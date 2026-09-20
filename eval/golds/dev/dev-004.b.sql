SELECT t.sku, t.name, t.stock_qty
FROM (
  SELECT p.sku, p.name, p.stock_qty, p.product_id,
         ROW_NUMBER() OVER (ORDER BY p.stock_qty ASC, p.product_id ASC) AS rn
  FROM products p
  WHERE p.stock_qty < 10
) t
WHERE t.rn <= 20
ORDER BY t.stock_qty ASC, t.product_id ASC
