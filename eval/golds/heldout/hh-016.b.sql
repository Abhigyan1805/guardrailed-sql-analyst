WITH rf AS (
  SELECT c.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS v
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status = 'refunded' AND o.tenant_id = :tenant
  GROUP BY c.name
), cn AS (
  SELECT c.name AS category_name, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS v
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status = 'cancelled' AND o.tenant_id = :tenant
  GROUP BY c.name
)
SELECT rf.category_name
FROM rf
JOIN cn ON cn.category_name = rf.category_name
WHERE rf.v > cn.v
ORDER BY rf.category_name ASC
