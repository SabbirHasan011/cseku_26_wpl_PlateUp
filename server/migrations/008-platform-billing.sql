-- New orders snapshot the agreed fee; old orders deliberately remain fee-free.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate_bps INTEGER
  CHECK (commission_rate_bps BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(user_id),
  period_start DATE NOT NULL CHECK (EXTRACT(DAY FROM period_start)=1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id,period_start)
);
CREATE TABLE IF NOT EXISTS platform_commissions (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES billing_invoices(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  item_title TEXT NOT NULL,
  gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount>=0),
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  fee_amount NUMERIC(12,2) NOT NULL CHECK (fee_amount>=0 AND fee_amount<=gross_amount),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (fee_amount=ROUND(gross_amount*rate_bps/10000,2))
);
CREATE INDEX IF NOT EXISTS platform_commissions_invoice_idx ON platform_commissions(invoice_id);
CREATE TABLE IF NOT EXISTS billing_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES billing_invoices(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount>0),
  kind TEXT NOT NULL CHECK (kind IN ('real','demo')),
  method TEXT NOT NULL CHECK (method IN ('bank_transfer','bkash','nagad','cash','other')),
  reference VARCHAR(120) NOT NULL CHECK (LENGTH(TRIM(reference))>0),
  note VARCHAR(500) NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id),
  void_reason VARCHAR(500),
  CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
    (voided_at IS NOT NULL AND voided_by IS NOT NULL AND LENGTH(TRIM(void_reason))>0))
);
-- A receipt cannot be counted twice, even against another restaurant's invoice.
CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_reference_unique
  ON billing_payments(kind,method,LOWER(reference));
CREATE INDEX IF NOT EXISTS billing_payments_invoice_idx ON billing_payments(invoice_id);
