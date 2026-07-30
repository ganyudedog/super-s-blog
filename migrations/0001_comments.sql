CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS comments_target_created_idx ON comments(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_ip_created_idx ON comments(ip_hash, created_at DESC);
