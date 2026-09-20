SELECT COUNT(*) AS customers
FROM (SELECT DISTINCT o.customer_id FROM orders o WHERE o.tenant_id = :tenant) x
