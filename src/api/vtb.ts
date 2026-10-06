import { z } from "zod";
import { readSeason, writeSeason } from "../db/seasons";
import { logger } from "../logger";
import type { Env } from "../types/env";
import {
  gameSchema,
  seasonSchema,
  type Game,
  type Season,
} from "../types/vtb";
import { matchDate } from "../util/datetime";

const LEAGUES = ["vtb", "wbc"] as const;

const API_BASE = "https://api.vtb-league.com/v2";

const MATCH_FIELDS =
  "matchId,matchStatus,matchTimeMSK,competitors.isHomeCompetitor," +
  "competitors.scoreString,competitors.teamName.ru,customValues.externalBroadcast.url";

const seasonsResponseSchema = z.object({
  data: z.array(seasonSchema),
});

export const matchesResponseSchema = z.object({
  data: z.array(gameSchema),
});

const scheduledMatchesResponseSchema = z.object({
  data: z.array(gameSchema.pick({ matchId: true, matchTimeMSK: true })),
});

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`VTB API ${response.status} for ${url}`);
  }
  return response.json();
}

export async function getCurrentSeason(env: Env, league: string): Promise<Season> {
  const cached = await readSeason(env, league);
  if (cached !== null) return cached;
  const url = `${API_BASE}/leagues/${league}/seasons?limit=100&fields=isCurrent,season`;
  const parsed = seasonsResponseSchema.parse(await getJson(url));
  const season = parsed.data.find((item) => item.isCurrent);
  if (season === undefined) {
    throw new Error(`No current season for league ${league}`);
  }
  try {
    await writeSeason(env, league, season);
  } catch (error) {
    logger.error(`season cache write failed for ${league}: ${String(error)}`);
  }
  return season;
}

export async function downloadGamesByLeague(env: Env, league: string): Promise<Game[]> {
  const season = await getCurrentSeason(env, league);
  const url =
    `${API_BASE}/leagues/${league}/seasons/${season.season}/matches` +
    `?limit=500&fields=${MATCH_FIELDS}`;
  const parsed = matchesResponseSchema.parse(await getJson(url));
  return parsed.data;
}

export async function downloadGames(env: Env): Promise<Game[]> {
  const byLeague = await Promise.all(LEAGUES.map((league) => downloadGamesByLeague(env, league)));
  return byLeague.flat();
}

export async function downloadScheduledGames(env: Env): Promise<Pick<Game, "matchId" | "matchTimeMSK">[]> {
  const byLeague = await Promise.all(LEAGUES.map(async (league) => {
    const season = await getCurrentSeason(env, league);
    const url =
      `${API_BASE}/leagues/${league}/seasons/${season.season}/matches` +
      "?limit=500&fields=matchId,matchTimeMSK";
    return scheduledMatchesResponseSchema.parse(await getJson(url)).data;
  }));
  return byLeague.flat();
}

export function getFinishedGames(games: readonly Game[]): Game[] {
  return games.filter((game) => game.matchStatus === "COMPLETE");
}

export function getGames(
  startDate: string,
  endDate: string,
  games: readonly Game[],
): Game[] {
  return games.filter((game) => {
    const day = matchDate(game.matchTimeMSK);
    return startDate <= day && day <= endDate;
  });
}
