-- Add shared city identities without losing previously saved locations.
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS cities_name_normalized_idx ON cities(LOWER(name));
INSERT INTO cities(name,aliases) VALUES
  ('Dhaka',ARRAY['dacca']),('Khulna','{}'),('Chattogram',ARRAY['chittagong']),
  ('Rajshahi','{}'),('Sylhet','{}'),('Barishal',ARRAY['barisal']),('Rangpur','{}'),
  ('Mymensingh','{}'),('Gazipur','{}'),('Narayanganj','{}'),('Cumilla',ARRAY['comilla']),
  ('Bogura',ARRAY['bogra']),('Jashore',ARRAY['jessore']),('Kushtia','{}'),
  ('Cox''s Bazar',ARRAY['coxs bazar','cox’s bazar']),('Dinajpur','{}'),
  ('Faridpur','{}'),('Pabna','{}'),('Tangail','{}'),('Feni','{}')
ON CONFLICT DO NOTHING;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);

DO $$ DECLARE profile_table TEXT; BEGIN
  FOREACH profile_table IN ARRAY ARRAY['customers','businesses'] LOOP
    EXECUTE format('UPDATE %I p SET city_id=c.id,city=c.name FROM cities c
      WHERE p.city_id IS NULL AND (LOWER(BTRIM(REGEXP_REPLACE(p.city,''[[:space:]]+'','' '',''g'')))=LOWER(c.name)
        OR LOWER(BTRIM(REGEXP_REPLACE(p.city,''[[:space:]]+'','' '',''g'')))=ANY(c.aliases))',profile_table);
    EXECUTE format('INSERT INTO cities(name) SELECT DISTINCT INITCAP(LOWER(BTRIM(REGEXP_REPLACE(city,''[[:space:]]+'','' '',''g''))))
      FROM %I WHERE city_id IS NULL AND NULLIF(BTRIM(city),'''') IS NOT NULL ON CONFLICT DO NOTHING',profile_table);
    EXECUTE format('UPDATE %I p SET city_id=c.id,city=c.name FROM cities c WHERE p.city_id IS NULL
      AND LOWER(BTRIM(REGEXP_REPLACE(p.city,''[[:space:]]+'','' '',''g'')))=LOWER(c.name)',profile_table);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS businesses_city_id_idx ON businesses(city_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_locked_until TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS orders_pickup_code_idx ON orders(pickup_code) WHERE pickup_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,order_id,event)
);
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id,id DESC);
