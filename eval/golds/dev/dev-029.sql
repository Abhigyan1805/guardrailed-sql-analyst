WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY 1
)
SELECT to_char(mon, 'YYYY-MM') AS month, revenue,
       SUM(revenue) OVER (ORDER BY mon ASC) AS running_total
FROM m
ORDER BY mon ASC
