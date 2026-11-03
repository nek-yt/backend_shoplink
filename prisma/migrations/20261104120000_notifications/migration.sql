-- Notifications: things that happened for a user (someone bought their product, a product was reported...).
-- They are also pushed live over GET /api/notifications/stream. read_at stays null until the user opens them.
CREATE TABLE notifications (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('sale', 'report')),
  title      TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body       TEXT        NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  link       TEXT,
  image_url  TEXT,
  -- What the shop needs to write the text in the reader's language (names, counts, order number).
  data       JSONB       NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
