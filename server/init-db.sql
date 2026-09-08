CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  business_name VARCHAR(255),
  original_price NUMERIC(10,2) DEFAULT 0,
  rescue_price NUMERIC(10,2) DEFAULT 0,
  quantity INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  author_name VARCHAR(255),
  rating INT DEFAULT 5,
  comment TEXT NOT NULL,
  reply TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO users (name, email, password_hash, role)
VALUES
  ('Demo Customer', 'user@plateup.com', '$2b$10$8l1R6D4eA1JdQw2m3LrJ/Ok6i0o7QpZRL4nZsawMJeU0k5P79NH5m', 'customer'),
  ('Spice Trail Kitchen', 'spicetrail@plateup.com', '$2b$10$8l1R6D4eA1JdQw2m3LrJ/Ok6i0o7QpZRL4nZsawMJeU0k5P79NH5m', 'business')
ON CONFLICT (email) DO NOTHING;

INSERT INTO listings (title, category, business_name, original_price, rescue_price, quantity)
VALUES
  ('Mixed pastry surprise box', 'Bakery', 'Aromas Bakery', 450, 180, 6),
  ('Chicken biryani, end-of-day tray', 'Restaurant meal', 'Spice Trail Kitchen', 320, 140, 3),
  ('Ripe produce crate', 'Produce', 'Green Basket Grocers', 600, 220, 2)
ON CONFLICT DO NOTHING;

INSERT INTO reviews (business_name, item_name, author_name, rating, comment, reply)
VALUES
  ('Spice Trail Kitchen', 'Chicken biryani, end-of-day tray', 'Tanvir Hossain', 5, 'Food was warm and tasted perfectly fresh! Packaging was neat. Unbelievable deal for the price.', 'Thank you Tanvir! Glad you enjoyed the meal and helped us reduce surplus food!'),
  ('Spice Trail Kitchen', 'Special Mutton Curry Box', 'Nabila K.', 4, 'Great portion size. A bit spicy for my personal taste, but incredible value.', NULL),
  ('Aromas Bakery', 'Mixed pastry surprise box', 'Sajid Ahmed', 5, 'The croissants were still buttery and crisp! Will order again tomorrow.', 'Thanks Sajid! See you next time.')
ON CONFLICT DO NOTHING;
