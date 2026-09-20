WITH per_order AS (
  SELECT oi.order_id, p.category_id, oi.qty, oi.unit_price, oi.discount
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.tenant_id = :tenant
), agg AS (
  SELECT order_id,
         COUNT(DISTINCT category_id) AS categories,
         SUM(qty * unit_price * (1 - discount)) AS revenue
  FROM per_order
  GROUP BY order_id
)
SELECT order_id, categories, revenue
FROM agg
WHERE categories > 2
ORDER BY categories DESC, order_id ASC
LIMIT 20
