import { loadConfig } from "./config";
import { logger } from "./logger";
import { enqueueUpcomingMatches } from "./scheduler/enqueue";
import { handleMessage } from "./services/commands";
import { broadcastMatch } from "./services/notifications";
import type { IncomingMessage } from "./types/telegram";
import { parseUpdate } from "./types/telegram";
import type { Env, MatchBroadcastMessage } from "./types/env";

const WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

async function handleWebhook(env: Env, body: string): Promise<void> {
  const update = parseUpdate(body);
  const message = update.message;
  if (message === null || message === undefined) {
    return;
  }
  const from = message.from;
  if (from === null || from === undefined) {
    return;
  }

  const incoming: IncomingMessage = {
    chatId: from.id,
    username: from.username ?? "unknown",
    text: message.text ?? null,
  };
  await handleMessage(env, incoming);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "GET") {
      return new Response("ok");
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    loadConfig(env);

    if (env.TELEGRAM_WEBHOOK_SECRET !== "") {
      const provided = request.headers.get(WEBHOOK_SECRET_HEADER);
      if (provided !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
    }

    const body = await request.text();
    ctx.waitUntil(
      handleWebhook(env, body).catch((error: unknown) => {
        logger.error(
          `webhook failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }),
    );

    return new Response("!", { status: 200 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await enqueueUpcomingMatches(env);
  },

  async queue(
    batch: MessageBatch<MatchBroadcastMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      await broadcastMatch(env, message.body.matchId, message.body.offset);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, MatchBroadcastMessage>;