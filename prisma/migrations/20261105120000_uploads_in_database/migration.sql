-- Uploaded pictures live in the database instead of on disk: hosts like Render's free plan wipe the disk on
-- every deploy and restart. The URLs stay the same: /api/uploads/{folder}/{name}.
CREATE TABLE uploads (
  name         TEXT        PRIMARY KEY CHECK (name ~ '^[\w-]+\.(jpg|png|gif|webp)$'),
  folder       TEXT        NOT NULL CHECK (folder IN ('products', 'avatars')),
  content_type TEXT        NOT NULL,
  data         BYTEA       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
