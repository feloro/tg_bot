import { getSchedule } from "../db/schedule";
import { logger } from "../logger";
import type { Env, MatchBroadcastMessage } from "../types/env";
import {
  broadcastInstant,
  MAX_QUEUE_DELAY_SECONDS,
} from "../util/datetime";

const SEND_BATCH_SIZE = 100;

const ENTRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const CHUNK_RETENTION_DAYS = 30;

interface PendingMatch {
  matchId: number;
  fireAt: number;
}

async function getEnqueuedKeys(env: Env): Promise<Set<string>> {
  const result = await env.DB.prepare(
    "SELECT match_id, fire_at FROM enqueued_matches",
  ).all<{ match_id: number; fire_at: number }>();
  return new Set(result.results.map((row) => `${row.match_id}:${row.fire_at}`));
}

async function recordMatches(env: Env, pending: PendingMatch[]): Promise<void> {
  if (pending.length === 0) {
    return;
  }
  const statements = pending.map((item) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO enqueued_matches (match_id, fire_at) VALUES (?, ?)",
    ).bind(item.matchId, item.fireAt),
  );
  await env.DB.batch(statements);
}

async function pruneEntries(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM enqueued_matches WHERE fire_at < ?").bind(
      now - ENTRY_RETENTION_MS,
    ),
    env.DB.prepare(
      "DELETE FROM sent_chunks WHERE sent_at < datetime('now', ?)",
    ).bind(`-${CHUNK_RETENTION_DAYS} days`),
  ]);
}

async function publish(env: Env, pending: PendingMatch[], now: number) {
  for (let i = 0; i < pending.length; i += SEND_BATCH_SIZE) {
    const slice = pending.slice(i, i + SEND_BATCH_SIZE);
    const messages: MessageSendRequest<MatchBroadcastMessage>[] = slice.map(
      (item) => ({
        body: { matchId: item.matchId, offset: 0 },
        delaySeconds: Math.floor((item.fireAt - now) / 1000),
      }),
    );
    await env.MATCH_BROADCASTS.sendBatch(messages);
  }
  await recordMatches(env, pending);
}

/**
 * Queues delays are capped at 24 h, so every hourly run only publishes matches
 * whose broadcast instant falls inside that window. Re-keying on fire_at means a
 * rescheduled match gets a fresh message instead of being silently skipped.
 */
export async function enqueueUpcomingMatches(env: Env): Promise<void> {
  const games = await getSchedule(env);
  const now = Date.now();
  const horizon = now + MAX_QUEUE_DELAY_SECONDS * 1000;
  const already = await getEnqueuedKeys(env);

  const pending: PendingMatch[] = [];
  for (const game of games) {
    const fireAt = broadcastInstant(game.matchTimeMSK);
    if (!Number.isFinite(fireAt) || fireAt <= now || fireAt > horizon) {
      continue;
    }
    if (already.has(`${game.matchId}:${fireAt}`)) {
      continue;
    }
    pending.push({ matchId: game.matchId, fireAt });
  }

  await publish(env, pending, now);
  await pruneEntries(env, now);

  logger.info(
    `scheduler: ${games.length} games scanned, ${pending.length} queued for broadcast`,
  );
}