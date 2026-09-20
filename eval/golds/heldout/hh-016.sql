WITH cr AS (
  SELECT c.name AS category_name,
         SUM(CASE WHEN o.status = 'refunded' THEN oi.qty * oi.unit_price * (1 - oi.discount) ELSE 0 END) AS refunded,
         SUM(CASE WHEN o.status = 'cancelled' THEN oi.qty * oi.unit_price * (1 - oi.discount) ELSE 0 END) AS cancelled
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('refunded','cancelled') AND o.tenant_id = :tenant
  GROUP BY c.name
)
SELECT category_name FROM cr WHERE refunded > cancelled ORDER BY category_name ASC
