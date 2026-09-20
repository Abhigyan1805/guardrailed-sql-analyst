SELECT s.segment,
       (SELECT COUNT(*) FROM customers c WHERE c.segment = s.segment) AS customers
FROM (SELECT DISTINCT segment FROM customers) s
ORDER BY customers DESC, s.segment ASC
