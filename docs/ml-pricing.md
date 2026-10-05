# Item sales models and dynamic rescue pricing

## Run

From the repository root, with PostgreSQL configured in `.env`:

```powershell
python -m pip install -r ml/requirements.txt
npm run db:migrate
npm start
```

Open http://localhost:5000/. Python is required for training, not for serving an
already trained model. If Python is not on PATH, set `ML_PYTHON` in `.env` to the
Python executable's absolute path (no extra command arguments), then restart.
No separate Python server or frontend build is needed.

## Restaurant workflow

1. Add a food item with **original price** and **minimum price**. Minimum must be
   no more than 80% of original, with at most two decimal places.
2. In **Manage Listings**, open **Pricing & item history** on that item.
3. Download the daily-offer CSV template. Upload history for **one item reference**
   per file. The chosen listing ID is checked against the signed-in business and
   stored as a foreign key. See [the CSV specification](training-data.md).
4. Select **Imported restaurant history** and **Train / retrain**. Alternatively,
   select eligible completed **PlateUp offers** for the item.
5. For a course demonstration, expand the demo section, use **synthetic demo
   history**, then train with **Synthetic demo history** selected. This explicitly
   saves 180 reproducible observations in the isolated dataset, not sales/orders.
6. Enter today's actual available portions as before. During the offer window,
   marketplace/API requests refresh prices at most once every three minutes.
   Visible pages still fetch updates every 30 seconds. Recalculation happens on
   the next relevant request after three minutes; it may return the same price.
   Quantity updates and retraining request a refresh but cannot bypass the daily
   three-minute reduction limit. Each new daily offer has its own pricing state.

New dates can be imported and the model retrained. Duplicates are rejected without
overwriting historical rows. Existing generic imports are not silently matched by
item name; imports for model training must be linked using the item dialog. If a
generic import already uses the same reference/date/source, use a new stable
reference for the item-specific dataset. Training never mixes synthetic and real
sources. Editing permanent item settings invalidates its model; its linked history
is preserved for review/retraining.

## Model and price policy

`ml/train.py` trains scikit-learn `StandardScaler` + `Ridge(alpha=10)` per food item.
Its target is the **fraction of offered portions collected**. Features available
before the outcome are price/original-price ratio, log offered quantity, offer
duration, and weekday sine/cosine (Monday zero). Original currency amounts cancel
through the ratio. No customer identity or personal data goes to Python.

