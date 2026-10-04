import { z } from "zod";
import type { Env } from "./types/env";

const configSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  TELEGRAM_API_BASE: z.string().url(),
  TELEGRAM_WEBHOOK_SECRET: z.string(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Env): Config {
  return configSchema.parse(env);
}