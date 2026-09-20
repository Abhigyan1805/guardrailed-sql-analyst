SELECT to_char(date_trunc('month', o.ordered_at), 'YYYY-MM') AS month, COUNT(*) AS orders
FROM orders o
WHERE o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
  AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
  AND o.tenant_id = :tenant
GROUP BY 1
ORDER BY 1 ASC
