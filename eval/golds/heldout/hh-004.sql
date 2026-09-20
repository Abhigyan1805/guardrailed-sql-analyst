SELECT 'CUSTOMER-' || c.customer_id AS display_name
FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.customer_id AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 month'
)
AND NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.customer_id AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now) + interval '1 month'
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '2 months'
)
ORDER BY c.customer_id ASC
