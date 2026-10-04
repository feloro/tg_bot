CREATE TABLE IF NOT EXISTS season_cache (
  league     TEXT PRIMARY KEY,
  season     INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
