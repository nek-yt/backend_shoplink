-- More pictures per product, besides the main one in image_url. A JSON array of URLs, in display order.
ALTER TABLE products ADD COLUMN images JSONB NOT NULL DEFAULT '[]';
