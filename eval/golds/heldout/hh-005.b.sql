WITH ranked AS (
  SELECT o.customer_id, o.ordered_at,
         ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.ordered_at ASC, o.order_id ASC) AS rn
  FROM orders o
  WHERE o.tenant_id = :tenant
), gaps AS (
  SELECT rn,
         (ordered_at - LAG(ordered_at) OVER (PARTITION BY customer_id ORDER BY ordered_at ASC, rn ASC)) AS gap
  FROM ranked
)
SELECT AVG(EXTRACT(EPOCH FROM gap) / 86400.0) AS avg_days
FROM gaps
WHERE rn = 2
