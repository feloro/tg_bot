/**
 * End-to-end check that runs the real production code path locally:
 *
 *   mock Telegram  <--  poller (long polling)  -->  wrangler dev (the Worker)  -->  mock Telegram
 *
 * The Worker is started with `--persist-to` pointed at a throwaway directory and
 * given its secrets through `--env-file`, so the test never touches your local
 * D1 state or your real `.dev.vars`.
 *
 * Usage: npm run e2e
 * Exits non-zero on the first failed assertion.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MOCK_PORT = Number(process.env["E2E_MOCK_PORT"] ?? "8788");
const WORKER_PORT = Number(process.env["E2E_WORKER_PORT"] ?? "8787");
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}/`;
const READY_TIMEOUT_MS = 120_000;
const SCENARIO_TIMEOUT_MS = 120_000;

const EXPECTED_REPLIES = 8;

interface SendMessage {
  chat_id: number | null;
  parse_mode: string | null;
  text: string | null;
}

const children: ChildProcess[] = [];
const workDir = mkdtempSync(join(tmpdir(), "tg-e2e-"));

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function launch(name: string, cmd: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so the whole tree can be signalled on teardown.
    detached: process.platform !== "win32",
  });
  const prefix = `[${name}] `;
  const relay = (stream: NodeJS.ReadableStream | null): void => {
    let buffer = "";
    stream?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") console.log(prefix + line);
      }
    });
  };
  relay(child.stdout);
  relay(child.stderr);
  children.push(child);
  return child;
}

/** Run a command to completion, streaming its output. */
function runToCompletion(name: string, cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`${name} failed (exit ${result.status}):\n${output}`);
  }
  for (const line of output.split("\n")) {
    if (line.trim() !== "") console.log(`[${name}] ${line}`);
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status > 0) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await sleep(500);
  }
}

interface MockState {
  calls: { api: string }[];
  sendMessages: SendMessage[];
}

async function mockState(): Promise<MockState> {
  const response = await fetch(`${MOCK_BASE}/__calls`, { signal: AbortSignal.timeout(10_000) });
  return (await response.json()) as MockState;
}

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail === "" ? "" : ` -> ${detail}`}`);
    failures.push(label);
  }
}

/** Kill a child and everything it spawned (wrangler forks workerd). */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

function cleanup(): void {
  for (const child of children) {
    killTree(child);
  }
  rmSync(workDir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log(`workdir: ${workDir}`);
  console.log(`mock ${MOCK_BASE} | worker ${WORKER_URL}\n`);

  // Secrets for the Worker come from a throwaway env file, not .dev.vars.
  const envFile = join(workDir, "e2e.env");
  writeFileSync(
    envFile,
    [`BOT_TOKEN=e2e-token`, `TELEGRAM_API_BASE=${MOCK_BASE}`].join("\n"),
    "utf8",
  );

  launch("mock", process.execPath, ["scripts/mock-telegram.ts", String(MOCK_PORT)]);
  await waitForHttp(`${MOCK_BASE}/__calls`, 20_000);
  console.log("");

  // Invoke the local wrangler through node directly: `npx` is a .cmd shim on
  // Windows and cannot be spawned without a shell.
  const wrangler = join(REPO_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  const stateDir = join(workDir, "state");

  // A fresh --persist-to directory has no schema, so migrate it before booting.
  runToCompletion("migrate", process.execPath, [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "users",
    "--local",
    "--persist-to",
    stateDir,
  ]);

  launch("worker", process.execPath, [
    wrangler,
    "dev",
    "--port",
    String(WORKER_PORT),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    stateDir,
    "--env-file",
    envFile,
  ]);
  await waitForHttp(WORKER_URL, READY_TIMEOUT_MS);
  console.log("");

  launch("poller", process.execPath, [
    "scripts/poller.ts",
  ], { BOT_TOKEN: "e2e-token", TELEGRAM_API_BASE: MOCK_BASE, WORKER_URL });

  // Wait for the whole scripted conversation to be answered.
  const deadline = Date.now() + SCENARIO_TIMEOUT_MS;
  for (;;) {
    const state = await mockState();
    if (state.sendMessages.length >= EXPECTED_REPLIES) break;
    if (Date.now() > deadline) {
      throw new Error(
        `only ${state.sendMessages.length}/${EXPECTED_REPLIES} replies after ${SCENARIO_TIMEOUT_MS / 1000}s`,
      );
    }
    await sleep(500);
  }
  await sleep(1500);

  const state = await mockState();
  const sent = state.sendMessages;
  const apis = new Set(state.calls.map((c) => c.api));

  console.log("\n--- assertions ---");

  check("poller checked the webhook first", apis.has("getWebhookInfo"));
  check("poller long-polled for updates", apis.has("getUpdates"));
  check("worker called sendMessage", apis.has("sendMessage"));

  check(
    `all ${EXPECTED_REPLIES} scenario updates answered`,
    sent.length === EXPECTED_REPLIES,
    `got ${sent.length}`,
  );

  check(
    "every reply went to the scenario chat",
    sent.every((m) => m.chat_id === 424242),
  );

  const hasText = (needle: string): boolean => sent.some((m) => (m.text ?? "").includes(needle));
  check("/register acknowledged", hasText("добавлен в рассылку"));
  check("duplicate /register acknowledged again", sent.filter((m) => (m.text ?? "").includes("добавлен в рассылку")).length === 2);
  check("/unregister acknowledged", hasText("убран из рассылки"));
  check("/today answered", hasText("Игры на сегодня"));
  check("/past answered", hasText("Игры за прошедшие 5 дней"));
  check("/soon answered", hasText("Игры в ближайшие 5 дней"));
  check("/help answered", hasText("/today"));
  check("plain text fell through to help", sent.filter((m) => (m.text ?? "").includes("справки")).length === 1);

  check(
    "MarkdownV2 escaping applied where Markdown is not",
    sent.some((m) => m.parse_mode === "MarkdownV2" && (m.text ?? "").includes("\\-")),
    `parse modes: ${[...new Set(sent.map((m) => m.parse_mode))].join(",")}`,
  );
  check(
    "plain Markdown used for short replies",
    sent.some((m) => m.parse_mode === "Markdown" || m.parse_mode === null),
  );

  console.log("\n--- sample replies ---");
  for (const [index, message] of sent.entries()) {
    const preview = (message.text ?? "").replace(/\n/g, "\\n").slice(0, 78);
    console.log(`  ${index + 1}. mode=${message.parse_mode ?? "-"} :: ${preview}`);
  }

  console.log("");
  if (failures.length > 0) {
    console.log(`E2E FAILED: ${failures.length} assertion(s) failed`);
    finish(1);
  } else {
    console.log("E2E PASSED");
    finish(0);
  }
}

/**
 * Children keep the event loop alive through their stdio pipes, so teardown and
 * exit have to be explicit or the run hangs after the last assertion.
 */
function finish(code: number): void {
  cleanup();
  process.exit(code);
}

process.on("exit", cleanup);

main().catch((error: unknown) => {
  console.error("\nE2E ERROR:", error instanceof Error ? error.message : error);
  finish(1);
});
