SELECT AVG(r.rating)::float AS avg_rating, COUNT(*) AS reviews
FROM reviews r
