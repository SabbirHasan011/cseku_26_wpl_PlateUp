# PlateUp

PlateUp is a surplus-food marketplace built to reduce food waste by helping businesses list food near the end of its selling period at discounted rescue prices, while allowing customers to discover, reserve, and collect discounted meals.

This project is a full-stack web application with a PostgreSQL-backed backend and a lightweight HTML/CSS/JavaScript frontend. It focuses on the core marketplace flow: signup, listing creation, inventory tracking, reservations, order management, reviews, and sales reporting.

## Why this project exists

Food businesses often have usable food left near closing time. Instead of letting it go to waste, PlateUp lets them publish it as a discounted listing and gives customers the ability to reserve it before pickup.

The app is designed around a simple pickup-based marketplace model:

1. A business creates a listing.
2. A customer searches and reserves available food.
3. The business updates order status.
4. The customer picks up the order.
5. Sales and review data are recorded.

## Features

### User roles and authentication
- Customer and business signup/login
- JWT-based session handling
- Role-based access checks
- Secure password hashing with bcrypt
- Profile editing for both customers and businesses

### Business features
- Create and manage food listings
- Set original and minimum prices; trained item models update the effective rescue price within those bounds (at least 20% off)
- Define offer start and end times
- Upload food images
- Choose a saved food category from a dropdown, or use Add Category to save a new shared choice
- Price spinner arrows adjust by ৳1; the offer-time picker saves automatically after selecting hour, minute, and AM/PM
- Manage daily availability and remaining stock
- Track business orders from pending to completed
- View sales summaries and business analytics
- Overview shows current daily offer stock, pending orders, completed pickups and collected revenue, with shortcuts to daily quantities and orders. Lifetime totals remain separate.
- Manage Listings has a visible Upload Sales History action per item and server-derived History needed / Ready to train / Model active / Fallback active labels. Training readiness requires 30 eligible offer dates and at least three price ratios; synthetic models remain labelled demonstrations.

### Customer features
- Search and browse active listings from restaurants matching your selected city; customer and business profiles use a shared city catalog
- Open View Restaurants beside the marketplace search to browse registered kitchens, search by name/city, and open a restaurant's profile and menu
- Search in restaurant by meal name, description, or category, then use View details to choose portions and add them to the cart
- Filter by category
- View meal photos, pickup information, and five-star item ratings based on actual reviews
- Choose portions with a live price total, then confirm the reservation in your cart
- Change cart quantities, remove meals, or clear the cart; current prices and stock are checked before confirmation
- Keep a separate cart per customer on the same browser across refreshes and sign-ins; restoring it rechecks current availability and prices
- Use My Orders for active, completed, and cancelled/missed reservations, pickup deadlines, progress, and reviews
- Save favorite meals and restaurants; unavailable favorites remain removable but cannot be purchased
- Show the pickup code from your order to the restaurant at collection
- Cancel eligible orders
- Leave reviews for completed orders

Meal cards show the effective price, actual whole-percentage discount, remaining portions and the pickup deadline in Bangladesh time. Mobile navigation keeps Cart and Updates reachable beside a collapsible page menu; business pages use a compact selector. Loading cards, retry actions, actionable empty states and dismissible messages provide feedback without routine browser alerts. The homepage uses the supported “20% or more” discount claim, labels its feed “Available Meals Near You”, and opens business signup with the business role selected.

### Inventory and order handling
- Daily inventory records per listing and date
- Atomic stock updates during reservation creation
- Quantity validation to prevent over-ordering
- Order status transitions such as pending, confirmed, ready, and completed
- Sales history recording when an order is completed
- Businesses can reject an open reservation with a required reason; rejection returns portions to the original daily inventory
- Reservations have a fixed pickup deadline captured from the daily offer end, including midnight-crossing windows

Overdue pending/confirmed/ready reservations become `expired` when orders, order actions, notifications, or the business daily report are requested. No background job is required: while PlateUp is open, its existing polling triggers these checks. Both parties receive an in-app expiry notification. Stock is restored once to the original daily record; a closed offer remains unpurchasable. Historical orders without a linked daily record have no inferred deadline. Later edits to a food item's time window do not change an existing reservation's deadline.

The Sales & Predictions tab includes a daily report with date filters and CSV export. It counts offered portions, portions awaiting pickup, collected portions, remaining/unreserved portions, missed-pickup portions, and collected revenue, grouped by the daily offer date in Bangladesh time. The remaining figure becomes leftover stock once the offer closes. Missed portions are a subset of uncollected food, not an additional inventory quantity. Reports support up to 366 days per request.

