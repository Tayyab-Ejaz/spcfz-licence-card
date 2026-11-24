-- The welcome WhatsApp message (19 November 2026), sent through Gallabox beside the welcome email.
-- It goes to cards.customer_phone, which migration 0011 (the referral link, 24 November 2026) already added.

-- Every WhatsApp message the service sends or means to send, kept as a log, like emails.
-- status: the outbox's own state (queued -> sent | failed | skipped); sent means Gallabox accepted it.
-- delivery: what WhatsApp reported afterwards (sent, delivered, read, failed...), read back from Gallabox by
-- check_at / checks until it is final or three days have passed.
CREATE TABLE whatsapp_messages (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  lang TEXT NOT NULL,
  template TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_id TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  delivery TEXT,
  delivery_at TEXT,
  check_at TEXT,
  checks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_whatsapp_card ON whatsapp_messages (card_id);
CREATE INDEX idx_whatsapp_due ON whatsapp_messages (status, next_attempt_at);
CREATE INDEX idx_whatsapp_check ON whatsapp_messages (check_at);

-- Numbers that must not get WhatsApp messages from the service (staff stop them from the card page).
CREATE TABLE whatsapp_suppressions (
  phone TEXT PRIMARY KEY,
  card_id TEXT,
  source TEXT NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL
);
