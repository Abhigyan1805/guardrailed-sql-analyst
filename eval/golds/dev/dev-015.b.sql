WITH lines AS (
  SELECT o.region, oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
)
SELECT region, SUM(rev) AS revenue
FROM lines
GROUP BY region
ORDER BY SUM(rev) DESC, region ASC
