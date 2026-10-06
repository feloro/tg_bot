import { downloadGames } from "../api/vtb";
import type { Env } from "../types/env";
import type { Game } from "../types/vtb";

export interface Schedule {
  games: Game[];
  fetchedAt: number;
}

export async function getSchedule(env: Env): Promise<Schedule> {
  const games = await downloadGames(env);
  return { games, fetchedAt: Date.now() };
}
