-- Comments on products: as many as anyone wants. Stars stay in reviews (one per user and product).
CREATE TABLE comments (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT        NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_product ON comments(product_id, created_at);
CREATE INDEX idx_comments_user ON comments(user_id);
