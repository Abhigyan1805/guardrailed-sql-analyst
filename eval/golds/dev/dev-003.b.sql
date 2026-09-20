SELECT m.display_name, m.segment, m.created_at
FROM (
  SELECT 'CUSTOMER-' || c.customer_id AS display_name, c.segment, c.created_at,
         ROW_NUMBER() OVER (ORDER BY c.created_at DESC, c.customer_id ASC) AS rn
  FROM customers c
  WHERE c.created_at > TIMESTAMPTZ '2023-06-01T00:00:00Z'
) m
WHERE m.rn <= 10
ORDER BY m.rn ASC
