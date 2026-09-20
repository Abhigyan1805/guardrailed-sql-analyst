SELECT p.sku, p.name, c.name AS category_name, p.list_price
FROM products p
JOIN categories c ON c.category_id = p.category_id
WHERE p.list_price > (
  SELECT AVG(p2.list_price) FROM products p2 WHERE p2.category_id = p.category_id
)
ORDER BY p.list_price DESC, p.product_id ASC
LIMIT 20
