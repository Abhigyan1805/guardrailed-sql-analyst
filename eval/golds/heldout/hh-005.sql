WITH ranked AS (
  SELECT o.customer_id, o.ordered_at,
         ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.ordered_at ASC, o.order_id ASC) AS rn
  FROM orders o
  WHERE o.tenant_id = :tenant
), pairs AS (
  SELECT r1.customer_id,
         EXTRACT(EPOCH FROM (r2.ordered_at - r1.ordered_at)) / 86400.0 AS days
  FROM ranked r1
  JOIN ranked r2 ON r2.customer_id = r1.customer_id AND r2.rn = 2
  WHERE r1.rn = 1
)
SELECT AVG(days) AS avg_days FROM pairs
