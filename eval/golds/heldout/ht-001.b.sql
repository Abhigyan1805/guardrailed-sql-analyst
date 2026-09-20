WITH lines AS (
  SELECT oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
)
SELECT COALESCE(SUM(rev), 0) AS revenue FROM lines
