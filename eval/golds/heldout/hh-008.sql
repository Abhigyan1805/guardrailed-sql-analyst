WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
  GROUP BY 1
)
SELECT to_char(mon, 'YYYY-MM') AS month, revenue,
       SUM(revenue) OVER (ORDER BY mon ASC) AS cumulative
FROM m
ORDER BY mon ASC
