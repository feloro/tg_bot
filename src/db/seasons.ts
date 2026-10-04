import type { Env } from "../types/env";
import type { Season } from "../types/vtb";

const SEASON_TTL_MS = 24 * 60 * 60 * 1000;

export async function readSeason(env: Env, league: string): Promise<Season | null> {
  const row = await env.DB.prepare(
    "SELECT season, fetched_at FROM season_cache WHERE league = ?",
  ).bind(league).first<{ season: number; fetched_at: number }>();
  if (row === null || Date.now() - row.fetched_at >= SEASON_TTL_MS) return null;
  return { season: row.season, isCurrent: true };
}

export async function writeSeason(env: Env, league: string, season: Season): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO season_cache (league, season, fetched_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(league) DO UPDATE SET season = excluded.season, fetched_at = excluded.fetched_at",
  ).bind(league, season.season, Date.now()).run();
}
