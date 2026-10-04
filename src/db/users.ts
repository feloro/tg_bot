import type { Env } from "../types/env";

export async function getUser(env: Env, userId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT user_id FROM users WHERE user_id = ?",
  )
    .bind(String(userId))
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function createUser(env: Env, userId: number): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)")
    .bind(String(userId))
    .run();
}

export async function removeUser(env: Env, userId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM users WHERE user_id = ?")
    .bind(String(userId))
    .run();
}

export async function getUsers(env: Env): Promise<string[]> {
  const result = await env.DB.prepare("SELECT user_id FROM users").all<{
    user_id: string;
  }>();
  return result.results.map((row) => row.user_id);
}

export async function getUsersChunk(
  env: Env,
  offset: number,
  limit: number,
): Promise<string[]> {
  const result = await env.DB.prepare(
    "SELECT user_id FROM users ORDER BY user_id LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all<{ user_id: string }>();
  return result.results.map((row) => row.user_id);
}