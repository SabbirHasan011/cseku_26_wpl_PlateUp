-- Preserve observations without changing marketplace inventory or old identities.
CREATE TABLE IF NOT EXISTS offer_snapshots (
  daily_availability_id INTEGER PRIMARY KEY REFERENCES daily_availability(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  original_unit_price NUMERIC(10,2) NOT NULL,
  rescue_unit_price NUMERIC(10,2) NOT NULL,
  offer_start_time TIME NOT NULL,
  offer_end_time TIME NOT NULL,
  first_quantity INTEGER NOT NULL CHECK (first_quantity >= 0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quality TEXT NOT NULL CHECK (quality IN ('captured','legacy_estimated'))
);

-- Existing offers cannot be reconstructed accurately from today's editable items.
INSERT INTO offer_snapshots(daily_availability_id,title,category,original_unit_price,
  rescue_unit_price,offer_start_time,offer_end_time,first_quantity,quality)
SELECT a.id,l.title,l.category,l.original_price,l.rescue_price,l.offer_start_time,
  l.offer_end_time,a.initial_quantity,'legacy_estimated'
FROM daily_availability a JOIN listings l ON l.id=a.listing_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS offer_events (
  id BIGSERIAL PRIMARY KEY,
  daily_availability_id INTEGER NOT NULL REFERENCES daily_availability(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  original_unit_price NUMERIC(10,2) NOT NULL,
  rescue_unit_price NUMERIC(10,2) NOT NULL,
  initial_quantity INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  order_quantity INTEGER,
  order_status TEXT,
  order_unit_price NUMERIC(12,4)
);
CREATE INDEX IF NOT EXISTS offer_events_daily_idx ON offer_events(daily_availability_id,id);

CREATE OR REPLACE FUNCTION plateup_observe_inventory() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item listings%ROWTYPE;
BEGIN
  SELECT * INTO item FROM listings WHERE id=NEW.listing_id;
  IF TG_OP='INSERT' THEN
    INSERT INTO offer_snapshots(daily_availability_id,title,category,original_unit_price,
      rescue_unit_price,offer_start_time,offer_end_time,first_quantity,quality)
    VALUES(NEW.id,item.title,item.category,item.original_price,item.rescue_price,
      item.offer_start_time,item.offer_end_time,NEW.initial_quantity,'captured') ON CONFLICT DO NOTHING;
  ELSIF NEW.initial_quantity=OLD.initial_quantity AND NEW.remaining_quantity=OLD.remaining_quantity THEN
    RETURN NEW;
  END IF;
  INSERT INTO offer_events(daily_availability_id,event_type,original_unit_price,rescue_unit_price,initial_quantity,remaining_quantity)
  VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN 'offer_created'
    WHEN NEW.initial_quantity<>OLD.initial_quantity THEN 'quantity_changed' ELSE 'inventory_changed' END,
    item.original_price,item.rescue_price,NEW.initial_quantity,NEW.remaining_quantity);
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER plateup_inventory_observation AFTER INSERT OR UPDATE ON daily_availability
FOR EACH ROW EXECUTE FUNCTION plateup_observe_inventory();

CREATE OR REPLACE FUNCTION plateup_observe_item() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE daily daily_availability%ROWTYPE; kind TEXT;
BEGIN
  IF ROW(NEW.title,NEW.category,NEW.original_price,NEW.rescue_price,NEW.offer_start_time,NEW.offer_end_time,NEW.is_active)
    IS NOT DISTINCT FROM ROW(OLD.title,OLD.category,OLD.original_price,OLD.rescue_price,OLD.offer_start_time,OLD.offer_end_time,OLD.is_active) THEN RETURN NEW; END IF;
  kind := CASE WHEN ROW(NEW.title,NEW.category,NEW.offer_start_time,NEW.offer_end_time,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.title,OLD.category,OLD.offer_start_time,OLD.offer_end_time,OLD.is_active)
    THEN 'item_changed' ELSE 'price_changed' END;
  FOR daily IN SELECT a.* FROM daily_availability a JOIN offer_snapshots s ON s.daily_availability_id=a.id
    WHERE a.listing_id=NEW.id AND
      a.offer_date+ s.offer_end_time + CASE WHEN s.offer_end_time<=s.offer_start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END
      > CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka'
    ORDER BY a.id FOR UPDATE OF a LOOP
    INSERT INTO offer_events(daily_availability_id,event_type,original_unit_price,rescue_unit_price,initial_quantity,remaining_quantity)
    VALUES(daily.id,kind,NEW.original_price,NEW.rescue_price,daily.initial_quantity,daily.remaining_quantity);
    IF kind='item_changed' AND ROW(NEW.original_price,NEW.rescue_price) IS DISTINCT FROM ROW(OLD.original_price,OLD.rescue_price) THEN
      INSERT INTO offer_events(daily_availability_id,event_type,original_unit_price,rescue_unit_price,initial_quantity,remaining_quantity)
      VALUES(daily.id,'price_changed',NEW.original_price,NEW.rescue_price,daily.initial_quantity,daily.remaining_quantity);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER plateup_item_observation AFTER UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION plateup_observe_item();

CREATE OR REPLACE FUNCTION plateup_observe_order() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.daily_availability_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
  INSERT INTO offer_events(daily_availability_id,order_id,event_type,original_unit_price,rescue_unit_price,
    initial_quantity,remaining_quantity,order_quantity,order_status,order_unit_price)
  SELECT a.id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'reservation_created' ELSE 'order_status_changed' END,
    l.original_price,l.rescue_price,a.initial_quantity,a.remaining_quantity,NEW.quantity,NEW.status,NEW.total_price/NEW.quantity
  FROM daily_availability a JOIN listings l ON l.id=a.listing_id WHERE a.id=NEW.daily_availability_id;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER plateup_order_observation AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION plateup_observe_order();

-- Imported and generated observations never create listings, reservations, or sales.
CREATE TABLE IF NOT EXISTS training_records (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(user_id) ON DELETE CASCADE,
  item_reference TEXT NOT NULL,
  offer_date DATE NOT NULL,
  data_source TEXT NOT NULL CHECK (data_source IN ('real','synthetic')),
  record JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,item_reference,offer_date,data_source)
);
