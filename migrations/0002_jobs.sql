-- Render job queue (docs/PORT-TO-NODE.md section 2, src/platform/sqlite-queue.ts).
-- One row per queued render; the in-process worker claims the oldest available row, runs the
-- consumer, then deletes it (acked), re-schedules it (retry) or parks it as dead after the last attempt.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                 -- ULID
  queue TEXT NOT NULL,                 -- logical queue name, 'render'
  body TEXT NOT NULL,                  -- JSON { card_id, content_hash }
  attempts INTEGER NOT NULL DEFAULT 0, -- deliveries so far
  available_at TEXT NOT NULL,          -- ISO; the worker picks rows with available_at <= now
  state TEXT NOT NULL,                 -- queued | running | dead
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_state_available ON jobs (state, available_at);
