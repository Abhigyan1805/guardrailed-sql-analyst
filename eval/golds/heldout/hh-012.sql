SELECT to_char(date_trunc('month', o.ordered_at), 'YYYY-MM') AS month,
       COUNT(*) FILTER (WHERE o.status = 'cancelled')::float / COUNT(*) AS cancelled_pct
FROM orders o
WHERE o.tenant_id = :tenant
GROUP BY 1
ORDER BY 1 ASC