At least 30 eligible distinct offer dates, positive quantity/original price, and
three distinct price ratios are required. The earliest 80% train an evaluation
model; the latest 20% test it. MAE is reported in portions, alongside a baseline
using the training period's mean collected fraction. If Ridge does not beat or
match that baseline, time-based pricing remains active. The final model is refitted on all
eligible rows. Coefficients and evaluation metadata are stored as JSON in
`pricing_models`, avoiding uploaded pickle/joblib executables. Node uses the same
feature transformation and exported coefficients for inexpensive inference.
See the official [Ridge documentation](https://scikit-learn.org/1.8/modules/generated/sklearn.linear_model.Ridge.html).

Policy version 3 uses **whole taka** and opens a new daily offer at
**floor(original × 0.80)**. Item creation/editing requires whole original and
minimum prices. Existing fractional effective prices round down on the next
relevant request, within the price boundaries; historical orders remain unchanged.
Legacy fractional minimums round up for pricing. If no whole price fits a legacy
item's boundaries, that item reports a settings error without blocking other items.
The time schedule interpolates from that opening price to the restaurant minimum
over the offer window. Relevant API requests review prices at most once every
three minutes. Missed reviews are not replayed as a burst of discounts. The first
active calculation establishes the opening price, even if stock was entered late.

After 10% of the window, net committed portions divided by initial quantity and
elapsed fraction measures reservation pace. Pace at least 1 holds the price.
Once reservations have occurred, stock at or below max(2 portions, ceil(15% of
initial stock)) also holds it. A small initial offer with no orders still declines.
Pace below 0.75 with substantial stock advances the discount by up to 10% of the
opening-to-minimum spread, scaled by elapsed time. During the final 15%, slow
offers move toward the minimum. These are prototype policy settings.

The existing Ridge still predicts full-offer collection fraction, not interval
demand. A usable model within its observed price range can adjust the schedule by
at most 10% of the opening-to-minimum difference, scaled by elapsed time.
For original ৳300/minimum ৳170 the maximum model adjustment is ৳7.
Unsupported or unsuitable models use the time schedule without ML assistance.

Each review may lower price by at most floor(5% of original price to whole taka),
with a one-taka minimum step for inexpensive items. Whole-taka rounding may keep
successive reviews at the same price. Prices never increase automatically and never fall
below the minimum. Strong sales can keep prices above the minimum at closing.
Explicit edits of original/minimum price can require clamping to new legal
bounds. Confirmed reservation prices remain unchanged.

Migration 007 adds last_price and last_priced_at to daily_availability. Quantity
edits, retraining, restarts and cancellations do not clear this daily state.
Every new offer date has its own opening price. Migration preserves prices
already advertised in existing offers, including offers already at their minimum;
these items get the opening rule with their next daily offer.

The active offer's last_priced_at controls its next review independently of the
listing's general refresh timestamp, so quantity edits and retraining cannot delay
a due review. Manage Listings shows each item's pricing reason. Items at their
minimum, scheduled/closed offers, missing stock and strong sales may legitimately
keep the same price; refreshing does not reset them to a higher price.

Time-only decisions use pricing_source=time_policy and create no fake
ml_predictions. Actual assistance uses model or synthetic_model; prediction
records include the policy version, baseline and model signal. Price changes
continue through the event journal. Synthetic assistance is labelled.
Model errors are not confidence scores.

## Integrity and compatibility

- Migration 006 is additive. It saves existing rescue prices as minimums, capped
  at 80% of original where needed, and caps current prices by the same limit.
  Existing order totals and original offer snapshots are unchanged.
- PostgreSQL checks minimum/effective price bounds; API validation rejects invalid
  limits and precision. The editor's one-unit spinner increments are preserved.
- `rescue_price` remains the effective price in existing APIs. Legacy API clients
  supplying `rescue_price` instead of `minimum_price` treat it as the floor.
- Pricing updates and checkout lock listing then daily inventory. Old quoted
  prices return 409; cart refresh shows the new total before another confirmation.
  Confirmed reservations and completed sales keep their historical totals.
- All dates/windows use Asia/Dhaka, including offers crossing midnight.
- Inference is request-driven; no background timer, Python web service or cron job
  is required. Existing frontend polling discovers price changes. The read-triggered
  refresher serializes pricing writers with a database advisory lock.
- Training is limited to two concurrent jobs in a Node process, 5,000 rows, and
  60 seconds. Missing Python/packages returns a useful error; time-based pricing
  or the previous trained model continues to work.

New business-only endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/business/listings/:id/pricing` | Current bounds/source, linked-history counts and model metrics |
| `POST /api/business/listings/:id/train` | Train on `{source: "restaurant"\|"platform"\|"synthetic"}` |
| `POST /api/business/listings/:id/sample` | Generate labelled single-item sample CSV |
| `POST /api/business/training-data/import?listing_id=:id` | Validate and link a single item's CSV history |

## Limitations and validation

This is an academic pricing prototype. Observed collections are censored by stock,
missed pickups and historic business decisions; they are not true uncensored
demand. Synthetic results establish pipeline behavior only. Real restaurant data
and controlled price experiments are required to evaluate usefulness. The model
does not predict surplus, personalize recommendations, or replace daily stock entry.

Daily rows with changing prices, quantities or item settings are excluded rather
than treated as a single-price experiment. Their event history is retained; future
interval-based modelling is needed to learn reliably from dynamic offers. The
current module therefore retrains from eligible constant-price offers/imports.
Training is explicit after imports, not an automatic online learning system.

Run `npm test` after migration and Python dependency installation. Tests launch
Python for genuine training, exercise APIs against disposable database records,
check price bounds/midnight windows/fallback, and exercise the UI with a DOM double.
There is no frontend compilation/build or lint script. DOM tests do not verify
visual layout in a browser.
