WITH c AS (
  SELECT o.customer_id, COUNT(*) AS orders, MAX(o.ordered_at) AS last_at
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
  HAVING COUNT(*) > 5
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name, c.orders
FROM c
JOIN customers cu ON cu.customer_id = c.customer_id
WHERE c.last_at <= :eval_now - interval '90 days'
ORDER BY c.orders DESC, c.customer_id ASC
LIMIT 20
