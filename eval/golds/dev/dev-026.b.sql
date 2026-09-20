WITH months AS (
  SELECT generate_series(TIMESTAMPTZ '2025-01-01T00:00:00Z',
                         TIMESTAMPTZ '2025-12-01T00:00:00Z',
                         interval '1 month') AS mon
), agg AS (
  SELECT date_trunc('month', o.ordered_at) AS mon,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
    AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
  GROUP BY 1
), joined AS (
  SELECT m.mon, COALESCE(a.revenue, 0) AS revenue
  FROM months m
  LEFT JOIN agg a ON a.mon = m.mon
), withlag AS (
  SELECT mon, revenue, LAG(revenue) OVER (ORDER BY mon) AS prev FROM joined
)
SELECT to_char(mon, 'YYYY-MM') AS month, revenue,
       CASE WHEN prev = 0 THEN NULL ELSE (revenue - prev) / prev END AS mom_growth
FROM withlag
ORDER BY mon ASC
