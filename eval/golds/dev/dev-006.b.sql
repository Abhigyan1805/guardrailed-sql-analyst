SELECT COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_orders
FROM orders o
WHERE o.tenant_id = :tenant
