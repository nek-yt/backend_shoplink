-- Each order gets its own random number (like SL-7K3F9QX2) to show customers instead of the
-- counting id, which tells everyone how many orders the shop has.
ALTER TABLE orders ADD COLUMN order_number TEXT;
UPDATE orders SET order_number = 'SL-' || upper(substr(md5(random()::text || id::text), 1, 8));
ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;
CREATE UNIQUE INDEX orders_order_number_key ON orders(order_number);
