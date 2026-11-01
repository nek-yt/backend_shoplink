-- Every user can sell: products belong to the user who created them, and order items remember the seller
-- (so sellers keep seeing their sales even after deleting the product).
ALTER TABLE products ADD COLUMN seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Products made before this belong to the first admin.
UPDATE products SET seller_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
UPDATE order_items i SET seller_id = p.seller_id FROM products p WHERE p.id = i.product_id;

CREATE INDEX idx_products_seller ON products(seller_id);
CREATE INDEX idx_order_items_seller ON order_items(seller_id);
