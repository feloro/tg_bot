import { z } from "zod";

export const teamNameLocaleSchema = z.object({
  ru: z.string(),
  en: z.string(),
});

export const seasonSchema = z.object({
  isCurrent: z.boolean(),
  season: z.number(),
});

export const competitorSchema = z.object({
  isHomeCompetitor: z.boolean(),
  scoreString: z.number(),
  teamName: teamNameLocaleSchema.nullish(),
  teamId: z.number().default(-1),
});

export const gameSchema = z.object({
  matchId: z.number(),
  matchStatus: z.string(),
  matchTimeMSK: z.string(),
  competitors: z.array(competitorSchema).nullish(),
  // Absent on every match the provider has not published a stream for yet, so
  // both levels must accept undefined. The url is deliberately not validated as
  // a URL: a single malformed value would otherwise fail the whole season parse.
  customValues: z
    .object({ externalBroadcast: z.object({ url: z.string() }).nullish() })
    .nullish(),
});

export type TeamNameLocale = z.infer<typeof teamNameLocaleSchema>;
export type Season = z.infer<typeof seasonSchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type Game = z.infer<typeof gameSchema>;