WITH jan AS (
  SELECT DISTINCT o.customer_id
  FROM orders o
  WHERE o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 month'
), feb AS (
  SELECT DISTINCT o.customer_id
  FROM orders o
  WHERE o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now) + interval '1 month'
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '2 months'
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name
FROM (SELECT customer_id FROM jan EXCEPT SELECT customer_id FROM feb) x
JOIN customers c ON c.customer_id = x.customer_id
ORDER BY c.customer_id ASC
