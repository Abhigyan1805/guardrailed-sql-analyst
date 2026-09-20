WITH p AS (SELECT list_price FROM products)
SELECT (SELECT MIN(list_price) FROM p) AS min_price,
       (SELECT MAX(list_price) FROM p) AS max_price