### Reviews
- Customers can create, edit, and delete reviews for completed orders
- Business owners can reply to reviews
- Reviews are tied to real orders and listings
- Item cards and details show the average and review count; unreviewed items show five empty stars

Customers and restaurants select a city from the searchable profile suggestions. The shared catalog starts with 20 cities and preserves previously saved locations. Common aliases such as Chittagong/Chattogram resolve to the same city ID. Unrecognized new entries are rejected; expand the `cities` catalog to support additional locations. Guests and accounts without a saved city see a prompt instead of a food feed. City matching applies to the feed, item details, cart checks, and new reservations. Changing your customer city clears the cart but keeps existing orders.

The restaurant directory includes all active registered business accounts, including kitchens without available meals. Public restaurant profiles contain their name, description, pickup address/city, business hours, and review ratings. Restaurant menus show only currently active, in-stock meals matching the viewer's saved city. Guests can explore the directory and profiles, then sign in to browse local meals. The directory and menu refresh every 30 seconds while visible.

### Pickup verification and notifications
- Customer orders show a unique pickup code until completed or cancelled. Business APIs never return the code.
- Businesses move orders to confirmed and ready, then enter the customer's code to complete pickup. Five incorrect attempts pause verification for five minutes.
- In-app notifications alert businesses to new/cancelled reservations and customers to confirmed, ready, and completed orders. The Updates button shows unread counts and offers individual or bulk mark-as-read actions.
- Notifications and order status refresh every 15 seconds while the app is visible. They are stored in PostgreSQL; email, SMS, and background push notifications are not included.

## Tech stack

### Current stack in this repository
- Frontend: HTML5, CSS3, and vanilla JavaScript with native ES modules
- Backend: Node.js + Express
- Database: PostgreSQL
- Authentication: bcrypt + JWT
- File handling: multer
- CORS: enabled for API access

### Important note
PlateUp intentionally uses a modular vanilla frontend. It does not use React, Tailwind, TypeScript, or a frontend bundler. The browser loads native ES modules directly; there is no frontend build step.

Navigation updates the address bar using browser history. Examples: `/browse-food`,
`/restaurants`, `/restaurants/12`, `/orders`, `/profile`, `/business/listings`, and
`/business/profile`. Every business sidebar tab has its own URL. Express serves the
application shell at these allowlisted paths, so bookmarks, direct visits, refresh,
and Back/Forward work. The URL determines the initial page; the old saved-screen
preference no longer overrides it. Protected pages still require the appropriate
account, and a signed-out visitor is sent to login before returning to the requested
page. Restart `npm start` after updating the server routes. With VS Code Live Server
on port 5500, navigation uses `frontend/index.html#/...` because that static server
does not handle the Express page routes.

Item-specific sales regression and bounded dynamic pricing are implemented. Python/scikit-learn trains a model from an item's eligible history; Node applies its coefficients and the remaining-time pricing policy. Synthetic models are labelled demonstrations. Personalized recommendations and surplus prediction remain unimplemented. See [ML setup, workflow and limitations](docs/ml-pricing.md).

## Project structure

```text
.
├── frontend/
│   ├── index.html              # Application shell, served at /
│   ├── views/                  # Home, auth, marketplace, restaurants, orders,
│   │                           # favorites, recovery/reset, profile, business
│   ├── components/             # Navbar and shared dialogs
│   ├── css/styles.css          # Existing styling
│   └── js/                     # Native ES modules grouped by responsibility
├── assets/js/data.js           # Archived fixtures; not loaded by the app
├── server/                     # Express APIs, PostgreSQL, migrations, uploads
├── test/                       # API, frontend behavior, views and static-serving tests
│   └── helpers/                # Isolated ES-module loader and DOM test double
├── UI_PlateUp.html             # Compatibility launcher; no application screens
├── AGENTS.md
├── README.md
├── package.json
├── PlateUp_SRS.pdf
├── PlateUP_ER.png
└── PlateUp_Flowchart.png
```

### Frontend organization

`frontend/js/app.js` boots the application and installs polling once. `router.js`
controls known screens, role redirects, browser history and screen initialization.
`page-urls.js` maps screens and business tabs to allowlisted URLs.
`views.js` fetches only allowlisted HTML partials. A screen loads on first use and stays
mounted while hidden, preserving search fields and unfinished forms without full-page
navigation. Concurrent loads are deduplicated; a slow earlier navigation cannot replace
a newer selection. Failed view loads leave the current screen visible and show a retry.

