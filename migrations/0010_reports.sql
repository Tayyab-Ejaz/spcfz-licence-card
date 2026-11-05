-- The monthly impact report (5 November 2026, src/report/): one row per address each time a month's report is sent,
-- kept as a log like `emails` (status queued -> sent | failed). actor null: the monthly run on the 1st; otherwise
-- the admin who pressed Send. Nothing here is personal data about customers.
CREATE TABLE report_emails (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_id TEXT,
  subject TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_report_emails_due ON report_emails (status, next_attempt_at);
CREATE INDEX idx_report_emails_month ON report_emails (month);
