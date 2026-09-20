SELECT COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled_orders
FROM orders o
WHERE o.region = 'EU' AND o.tenant_id = :tenant
