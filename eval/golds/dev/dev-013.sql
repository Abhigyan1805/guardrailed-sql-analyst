WITH cust AS (
  SELECT o.customer_id,
         COUNT(DISTINCT oi.order_id) AS orders,
         SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
)
SELECT 'CUSTOMER-' || c.customer_id AS display_name, cust.orders, cust.revenue
FROM cust
JOIN customers c ON c.customer_id = cust.customer_id
WHERE cust.orders > 3 AND cust.revenue > 1000
ORDER BY cust.revenue DESC, c.customer_id ASC
LIMIT 20
