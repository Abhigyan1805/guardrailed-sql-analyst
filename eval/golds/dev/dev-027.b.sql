WITH prod_rev AS (
  SELECT c.name AS category_name, p.product_id, p.name AS product_name,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, p.product_id, p.name
), with_total AS (
  SELECT pr.*, SUM(pr.revenue) OVER (PARTITION BY pr.category_name) AS category_total
  FROM prod_rev pr
)
SELECT t.category_name, t.product_name, t.revenue,
       RANK() OVER (PARTITION BY t.category_name ORDER BY t.revenue DESC) AS rnk
FROM with_total t
WHERE t.category_total >= 500
ORDER BY t.category_name ASC, rnk ASC, t.product_id ASC
