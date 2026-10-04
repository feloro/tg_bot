import { downloadGames } from "../api/vtb";
import type { Env } from "../types/env";
import type { Game } from "../types/vtb";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function readCache(env: Env): Promise<Game[] | null> {
  const row = await env.DB.prepare(
    "SELECT payload, fetched_at FROM schedule_cache WHERE id = 1",
  ).first<{ payload: string; fetched_at: number }>();
  if (row === null || Date.now() - row.fetched_at > CACHE_TTL_MS) {
    return null;
  }
  return JSON.parse(row.payload) as Game[];
}

async function writeCache(env: Env, games: readonly Game[]): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO schedule_cache (id, payload, fetched_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at",
  )
    .bind(JSON.stringify(games), Date.now())
    .run();
}

/**
 * A full season download costs several ms of the Free tier's 10 ms CPU budget, so
 * the result is cached in D1 and the hourly cron only pays for a ~30 kB read.
 */
export async function getSchedule(env: Env): Promise<Game[]> {
  const cached = await readCache(env);
  if (cached !== null) {
    return cached;
  }
  const games = await downloadGames();
  await writeCache(env, games);
  return games;
}

export async function findGame(
  env: Env,
  matchId: number,
): Promise<Game | undefined> {
  const games = await getSchedule(env);
  return games.find((game) => game.matchId === matchId);
}