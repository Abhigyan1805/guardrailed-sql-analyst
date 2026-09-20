WITH cust AS (
  SELECT o.customer_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY o.customer_id
), total AS (SELECT SUM(revenue) AS t FROM cust),
ranked AS (
  SELECT customer_id, revenue,
         ROW_NUMBER() OVER (ORDER BY revenue DESC, customer_id ASC) AS rn,
         COUNT(*) OVER () AS n
  FROM cust
)
SELECT SUM(ranked.revenue) / (SELECT t FROM total) AS top10_share
FROM ranked
WHERE ranked.rn <= CEIL(0.1 * ranked.n)
