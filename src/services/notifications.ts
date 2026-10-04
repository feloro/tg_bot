import { sendMessage } from "../api/telegram";
import { getSchedule } from "../db/schedule";
import { getUsersChunk } from "../db/users";
import { logger } from "../logger";
import type { Env, MatchBroadcastMessage } from "../types/env";
import { broadcastInstant } from "../util/datetime";
import { formatGames } from "./gameFormatter";

/**
 * Workers Free allows 50 subrequests per invocation. A chunk costs one send per
 * user before Telegram retries, plus two API calls for matches (four on a season
 * cache miss).
 * Rate-limit retries can exceed the cap; chunking alone does not bound them.
 */
const USERS_PER_CHUNK = 20;

const MAX_CONCURRENT_SENDS = 6;

const CHUNK_RETRY_DELAY_SECONDS = 1;

const EARLY_TOLERANCE_MS = 60 * 1000;

const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

async function claimChunk(
  env: Env,
  matchId: number,
  chunkIndex: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO sent_chunks (match_id, chunk_index) VALUES (?, ?)",
  )
    .bind(matchId, chunkIndex)
    .run();
  return result.meta.changes > 0;
}

async function sendToUser(
  env: Env,
  userId: string,
  text: string,
): Promise<void> {
  try {
    await sendMessage(env, Number(userId), text, "Markdown");
  } catch (error) {
    logger.error(
      `broadcast failed for ${userId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function sendInBatches(env: Env, users: string[], text: string) {
  for (let i = 0; i < users.length; i += MAX_CONCURRENT_SENDS) {
    const window = users.slice(i, i + MAX_CONCURRENT_SENDS);
    await Promise.all(window.map((userId) => sendToUser(env, userId, text)));
  }
}

/**
 * Broadcasts one chunk of subscribers for a single match. Workers Free allows
 * only 50 subrequests per invocation, so the remainder is re-queued.
 */
export async function broadcastMatch(
  env: Env,
  message: MatchBroadcastMessage,
): Promise<void> {
  const { matchId, offset } = message;
  const users = await getUsersChunk(env, offset, USERS_PER_CHUNK);
  if (users.length === 0) {
    return;
  }

  const chunkIndex = Math.floor(offset / USERS_PER_CHUNK);
  let snapshot = message.snapshot;
  if (snapshot === undefined || Date.now() - snapshot.fetchedAt >= SNAPSHOT_MAX_AGE_MS) {
    const { games, fetchedAt } = await getSchedule(env);
    const game = games.find((item) => item.matchId === matchId);
    if (game === undefined || game.matchStatus === "COMPLETE") {
      logger.warn(`match ${matchId} unavailable or completed, broadcast skipped`);
      return;
    }
    // A message queued for an old start time may fire before the rescheduled match.
    const fireAt = broadcastInstant(game.matchTimeMSK);
    if (!Number.isFinite(fireAt) || Date.now() < fireAt - EARLY_TOLERANCE_MS) {
      logger.warn(`match ${matchId} is not due yet or has an invalid start time, broadcast skipped`);
      return;
    }
    snapshot = { text: formatGames([game], false), fetchedAt };
  }

  if (!(await claimChunk(env, matchId, chunkIndex))) {
    logger.warn(`chunk ${chunkIndex} of match ${matchId} already sent, skipping`);
    return;
  }

  await sendInBatches(env, users, snapshot.text);
  logger.info(`match ${matchId}: sent chunk ${chunkIndex} to ${users.length} users`);

  if (users.length === USERS_PER_CHUNK) {
    await env.MATCH_BROADCASTS.send(
      { matchId, offset: offset + USERS_PER_CHUNK, snapshot },
      { delaySeconds: CHUNK_RETRY_DELAY_SECONDS },
    );
  }
}
