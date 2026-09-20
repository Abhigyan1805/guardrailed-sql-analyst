WITH d AS (
  SELECT p.category_id, oi.discount
  FROM order_items oi
  JOIN products p ON p.product_id = oi.product_id
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.tenant_id = :tenant
)
SELECT c.name AS category_name, AVG(d.discount) AS avg_discount
FROM d
JOIN categories c ON c.category_id = d.category_id
GROUP BY c.name
ORDER BY AVG(d.discount) DESC, c.name ASC
