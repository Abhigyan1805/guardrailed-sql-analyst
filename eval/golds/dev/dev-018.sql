WITH r AS (
  SELECT o.customer_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name, r.revenue
FROM r
JOIN customers c ON c.customer_id = r.customer_id
ORDER BY r.revenue DESC, c.customer_id ASC
LIMIT 5
