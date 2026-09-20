SELECT COUNT(*) AS payments, SUM(pay.amount) AS total_amount
FROM payments pay
JOIN orders o ON o.order_id = pay.order_id
WHERE o.tenant_id = :tenant
