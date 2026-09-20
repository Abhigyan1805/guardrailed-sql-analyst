WITH ordtot AS (
  SELECT oi.order_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS total
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY oi.order_id
), ordcat AS (
  SELECT DISTINCT oi.order_id, c.name AS category_name
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
), catavg AS (
  SELECT oc.category_name, AVG(ot.total) AS aov
  FROM ordcat oc
  JOIN ordtot ot ON ot.order_id = oc.order_id
  GROUP BY oc.category_name
), comp AS (SELECT AVG(total) AS a FROM ordtot)
SELECT category_name, aov AS avg_order_value
FROM catavg CROSS JOIN comp
WHERE aov > comp.a
ORDER BY aov DESC, category_name ASC
