SELECT r.region, r.avg_order_value, rf.refunded_share, r.orders
FROM (
  SELECT o.region,
         AVG(CASE WHEN o.status IN ('paid','shipped') THEN tot.total END) AS avg_order_value,
         COUNT(*) AS orders
  FROM orders o
  JOIN (SELECT order_id, SUM(qty * unit_price * (1 - discount)) AS total
        FROM order_items GROUP BY order_id) tot ON tot.order_id = o.order_id
  WHERE o.tenant_id = :tenant
  GROUP BY o.region
) r
JOIN (
  SELECT o.region,
         COUNT(*) FILTER (WHERE o.status = 'refunded')::float / NULLIF(COUNT(*), 0) AS refunded_share
  FROM orders o
  WHERE o.tenant_id = :tenant
  GROUP BY o.region
) rf ON rf.region = r.region
ORDER BY r.region ASC
