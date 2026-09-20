WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon, oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND date_part('year', o.ordered_at) = date_part('year', :eval_now)
)
SELECT to_char(mon, 'YYYY-MM') AS month, SUM(rev) AS revenue
FROM m
GROUP BY mon
ORDER BY mon ASC
