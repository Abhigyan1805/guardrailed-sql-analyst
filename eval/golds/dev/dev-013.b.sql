SELECT 'CUSTOMER-' || c.customer_id AS display_name, ord.n AS orders, rev.rev AS revenue
FROM customers c
JOIN (
  SELECT o.customer_id, COUNT(DISTINCT oi.order_id) AS n
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
  HAVING COUNT(DISTINCT oi.order_id) > 3
) ord ON ord.customer_id = c.customer_id
JOIN (
  SELECT o.customer_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS rev
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
  HAVING SUM(oi.qty * oi.unit_price * (1 - oi.discount)) > 1000
) rev ON rev.customer_id = c.customer_id
ORDER BY rev.rev DESC, c.customer_id ASC
LIMIT 20
