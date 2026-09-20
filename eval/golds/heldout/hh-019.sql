WITH c AS (
  SELECT o.order_id, o.status, COUNT(*) AS items
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.order_id, o.status
)
SELECT status, AVG(items) AS avg_items_per_order
FROM c
GROUP BY status
ORDER BY status ASC
