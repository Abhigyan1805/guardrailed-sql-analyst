WITH firsts AS (
  SELECT o.customer_id, MIN(o.ordered_at) AS first_at
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
), cohorts AS (
  SELECT customer_id FROM firsts
  WHERE first_at >= date_trunc('year', :eval_now)
    AND first_at < date_trunc('year', :eval_now) + interval '1 year'
)
SELECT COALESCE(SUM(oi.qty * oi.unit_price * (1 - oi.discount)), 0) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND o.customer_id IN (SELECT customer_id FROM cohorts)
