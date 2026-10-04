import { z } from "zod";

export const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      text: z.string().nullish(),
      from: z
        .object({
          id: z.number(),
          username: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

export type Update = z.infer<typeof updateSchema>;

export interface IncomingMessage {
  chatId: number;
  username: string;
  text: string | null;
}

export function parseUpdate(body: string): Update {
  return updateSchema.parse(JSON.parse(body));
}

export function parseCommand(text: string): string | null {
  if (!text.startsWith("/")) {
    return null;
  }
  const [head] = text.slice(1).split(/\s/);
  if (head === undefined || head === "") {
    return null;
  }
  return head.split("@")[0]?.toLowerCase() ?? null;
}