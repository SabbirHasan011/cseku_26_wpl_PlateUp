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
- Manage daily availability and remaining stock
- Track business orders from pending to completed
- View sales summaries and business analytics

### Customer features
- Search and browse active listings
- Filter by category
- View item details and pickup information
- Reserve food based on daily availability
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
