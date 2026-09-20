SELECT p.product_id, p.sku, p.name AS product_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
GROUP BY p.product_id, p.sku, p.name
ORDER BY revenue DESC, p.product_id ASC
LIMIT 5
