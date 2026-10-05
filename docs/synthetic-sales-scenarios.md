# Synthetic sales scenarios

These are reproducible academic simulations. The demand rates, discount response,
weekend effects and pickup outcomes are assumptions, not real restaurant data.
They test pipeline behaviour and cannot establish production accuracy or causal
price sensitivity. The generator never writes to PostgreSQL or trains a live model.

Run from the repository root:

```powershell
npm run data:scenarios
# Choose a new folder when generating another set; existing output is preserved.
npm run data:scenarios -- --seed 20261005 --days 180 --start 2025-10-01 --output data/generated/gradual-pricing-demo
```

Defaults cover 180 days starting October 1, 2025, for Chicken Biryani, Beef Biryani,
Pastry Box, Mint Mojito, Mango Juice and Polao. Six daily CSVs contain 1,080 offers.
The experimental interval CSV contains 93,600 three-minute observations. Files
under data/generated are ignored by Git; the generator and assumptions are tracked.

## Daily files: supported by the existing importer

Each `*-daily.csv` uses the exact version 1 import format and contains one item.
In Manage Listings, open that item's Pricing & item history, select its matching
file and Import item history. Choose Synthetic demo history and Train / retrain.
Importing a CSV does not train automatically or change inventory/sales. Existing
item/date/source duplicates are rejected; never rename dates to hide duplicates.
Original prices and category must suit the chosen item. Prefer the in-app demo
button for an arbitrary existing item: it uses its own price, category and times.

Daily experiments hold price constant within an offer. Ratios range from 30% to
80% of original price, independently randomized across days. These represent
historical test prices, not today's restaurant minimum. Each item has a different
assumed demand level and price sensitivity. Offered quantities vary; Friday and
Saturday demand increases by 18%. Approximately 4% of days have a zero-demand
shock, 14% have a quiet shock and 12% a busy shock, plus day noise and Poisson
arrivals. Stock limits collections. Booking outcomes assume 4% cancellations,
3% missed pickups and 1% business rejections. These are illustrative settings.

The item-specific in-app generator also varies its random stream by item ID and
uses category-specific assumptions. Existing samples and trained models are not
replaced: import new dates explicitly and retrain when appropriate.

## Interval file: experimental, not accepted by the current importer/trainer

The simulation records 3-minute offers in Asia/Dhaka, including crossing midnight.
80% of dates use the implemented gradual policy without model assistance; 20%
use randomized fixed prices within the item's bounds to provide contrasting
price exposure. Inventory reconciles across intervals and revenue uses the price
in that interval. All reservations resolve within their interval in this simplified
simulation; real orders may remain pending for much longer.

`remaining_before`, `effective_unit_price`, `minutes_remaining` and
`collected_previous_15_minutes` are known at the observation time. Columns ending
in `next_3_minutes`, `remaining_after`, `interval_revenue` and
`collected_until_close` are future outcomes. Do not use them as input features for
the same observation. The last 20% of offer dates are labelled holdout; do not
randomly split intervals from the same offer across training and evaluation.
The current daily Ridge model still uses constant-price daily rows. Interval
training, reconstruction from real events and policy evaluation remain future work.

`summary.json` records the seed, dates, counts, per-item outcomes and simulation
assumptions. Synthetic scenarios should be replaced or supplemented with real
observations before assessing whether ML improves on time-based pricing.
