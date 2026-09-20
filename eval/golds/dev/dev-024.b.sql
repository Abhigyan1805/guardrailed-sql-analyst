SELECT r.region, n.cancelled
FROM (SELECT DISTINCT region FROM orders WHERE tenant_id = :tenant) r
JOIN (
  SELECT region, COUNT(*) AS cancelled
  FROM orders
  WHERE status = 'cancelled' AND tenant_id = :tenant
  GROUP BY region
) n ON n.region = r.region
ORDER BY n.cancelled DESC, r.region ASC
