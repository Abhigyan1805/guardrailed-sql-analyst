WITH rev AS (
  SELECT c.name AS category_name, date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, date_trunc('month', o.ordered_at)
), ranked AS (
  SELECT category_name, mon, revenue,
         ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY mon ASC) AS rn
  FROM rev
)
SELECT r1.category_name, to_char(r1.mon, 'YYYY-MM') AS month, r1.revenue,
       CASE WHEN r2.revenue IS NULL OR r2.revenue = 0 THEN NULL
            ELSE (r1.revenue - r2.revenue) / r2.revenue END AS mom_growth
FROM ranked r1
LEFT JOIN ranked r2 ON r2.category_name = r1.category_name AND r2.rn = r1.rn - 1
ORDER BY r1.category_name ASC, r1.mon ASC
