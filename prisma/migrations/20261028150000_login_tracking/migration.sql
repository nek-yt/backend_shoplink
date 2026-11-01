-- Login tracking: every successful register/login adds a row to logins, and users keep the latest one.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE logins (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method     TEXT        NOT NULL CHECK (method IN ('register', 'password', 'telegram', 'tiktok', 'instagram')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logins_user ON logins(user_id);
CREATE INDEX idx_logins_created ON logins(created_at);
CREATE INDEX idx_users_created ON users(created_at);
