WITH c AS (
  SELECT o.customer_id, COUNT(*) AS orders
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.customer_id
), r AS (
  SELECT customer_id, orders, ROW_NUMBER() OVER (ORDER BY orders DESC, customer_id ASC) AS rn
  FROM c
)
SELECT 'CUSTOMER-' || customer_id AS display_name, orders FROM r
WHERE rn <= 10
ORDER BY orders DESC, customer_id ASC
