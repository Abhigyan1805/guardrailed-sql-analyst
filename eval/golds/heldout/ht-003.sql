SELECT COUNT(*) AS orders
FROM orders o
WHERE o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('month', :eval_now) - interval '1 month'
  AND o.ordered_at < date_trunc('month', :eval_now)
