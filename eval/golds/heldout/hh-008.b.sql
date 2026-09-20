WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now)
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
  GROUP BY 1
), cum AS (
  SELECT m1.mon, m1.revenue, SUM(m2.revenue) AS cumulative
  FROM m m1
  JOIN m m2 ON m2.mon <= m1.mon
  GROUP BY m1.mon, m1.revenue
)
SELECT to_char(mon, 'YYYY-MM') AS month, revenue, cumulative
FROM cum
ORDER BY mon ASC
