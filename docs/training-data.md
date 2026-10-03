# Offer history and dataset preparation

This feature prepares data for dynamic rescue pricing. The separate [item pricing module](ml-pricing.md) now trains models and applies bounded prices. This page documents the CSV and observation layer.

Run `npm run db:migrate`, restart the backend, and open **Business Portal → Data preparation**.

## What is captured

`offer_snapshots` stores title, category, original and rescue **unit** prices, offer times, and first entered quantity when a daily availability record is created. A snapshot is retained when the item is edited or deactivated. Historical records present before migration 005 are labelled `legacy_estimated`: current item values cannot prove their historical prices or times. Migration reruns do not replace captured snapshots.

`offer_events` records timestamped offer creation, inventory changes, total-quantity changes, item edits, price changes, reservation creation and order-status changes. Each event includes the observed prices and inventory; reservation events additionally record the committed unit price. Events are written by PostgreSQL triggers in the same transaction as the change, including changes made through existing APIs. A transaction rollback also rolls back its observations. Snapshot/event rows are tied to their daily record through foreign keys. Standard application deactivation preserves them.

Offer dates and windows use `Asia/Dhaka`. Events export UTC ISO timestamps. End time at or before start means the offer ends on the following date. Order-status events describe stock at that instant; cancellation/expiry stock restoration is recorded in the subsequent inventory event. Event order and the explicit committed order price matter when reconstructing pricing intervals.

## Data checks and exports

**PlateUp history** contains one row per item and offer date, including zero-sale offers. An absent daily availability record is not manufactured as zero demand. Before extraction the existing order-expiry service finalizes overdue reservations for the business, restoring stock once and sending notifications. Unexpired open orders keep an offer unfinished.

The table previews up to 100 rows, including flagged records. The offer CSV exports only eligible, ended, resolved records. Eligibility requires captured history, reconciled collected/remaining quantities, and matching completed-order/sales records. Imported self-reported records are checked against the supplied values but cannot be verified against platform transactions. Full-price restaurant sales are outside this dataset; supply rescue-offer outcomes only.

Offers with changed prices, quantities, or item details are conservatively excluded from the daily training CSV. A single daily price cannot describe multiple prices. Their **price & stock event CSV** is available separately for future interval-based pricing analysis. Inventory exposure and sell-outs require care: observed collections are limited by stock and do not measure uncapped demand. Remaining stock is not proof that food was physically discarded.

Cancelled, rejected and expired quantities count reservation outcomes; a returned portion may be reserved again, so these figures are not mutually exclusive inventory buckets. Collected plus remaining must equal final offered quantity for a resolved offer. `sales_data.price` is a transaction total; the CSV prices are per portion and revenue is completed-order revenue.

The diagnostics also report platform orders without daily inventory references and missing snapshots. These are excluded rather than assigned invented outcomes.

## Shared CSV version 1

Download the template in the Business Portal. Headers must appear in this order:

```csv
schema_version,item_reference,offer_date,title,category,original_unit_price,rescue_unit_price,offer_start_time,offer_end_time,initial_quantity,collected_quantity,cancelled_quantity,rejected_quantity,expired_quantity,remaining_quantity,revenue,data_source,snapshot_quality,price_changed,quantity_changed,item_changed
1,biryani-01,2025-09-21,Chicken Biryani,Main Meal,300,150,20:00,00:00,15,10,2,0,1,5,1500,real,self_reported,false,false,false
```

- `schema_version`: `1`.
- `item_reference`: stable external food-item identifier within the signed-in business. `plateup:<id>` is reserved for native exports and cannot be imported. No customer identifiers are included.
- `offer_date`: `YYYY-MM-DD`, the starting date of the offer.
- `original_unit_price`, `rescue_unit_price`, `revenue`: non-negative BDT values with at most two decimal places. Rescue price cannot exceed original price.
- `offer_start_time`, `offer_end_time`: `HH:MM` in Bangladesh time.
- `initial_quantity`: final total made available for that offer; `first_quantity` is additionally retained in the native JSON preview. If totals changed, set `quantity_changed=true` and use event analysis.
- Quantity fields: non-negative integers up to 1,000,000.
- `data_source`: `real` for restaurant observations or `synthetic` for generated examples.
- `snapshot_quality`: imported real data uses `self_reported`; samples use `synthetic`. Native data uses `captured` or `legacy_estimated`.
- Change flags: literal `true` or `false`. Accurate flags matter: importing a row does not reconstruct its price or inventory history.

When prices did not change, revenue must equal collected quantity times rescue unit price. Variable-price rows can be stored and inspected but are excluded from the daily export. Original prices/categories/time windows also need truthful historical values.

Files must be UTF-8, at most 1 MB and 5,000 rows. Quoted commas, quotes and newlines are supported. Spreadsheet formula-like text is escaped on export and reversed safely for text columns on import.

**Validate file** checks format, quantities, prices, ended windows and duplicates, without saving. **Import validated file** revalidates and atomically saves the whole file. Duplicates within a file or against stored item/date/source records reject the whole import. Existing records are not overwritten. Use corrected files before the first import; correction/deletion of previously imported records is not exposed yet.

Imports are stored in `training_records`, scoped to the authenticated business. They never create food items, inventory, customer accounts, orders, reviews or sales. The restaurant and synthetic sources are separate from native PlateUp history and from sales analytics. Each export selects one source; synthetic and real observations are not silently mixed.

## Reproducible samples

In the Business Portal choose a seed, historical starting date, day count and number of items. **Generate & download CSV** creates a labelled CSV without storing it. **Save sample dataset** explicitly imports it into isolated synthetic storage.

The command-line generator uses the same format and algorithm:

```powershell
npm run data:generate
npm run data:generate -- --seed 43 --days 180 --items 5 --start 2025-01-01 --output data/generated/sample-43.csv
```

Defaults: seed 42, 180 days, 5 items, January 1, 2025; 900 rows. The command refuses to overwrite an existing file. Generated files are ignored by Git. The generator performs no database writes.

The deterministic generator assumes item/weekday effects, stronger collection likelihood at larger discounts, random noise, approximately 6% zero-demand offer days, and some missed pickups. It includes overnight windows and stock-limited outcomes. These are experimental assumptions, not measured restaurant behavior. Identical parameters produce identical CSV bytes. Synthetic model performance cannot establish real-world accuracy or prove a causal price effect.

## APIs

All require business authentication and enforce business ownership:

- `GET /api/business/training-data?source=platform|restaurant|synthetic&from=YYYY-MM-DD&to=YYYY-MM-DD`: data checks and JSON preview.
- The same route with `&format=csv`: eligible daily observations.
- `GET /api/business/training-data/template`: header-only CSV template.
- `POST /api/business/training-data/import?dry_run=true`: validate CSV without saving; content type `text/csv`.
- The same POST without `dry_run`: atomic isolated import.
- `POST /api/business/training-data/synthetic`: `{seed,days,items,start}`; returns CSV and metadata without persisting.
- `GET /api/business/training-data/events?from=...&to=...`: native price/inventory/order event CSV.

## Remaining work

The item pricing module now implements daily sales regression, chronological evaluation, a price policy, minimum-price controls and marketplace integration. Interval dataset construction remains future work: the daily model uses eligible stable-price offers, while dynamic-offer evaluation will need event history and real observations. Do not use same-offer collected/remaining quantities as inputs to a prediction made before the offer. Old price history cannot be reconstructed by adding more synthetic records.
