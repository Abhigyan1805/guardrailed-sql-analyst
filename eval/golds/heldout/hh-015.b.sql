WITH pr AS (
  SELECT o.region, p.product_id, p.name AS product_name, SUM(oi.qty) AS units
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.region, p.product_id, p.name
)
SELECT DISTINCT ON (region) region, product_name, units
FROM pr
ORDER BY region ASC, units DESC, product_id ASC
