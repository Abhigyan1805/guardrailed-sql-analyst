SELECT c.segment, COUNT(*) AS customers
FROM customers c
GROUP BY c.segment
ORDER BY customers DESC, c.segment ASC
