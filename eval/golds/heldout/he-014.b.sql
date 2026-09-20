WITH p AS (
  SELECT pay.amount
  FROM payments pay
  JOIN orders o ON o.order_id = pay.order_id
  WHERE o.tenant_id = :tenant
)
SELECT (SELECT COUNT(*) FROM p) AS payments, (SELECT SUM(amount) FROM p) AS total_amount
