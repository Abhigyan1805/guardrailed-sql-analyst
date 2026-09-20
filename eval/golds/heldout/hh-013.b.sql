WITH firsts AS (
  SELECT o.customer_id, MIN(o.ordered_at) AS first_at
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
), lines AS (
  SELECT oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN firsts f ON f.customer_id = o.customer_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND f.first_at >= date_trunc('year', :eval_now)
    AND f.first_at < date_trunc('year', :eval_now) + interval '1 year'
)
SELECT COALESCE(SUM(rev), 0) AS revenue FROM lines
