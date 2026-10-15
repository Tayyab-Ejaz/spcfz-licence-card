-- spcfz-licence-card, initial schema. Mirrors docs/ARCHITECTURE.md section 5.

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  licence_number TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  company_name_en TEXT NOT NULL,
  company_name_ar TEXT,
  licence_type TEXT,
  activity_category TEXT,
  issued_on TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  render_error TEXT,
  source TEXT NOT NULL,
  template_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rendered_at TEXT,
  expires_at TEXT,
  UNIQUE (licence_number, is_test)
);
CREATE INDEX idx_cards_status ON cards (status);
CREATE INDEX idx_cards_company ON cards (company_name_en);
CREATE INDEX idx_cards_created ON cards (created_at);
CREATE INDEX idx_cards_expires ON cards (expires_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  route TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  errors TEXT,
  card_id TEXT,
  raw_body TEXT,
  raw_body_expires_at TEXT,
  actor TEXT
);
CREATE INDEX idx_events_received ON events (received_at);
CREATE INDEX idx_events_card ON events (card_id);
CREATE INDEX idx_events_raw_expiry ON events (raw_body_expires_at);

-- lang/size/network are '' rather than NULL so the primary key upsert works.
-- day is YYYY-MM-DD for live rows and YYYY-MM once compacted.
CREATE TABLE metrics (
  day TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card_id, kind, lang, size, network)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('caption_en', 'We''re officially licensed at SPC Free Zone! {company} is now a licensed business in Sharjah. #SPCFreeZone #Sharjah #BusinessSetup {link}'),
  ('caption_ar', 'أصبحت {company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر! #SPCFreeZone #الشارقة {link}'),
  ('gtm_enabled', '0'),
  ('retention_days', '730'),
  ('test_retention_days', '30'),
  ('raw_body_days', '7');
