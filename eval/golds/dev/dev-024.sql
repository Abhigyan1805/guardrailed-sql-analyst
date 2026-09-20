SELECT o.region, COUNT(*) AS cancelled
FROM orders o
WHERE o.status = 'cancelled' AND o.tenant_id = :tenant
GROUP BY o.region
ORDER BY cancelled DESC, o.region ASC
