-- The original ShopLink tables. Databases made by the old Express version already have them;
-- scripts/db-up.ts marks this migration as applied there instead of running it.
CREATE TABLE users (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT        NOT NULL,
  email           TEXT        UNIQUE,
  phone           TEXT        UNIQUE,
  password_hash   TEXT,
  role            TEXT        NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  source          TEXT        NOT NULL DEFAULT 'other' CHECK (source IN ('tiktok', 'instagram', 'telegram', 'other')),
  social_username TEXT,
  telegram_id     BIGINT      UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT             NOT NULL,
  description TEXT             NOT NULL DEFAULT '',
  price_cents BIGINT           NOT NULL CHECK (price_cents >= 0),
  rating      DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  stock       INTEGER          NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sizes       JSONB            NOT NULL DEFAULT '[]',
  colors      JSONB            NOT NULL DEFAULT '[]',
  image_url   TEXT,
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  customer_name TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  address       TEXT        NOT NULL,
  comment       TEXT,
  source        TEXT        NOT NULL,
  total_cents   BIGINT      NOT NULL CHECK (total_cents >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT    NOT NULL,
  size         TEXT,
  color        TEXT,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  price_cents  BIGINT  NOT NULL CHECK (price_cents >= 0)
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
