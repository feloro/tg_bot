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
});

export type TeamNameLocale = z.infer<typeof teamNameLocaleSchema>;
export type Season = z.infer<typeof seasonSchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type Game = z.infer<typeof gameSchema>;