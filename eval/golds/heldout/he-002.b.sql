SELECT COUNT(*) AS orders
FROM orders o
WHERE o.tenant_id = :tenant
  AND date_part('year', o.ordered_at) = date_part('year', :eval_now)
