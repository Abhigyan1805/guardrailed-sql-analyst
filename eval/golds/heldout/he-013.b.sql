SELECT COALESCE(SUM(CASE WHEN p.is_active THEN 1 ELSE 0 END), 0) AS active_products FROM products p
