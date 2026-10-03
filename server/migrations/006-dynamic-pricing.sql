-- Additive: preserve historical order prices and the offer event journal.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS minimum_price NUMERIC(10,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS pricing_source TEXT NOT NULL DEFAULT 'fallback';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMPTZ;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS pricing_reason TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='006-dynamic-pricing') THEN
    UPDATE listings SET minimum_price=LEAST(rescue_price,FLOOR(original_price*80)/100),
      rescue_price=LEAST(rescue_price,FLOOR(original_price*80)/100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='listing_dynamic_price_bounds') THEN
    ALTER TABLE listings ADD CONSTRAINT listing_dynamic_price_bounds CHECK
      (minimum_price IS NULL OR (minimum_price>=0 AND minimum_price<=FLOOR(original_price*80)/100
       AND rescue_price>=minimum_price AND rescue_price<=FLOOR(original_price*80)/100));
  END IF;
END $$;
ALTER TABLE listings ALTER COLUMN minimum_price SET NOT NULL;
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS training_item_day_source_idx ON training_records(listing_id,offer_date,data_source)
  WHERE listing_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pricing_models (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  artifact JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('platform','restaurant','synthetic')),
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ml_predictions ADD COLUMN IF NOT EXISTS model_source TEXT;
ALTER TABLE ml_predictions ADD COLUMN IF NOT EXISTS details JSONB;
INSERT INTO schema_migrations(version) VALUES ('006-dynamic-pricing') ON CONFLICT DO NOTHING;
