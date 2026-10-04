const MATCH_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export const BROADCAST_LEAD_MINUTES = 15;

export const MAX_QUEUE_DELAY_SECONDS = 86400;

/**
 * Wall-clock date of a match in its own UTC offset. The VTB API always sends
 * MSK (+03:00) in `matchTimeMSK`, so this needs no timezone conversion.
 */
export function matchDate(matchTimeMSK: string): string {
  return matchTimeMSK.slice(0, 10);
}

export function matchInstant(matchTimeMSK: string): number {
  return Date.parse(matchTimeMSK);
}

/** Formats the match's wall-clock time as `HH:MM dd.mm`. */
export function formatStartTime(matchTimeMSK: string): string | null {
  const match = MATCH_TIME_RE.exec(matchTimeMSK);
  if (match === null) {
    return null;
  }
  return `${match[4]}:${match[5]} ${match[3]}.${match[2]}`;
}

/** Current UTC calendar date as `YYYY-MM-DD`. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Adds calendar days to a `YYYY-MM-DD` UTC date. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function broadcastInstant(matchTimeMSK: string): number {
  return matchInstant(matchTimeMSK) - BROADCAST_LEAD_MINUTES * 60 * 1000;
}

export { DAY_MS };
