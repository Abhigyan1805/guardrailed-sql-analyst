WITH ordtot AS (
  SELECT o.order_id, o.customer_id, o.ordered_at, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.tenant_id = :tenant
  GROUP BY o.order_id, o.customer_id, o.ordered_at
), ranked AS (
  SELECT customer_id, ordered_at, revenue,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY ordered_at ASC, order_id ASC) AS rn
  FROM ordtot
)
SELECT 'CUSTOMER-' || customer_id AS display_name,
       ordered_at AS first_order_at, revenue AS first_order_revenue
FROM ranked
WHERE rn = 1
ORDER BY ordered_at ASC, customer_id ASC
LIMIT 20
