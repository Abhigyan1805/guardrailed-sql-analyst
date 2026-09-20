WITH m AS (
  SELECT date_trunc('year', o.ordered_at) AS yr, date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= date_trunc('year', :eval_now) - interval '1 year'
    AND o.ordered_at < date_trunc('year', :eval_now) + interval '1 year'
  GROUP BY date_trunc('year', o.ordered_at), date_trunc('month', o.ordered_at)
)
SELECT to_char(yr, 'YYYY') AS year, to_char(mon, 'YYYY-MM') AS month, revenue
FROM (
  SELECT DISTINCT ON (yr) yr, mon, revenue
  FROM m
  ORDER BY yr ASC, revenue DESC, mon ASC
) x
ORDER BY yr ASC
