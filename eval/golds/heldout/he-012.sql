SELECT o.status, COUNT(*) AS orders
FROM orders o
WHERE o.tenant_id = :tenant
GROUP BY o.status
ORDER BY orders DESC, o.status ASC
