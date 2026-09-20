SELECT SUM(oi.qty)::float / NULLIF(COUNT(*), 0) AS avg_units
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.tenant_id = :tenant
