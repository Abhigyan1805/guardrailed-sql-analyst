WITH lines AS (
  SELECT c.name AS category_name, oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
)
SELECT category_name, SUM(rev) AS revenue
FROM lines
GROUP BY category_name
ORDER BY SUM(rev) DESC, category_name ASC
