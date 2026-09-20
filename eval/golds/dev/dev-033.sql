SELECT oi.order_id, COUNT(DISTINCT p.category_id) AS categories,
       SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
WHERE o.tenant_id = :tenant
GROUP BY oi.order_id
HAVING COUNT(DISTINCT p.category_id) > 2
ORDER BY categories DESC, oi.order_id ASC
LIMIT 20
