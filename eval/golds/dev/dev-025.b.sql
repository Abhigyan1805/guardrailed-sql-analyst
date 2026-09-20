SELECT p.sku, p.name
FROM products p
LEFT JOIN (
  SELECT DISTINCT oi.product_id
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.tenant_id = :tenant
) s ON s.product_id = p.product_id
WHERE s.product_id IS NULL
ORDER BY p.product_id ASC
LIMIT 20
