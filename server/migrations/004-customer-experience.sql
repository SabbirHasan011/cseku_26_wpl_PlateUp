ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_deadline TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK
  (status IN ('pending','confirmed','ready','completed','cancelled','rejected','expired'));

-- Snapshot existing reservation windows once; later item edits cannot change them.
UPDATE orders o SET pickup_deadline=(a.offer_date + l.offer_end_time +
  CASE WHEN l.offer_end_time<=l.offer_start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END)
  AT TIME ZONE 'Asia/Dhaka'
FROM daily_availability a JOIN listings l ON l.id=a.listing_id
WHERE o.daily_availability_id=a.id AND o.pickup_deadline IS NULL;
CREATE INDEX IF NOT EXISTS orders_open_deadline_idx ON orders(pickup_deadline)
  WHERE status IN ('pending','confirmed','ready');

CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((listing_id IS NOT NULL)::int + (business_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_listing_unique ON favorites(customer_id,listing_id) WHERE listing_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS favorites_business_unique ON favorites(customer_id,business_id) WHERE business_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id,created_at DESC);
