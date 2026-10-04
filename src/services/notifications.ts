import { sendMessage } from "../api/telegram";
import { findGame } from "../db/schedule";
import { getUsersChunk } from "../db/users";
import { logger } from "../logger";
import type { Env } from "../types/env";
import { broadcastInstant } from "../util/datetime";
import { formatGames } from "./gameFormatter";

/**
 * Workers Free allows 50 subrequests per invocation. A chunk costs one send per
 * user, up to four API calls when the schedule is refreshed, and a handful of
 * D1 queries, so 20 leaves a wide margin under the cap.
 */
const USERS_PER_CHUNK = 20;

const MAX_CONCURRENT_SENDS = 6;

const CHUNK_RETRY_DELAY_SECONDS = 1;

const EARLY_TOLERANCE_MS = 60 * 1000;

/**
 * Broadcast links are published shortly before the match, well inside the six
 * hour cache window the commands use. Refreshing at broadcast time picks them
 * up, while the chunks queued right after reuse the freshly written cache
 * instead of downloading the season once per chunk.
 */
const BROADCAST_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

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
  matchId: number,
  offset: number,
): Promise<void> {
  const users = await getUsersChunk(env, offset, USERS_PER_CHUNK);
  if (users.length === 0) {
    return;
  }

  const chunkIndex = Math.floor(offset / USERS_PER_CHUNK);
  const game = await findGame(env, matchId, BROADCAST_CACHE_MAX_AGE_MS);
  if (game === undefined) {
    logger.warn(`match ${matchId} not found in schedule, broadcast skipped`);
    return;
  }

  // A message queued for an old start time fires early once the league reschedules.
  const fireAt = broadcastInstant(game.matchTimeMSK);
  if (Date.now() < fireAt - EARLY_TOLERANCE_MS) {
    logger.warn(
      `match ${matchId} is not due yet (${new Date(fireAt).toISOString()}), broadcast skipped`,
    );
    return;
  }

  if (!(await claimChunk(env, matchId, chunkIndex))) {
    logger.warn(`chunk ${chunkIndex} of match ${matchId} already sent, skipping`);
    return;
  }

  const text = formatGames([game], false);
  await sendInBatches(env, users, text);
  logger.info(`match ${matchId}: sent chunk ${chunkIndex} to ${users.length} users`);

  if (users.length === USERS_PER_CHUNK) {
    await env.MATCH_BROADCASTS.send(
      { matchId, offset: offset + USERS_PER_CHUNK },
      { delaySeconds: CHUNK_RETRY_DELAY_SECONDS },
    );
  }
}