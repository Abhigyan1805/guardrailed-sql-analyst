WITH o AS (
  SELECT oi.order_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY oi.order_id
)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY revenue)::float AS median_order_value
FROM o
