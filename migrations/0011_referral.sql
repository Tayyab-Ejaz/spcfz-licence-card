-- The owner's referral link (24 November 2026, src/referral/). The caption's link is BASE_URL/r/<ref_code>; a lead
-- that comes from it reaches Zoho with the owner as the referrer (name, email, phone), sent by SPC's website after it
-- asks GET /api/referrer/<ref_code> who the code belongs to.
-- ref_code: seven characters from src/referral/code.ts REF_ALPHABET; set when the card is created, or the first time
-- the card is shown for cards made before this; never changes.
-- customer_phone: the owner's mobile in international form (+971501234567), from the ERP or staff; the referrer's
-- phone on referral leads. Personal data, kept like the founder's name and the email addresses (nothing is deleted).
-- (Ported from the WhatsApp branch, whose own migration also adds it: drop that line there when it is rebased.)
ALTER TABLE cards ADD COLUMN customer_phone TEXT;
ALTER TABLE cards ADD COLUMN ref_code TEXT;
CREATE UNIQUE INDEX idx_cards_ref_code ON cards (ref_code);
