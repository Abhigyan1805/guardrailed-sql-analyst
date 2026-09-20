SELECT (SELECT COUNT(*) FROM customers)
       - (SELECT COUNT(DISTINCT customer_id) FROM orders WHERE tenant_id = :tenant) AS customers
