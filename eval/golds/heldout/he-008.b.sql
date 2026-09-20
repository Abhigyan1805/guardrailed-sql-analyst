WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon
  FROM orders o
  WHERE o.tenant_id = :tenant AND date_part('year', o.ordered_at) = date_part('year', :eval_now)
)
SELECT to_char(mon, 'YYYY-MM') AS month, COUNT(*) AS orders
FROM m
GROUP BY mon
ORDER BY mon ASC
