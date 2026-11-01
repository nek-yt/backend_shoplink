-- Reviews: stars (1 to 5) and a comment from customers. One review per user per product.
CREATE TABLE reviews (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reviews_product_user_key UNIQUE (product_id, user_id)
);
CREATE INDEX idx_reviews_user ON reviews(user_id);

-- Kept up to date by the API whenever a review is added, changed or deleted.
-- The seller-set products.rating column is left as it is.
ALTER TABLE products ADD COLUMN reviews_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN reviews_rating DOUBLE PRECISION;
