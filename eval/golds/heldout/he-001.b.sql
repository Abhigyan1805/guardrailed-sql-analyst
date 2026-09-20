WITH bounds AS (
  SELECT date_trunc('month', :eval_now) - interval '1 month' AS lo,
         date_trunc('month', :eval_now) AS hi
)
SELECT COALESCE(SUM(oi.qty * oi.unit_price * (1 - oi.discount)), 0) AS revenue
FROM bounds b
JOIN orders o ON o.ordered_at >= b.lo AND o.ordered_at < b.hi
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
