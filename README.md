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
- Set original and rescue prices
- Define offer start and end times
- Upload food images
- Choose a saved food category from a dropdown, or use Add Category to save a new shared choice
- Price spinner arrows adjust by ৳1; the offer-time picker saves automatically after selecting hour, minute, and AM/PM
- Manage daily availability and remaining stock
- Track business orders from pending to completed
- View sales summaries and business analytics

### Customer features
- Search and browse active listings from restaurants matching your selected city; customer and business profiles use a shared city catalog
- Open View Restaurants beside the marketplace search to browse registered kitchens, search by name/city, and open a restaurant's profile and menu
- Search in restaurant by meal name, description, or category, then use View details to choose portions and add them to the cart
- Filter by category
- View meal photos, pickup information, and five-star item ratings based on actual reviews
- Choose portions with a live price total, then confirm the reservation in your cart
- Change cart quantities, remove meals, or clear the cart; current prices and stock are checked before confirmation
- Show the pickup code from your order to the restaurant at collection
- Cancel eligible orders
- Leave reviews for completed orders

### Inventory and order handling
- Daily inventory records per listing and date
- Atomic stock updates during reservation creation
- Quantity validation to prevent over-ordering
- Order status transitions such as pending, confirmed, ready, and completed
- Sales history recording when an order is completed

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
- Frontend: HTML, CSS, and vanilla JavaScript
- Backend: Node.js + Express
- Database: PostgreSQL
- Authentication: bcrypt + JWT
- File handling: multer
- CORS: enabled for API access

### Important note
This repository does not currently use React or Tailwind. The frontend is a plain static web UI, and there is no frontend build step in the current setup.

The AI/ML prediction features described in the broader project vision are not implemented yet in this codebase.

## Project structure

```text
.
├── assets/
│   ├── css/
│   └── js/
├── server/
│   ├── uploads/
│   ├── db.js
│   ├── index.js
│   ├── init-db.sql
│   ├── migrate.js
│   └── migrate.sql
├── test/
│   └── api.test.js
├── UI_PlateUp.html
├── AGENTS.md
├── README.md
├── package.json
└── PlateUp_SRS.pdf
```

## Prerequisites

Before running the app, make sure you have:

- Node.js installed
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

The latest additive migration (`server/migrations/002-city-pickup-notifications.sql`) adds `cities`, profile city foreign keys, pickup verification fields, and `notifications`. The runner backfills codes only for existing open orders that have none, preserving codes on reruns. Restart the backend after running the migration.

Additional APIs: `GET /api/cities`, `POST /api/cart/quote`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`, and `PATCH /api/notifications/read` (with `through_id`). Completing an order through `PATCH /api/orders/:id` requires `pickup_code`; checkout supplies `unit_price` for each item so a price change returns a conflict for customer review.

Restaurant APIs: `GET /api/restaurants` returns public business profiles; `GET /api/restaurants/:id` returns `{ restaurant, listings }`. The latter applies the existing city and availability rules to `listings`. Neither endpoint returns authentication or private account fields. No additional migration is needed for restaurant browsing.

Category APIs: `GET /api/categories` lists the saved category catalog; `POST /api/categories` (business accounts only) adds `{ name }`. Names are unique ignoring case, and listing create/edit rejects categories outside the catalog. Run `npm run db:migrate` to apply `003-food-categories.sql`, which preserves existing listing categories and seeds the standard choices without changing listing data. Existing prices with decimals remain supported; only the form's arrow increment changes to one taka.

## Running the app

Start the server:

```bash
npm start
```

Then open:

```text
http://localhost:5000/
```

## Testing

Run the API test suite with:

```bash
npm test
```

The test suite validates marketplace workflows such as registration, login, listing management, order creation, status updates, inventory logic, and review behavior.

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

- No React frontend yet
- No admin dashboard
- No full delivery logistics system
- No dynamic rescue pricing engine
- No ML model or recommendation engine
- Limited geographic mapping features

## Roadmap

Planned future work includes:
- React-based frontend migration
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
