WITH ord AS (
  SELECT o.order_id, o.region, o.status,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.tenant_id = :tenant
  GROUP BY o.order_id, o.region, o.status
)
SELECT region,
       AVG(CASE WHEN status IN ('paid','shipped') THEN revenue END) AS avg_order_value,
       SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END)::float / COUNT(*) AS refunded_share,
       COUNT(*) AS orders
FROM ord
GROUP BY region
ORDER BY region ASC
