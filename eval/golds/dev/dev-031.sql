WITH t AS (
  SELECT SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS total
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
), c AS (
  SELECT cat.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories cat ON cat.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY cat.name
)
SELECT c.category_name, c.revenue, c.revenue / t.total AS share
FROM c CROSS JOIN t
ORDER BY share DESC, c.category_name ASC
