-- Unsubscribe (27 October 2026): addresses that asked for no more emails. Checked before an email is queued and
-- again before it is sent. Kept like everything else (nothing is deleted); staff can see it on the card.
CREATE TABLE email_suppressions (
  email TEXT PRIMARY KEY,
  card_id TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
