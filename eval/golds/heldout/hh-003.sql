WITH per_prod AS (
  SELECT p.product_id, p.sku, p.name AS product_name,
         COUNT(DISTINCT oi.order_id) AS total_orders,
         COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN oi.order_id END) AS cancelled_orders
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.tenant_id = :tenant
  GROUP BY p.product_id, p.sku, p.name
)
SELECT product_id, sku, product_name,
       cancelled_orders::float / total_orders AS cancel_rate
FROM per_prod
WHERE total_orders > 0
  AND cancelled_orders::float / total_orders >
      (SELECT COUNT(*) FILTER (WHERE status = 'cancelled')::float / NULLIF(COUNT(*), 0)
       FROM orders WHERE tenant_id = :tenant)
ORDER BY cancel_rate DESC, product_id ASC
LIMIT 20
