WITH bounds AS (
  SELECT date_trunc('month', min(ordered_at)) AS lo,
         date_trunc('month', max(ordered_at)) AS hi
  FROM orders
  WHERE status IN ('paid','shipped') AND tenant_id = :tenant
), months AS (
  SELECT generate_series(lo, hi, interval '1 month') AS mon FROM bounds
)
SELECT to_char(m.mon, 'YYYY-MM') AS month,
       COALESCE(SUM(oi.qty * oi.unit_price * (1 - oi.discount)), 0) AS revenue
FROM months m
LEFT JOIN orders o
  ON date_trunc('month', o.ordered_at) = m.mon
 AND o.status IN ('paid','shipped') AND o.tenant_id = :tenant
LEFT JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY m.mon
ORDER BY m.mon ASC
