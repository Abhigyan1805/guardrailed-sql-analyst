WITH spine AS (
  SELECT generate_series(TIMESTAMPTZ '2025-01-01T00:00:00Z',
                         TIMESTAMPTZ '2025-12-01T00:00:00Z',
                         interval '1 month') AS mon
), rev AS (
  SELECT date_trunc('month', o.ordered_at) AS mon,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped')
    AND o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
    AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
    AND o.tenant_id = :tenant
  GROUP BY 1
)
SELECT to_char(s.mon, 'YYYY-MM') AS month,
       COALESCE(r.revenue, 0) AS revenue,
       CASE
         WHEN LAG(COALESCE(r.revenue, 0)) OVER (ORDER BY s.mon) = 0 THEN NULL
         ELSE (COALESCE(r.revenue, 0) - LAG(COALESCE(r.revenue, 0)) OVER (ORDER BY s.mon))
              / NULLIF(LAG(COALESCE(r.revenue, 0)) OVER (ORDER BY s.mon), 0)
       END AS mom_growth
FROM spine s
LEFT JOIN rev r ON r.mon = s.mon
ORDER BY s.mon ASC
