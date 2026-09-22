# PlateUp

PlateUp is a pickup-based surplus food marketplace for customers and food businesses. Businesses publish discounted food; customers reserve it and collect it at the business.

## Current stack

- Frontend: HTML, CSS, and vanilla JavaScript in `UI_PlateUp.html` and `assets/`. React and Tailwind are planned, but are not in this repository.
- Backend: Node.js and Express.
- Database: PostgreSQL.
- Authentication: bcrypt password hashes and JWTs.
- AI/ML: prediction storage exists; no model or generated predictions exist yet.

## Setup

Install dependencies with `npm install`. Provide `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT` (optional), `JWT_SECRET`, and `PORT` (optional) in a local `.env`. Do not commit the file.

Run `npm run db:migrate` before starting the app. This creates the initial schema on an empty database, or incrementally updates an existing PlateUp database without dropping its data. It can be rerun. Existing listing IDs stay intact for orders, reviews, and sales. Legacy listing stock is copied into dated availability once; older items without an offer window receive a full-day window and can be given a new daily quantity on later dates. Legacy listings/reviews with names that do not match a registered account are attached to inactive placeholder accounts; unmatched review item names remain available as legacy display text.

Run `npm start`, then visit `http://localhost:5000/`. Run `npm test` for the API integration test. There is no frontend build step because this frontend is plain HTML/JS.

## Implemented workflows

- Customer and business signup/login, account and role checks, profile editing.
- Businesses save reusable food items with a fixed daily offer window and optional food image, then set each day's total quantity from Manage Listings. Images are stored under `server/uploads/food/`, served through `/uploads/food/`, limited to 5 MB, and excluded from Git.
- Daily availability keeps separate initial and remaining quantities for each item and offer date. One record per item/date is enforced by the database. Offer windows and status use `Asia/Dhaka`; an end time earlier than or equal to the start time ends on the next date.
- Public listing search, category filtering, image display, and details. Only active, in-window items with remaining stock are returned by the API.
- Customer reservations stored as orders with an atomic daily-inventory update; customer cancellation restores stock to the same daily record. Quantity changes cannot go below units already reserved.
- Business order progression from pending to confirmed, ready, and completed.
- Sales history recorded when an order is completed.
- Customer reviews of completed orders, review editing/deletion, and business replies.
- Business sales summary and prediction empty state.

The existing [SRS](PlateUp_SRS.pdf) and [AGENTS.md](AGENTS.md) describe the broader target system. Administrator tools, a React frontend, real mapping, and ML prediction/recommendation models remain future work.

The fixed rescue price remains an item field for existing checkout and sales behavior. No ML prediction or dynamic pricing is implemented. Before testing image uploads, restart `npm start` after installing the updated dependencies and running the migration. The current frontend is plain HTML/JavaScript, so there is no frontend build or lint command.
