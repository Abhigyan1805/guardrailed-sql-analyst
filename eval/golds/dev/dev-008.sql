SELECT DISTINCT c.name AS category_name
FROM products p
JOIN categories c ON c.category_id = p.category_id
ORDER BY category_name ASC
