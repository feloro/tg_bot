export interface MatchBroadcastMessage {
  matchId: number;
  offset: number;
}

export interface Env {
  readonly BOT_TOKEN: string;
  readonly DB: D1Database;
  readonly MATCH_BROADCASTS: Queue<MatchBroadcastMessage>;
  readonly TELEGRAM_API_BASE: string;
  readonly TELEGRAM_WEBHOOK_SECRET: string;
}