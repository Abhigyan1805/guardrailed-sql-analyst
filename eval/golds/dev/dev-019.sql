SELECT c.name AS category_name, AVG(oi.discount) AS avg_discount
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
JOIN categories c ON c.category_id = p.category_id
WHERE o.tenant_id = :tenant
GROUP BY c.name
ORDER BY avg_discount DESC, c.name ASC
