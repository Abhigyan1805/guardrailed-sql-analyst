WITH c AS (
  SELECT cat.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories cat ON cat.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY cat.name
)
SELECT category_name, revenue,
       revenue / SUM(revenue) OVER () AS share
FROM c
ORDER BY share DESC, category_name ASC
