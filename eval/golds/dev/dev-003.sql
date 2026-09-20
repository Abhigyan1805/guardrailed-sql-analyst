SELECT 'CUSTOMER-' || c.customer_id AS display_name, c.segment, c.created_at
FROM customers c
WHERE c.created_at > TIMESTAMPTZ '2023-06-01T00:00:00Z'
ORDER BY c.created_at DESC, c.customer_id ASC
LIMIT 10
