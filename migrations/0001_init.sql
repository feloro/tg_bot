CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enqueued_matches (
  match_id INTEGER NOT NULL,
  fire_at  INTEGER NOT NULL,
  PRIMARY KEY (match_id, fire_at)
);

CREATE TABLE IF NOT EXISTS schedule_cache (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_chunks (
  match_id    INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (match_id, chunk_index)
);