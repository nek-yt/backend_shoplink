-- Log in with TikTok (open_id) and Instagram (app-scoped user id). Both ids are strings.
ALTER TABLE users ADD COLUMN tiktok_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN instagram_id TEXT UNIQUE;
