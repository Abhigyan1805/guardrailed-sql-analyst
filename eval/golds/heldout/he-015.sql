SELECT 'CUSTOMER-' || o.customer_id AS display_name, COUNT(*) AS orders
FROM orders o
WHERE o.tenant_id = :tenant
GROUP BY o.customer_id
ORDER BY orders DESC, o.customer_id ASC
LIMIT 10
