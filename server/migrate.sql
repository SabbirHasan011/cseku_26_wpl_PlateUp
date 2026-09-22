-- Additive migration from the original three-table prototype. Safe to run again.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Repair only the unusable hash shipped with the original public demo seed.
UPDATE users SET password_hash = '$2b$10$y/GmCC2pucaVEKAzfTu.CeUr1A926kLEa8y6c13/.75PYO9CngyKe'
WHERE email IN ('user@plateup.com', 'spicetrail@plateup.com')
  AND password_hash = '$2b$10$8l1R6D4eA1JdQw2m3LrJ/Ok6i0o7QpZRL4nZsawMJeU0k5P79NH5m';

CREATE TABLE IF NOT EXISTS customers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  address TEXT,
  city VARCHAR(255),
  preferred_location VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS businesses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  business_name VARCHAR(255) NOT NULL,
  description TEXT,
  address TEXT,
  city VARCHAR(255),
  phone VARCHAR(50),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  opening_time TIME,
  closing_time TIME,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Legacy rows can name businesses/customers that never registered. Disabled
-- placeholder users preserve those rows without providing usable credentials.
INSERT INTO users (name, email, password_hash, role, status)
SELECT DISTINCT COALESCE(NULLIF(TRIM(source.business_name), ''), 'Unknown Business'),
       'legacy-business-' || md5(COALESCE(NULLIF(TRIM(source.business_name), ''), 'Unknown Business')) || '@plateup.invalid',
       '!disabled', 'business', 'inactive'
FROM (
  SELECT business_name FROM listings
  UNION ALL SELECT business_name FROM reviews
) source
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.role = 'business'
    AND LOWER(u.name) = LOWER(COALESCE(NULLIF(TRIM(source.business_name), ''), 'Unknown Business'))
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (name, email, password_hash, role, status)
SELECT DISTINCT COALESCE(NULLIF(TRIM(r.author_name), ''), 'Legacy Customer'),
       'legacy-customer-' || md5(COALESCE(NULLIF(TRIM(r.author_name), ''), 'Legacy Customer')) || '@plateup.invalid',
       '!disabled', 'customer', 'inactive'
FROM reviews r
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.role = 'customer'
    AND LOWER(u.name) = LOWER(COALESCE(NULLIF(TRIM(r.author_name), ''), 'Legacy Customer'))
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO customers (user_id)
SELECT id FROM users WHERE role = 'customer'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO businesses (user_id, business_name)
SELECT id, name FROM users WHERE role = 'business'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(user_id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS available_from TIMESTAMP;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS available_until TIMESTAMP;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'available';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE listings l SET business_id = (
  SELECT b.user_id FROM businesses b
  WHERE LOWER(b.business_name) = LOWER(COALESCE(NULLIF(TRIM(l.business_name), ''), 'Unknown Business'))
  ORDER BY b.user_id LIMIT 1
)
WHERE l.business_id IS NULL;
ALTER TABLE listings ALTER COLUMN business_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='listings_values_check') THEN
    ALTER TABLE listings ADD CONSTRAINT listings_values_check CHECK
      (quantity >= 0 AND original_price >= 0 AND rescue_price >= 0 AND rescue_price <= original_price);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='listings_status_check') THEN
    ALTER TABLE listings ADD CONSTRAINT listings_status_check CHECK
      (status IN ('available','sold_out','expired','inactive'));
  END IF;
END $$;

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(user_id);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(user_id);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS listing_id INTEGER REFERENCES listings(id);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS order_id INTEGER;

