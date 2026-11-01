-- Categories for browsing the shop (hoodies, jeans, bags...). Products made before this are 'other'.
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
CREATE INDEX idx_products_category ON products(category);
