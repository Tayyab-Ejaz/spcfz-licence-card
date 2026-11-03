-- The LinkedIn post alert (3 November 2026): when a customer posts their card with "Post to LinkedIn", SPC gets an
-- email (kind post_alert) so its page can like, comment on and repost it while it is new. ref: the linkedin_posts id
-- the alert is about; null for welcome emails.
ALTER TABLE emails ADD COLUMN ref TEXT;
