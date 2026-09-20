WITH c AS (
  SELECT o.customer_id, COUNT(DISTINCT oi.order_id) AS orders
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
)
SELECT SUM(CASE WHEN orders > 1 THEN 1 ELSE 0 END)::float / COUNT(*) AS repeat_share,
       COUNT(*) AS customers
FROM c
