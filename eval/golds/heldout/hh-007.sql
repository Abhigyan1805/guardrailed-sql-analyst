WITH pr AS (
  SELECT c.name AS category_name, p.product_id, p.name AS product_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, p.product_id, p.name
), ranked AS (
  SELECT category_name, product_name, revenue,
         ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY revenue DESC, product_id ASC) AS rn
  FROM pr
)
SELECT category_name, product_name, revenue, rn AS rnk
FROM ranked
WHERE rn <= 3
ORDER BY category_name ASC, rn ASC
