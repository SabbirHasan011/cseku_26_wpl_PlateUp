-- Preserve listing category text for API compatibility; the catalog controls new choices.
CREATE TABLE IF NOT EXISTS food_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS food_categories_name_unique ON food_categories (LOWER(name));

INSERT INTO food_categories (name) VALUES
  ('Bakery'),('Restaurant meal'),('Main Meal'),('Groceries'),('Cafe'),('Produce')
ON CONFLICT DO NOTHING;

INSERT INTO food_categories (name)
SELECT DISTINCT btrim(category) FROM listings WHERE category IS NOT NULL AND length(btrim(category)) > 0
ORDER BY btrim(category)
ON CONFLICT DO NOTHING;