UPDATE reviews r SET customer_id = (
  SELECT c.user_id FROM customers c JOIN users u ON u.id = c.user_id
  WHERE LOWER(u.name) = LOWER(COALESCE(NULLIF(TRIM(r.author_name), ''), 'Legacy Customer'))
  ORDER BY c.user_id LIMIT 1
) WHERE r.customer_id IS NULL;
UPDATE reviews r SET business_id = (
  SELECT b.user_id FROM businesses b
  WHERE LOWER(b.business_name) = LOWER(COALESCE(NULLIF(TRIM(r.business_name), ''), 'Unknown Business'))
  ORDER BY b.user_id LIMIT 1
) WHERE r.business_id IS NULL;
UPDATE reviews r SET listing_id = (
  SELECT l.id FROM listings l WHERE l.business_id = r.business_id
    AND LOWER(l.title) = LOWER(r.item_name)
  ORDER BY l.id LIMIT 1
) WHERE r.listing_id IS NULL;
ALTER TABLE reviews ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE reviews ALTER COLUMN business_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_rating_check') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(user_id),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','ready','completed','cancelled')),
  order_time TIMESTAMP NOT NULL DEFAULT NOW(),
  pickup_time TIMESTAMP,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Pay at pickup',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','refunded')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_data (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(user_id),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  order_id INTEGER UNIQUE REFERENCES orders(id),
  quantity_sold INTEGER NOT NULL CHECK (quantity_sold > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  sale_time TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ml_predictions (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(user_id),
  listing_id INTEGER REFERENCES listings(id),
  prediction_type VARCHAR(20) NOT NULL CHECK (prediction_type IN ('demand','surplus','price')),
  predicted_value NUMERIC(12,2) NOT NULL,
  confidence NUMERIC(5,4) CHECK (confidence BETWEEN 0 AND 1),
  prediction_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_order_id_fkey') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_order ON reviews(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS listings_business_id_idx ON listings(business_id);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_listing_id_idx ON orders(listing_id);
CREATE INDEX IF NOT EXISTS reviews_business_id_idx ON reviews(business_id);
CREATE INDEX IF NOT EXISTS reviews_customer_id_idx ON reviews(customer_id);
CREATE INDEX IF NOT EXISTS sales_data_business_id_idx ON sales_data(business_id);
CREATE INDEX IF NOT EXISTS ml_predictions_business_id_idx ON ml_predictions(business_id);

-- A listing is now a reusable food item. Existing IDs remain intact so orders,
-- reviews, sales, and prediction infrastructure keep their foreign keys.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS offer_start_time TIME;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS offer_end_time TIME;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE listings SET
  offer_start_time = COALESCE(offer_start_time,
    CASE WHEN available_from IS NOT NULL THEN
      available_from::time
    ELSE TIME '00:00' END),
  offer_end_time = COALESCE(offer_end_time,
    CASE WHEN available_until IS NOT NULL THEN
      available_until::time
    ELSE TIME '00:00' END),
  is_active = CASE WHEN status='inactive' THEN FALSE ELSE is_active END
WHERE offer_start_time IS NULL OR offer_end_time IS NULL OR status='inactive';
ALTER TABLE listings ALTER COLUMN offer_start_time SET NOT NULL;
ALTER TABLE listings ALTER COLUMN offer_end_time SET NOT NULL;

CREATE TABLE IF NOT EXISTS daily_availability (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  offer_date DATE NOT NULL,
  initial_quantity INTEGER NOT NULL CHECK (initial_quantity >= 0),
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= initial_quantity),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_availability_one_per_day UNIQUE (listing_id, offer_date)
);
CREATE INDEX IF NOT EXISTS daily_availability_offer_date_idx ON daily_availability(offer_date);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS daily_availability_id INTEGER REFERENCES daily_availability(id);
CREATE INDEX IF NOT EXISTS orders_daily_availability_id_idx ON orders(daily_availability_id);

-- PostgreSQL computes status from the business-local offer date and clock.
-- End <= start means the end is on the next date (00:00 is midnight).
CREATE OR REPLACE FUNCTION plateup_daily_status(
  p_offer_date DATE, p_remaining INTEGER, p_start TIME, p_end TIME, p_now TIMESTAMP
) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN p_offer_date IS NULL THEN 'Not Available Today'
    WHEN p_now >= (p_offer_date + p_end + CASE WHEN p_end <= p_start
      THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END) THEN 'Closed for Today'
    WHEN p_remaining = 0 THEN 'Sold Out'
    WHEN p_now < p_offer_date + p_start THEN 'Scheduled for Today'
    ELSE 'Active'
  END;
$$;

-- Backfill exactly once. Old rows with no dates become reusable items with a
-- full-day window; their current stock is copied to one dated record. Previous
-- orders get historical dated records, and existing order IDs stay unchanged.
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT NOW());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='daily_availability_v1') THEN
    INSERT INTO daily_availability (listing_id, offer_date, initial_quantity, remaining_quantity)
    SELECT o.listing_id,
      CASE WHEN l.offer_end_time < l.offer_start_time AND
        (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::time < l.offer_end_time)
        THEN (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date - 1)
        ELSE ((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date END,
      SUM(o.quantity)::integer,
      SUM(CASE WHEN o.status='cancelled' THEN o.quantity ELSE 0 END)::integer
    FROM orders o JOIN listings l ON l.id=o.listing_id
    GROUP BY o.listing_id, 2
    ON CONFLICT (listing_id,offer_date) DO NOTHING;

    INSERT INTO daily_availability (listing_id, offer_date, initial_quantity, remaining_quantity)
    SELECT l.id,
      COALESCE(l.available_from::date,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date),
      COALESCE(l.quantity,0) + COALESCE((SELECT SUM(o.quantity)::integer FROM orders o
        WHERE o.listing_id=l.id AND o.status<>'cancelled' AND
        (CASE WHEN l.offer_end_time < l.offer_start_time AND
          (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::time < l.offer_end_time)
          THEN (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date - 1)
          ELSE ((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date END) =
          COALESCE(l.available_from::date,
            (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date)),0),
      COALESCE(l.quantity,0)
    FROM listings l
    ON CONFLICT (listing_id,offer_date) DO UPDATE SET
      initial_quantity=EXCLUDED.initial_quantity,
      remaining_quantity=EXCLUDED.remaining_quantity;

    UPDATE orders o SET daily_availability_id=a.id
    FROM listings l JOIN daily_availability a ON a.listing_id=l.id
    WHERE o.listing_id=l.id AND o.daily_availability_id IS NULL AND a.offer_date=
      CASE WHEN l.offer_end_time < l.offer_start_time AND
        (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::time < l.offer_end_time)
        THEN (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date - 1)
        ELSE ((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date END;

    INSERT INTO schema_migrations(version) VALUES ('daily_availability_v1');
  END IF;
END $$;

-- Correct databases that ran the first draft of the backfill before the
-- legacy timestamp-without-time-zone values were recognized as wall-clock time.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='daily_availability_timezone_v2') THEN
    UPDATE listings SET offer_start_time=available_from::time,
      offer_end_time=COALESCE(available_until::time,offer_end_time)
    WHERE available_from IS NOT NULL;

    UPDATE daily_availability a SET offer_date=l.available_from::date
    FROM listings l WHERE a.listing_id=l.id AND l.available_from IS NOT NULL
      AND a.offer_date<>l.available_from::date
      AND NOT EXISTS (SELECT 1 FROM daily_availability other
        WHERE other.listing_id=l.id AND other.offer_date=l.available_from::date);

    INSERT INTO daily_availability (listing_id,offer_date,initial_quantity,remaining_quantity)
    SELECT o.listing_id,
      CASE WHEN l.offer_end_time<l.offer_start_time AND
        (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::time<l.offer_end_time)
        THEN (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date-1)
        ELSE ((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date END,
      SUM(o.quantity)::integer,
      SUM(CASE WHEN o.status='cancelled' THEN o.quantity ELSE 0 END)::integer
    FROM orders o JOIN listings l ON l.id=o.listing_id GROUP BY o.listing_id,2
    ON CONFLICT (listing_id,offer_date) DO NOTHING;

    UPDATE orders o SET daily_availability_id=a.id
    FROM listings l JOIN daily_availability a ON a.listing_id=l.id
    WHERE o.listing_id=l.id AND a.offer_date=CASE
      WHEN l.offer_end_time<l.offer_start_time AND
        (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::time<l.offer_end_time)
        THEN (((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date-1)
        ELSE ((o.order_time AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Dhaka')::date END;

    INSERT INTO schema_migrations(version) VALUES ('daily_availability_timezone_v2');
  END IF;
END $$;
