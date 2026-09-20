WITH r AS (
  SELECT o.customer_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
), ranked AS (
  SELECT customer_id, revenue,
         ROW_NUMBER() OVER (ORDER BY revenue DESC, customer_id ASC) AS rn
  FROM r
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name, ranked.revenue
FROM ranked
JOIN customers c ON c.customer_id = ranked.customer_id
WHERE ranked.rn <= 5
ORDER BY ranked.revenue DESC, c.customer_id ASC
