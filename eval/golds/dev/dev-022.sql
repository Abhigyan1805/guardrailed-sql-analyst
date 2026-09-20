WITH spine AS (
  SELECT generate_series(date_trunc('month', min(o.ordered_at)),
                         date_trunc('month', max(o.ordered_at)),
                         interval '1 month') AS mon
  FROM orders o
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
), rev AS (
  SELECT date_trunc('month', o.ordered_at) AS mon,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY 1
)
SELECT to_char(s.mon, 'YYYY-MM') AS month, COALESCE(r.revenue, 0) AS revenue
FROM spine s
LEFT JOIN rev r ON r.mon = s.mon
ORDER BY s.mon ASC
