WITH cust AS (
  SELECT o.customer_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
), total AS (SELECT SUM(revenue) AS t FROM cust),
n AS (SELECT COUNT(*) AS c FROM cust)
SELECT (
  SELECT SUM(revenue)
  FROM (
    SELECT revenue FROM cust
    ORDER BY revenue DESC, customer_id ASC
    LIMIT (SELECT CEIL(0.1 * c)::bigint FROM n)
  ) top
) / total.t AS top10_share
FROM total
