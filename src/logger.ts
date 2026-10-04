type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR";

const LOGGER_NAME = "MyLogger";

function emit(level: Level, message: string): void {
  console.log(
    JSON.stringify({
      message,
      level,
      logger: LOGGER_NAME,
      timestamp: new Date().toISOString(),
    }),
  );
}

export const logger = {
  debug: (message: string): void => emit("DEBUG", message),
  info: (message: string): void => emit("INFO", message),
  warn: (message: string): void => emit("WARNING", message),
  error: (message: string): void => emit("ERROR", message),
};