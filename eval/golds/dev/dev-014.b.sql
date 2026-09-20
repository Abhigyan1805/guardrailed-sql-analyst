WITH pr AS (
  SELECT p.product_id, p.sku, p.name AS product_name,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY p.product_id, p.sku, p.name
), r AS (
  SELECT product_id, sku, product_name, revenue,
         ROW_NUMBER() OVER (ORDER BY revenue DESC, product_id ASC) AS rn
  FROM pr
)
SELECT product_id, sku, product_name, revenue
FROM r
WHERE rn <= 5
ORDER BY revenue DESC, product_id ASC
