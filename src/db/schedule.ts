import { downloadGames } from "../api/vtb";
import { logger } from "../logger";
import type { Env } from "../types/env";
import type { Game } from "../types/vtb";

export interface Schedule {
  games: Game[];
  fetchedAt: number;
  stale: boolean;
}

async function readCache(env: Env): Promise<Schedule | null> {
  const row = await env.DB.prepare(
    "SELECT payload, fetched_at FROM schedule_cache WHERE id = 1",
  ).first<{ payload: string; fetched_at: number }>();
  if (row === null) return null;
  return {
    games: JSON.parse(row.payload) as Game[],
    fetchedAt: row.fetched_at,
    stale: true,
  };
}

async function writeCache(env: Env, games: readonly Game[], fetchedAt: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO schedule_cache (id, payload, fetched_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at",
  )
    .bind(JSON.stringify(games), fetchedAt)
    .run();
}

/** Always fetch live data; only user-facing commands may opt into stale fallback. */
export async function getSchedule(env: Env, allowFallback = false): Promise<Schedule> {
  let games: Game[];
  try {
    games = await downloadGames(env);
  } catch (error) {
    if (allowFallback) {
      const cached = await readCache(env);
      if (cached !== null) {
        logger.warn(`schedule refresh failed, using backup from ${new Date(cached.fetchedAt).toISOString()}`);
        return cached;
      }
    }
    throw error;
  }
  const fetchedAt = Date.now();
  try {
    await writeCache(env, games, fetchedAt);
  } catch (error) {
    // A backup write failure must not discard a successful live response.
    logger.error(`schedule backup write failed: ${String(error)}`);
  }
  return { games, fetchedAt, stale: false };
}
