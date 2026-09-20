WITH m AS (
  SELECT date_trunc('month', o.ordered_at) AS mon, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
    AND o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
    AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
  GROUP BY 1
)
SELECT to_char(mon, 'YYYY-MM') AS month, revenue
FROM (
  SELECT mon, revenue, AVG(revenue) OVER () AS a FROM m
) t
WHERE revenue > a
ORDER BY mon ASC
