WITH ordtot AS (
  SELECT o.order_id, o.customer_id, o.ordered_at, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.tenant_id = :tenant
  GROUP BY o.order_id, o.customer_id, o.ordered_at
), firsts AS (
  SELECT DISTINCT ON (customer_id) customer_id, ordered_at, revenue
  FROM ordtot
  ORDER BY customer_id ASC, ordered_at ASC, order_id ASC
)
SELECT 'CUSTOMER-' || customer_id AS display_name,
       ordered_at AS first_order_at, revenue AS first_order_revenue
FROM firsts
ORDER BY ordered_at ASC, customer_id ASC
LIMIT 20
