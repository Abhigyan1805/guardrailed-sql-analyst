SELECT pay.method, COUNT(*) AS payments, SUM(pay.amount) AS total
FROM payments pay
JOIN orders o ON o.order_id = pay.order_id
WHERE o.tenant_id = :tenant
GROUP BY pay.method
ORDER BY SUM(pay.amount) DESC, pay.method ASC
