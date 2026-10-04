import { getGames } from "../api/vtb";
import { sendMessage } from "../api/telegram";
import { createUser, getUser, removeUser } from "../db/users";
import { getSchedule, type Schedule } from "../db/schedule";
import { logger } from "../logger";
import type { Env } from "../types/env";
import type { IncomingMessage } from "../types/telegram";
import { parseCommand } from "../types/telegram";
import { addDays, today } from "../util/datetime";
import { escapeMarkdownV2, formatGames } from "./gameFormatter";

const HELP_TEXT =
  "Для того, чтобы получить список матчей на сегодня - /today\n" +
  "Список матчей на 5 дней вперед - /soon\n" +
  "Список матчей за последние 5 дней - /past";

const FALLBACK_TEXT =
  "Для получения справки воспользуйтесь коммандой - /help";

function logCommand(message: IncomingMessage): void {
  logger.info(
    `function ${message.text} by ${message.username} at ${new Date().toISOString()}`,
  );
}

async function getCommandSchedule(env: Env, chatId: number): Promise<Schedule | null> {
  try {
    return await getSchedule(env, true);
  } catch (error) {
    logger.error(`schedule unavailable: ${String(error)}`);
    await sendMessage(env, chatId, "Расписание временно недоступно, попробуйте позже");
    return null;
  }
}

function scheduleWarning(schedule: Schedule): string {
  if (!schedule.stale) return "";
  const updatedAt = new Date(schedule.fetchedAt).toISOString();
  return `Не удалось обновить расписание; резервные данные от ${updatedAt}\n\n`;
}

async function sendTodayGames(
  env: Env,
  message: IncomingMessage,
): Promise<void> {
  logCommand(message);
  const schedule = await getCommandSchedule(env, message.chatId);
  if (schedule === null) return;
  const { games } = schedule;
  const day = today();
  const text = `${scheduleWarning(schedule)}Игры на сегодня:${formatGames(getGames(day, day, games), false)}`;
  await sendMessage(env, message.chatId, text, "Markdown");
}

async function sendSoonGames(env: Env, message: IncomingMessage): Promise<void> {
  logCommand(message);
  const schedule = await getCommandSchedule(env, message.chatId);
  if (schedule === null) return;
  const { games } = schedule;
  const day = today();
  const text = `${scheduleWarning(schedule)}Игры в ближайшие 5 дней:${formatGames(
    getGames(day, addDays(day, 5), games),
    false,
  )}`;
  await sendMessage(env, message.chatId, text, "Markdown");
}

async function sendPastGames(env: Env, message: IncomingMessage): Promise<void> {
  logCommand(message);
  const schedule = await getCommandSchedule(env, message.chatId);
  if (schedule === null) return;
  const { games } = schedule;
  const day = today();
  const formatted = formatGames(
    getGames(addDays(day, -5), day, games),
    true,
  );
  await sendMessage(
    env,
    message.chatId,
    escapeMarkdownV2(`${scheduleWarning(schedule)}Игры за прошедшие 5 дней:${formatted}`),
    "MarkdownV2",
  );
}

async function sendHelp(env: Env, message: IncomingMessage): Promise<void> {
  await sendMessage(env, message.chatId, HELP_TEXT);
}

async function registerUser(env: Env, message: IncomingMessage): Promise<void> {
  logCommand(message);
  const existing = await getUser(env, message.chatId);
  if (existing === null) {
    await createUser(env, message.chatId);
  }
  await sendMessage(
    env,
    message.chatId,
    "Ваш пользователь добавлен в рассылку",
    "Markdown",
  );
}

async function unregisterUser(env: Env, message: IncomingMessage): Promise<void> {
  logCommand(message);
  await removeUser(env, message.chatId);
  await sendMessage(
    env,
    message.chatId,
    "Ваш пользователь убран из рассылки",
    "Markdown",
  );
}

export async function handleMessage(
  env: Env,
  message: IncomingMessage,
): Promise<void> {
  const command = message.text === null ? null : parseCommand(message.text);

  switch (command) {
    case "today":
      return sendTodayGames(env, message);
    case "soon":
      return sendSoonGames(env, message);
    case "past":
      return sendPastGames(env, message);
    case "help":
      return sendHelp(env, message);
    case "register":
      return registerUser(env, message);
    case "unregister":
      return unregisterUser(env, message);
    default:
      return sendMessage(env, message.chatId, FALLBACK_TEXT);
  }
}
