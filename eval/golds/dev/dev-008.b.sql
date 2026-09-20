SELECT c.name AS category_name
FROM categories c
WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.category_id)
ORDER BY c.name ASC
