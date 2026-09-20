WITH c AS (
  SELECT o.customer_id, COUNT(DISTINCT oi.order_id) AS orders
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
)
SELECT COUNT(*) FILTER (WHERE orders > 1)::float / NULLIF(COUNT(*), 0) AS repeat_share,
       COUNT(*) AS customers
FROM c
