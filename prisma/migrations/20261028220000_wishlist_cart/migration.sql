-- Wishlist: products a user saved for later. Each product at most once per user.
CREATE TABLE wishlist_items (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_items_user_product_key UNIQUE (user_id, product_id)
);
CREATE INDEX idx_wishlist_items_product ON wishlist_items(product_id);

-- Cart: one line per product + size + color. '' means "no size/color", so the unique key works.
CREATE TABLE cart_items (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT        NOT NULL DEFAULT '',
  color      TEXT        NOT NULL DEFAULT '',
  quantity   INTEGER     NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_line_key UNIQUE (user_id, product_id, size, color)
);
CREATE INDEX idx_cart_items_product ON cart_items(product_id);