`state.js` holds shared session/feature state, `api.js` preserves the JSON API client,
and `ui.js` holds formatting/dialog helpers. The feature modules are `auth`, `profile`,
`marketplace`, `restaurants`, `listings`, `business`, `cart`, `orders`, `reviews`,
`favorites`, `notifications`, and `home`. There are no global application handlers.

The navbar and shared dialogs mount once. `events.js` delegates clicks, submissions,
input and change events to an explicit action map, so generated cards and newly mounted
views work without repeated listener registration. Do not put inline event code or
scripts in partials. Background renderers check whether their view exists.

To add a screen, create its markup in `frontend/views/`, add its controlled path to
`views.js`, and register its initializer/role in `router.js`. Add its URL to
`page-urls.js` and the Express shell-route allowlist in `server/index.js` so direct
visits work. Keep feature logic in its
own module, reusing the API client and shared state. Login/signup remain one tabbed
view; the existing business dashboard retains its tabs. No admin view is invented.


## Prerequisites

Before running the app, make sure you have:

- Node.js 20 or newer (the email library requires it; use a current LTS release)
- PostgreSQL running locally or on a server
- A database created for PlateUp
- A `.env` file with required environment variables

## Environment variables

Create a `.env` file in the project root with values similar to the following:

```env
DB_USER=your_db_user
DB_HOST=localhost
DB_NAME=plateup
DB_PASSWORD=your_db_password
DB_PORT=5432
JWT_SECRET=your_secure_jwt_secret
PORT=5000
```

See `.env.example` for all configuration keys. To enable real password-reset email, set `APP_ORIGIN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. Port 587 uses STARTTLS (`SMTP_SECURE=false`); port 465 uses TLS (`SMTP_SECURE=true`). TLS certificate verification stays enabled. Set `APP_ORIGIN` to the public HTTPS address when deployed. Restart the server after changing environment variables.

Customers and businesses can change their password from their profile by entering the current password. The sign-in page also has Forgot password. Recovery emails contain a single-use link that expires after 30 minutes; only a hash of its token is stored in PostgreSQL. Reset tokens are kept in the URL fragment, removed from the address after reading, and never returned by the API or logged. Changing/resetting a password invalidates existing login sessions and reset links. Recovery requests return the same response for known and unknown emails, have a one-minute per-account cooldown, and security endpoints have a per-process IP rate limit (10 attempts per route per 15 minutes). A shared rate-limit store would be needed for multiple server instances.

Without SMTP settings, password changes work but Forgot password reports that email recovery is not configured. Tests use a captured email sender and do not send real email. Email delivery through your provider must be checked after configuration.

Important:
- Do not commit the `.env` file.
- Keep secrets out of source control.

## Installation

```bash
npm install
```

## Database setup

Run the migration script before starting the app:

```bash
npm run db:migrate
```

This script initializes the required schema and can be rerun safely to update the database without dropping existing data when applicable.

Migration `002-city-pickup-notifications.sql` adds `cities`, profile city foreign keys, pickup verification fields, and `notifications`. The runner backfills codes only for existing open orders that have none, preserving codes on reruns. Migration `004-customer-experience.sql` adds favorites, password-reset records, account session versions, pickup deadlines/reasons, and the `rejected`/`expired` order statuses. It backfills deadlines for reservations with daily inventory records and preserves already saved deadlines on reruns. Restart the backend after running the migration.

Additional APIs: `GET /api/cities`, `POST /api/cart/quote`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`, and `PATCH /api/notifications/read` (with `through_id`). Completing an order through `PATCH /api/orders/:id` requires `pickup_code`; checkout supplies `unit_price` for each item so a price change returns a conflict for customer review.

Restaurant APIs: `GET /api/restaurants` returns public business profiles; `GET /api/restaurants/:id` returns `{ restaurant, listings }`. The latter applies the existing city and availability rules to `listings`. Neither endpoint returns authentication or private account fields. No additional migration is needed for restaurant browsing.

Category APIs: `GET /api/categories` lists the saved category catalog; `POST /api/categories` (business accounts only) adds `{ name }`. Names are unique ignoring case, and listing create/edit rejects categories outside the catalog. Run `npm run db:migrate` to apply `003-food-categories.sql`, which preserves existing listing categories and seeds the standard choices without changing listing data. Existing prices with decimals remain supported; only the form's arrow increment changes to one taka.

