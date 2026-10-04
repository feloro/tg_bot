import type { Competitor, Game } from "../types/vtb";
import { formatStartTime } from "../util/datetime";

function teamName(competitor: Competitor): string {
  return competitor.teamName?.ru || "TBA";
}

/**
 * The provider appends utm tracking parameters whose underscores the legacy
 * Markdown parse mode used by /today, /soon and the broadcast treats as
 * emphasis delimiters, which makes Telegram reject the message. The tracking
 * parameters carry no meaning here, so the query string is dropped.
 */
function broadcastLink(game: Game): string {
  const raw = game.customValues?.externalBroadcast?.url;
  if (raw === undefined || raw === "") {
    return "Отсутствует";
  }
  const clean = raw.split("?")[0] ?? raw;
  return `[Ссылка](${clean})`;
}

export function formatGames(
  games: readonly Game[],
  withScore: boolean,
): string {
  let responseText = "";

  for (const game of games) {
    const link = broadcastLink(game);
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