import { videoUrl } from "../api/vtb";
import type { Competitor, Game } from "../types/vtb";
import { formatStartTime } from "../util/datetime";

function teamName(competitor: Competitor): string {
  return competitor.teamName?.ru || "TBA";
}

export async function formatGames(
  games: readonly Game[],
  withScore: boolean,
): Promise<string> {
  let responseText = "";

  for (const game of games) {
    const url = await videoUrl(game);
    const link = url === null ? "Отсутствует" : `[Ссылка](${url})`;
    const timeStart = formatStartTime(game.matchTimeMSK) ?? "";

    const competitors = game.competitors;
    if (competitors !== null && competitors !== undefined) {
      const [first, second] = competitors;
      if (first === undefined) {
        continue;
      }
      const homeCompetitor = first.isHomeCompetitor ? first : second;
      const guestCompetitor = first.isHomeCompetitor ? second : first;
      if (homeCompetitor === undefined || guestCompetitor === undefined) {
        continue;
      }

      responseText += `\n*${teamName(homeCompetitor)}* - *${teamName(guestCompetitor)}* \n*Начало матча:* ${timeStart} \n*Ссылка на транляцию:* ${link}`;
      if (withScore) {
        responseText += `\nCчет: ||${homeCompetitor.scoreString} : ${guestCompetitor.scoreString}||`;
      }
    } else {
      responseText += `\n*TBA* - *TBA* \n*Начало матча:* ${timeStart} \n*Ссылка на транляцию:* ${link}`;
    }

    responseText += "\n\n";
  }

  return responseText;
}

export function escapeMarkdownV2(text: string): string {
  return text.replaceAll("-", "\\-").replaceAll(".", "\\.");
}