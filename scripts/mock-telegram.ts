/**
 * Scriptable stand-in for the Telegram Bot API, used by `npm run e2e` so the whole
 * webhook path can be exercised without a real token or network access.
 *
 * Implements just what the bot and the poller call:
 *   getWebhookInfo, deleteWebhook, getUpdates, sendMessage
 * plus two test-only routes:
 *   GET /__calls -> every recorded call, for assertions
 *   GET /__reset -> clear recorded calls and rewind the scenario
 *
 * `getUpdates` follows Telegram's offset semantics: it returns every
 * not-yet-consumed update with `update_id >= offset`. When nothing is left it
 * blocks for the requested `timeout` (capped, so tests stay fast) and returns an
 * empty list, which is the long-poll path.
 *
 * `node scripts/mock-telegram.ts [port] [--set-webhook]` starts with a webhook
 * already registered, which is the condition that makes the real API answer 409.
 *
 * Not part of the Worker bundle.
 */

import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

const argv = process.argv.slice(2);
const PORT = Number(argv.find((a) => /^\d+$/.test(a)) ?? "8788");
const START_WITH_WEBHOOK = argv.includes("--set-webhook");

interface Update {
  update_id: number;
  message: {
    message_id: number;
    from: { id: number; username: string };
    chat: { id: number; type: string };
    date: number;
    text: string;
  };
}

interface RecordedCall {
  api: string;
  params: Record<string, string>;
  body: Record<string, unknown> | null;
}

const CHAT_ID = 424242;
const BASE_TIME = 1759430400;
const MAX_LONG_POLL_MS = 1200;

function update(id: number, text: string): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { id: CHAT_ID, username: "e2e" },
      chat: { id: CHAT_ID, type: "private" },
      date: BASE_TIME + id,
      text,
    },
  };
}

/** The conversation `npm run e2e` drives through the poller. */
const SCENARIO: Update[] = [
  update(1, "/register"),
  update(2, "/today"),
  update(3, "/past"),
  update(4, "/soon"),
  update(5, "/help"),
  update(6, "привет"),
  update(7, "/register"),
  update(8, "/unregister"),
];

let webhookUrl = START_WITH_WEBHOOK ? "https://example.invalid/webhook" : "";
let nextOffset = 1;
const calls: RecordedCall[] = [];

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function pendingCount(): number {
  return SCENARIO.filter((u) => u.update_id >= nextOffset).length;
}

function handleApi(
  api: string,
  params: Record<string, string>,
  res: ServerResponse,
): void {
  if (api === "getWebhookInfo") {
    json(res, {
      ok: true,
      result: { url: webhookUrl, pending_update_count: pendingCount() },
    });
    return;
  }

  if (api === "deleteWebhook") {
    webhookUrl = "";
    json(res, { ok: true, result: true });
    return;
  }

  if (api === "setWebhook") {
    webhookUrl = params["url"] ?? "";
    json(res, { ok: true, result: true });
    return;
  }

  if (api === "getUpdates") {
    const offset = Number(params["offset"] ?? "0");
    // A negative offset is how a poller asks to discard the backlog.
    const result = offset < 0 ? [] : SCENARIO.filter((u) => u.update_id >= offset);
    if (result.length === 0) {
      const wait = Math.min(Number(params["timeout"] ?? "0") * 1000, MAX_LONG_POLL_MS);
      setTimeout(() => json(res, { ok: true, result: [] }), wait);
      return;
    }
    nextOffset = result[result.length - 1].update_id + 1;
    json(res, { ok: true, result });
    return;
  }

  if (api === "sendMessage") {
    json(res, { ok: true, result: { message_id: calls.length } });
    return;
  }

  json(res, { ok: false, error_code: 404, description: `Not Found: ${api}` });
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/__calls") {
    json(res, {
      calls,
      sendMessages: calls
        .filter((c) => c.api === "sendMessage")
        .map((c) => ({
          chat_id: c.body?.["chat_id"] ?? null,
          parse_mode: c.body?.["parse_mode"] ?? null,
          text: c.body?.["text"] ?? null,
        })),
    });
    return;
  }

  if (url.pathname === "/__reset") {
    calls.length = 0;
    nextOffset = 1;
    json(res, { ok: true });
    return;
  }

  const api = url.pathname.split("/").pop() ?? "";
  const params = Object.fromEntries(url.searchParams);

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body: Record<string, unknown> | null = null;
    try {
      body = raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>);
    } catch {
      body = null;
    }
    calls.push({ api, params, body });
    handleApi(api, params, res);
  });
}).listen(PORT, "127.0.0.1", () => {
  const state = webhookUrl === "" ? "no webhook" : `webhook=${webhookUrl}`;
  console.log(`mock-telegram on http://127.0.0.1:${PORT} (${state})`);
  console.log(`scenario: ${SCENARIO.length} updates -> ${SCENARIO.map((u) => u.message.text).join(", ")}`);
});
