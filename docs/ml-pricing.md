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
   marketplace/API requests refresh prices at most once per minute.

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
match that baseline, fallback remains active. The final model is refitted on all
eligible rows. Coefficients and evaluation metadata are stored as JSON in
`pricing_models`, avoiding uploaded pickle/joblib executables. Node uses the same
feature transformation and exported coefficients for inexpensive inference.
See the official [Ridge documentation](https://scikit-learn.org/1.8/modules/generated/sklearn.linear_model.Ridge.html).

For an active offer the pricing policy evaluates 21 candidate prices, rounded to
cents, **between minimum and floor(original × 0.80 to cents)**. It only evaluates
ratios within the trained range. Predicted collection fraction × initial quantity
estimates full-window sales. The policy blends that with observed committed-order
pace (75% model / 25% pace; pace used only after 10% of the window), then scales by
remaining window time and caps by stock. Candidates maximize expected revenue
plus an explicit waste-reduction value per rescued portion:
`expected portions × (candidate price + minimum price × (1 + 4 × elapsed fraction))`.
This remaining-time/pace adjustment and objective are **policy assumptions**, not
separately learned models. No claim of optimal or causal price elasticity is made.

The fallback is the restaurant's minimum. It applies without a usable model,
outside active hours, without stock, or outside the historical price range.
Fallbacks never create fake prediction records. Model price changes are saved in
`ml_predictions` with source/details and in the existing price event journal.
Synthetic model prices are visibly labelled in management, marketplace cards,
meal details and the price-history report. Model errors are not confidence scores.

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
  60 seconds. Missing Python/packages returns a useful error; marketplace fallback
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
