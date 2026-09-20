WITH s AS (SELECT SUM(r.rating) AS total, COUNT(*) AS n FROM reviews r)
SELECT (s.total::float / NULLIF(s.n, 0)) AS avg_rating, s.n AS reviews
FROM s
