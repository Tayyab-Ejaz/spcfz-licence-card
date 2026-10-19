-- Staff sign-in for /admin (ARCHITECTURE section 8, from 19 October 2026; replaces Cloudflare Access).
-- Accounts are created with `node dist/cli/admin-user.js`; there is no sign-up.
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- One row per signed-in browser. Only a SHA-256 of the cookie value is stored, so a copy of the database does
-- not hand out working sessions.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX idx_admin_sessions_user ON admin_sessions (user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);
