-- Reports: a logged-in user flags a product for the admins. One open report per user and product.
-- status: open (waiting), resolved (the admin acted), dismissed (nothing wrong).
CREATE TABLE reports (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reporter_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT        NOT NULL CHECK (reason IN ('fake', 'scam', 'offensive', 'wrong_info', 'prohibited', 'other')),
  note        TEXT        NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_reports_product_reporter ON reports(product_id, reporter_id);
CREATE INDEX idx_reports_status ON reports(status, created_at);
