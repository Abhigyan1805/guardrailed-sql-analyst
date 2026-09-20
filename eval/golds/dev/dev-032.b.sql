WITH o AS (
  SELECT oi.order_id, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  GROUP BY oi.order_id
), ranked AS (
  SELECT revenue,
         ROW_NUMBER() OVER (ORDER BY revenue ASC) AS rn,
         COUNT(*) OVER () AS n
  FROM o
)
SELECT AVG(revenue)::float AS median_order_value
FROM ranked
WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
