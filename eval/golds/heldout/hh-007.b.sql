WITH pr AS (
  SELECT c.name AS category_name, p.product_id, p.name AS product_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, p.product_id, p.name
), ranked AS (
  SELECT pr.category_name, pr.product_name, pr.revenue,
         (SELECT COUNT(*) FROM pr x
          WHERE x.category_name = pr.category_name
            AND (x.revenue > pr.revenue
                 OR (x.revenue = pr.revenue AND x.product_id < pr.product_id))) + 1 AS rnk
  FROM pr
)
SELECT category_name, product_name, revenue, rnk
FROM ranked
WHERE rnk <= 3
ORDER BY category_name ASC, rnk ASC
