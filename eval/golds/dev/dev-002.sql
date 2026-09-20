SELECT COUNT(*) AS cancelled_orders
FROM orders o
WHERE o.status = 'cancelled' AND o.region = 'EU' AND o.tenant_id = :tenant
