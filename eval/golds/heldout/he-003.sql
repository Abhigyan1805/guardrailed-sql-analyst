SELECT COUNT(*) AS cancelled_orders
FROM orders o
WHERE o.status = 'cancelled' AND o.tenant_id = :tenant
  AND o.ordered_at >= TIMESTAMPTZ '2023-01-01T00:00:00Z'
  AND o.ordered_at < TIMESTAMPTZ '2024-01-01T00:00:00Z'
