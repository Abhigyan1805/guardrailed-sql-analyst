WITH avg_c AS (
  SELECT p.category_id, AVG(p.list_price) AS avg_price
  FROM products p
  GROUP BY p.category_id
)
SELECT p.sku, p.name, c.name AS category_name, p.list_price
FROM products p
JOIN categories c ON c.category_id = p.category_id
JOIN avg_c ON avg_c.category_id = p.category_id
WHERE p.list_price > avg_c.avg_price
ORDER BY p.list_price DESC, p.product_id ASC
LIMIT 20
