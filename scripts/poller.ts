/**
 * Dev-only bridge: long-polls the Telegram Bot API and replays every update into
 * the locally running Worker, so a real bot can drive `wrangler dev` without a
 * public webhook URL and without deploying anything.
 *
 * This file is never bundled into the Worker (`tsconfig.json` only includes `src/`).
 *
 * Requirements:
 *   - a dedicated bot token; the production one must keep serving its webhook,
 *     because Telegram refuses getUpdates while a webhook is registered
 *   - `npm run dev` listening on WORKER_URL
 *
 * Usage:
 *   node scripts/poller.ts
 *   node scripts/poller.ts --delete-webhook   # unregister the webhook first
 *   node scripts/poller.ts --drop-pending     # discard the backlog on start
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const POLL_TIMEOUT_SECONDS = 25;
const NETWORK_RETRY_BASE_MS = 1000;
const NETWORK_RETRY_MAX_MS = 15000;

interface ApiOk<T> {
  ok: true;
  result: T;
}

interface ApiErr {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
}

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

interface Update {
  update_id: number;
  message?: {
    text?: string;
    from?: { id: number; username?: string };
  };
}

class TelegramError extends Error {
  readonly code: number;
  readonly retryAfter: number | null;

  constructor(payload: ApiErr) {
    super(`${payload.error_code}: ${payload.description}`);
    this.code = payload.error_code;
    this.retryAfter = payload.parameters?.retry_after ?? null;
  }
}

function parseArgs(argv: string[]): { deleteWebhook: boolean; dropPending: boolean } {
  return {
    deleteWebhook: argv.includes("--delete-webhook"),
    dropPending: argv.includes("--drop-pending"),
  };
}

/** Minimal `.dev.vars` reader so the poller uses the same token as the Worker. */
function loadDevVars(): Record<string, string> {
  const file = resolve(REPO_ROOT, ".dev.vars");
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (match !== null) {
      out[match[1]] = match[2];
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function api<T>(
  method: string,
  token: string,
  base: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL(`/bot${token}/${method}`, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { method: "GET" });
  const payload = (await response.json()) as ApiOk<T> | ApiErr;
  if (payload.ok !== true) {
    throw new TelegramError(payload);
  }
  return payload.result;
}

async function replay(workerUrl: string, update: Update): Promise<void> {
  const response = await fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    throw new Error(`worker responded ${response.status} ${response.statusText}`);
  }
}

function describe(update: Update): string {
  const from = update.message?.from;
  const who = from === undefined ? "?" : (from.username ?? String(from.id));
  const text = update.message?.text;
  return text === undefined ? `${who} :: <non-text>` : `${who} :: ${text}`;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const devVars = loadDevVars();

  const token = process.env.BOT_TOKEN ?? devVars.BOT_TOKEN ?? "";
  const base = process.env.TELEGRAM_API_BASE ?? devVars.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  const workerUrl = process.env.WORKER_URL ?? "http://127.0.0.1:8787/";

  if (token === "" || token === "paste-real-token-here") {
    console.error("BOT_TOKEN is missing. Put a real token in .dev.vars or the environment.");
    process.exit(1);
  }

  const info = await api<WebhookInfo>("getWebhookInfo", token, base);
  if (info.url !== "") {
    if (!flags.deleteWebhook) {
      console.error(`This token still has a webhook: ${info.url}`);
      console.error("Use a dedicated bot, or re-run with --delete-webhook to unregister it.");
      process.exit(1);
    }
    await api<boolean>("deleteWebhook", token, base, { drop_pending_updates: "false" });
    console.log(`webhook unregistered (was ${info.url})`);
  }

  let offset = 0;
  if (flags.dropPending) {
    const skipped = await api<Update[]>("getUpdates", token, base, {
      offset: -1,
      limit: 1,
    });
    offset = skipped.length > 0 ? skipped[skipped.length - 1].update_id + 1 : 0;
    console.log(`dropped pending updates, resuming from ${offset}`);
  }

  console.log(`polling ${base}`);
  console.log(`replaying into ${workerUrl}`);
  console.log(`note: cron and the queue consumer stay manual locally — see README`);

  let failures = 0;
  for (;;) {
    try {
      const updates = await api<Update[]>("getUpdates", token, base, {
        offset,
        timeout: POLL_TIMEOUT_SECONDS,
      });
      failures = 0;
      for (const update of updates) {
        await replay(workerUrl, update);
        // Only advance past an update once the Worker has accepted it, otherwise
        // a failed replay would silently drop the message.
        offset = update.update_id + 1;
        console.log(`[${update.update_id}] ${describe(update)}`);
      }
    } catch (error) {
      if (error instanceof TelegramError && error.code === 409) {
        console.error("409 Conflict: a webhook is registered on this token. Stop the Worker first, then use --delete-webhook.");
        process.exit(1);
      }
      if (error instanceof TelegramError && error.retryAfter !== null) {
        failures = 0;
        await sleep(error.retryAfter * 1000);
        continue;
      }
      failures += 1;
      if (failures > 10) {
        console.error(`giving up after ${failures} consecutive failures:`, error);
        process.exit(1);
      }
      const delay = Math.min(NETWORK_RETRY_BASE_MS * 2 ** (failures - 1), NETWORK_RETRY_MAX_MS);
      console.error(`poll failed (${failures}/10), retrying in ${delay}ms:`, error instanceof Error ? error.message : error);
      await sleep(delay);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} — poller stopped`);
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error("fatal:", error);
  process.exit(1);
});