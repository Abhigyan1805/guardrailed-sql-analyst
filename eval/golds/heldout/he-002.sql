SELECT COUNT(*) AS orders
FROM orders o
WHERE o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('year', :eval_now)
  AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
