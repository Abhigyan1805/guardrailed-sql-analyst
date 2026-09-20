WITH first_o AS (
  SELECT o.customer_id, MIN(o.ordered_at) AS first_at
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
), recent AS (
  SELECT DISTINCT o.customer_id
  FROM orders o
  WHERE o.ordered_at > TIMESTAMPTZ '2025-07-01T00:00:00Z' AND o.tenant_id = :tenant
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name, f.first_at
FROM first_o f
JOIN customers c ON c.customer_id = f.customer_id
LEFT JOIN recent r ON r.customer_id = f.customer_id
WHERE f.first_at >= TIMESTAMPTZ '2024-01-01T00:00:00Z'
  AND f.first_at < TIMESTAMPTZ '2025-01-01T00:00:00Z'
  AND r.customer_id IS NULL
ORDER BY f.first_at ASC, c.customer_id ASC
LIMIT 20
