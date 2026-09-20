SELECT COUNT(DISTINCT o.customer_id) AS customers
FROM orders o
WHERE o.tenant_id = :tenant
