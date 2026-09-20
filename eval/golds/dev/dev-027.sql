WITH cat_rev AS (
  SELECT c.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS total
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name
  HAVING SUM(oi.qty * oi.unit_price * (1 - oi.discount)) >= 500
), prod_rev AS (
  SELECT c.name AS category_name, p.product_id, p.name AS product_name,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, p.product_id, p.name
)
SELECT p.category_name, p.product_name, p.revenue,
       RANK() OVER (PARTITION BY p.category_name ORDER BY p.revenue DESC) AS rnk
FROM prod_rev p
JOIN cat_rev c ON c.category_name = p.category_name
ORDER BY p.category_name ASC, rnk ASC, p.product_id ASC
