-- Cards expire when the licence does (19 October 2026), not after a fixed retention period.
-- licence_expires_on: the licence's last valid day (YYYY-MM-DD) as the ERP or staff give it; NULL when unknown.
-- expires_at is derived from it (the end of that day in Dubai); a card with no licence expiry date never expires.
ALTER TABLE cards ADD COLUMN licence_expires_on TEXT;
UPDATE cards SET expires_at = NULL WHERE licence_expires_on IS NULL AND status != 'expired';
