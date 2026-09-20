WITH months AS (
  SELECT DISTINCT date_trunc('month', o.ordered_at) AS mon
  FROM orders o
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
), pm AS (
  SELECT p.product_id, COUNT(DISTINCT date_trunc('month', o.ordered_at)) AS months_sold
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
  GROUP BY p.product_id
)
SELECT p.product_id, p.sku, p.name AS product_name
FROM products p
JOIN pm ON pm.product_id = p.product_id
WHERE (SELECT COUNT(*) FROM months) > 0
  AND pm.months_sold = (SELECT COUNT(*) FROM months)
ORDER BY p.product_id ASC
