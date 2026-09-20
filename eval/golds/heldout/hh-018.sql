SELECT COUNT(*) AS customers
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.tenant_id = :tenant
)
