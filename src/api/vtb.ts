import { z } from "zod";
import {
  gameSchema,
  seasonSchema,
  type Game,
  type Season,
} from "../types/vtb";
import { matchDate } from "../util/datetime";

const LEAGUES = ["vtb", "wbc"] as const;

const API_BASE = "https://api.vtb-league.com/v2";

const MATCH_FIELDS = "matchId,matchStatus,matchTimeMSK,competitors";

const seasonsResponseSchema = z.object({
  data: z.array(seasonSchema),
});

const matchesResponseSchema = z.object({
  data: z.array(gameSchema),
});

const broadcastResponseSchema = z.object({
  data: z
    .object({
      broadcast: z.object({ iframeUrl: z.string() }).nullish(),
    })
    .nullish(),
});

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`VTB API ${response.status} for ${url}`);
  }
  return response.json();
}

export async function getCurrentSeason(league: string): Promise<Season> {
  const url = `${API_BASE}/leagues/${league}/seasons?limit=100&fields=isCurrent,season`;
  const parsed = seasonsResponseSchema.parse(await getJson(url));
  const season = parsed.data.find((item) => item.isCurrent);
  if (season === undefined) {
    throw new Error(`No current season for league ${league}`);
  }
  return season;
}

export async function downloadGamesByLeague(league: string): Promise<Game[]> {
  const season = await getCurrentSeason(league);
  const url =
    `${API_BASE}/leagues/${league}/seasons/${season.season}/matches` +
    `?limit=500&fields=${MATCH_FIELDS}`;
  const parsed = matchesResponseSchema.parse(await getJson(url));
  return parsed.data;
}

export async function downloadGames(): Promise<Game[]> {
  const byLeague = await Promise.all(LEAGUES.map(downloadGamesByLeague));
  return byLeague.flat();
}

export async function getVideoURL(matchId: number): Promise<string | null> {
  const url = `${API_BASE}/matches/${matchId}/info?fields=broadcast`;
  const parsed = broadcastResponseSchema.safeParse(await getJson(url));
  if (!parsed.success) {
    return null;
  }
  return parsed.data.data?.broadcast?.iframeUrl ?? null;
}

const videoUrlCache = new WeakMap<Game, string | null>();

export async function videoUrl(game: Game): Promise<string | null> {
  const cached = videoUrlCache.get(game);
  if (cached !== undefined) {
    return cached;
  }
  const url = await getVideoURL(game.matchId);
  videoUrlCache.set(game, url);
  return url;
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