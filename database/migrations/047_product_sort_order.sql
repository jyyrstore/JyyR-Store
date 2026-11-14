ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0
  CHECK (sort_order >= 0);

WITH ranked_products AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY created_at DESC,id DESC
    )-1 AS sort_order
  FROM products
)
UPDATE products AS p
SET sort_order=ranked_products.sort_order
FROM ranked_products
WHERE ranked_products.id=p.id;

CREATE INDEX IF NOT EXISTS products_status_sort_order_idx
  ON products(status,sort_order,created_at DESC,id DESC);
