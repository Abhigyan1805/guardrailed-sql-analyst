SELECT p.product_id, p.sku, p.name, p.list_price
FROM products p
WHERE p.is_active = true
ORDER BY p.list_price DESC, p.product_id ASC
LIMIT 5
