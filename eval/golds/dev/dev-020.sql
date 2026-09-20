SELECT o.status, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
GROUP BY o.status
ORDER BY o.status ASC
