SELECT p.sku, p.name
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE oi.product_id = p.product_id AND o.tenant_id = :tenant
)
ORDER BY p.product_id ASC
LIMIT 20
