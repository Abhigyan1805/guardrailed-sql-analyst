SELECT COUNT(*) AS orders_2025
FROM orders o
WHERE o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
  AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
  AND o.tenant_id = :tenant
