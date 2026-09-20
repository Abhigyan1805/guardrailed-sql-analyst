WITH ord AS (
  SELECT oi.order_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY oi.order_id
)
SELECT AVG(revenue) AS avg_order_value FROM ord
