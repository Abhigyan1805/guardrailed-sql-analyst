SELECT c.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
JOIN categories c ON c.category_id = p.category_id
WHERE o.status IN ('paid','shipped')
  AND o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
  AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
  AND o.tenant_id = :tenant
GROUP BY c.name
ORDER BY revenue DESC, c.name ASC
LIMIT 5
