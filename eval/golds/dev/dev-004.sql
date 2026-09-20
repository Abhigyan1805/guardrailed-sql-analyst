SELECT p.sku, p.name, p.stock_qty
FROM products p
WHERE p.stock_qty < 10
ORDER BY p.stock_qty ASC, p.product_id ASC
LIMIT 20
