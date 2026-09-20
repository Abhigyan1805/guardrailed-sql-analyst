WITH lines AS (
  SELECT o.status, oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
)
SELECT status, SUM(rev) AS revenue FROM lines WHERE status = 'paid' GROUP BY status
UNION ALL
SELECT status, SUM(rev) AS revenue FROM lines WHERE status = 'shipped' GROUP BY status
ORDER BY status ASC
