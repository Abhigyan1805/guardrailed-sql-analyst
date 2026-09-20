WITH rev AS (
  SELECT c.name AS category_name, date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY c.name, date_trunc('month', o.ordered_at)
)
SELECT category_name, to_char(mon, 'YYYY-MM') AS month, revenue,
       CASE WHEN LAG(revenue) OVER (PARTITION BY category_name ORDER BY mon) = 0 THEN NULL
            ELSE (revenue - LAG(revenue) OVER (PARTITION BY category_name ORDER BY mon))
                 / NULLIF(LAG(revenue) OVER (PARTITION BY category_name ORDER BY mon), 0)
       END AS mom_growth
FROM rev
ORDER BY category_name ASC, mon ASC
