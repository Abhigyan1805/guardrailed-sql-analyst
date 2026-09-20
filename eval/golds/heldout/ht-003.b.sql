WITH b AS (
  SELECT date_trunc('month', :eval_now) - interval '1 month' AS lo,
         date_trunc('month', :eval_now) AS hi
)
SELECT COUNT(*) AS orders
FROM orders o, b
WHERE o.tenant_id = :tenant AND o.ordered_at >= b.lo AND o.ordered_at < b.hi
