SELECT t.product_id, t.sku, t.name, t.list_price
FROM (
  SELECT p.product_id, p.sku, p.name, p.list_price,
         ROW_NUMBER() OVER (ORDER BY p.list_price DESC, p.product_id ASC) AS rn
  FROM products p
  WHERE p.is_active = true
) t
WHERE t.rn <= 3
ORDER BY t.list_price DESC, t.product_id ASC
