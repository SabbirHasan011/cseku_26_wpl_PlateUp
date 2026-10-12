-- Explicit policy change: apply 10% to previous and future orders. Preserve
-- customer totals, sales rows, inventory and payment/audit records.
-- The runner executes this inside its migration transaction.
SET LOCAL lock_timeout = '10s';
LOCK TABLE orders,billing_invoices,platform_commissions,billing_payments
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE orders ALTER COLUMN commission_rate_bps SET DEFAULT 1000;
UPDATE orders SET commission_rate_bps=1000
  WHERE commission_rate_bps IS DISTINCT FROM 1000;

-- Existing charges retain their invoice, completion date and sale/title
-- snapshots. Recalculate only the rate and fee; existing receipts stay intact.
UPDATE platform_commissions SET rate_bps=1000,
  fee_amount=ROUND(gross_amount*1000/10000,2)
  WHERE rate_bps<>1000 OR fee_amount<>ROUND(gross_amount*1000/10000,2);

-- Legacy TIMESTAMP columns represent Bangladesh wall-clock time. Prefer the
-- pickup timestamp, then the linked sale timestamp, then the order timestamps.
WITH completed AS (
  SELECT l.business_id,
    COALESCE(o.pickup_time,s.sale_time,o.updated_at,o.order_time,o.created_at) AS local_completed_at
  FROM orders o JOIN listings l ON l.id=o.listing_id
  LEFT JOIN sales_data s ON s.order_id=o.id
  LEFT JOIN platform_commissions c ON c.order_id=o.id
  WHERE o.status='completed' AND c.id IS NULL
)
INSERT INTO billing_invoices(business_id,period_start)
  SELECT business_id,DATE_TRUNC('month',local_completed_at)::date
  FROM completed GROUP BY business_id,DATE_TRUNC('month',local_completed_at)::date
  ON CONFLICT(business_id,period_start) DO NOTHING;

WITH completed AS (
  SELECT o.id,l.business_id,l.title,o.total_price,
    COALESCE(o.pickup_time,s.sale_time,o.updated_at,o.order_time,o.created_at) AS local_completed_at
  FROM orders o JOIN listings l ON l.id=o.listing_id
  LEFT JOIN sales_data s ON s.order_id=o.id
  WHERE o.status='completed'
)
INSERT INTO platform_commissions(invoice_id,order_id,item_title,gross_amount,rate_bps,fee_amount,completed_at)
  SELECT i.id,o.id,o.title,o.total_price,1000,ROUND(o.total_price*1000/10000,2),
    o.local_completed_at AT TIME ZONE 'Asia/Dhaka'
  FROM completed o JOIN billing_invoices i ON i.business_id=o.business_id
    AND i.period_start=DATE_TRUNC('month',o.local_completed_at)::date
  ON CONFLICT(order_id) DO NOTHING;
