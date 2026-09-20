SELECT AVG(oi.qty) AS avg_units
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.tenant_id = :tenant