Customer experience APIs:

- `GET /api/favorites`, `PUT /api/favorites/:kind/:id`, `DELETE /api/favorites/:kind/:id` (`kind` is `listing` or `business`; customer authentication required).
- `GET /api/business/analytics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`, optionally `&format=csv`; business authentication required.
- `PATCH /api/orders/:id` accepts `{ status: "rejected", reason: "..." }` from the owning business.
- `POST /api/auth/change-password` with `{ current_password, new_password }` and authentication.
- `POST /api/auth/forgot-password` with `{ email }`; `POST /api/auth/reset-password` with `{ token, new_password }`.

## Running the app

Start the server:

```bash
npm start
```

Then open:

```text
http://localhost:5000/
```

The old `/UI_PlateUp.html` URL redirects to `/`. The root HTML file is only a
compatibility launcher for older bookmarks/IDE usage. Use the Express URL rather than
opening `frontend/index.html` as a file: HTML partial fetching and ES modules require
HTTP. Existing installations need only a server restart for this refactor; it adds no
dependencies and requires no database migration. Setup for a new database is unchanged.

## Offer data preparation

Business Portal → **Data preparation** provides historical offer snapshots, price/stock/order event CSVs, validated restaurant CSV imports, isolated synthetic datasets, and data-quality checks. **Manage Listings → Pricing & item history** links history to a specific item and trains its pricing model. Install Python dependencies with `python -m pip install -r ml/requirements.txt`, run `npm run db:migrate` (including migration 006), then restart the server. Older estimated offer details remain excluded from training.

Generate a reproducible 900-row sample CSV with `npm run data:generate`, or choose parameters in the Business Portal. Samples never create live orders or inflate sales reports. See [the data format and workflow](docs/training-data.md) for import fields, provenance, eligibility and limitations.

## Testing

Run the API and frontend test suites with:

```bash
npm test
```

The test suite validates marketplace workflows such as registration, login, listing management, order creation, status updates, inventory logic, and review behavior.

It also tests cart restoration and account/city isolation, catalog-driven filters, order timelines, favorites ownership/availability, concurrent expiry, rejection inventory, daily totals/CSV, and password reset expiry/reuse/session invalidation. Database integration tests create disposable accounts and clean their data afterward. No frontend build or lint command is configured; the frontend runs directly as HTML/CSS/JavaScript.

Frontend tests import the actual ES-module graph using Node's `--experimental-vm-modules`
flag (tests only). Existing behavior tests cover cart, portions, categories/time pickers,
reviews, favorites, notifications and recovery. View tests use a strict DOM double
populated from the actual partial markup to check missing-view safety, cached forms,
role checks, loading failures/retries, navigation races, authentication, bootstrap and
single listener/timer installation. Static-serving tests request every frontend file
through Express, check imports/content types and verify private files remain inaccessible.
These tests do not render CSS or replace a visual browser smoke test.

## Main workflows implemented

- Customer signup and login
- Business signup and login
- User profile management
- Food listing creation and editing
- Daily inventory tracking for listings
- Reservation and order processing
- Customer cancellation flow
- Business order progression
- Sales recording after order completion
- Customer review creation and management
- Business review replies
- Image upload support for food listings

## Current limitations

This project is a functional MVP and still has several planned future improvements:

- No admin dashboard
- No full delivery logistics system
- No dynamic rescue pricing engine
- Pricing model is an academic prototype; no personalized recommendation engine or real-world performance validation yet
- Limited geographic mapping features

## Roadmap

Planned future work includes:
- More complete customer and business dashboards
- Improved admin tools
- Data analytics and sales insights
- AI-powered demand prediction and surplus estimation
- Smarter pricing recommendations

## Contributing

Contributions are welcome for improvements to the marketplace workflow, backend logic, data integrity, and documentation.

Before making changes:
- Read the project guidelines in [AGENTS.md](AGENTS.md)
- Understand the current database schema and API behavior
- Preserve compatibility with working flows
- Keep changes minimal and focused

## License

This project is currently unlicensed unless explicitly stated otherwise.

## Additional project context

Broader project documentation and planning materials may also exist in the repository, such as the SRS. Those documents describe the intended long-term system, but the repository itself remains the source of truth for what is currently implemented.
