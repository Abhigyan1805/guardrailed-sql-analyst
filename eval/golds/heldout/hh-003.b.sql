WITH prod_orders AS (
  SELECT p.product_id, p.sku, p.name AS product_name, oi.order_id, o.status
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.tenant_id = :tenant
), rates AS (
  SELECT product_id, sku, product_name,
         COUNT(DISTINCT order_id)::float AS total,
         COUNT(DISTINCT order_id) FILTER (WHERE status = 'cancelled')::float AS cancelled
  FROM prod_orders
  GROUP BY product_id, sku, product_name
)
SELECT product_id, sku, product_name, cancelled / total AS cancel_rate
FROM rates
WHERE total > 0
  AND cancelled / total >
      (SELECT COUNT(*) FILTER (WHERE status = 'cancelled')::float / NULLIF(COUNT(*), 0)
       FROM orders WHERE tenant_id = :tenant)
ORDER BY cancel_rate DESC, product_id ASC
LIMIT 20
