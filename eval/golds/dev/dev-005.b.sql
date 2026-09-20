WITH agg AS (
  SELECT pay.method,
         COUNT(*) OVER (PARTITION BY pay.method) AS payments,
         SUM(pay.amount) OVER (PARTITION BY pay.method) AS total
  FROM payments pay
  JOIN orders o ON o.order_id = pay.order_id
  WHERE o.tenant_id = :tenant
)
SELECT DISTINCT method, payments, total
FROM agg
ORDER BY total DESC, method ASC
