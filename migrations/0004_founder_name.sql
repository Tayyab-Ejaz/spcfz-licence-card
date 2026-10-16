-- 16 Oct 2026: the ERP sends the founder's name, which the studio pre-fills on the card.
-- Personal data: kept for the card's retention period and deleted with the card.
ALTER TABLE cards ADD COLUMN founder_name_en TEXT;
ALTER TABLE cards ADD COLUMN founder_name_ar TEXT;
