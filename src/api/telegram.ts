import type { Env } from "../types/env";

export type ParseMode = "Markdown" | "MarkdownV2";

const MAX_RATE_LIMIT_RETRIES = 3;

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
}

export class TelegramApiError extends Error {
  readonly status: number;
  readonly chatId: number;
  readonly description: string;

  constructor(status: number, chatId: number, description: string) {
    super(`Telegram API ${status} for chat ${chatId}: ${description}`);
    this.name = "TelegramApiError";
    this.status = status;
    this.chatId = chatId;
    this.description = description;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTelegram(
  env: Env,
  chatId: number,
  text: string,
  parseMode?: ParseMode,
): Promise<void> {
  const url = `${env.TELEGRAM_API_BASE}/bot${env.BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode !== undefined) {
    body["parse_mode"] = parseMode;
  }

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const parsed = (await response.json()) as TelegramResponse;
    if (parsed.ok === true) {
      return;
    }

    const retryAfter = parsed.parameters?.retry_after;
    if (response.status === 429 && retryAfter !== undefined && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(retryAfter * 1000);
      continue;
    }

    throw new TelegramApiError(
      response.status,
      chatId,
      parsed.description ?? "unknown error",
    );
  }
}

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  parseMode?: ParseMode,
): Promise<void> {
  await callTelegram(env, chatId, text, parseMode);
}