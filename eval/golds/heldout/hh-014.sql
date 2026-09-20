WITH months AS (
  SELECT DISTINCT date_trunc('month', o.ordered_at) AS mon
  FROM orders o
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
), pm AS (
  SELECT DISTINCT p.product_id, date_trunc('month', o.ordered_at) AS mon
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
)
SELECT p.product_id, p.sku, p.name AS product_name
FROM products p
WHERE (SELECT COUNT(*) FROM months) > 0
  AND (SELECT COUNT(*) FROM months) = (
    SELECT COUNT(*) FROM pm WHERE pm.product_id = p.product_id
  )
ORDER BY p.product_id ASC
