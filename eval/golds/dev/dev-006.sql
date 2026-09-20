SELECT COUNT(*) AS pending_orders
FROM orders o
WHERE o.status = 'pending' AND o.tenant_id = :tenant
