SELECT 'CUSTOMER-' || c.customer_id AS display_name, f.first_at
FROM (
  SELECT o.customer_id, MIN(o.ordered_at) AS first_at
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
) f
JOIN customers c ON c.customer_id = f.customer_id
WHERE f.first_at >= TIMESTAMPTZ '2024-01-01T00:00:00Z'
  AND f.first_at < TIMESTAMPTZ '2025-01-01T00:00:00Z'
  AND NOT EXISTS (
    SELECT 1 FROM orders o2
    WHERE o2.customer_id = f.customer_id
      AND o2.ordered_at > TIMESTAMPTZ '2025-07-01T00:00:00Z'
      AND o2.tenant_id = :tenant
  )
ORDER BY f.first_at ASC, c.customer_id ASC
LIMIT 20
