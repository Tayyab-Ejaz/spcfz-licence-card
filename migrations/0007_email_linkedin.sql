-- The welcome email and direct LinkedIn posting (27 October 2026).
-- customer_email: where the welcome email goes (from the ERP, or staff). cc_email: an optional copy, e.g. the
-- customer's account manager at SPC. Personal data, kept like the founder's name (nothing is deleted).
ALTER TABLE cards ADD COLUMN customer_email TEXT;
ALTER TABLE cards ADD COLUMN cc_email TEXT;

-- Every email the service sends or means to send, kept as a log (status queued -> sent | failed | skipped).
CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc_email TEXT,
  lang TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_id TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_emails_card ON emails (card_id);
CREATE INDEX idx_emails_due ON emails (status, next_attempt_at);

-- Posts made through "Post to LinkedIn". No LinkedIn token or member id is kept.
CREATE TABLE linkedin_posts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  post_urn TEXT,
  error TEXT,
  lang TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_linkedin_posts_card ON linkedin_posts (card_id);
