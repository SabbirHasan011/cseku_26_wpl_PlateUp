-- Per-offer state protects the daily price against increases and repeated drops.
ALTER TABLE daily_availability ADD COLUMN IF NOT EXISTS last_price NUMERIC(10,2) CHECK (last_price>=0);
ALTER TABLE daily_availability ADD COLUMN IF NOT EXISTS last_priced_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='007-gradual-pricing') THEN
    -- Preserve prices already advertised during an offer at deployment time.
    UPDATE daily_availability a SET last_price=l.rescue_price,last_priced_at=l.pricing_updated_at
    FROM listings l WHERE a.listing_id=l.id AND l.pricing_updated_at IS NOT NULL
      AND l.pricing_updated_at >= (a.offer_date+l.offer_start_time) AT TIME ZONE 'Asia/Dhaka'
      AND l.pricing_updated_at < ((a.offer_date+l.offer_end_time)+
        CASE WHEN l.offer_end_time<=l.offer_start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END) AT TIME ZONE 'Asia/Dhaka';
    UPDATE listings SET pricing_updated_at=NULL;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES ('007-gradual-pricing') ON CONFLICT DO NOTHING;
