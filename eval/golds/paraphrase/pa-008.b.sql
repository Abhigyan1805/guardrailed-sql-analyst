SELECT SUM(oi.qty * oi.unit_price * (1 - oi.discount)) / NULLIF(COUNT(DISTINCT oi.order_id), 0) AS avg_order_value
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
