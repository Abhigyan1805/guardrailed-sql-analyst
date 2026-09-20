WITH o AS (
  SELECT date_trunc('month', ordered_at) AS mon,
         CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END AS cancelled
  FROM orders
  WHERE tenant_id = :tenant
)
SELECT to_char(mon, 'YYYY-MM') AS month, SUM(cancelled)::float / COUNT(*) AS cancelled_pct
FROM o
GROUP BY mon
ORDER BY mon ASC
