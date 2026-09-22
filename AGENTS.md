# PlateUp — Codex Project Context & Development Guidelines

## 1. Purpose of This File

This file provides persistent project context and development instructions for AI coding agents such as Codex working on the PlateUp repository.

Before making changes to the project:

1. Read this file.
2. Inspect the relevant existing source code.
3. Inspect the current database/schema when the task involves data.
4. Understand existing frontend/backend dependencies.
5. Preserve working functionality unless a change is explicitly required.

This document describes the **intended PlateUp system and development conventions**.

It does NOT prove that a feature has already been implemented.

### Source-of-truth rule

For implementation status:

**The actual repository is the source of truth.**

Always distinguish between:

* IMPLEMENTED
* PARTIALLY IMPLEMENTED
* NOT IMPLEMENTED
* PLANNED

Never report a feature as implemented merely because it appears in this document, README, SRS, ER diagram, roadmap, or other planning material.

---

# 2. Project Overview

## Project Name

PlateUp

## Project Type

University Web Programming Language course project.

## Product Concept

PlateUp is a web-based surplus-food marketplace designed to reduce food waste.

Restaurants, cafés, bakeries, grocery stores, and other food businesses may have usable food remaining near the end of a selling period.

Instead of allowing this food to become waste, businesses can publish surplus-food listings on PlateUp at discounted **rescue prices**.

Customers can discover available surplus food, reserve/order it, and collect it from the business.

The core marketplace concept is:

Business has surplus food
→ Business creates PlateUp listing
→ Customer discovers discounted food
→ Customer reserves/orders food
→ Customer picks up food
→ Business reduces food waste

PlateUp is initially designed around **pickup-based transactions**.

---

# 3. Primary Project Goals

PlateUp aims to:

1. Reduce avoidable food waste.
2. Help food businesses recover some value from surplus inventory.
3. Allow customers to purchase food at discounted prices.
4. Provide a convenient marketplace for discovering available surplus food.
5. Use historical platform data to provide future AI-assisted business insights.
6. Eventually improve surplus management through demand prediction and pricing recommendations.

---

# 4. Technology Stack

The intended primary stack is:

## Frontend

* React.js
* Tailwind CSS
* JavaScript/JSX unless the existing repository uses another established configuration

## Backend

* Node.js
* Express.js
* REST-style HTTP APIs

## Database

* PostgreSQL

## Authentication

Expected technologies may include:

* bcrypt for password hashing
* JWT/token-based authentication

However, inspect the actual implementation before assuming a specific authentication mechanism is complete.

## AI / Machine Learning

Planned stack:

* Python
* Scikit-learn

ML is a later-stage component and should remain separated from the core Node.js application where practical.

## Development and Collaboration

* Git
* GitHub
* GitHub Projects
* Feature branches
* Pull Requests
* GitHub Copilot / Codex assistance
* Automated/unit testing

---

# 5. High-Level System Architecture

The main web application should conceptually follow:

Customer / Business / Admin
|
v
React Frontend
|
| HTTP / REST API
v
Node.js + Express
|
v
PostgreSQL

The frontend must not connect directly to PostgreSQL.

Database operations should go through the backend.

Future ML integration may conceptually follow:

React Frontend
|
v
Node.js / Express
|
+------------------+
|                  |
v                  v
PostgreSQL         Python ML Service
|
v
Scikit-learn

The exact implementation may differ if the repository already contains a reasonable architecture.

Do not introduce unnecessary architectural complexity solely to match this diagram.

---

# 6. User Roles

PlateUp is designed around three primary roles.

## 6.1 Customer

Customers should eventually be able to:

* Register
* Log in
* Log out
* Manage their profile
* Browse available surplus-food listings
* Search listings
* Filter listings
* View listing details
* Discover relevant/nearby listings
* Reserve/order surplus food
* View current orders
* View order history
* Cancel orders when allowed
* Rate/review businesses or purchases
* Receive personalized food recommendations

---

## 6.2 Food Business

Food businesses should eventually be able to:

* Register
* Log in
* Log out
* Maintain a business profile
* Create surplus-food listings
* View their listings
* Edit listings
* Delete/deactivate listings
* Set available quantity
* Set original price
* Set rescue price
* Set availability periods
* Manage incoming orders/reservations
* Update order status
* View basic business analytics
* View historical sales information
* Receive demand predictions
* Receive surplus estimates
* Receive rescue-price recommendations

---

## 6.3 Administrator

Administrators should eventually be able to:

* Authenticate securely
* View/manage users
* View/manage businesses
* Monitor listings
* Monitor orders
* Moderate inappropriate content where applicable
* View basic platform statistics

Admin functionality is part of the intended system but does not necessarily have the same development priority as the core customer/business marketplace.

---

# 7. Major Functional Modules

The intended PlateUp application can be divided into the following modules.

## Module 1 — Authentication & Authorization

Includes:

* Registration
* Login
* Logout
* Password hashing
* Authentication token/session handling
* Protected routes
* Role-based authorization
* Customer/business/admin access separation

---

## Module 2 — Profiles

Includes:

### Customer profile

* Name
* Contact information
* Address/location information
* Preferences where applicable

### Business profile

* Business name
* Description
* Contact information
* Address
* City
* Geographic information where applicable
* Opening/closing times

---

## Module 3 — Surplus Food Listings

Businesses should be able to perform CRUD operations:

### Create

Create a new surplus-food listing.

### Read

View existing listings.

### Update

Modify listing information.

### Delete / Deactivate

Remove or deactivate listings.

A listing may contain:

* Food title
* Description
* Category
* Quantity
* Original price
* Rescue price
* Business
* Availability start
* Availability end
* Status
* Creation/update timestamps

---

# 8. Food Discovery

Customers should eventually be able to:

* Browse available listings
* Search listings
* Filter listings
* View listing details
* Discover listings based on location where supported
* Sort/filter based on useful attributes such as price/category

Only active and valid listings should normally be presented as purchasable.

---

# 9. Orders / Reservations

The intended customer transaction flow is:

Customer selects listing
→ Customer selects quantity
→ Backend validates availability
→ Order/reservation created
→ Listing quantity updated appropriately
→ Business receives order
→ Business processes order
→ Customer picks up food
→ Order completed

Potential order statuses include:

* pending
* confirmed
* ready
* completed
* cancelled

The exact status model should be kept simple unless additional complexity is required.

## Inventory integrity

A customer must not be able to successfully order more units than are available.

When multiple users order concurrently, backend/database logic should protect inventory consistency where practical.

Never rely only on frontend validation for quantity availability.

---

# 10. Reviews & Ratings

Customers should eventually be able to review eligible businesses/orders.

A review may contain:

* Customer reference
* Business reference
* Listing/order reference where appropriate
* Rating
* Comment
* Business reply
* Creation timestamp

Recommended rating range:

1–5

Where practical, reviews should be tied to real entities through foreign keys rather than storing names as relationship identifiers.

---

# 11. Target Database Model

The database is expected to evolve toward a relational model similar to the following.

IMPORTANT:

The current repository may contain a simpler schema.

Do NOT drop or replace existing tables simply because they differ from this target.

Inspect existing queries, APIs, frontend dependencies, and existing data before modifying schema.

---

## 11.1 USERS

Purpose:

Authentication and common user information.

Target fields:

* id — primary key
* name
* email — unique
* password_hash
* role
* phone
* profile_image
* status
* created_at
* updated_at

Possible roles:

* customer
* business
* admin

Possible statuses:

* active
* inactive
* suspended

Passwords must only be stored as secure hashes.

---

## 11.2 CUSTOMERS

Purpose:

Customer-specific information.

Target fields:

* user_id — PK/FK → users.id
* address
* city
* preferred_location
* created_at

Relationship:

users 1 → 0..1 customers

---

## 11.3 BUSINESSES

Purpose:

Business-specific information.

Target fields:

* user_id — PK/FK → users.id
* business_name
* description
* address
* city
* phone
* latitude
* longitude
* opening_time
* closing_time
* created_at

Relationship:

users 1 → 0..1 businesses

businesses 1 → N listings

---

## 11.4 LISTINGS

Purpose:

Surplus-food marketplace listings.

Target fields:

* id — primary key
* business_id — FK → businesses.user_id
* title
* description
* category
* quantity
* original_price
* rescue_price
* available_from
* available_until
* status
* created_at
* updated_at

Possible statuses:

* available
* sold_out
* expired
* inactive

---

## 11.5 ORDERS

Purpose:

Customer reservations/orders.

Target fields:

* id — primary key
* customer_id — FK → customers.user_id
* listing_id — FK → listings.id
* quantity
* total_price
* status
* order_time
* pickup_time
* payment_method
* payment_status
* created_at
* updated_at

Possible order statuses:

* pending
* confirmed
* ready
* completed
* cancelled

Possible payment statuses:

* pending
* paid
* failed
* refunded

Payment functionality may remain simplified in the MVP.

---

## 11.6 REVIEWS

Purpose:

Customer feedback.

Target fields:

* id — primary key
* customer_id — FK → customers.user_id
* business_id — FK → businesses.user_id
* listing_id — FK → listings.id where appropriate
* rating
* comment
* reply
* created_at

Relationships:

customers 1 → N reviews

businesses 1 → N reviews

---

## 11.7 SALES_DATA

Purpose:

Historical sales information for analytics and future ML.

Target fields:

* id — primary key
* business_id — FK → businesses.user_id
* listing_id — FK → listings.id
* quantity_sold
* price
* sale_time
* created_at

This data may later become part of the training/input data for demand prediction.

---

## 11.8 ML_PREDICTIONS

Purpose:

Store generated ML predictions/recommendations when needed.

Target fields:

* id — primary key
* business_id — FK → businesses.user_id
* listing_id — FK → listings.id, nullable where appropriate
* prediction_type
* predicted_value
* confidence
* prediction_date
* created_at

Potential prediction types:

* demand
* surplus
* price

---

# 12. Target Database Relationships

Conceptually:

users
|
+---- 0..1 customers
|
+---- 0..1 businesses

customers
|
+---- N orders
|
+---- N reviews

businesses
|
+---- N listings
|
+---- N reviews
|
+---- N sales_data
|
+---- N ml_predictions

listings
|
+---- N orders
|
+---- N sales_data
|
+---- N ml_predictions

More explicitly:

users.id
|
+---- customers.user_id
|
+---- businesses.user_id

businesses.user_id
|
+---- listings.business_id

customers.user_id
|
+---- orders.customer_id
|
+---- reviews.customer_id

listings.id
|
+---- orders.listing_id
|
+---- sales_data.listing_id
|
+---- ml_predictions.listing_id

businesses.user_id
|
+---- reviews.business_id
|
+---- sales_data.business_id
|
+---- ml_predictions.business_id

---

# 13. Current / Legacy Database Context

During early development, PlateUp used a simplified PostgreSQL schema.

At one point, the known schema contained:

* users
* listings
* reviews

The simplified `users` table contained approximately:

* id
* name
* email
* password_hash
* role
* created_at

The simplified `listings` table contained approximately:

* id
* title
* category
* business_name
* original_price
* rescue_price
* quantity
* created_at

The simplified `reviews` table contained approximately:

* id
* business_name
* item_name
* author_name
* rating
* comment
* reply
* created_at

This early schema used display strings such as:

* business_name
* item_name
* author_name

instead of proper relational foreign keys in several places.

This should eventually be normalized where appropriate.

However:

**DO NOT blindly replace these fields or tables.**

Existing frontend components and APIs may depend on them.

Before changing the database:

1. Inspect every relevant SQL query.
2. Inspect backend routes/controllers.
3. Inspect frontend API consumers.
4. Identify existing data dependencies.
5. Plan an incremental migration.
6. Preserve working authentication and CRUD behavior.

---

# 14. AI / Machine Learning Vision

AI functionality is intended to differentiate PlateUp from a basic CRUD marketplace.

However, AI is a later-stage component.

Do not allow ML implementation to destabilize incomplete core marketplace functionality.

The planned intelligent components are:

1. Demand prediction
2. Surplus estimation
3. Dynamic rescue-price recommendation
4. Personalized customer recommendations

---

# 15. Demand Prediction

The primary ML task is expected to be regression.

Goal:

Predict approximately how much of a food item is likely to sell.

Conceptually:

Historical Sales Data
|
v
Feature Preparation
|
v
Regression Model
|
v
Predicted Demand

Potential features include:

* business
* food/category
* day of week
* time
* price
* discount
* historical sales
* prepared/available quantity
* availability period

Potential target:

quantity_sold

Initial candidate models may include:

* Linear Regression as a baseline
* Random Forest Regressor
* Gradient Boosting Regressor

Model choice should be based on evaluation rather than assumption.

Potential evaluation metrics include:

* MAE
* RMSE where useful

---

# 16. Surplus Estimation

Surplus estimation does not necessarily require a separate ML model.

A simple approach is:

estimated_surplus =
max(0, prepared_quantity - predicted_demand)

Example:

Prepared quantity = 100

Predicted demand = 72

Estimated surplus = 28

This result can help a business decide how much food to list on PlateUp.

---

# 17. Dynamic Rescue Pricing

The system may recommend an appropriate rescue price.

Potential inputs:

* Original price
* Predicted demand
* Estimated surplus
* Remaining quantity
* Remaining availability time
* Historical sales behavior

For the initial implementation, pricing may be rule-based rather than ML-based.

Example principle:

Higher surplus + less remaining time
→ potentially larger discount

The business should generally retain control over the final price.

---

# 18. Personalized Recommendations

PlateUp may eventually rank available listings for individual customers.

Potential signals:

* Previous orders
* Preferred food categories
* Price preferences
* Location
* Listing availability
* Previous interactions

A simple content-based approach is sufficient for an initial university-project implementation.

Do not introduce complex recommendation infrastructure unless justified.

---

# 19. ML Data Limitation

PlateUp may initially lack sufficient real-world historical sales data.

This creates a cold-start problem.

For academic/prototype purposes, synthetic or controlled experimental data may be used.

If synthetic data is used:

* Clearly identify it as synthetic.
* Do not present experimental results as real-world production performance.
* Keep generation assumptions documented.
* Preserve reproducibility where practical.

As real PlateUp transaction data becomes available, it could later replace or supplement synthetic training data.

---

# 20. Marketplace Business Rules

The following rules should generally hold.

## Listings

* Quantity should not be negative.
* Prices should not be negative.
* Rescue price should normally not exceed original price.
* Expired/inactive listings should not be purchasable.
* Businesses should only modify listings they own.

## Orders

* Requested quantity must be positive.
* Requested quantity must not exceed available quantity.
* Customers should only manage their own orders.
* Businesses should only manage orders involving their listings.
* Order status transitions should be validated where appropriate.

## Reviews

* Rating should be within the accepted range.
* Customers should not arbitrarily modify another customer's review.
* Businesses should not arbitrarily modify customer review content.
* Business replies should remain distinguishable from customer comments.

## Authorization

Never rely only on the frontend to enforce ownership or permissions.

Authorization must be enforced by the backend.

---

# 21. Security Requirements

Security is required even though PlateUp is a university project.

## Passwords

Never:

* Store plaintext passwords
* Return password hashes through APIs
* Log passwords

Use an established password-hashing library such as bcrypt if consistent with the current implementation.

## Secrets

Never hardcode:

* Database passwords
* JWT secrets
* API keys
* Private credentials

Use environment variables.

`.env` should not be committed.

## SQL

Use parameterized queries or a safe established database abstraction.

Avoid constructing SQL directly from untrusted input.

## Authentication

Protected endpoints must verify authentication.

## Authorization

Verify:

* User role
* Resource ownership
* Requested action

where applicable.

## Input validation

Validate important input on the backend even if the frontend already validates it.

---

# 22. API Design Guidelines

Preserve the API conventions already established in the repository where reasonable.

Conceptually, APIs may resemble:

Authentication:

POST /api/auth/register

POST /api/auth/login

User:

GET /api/users/profile

Listings:

GET /api/listings

GET /api/listings/:id

POST /api/listings

PUT/PATCH /api/listings/:id

DELETE /api/listings/:id

Orders:

GET /api/orders

POST /api/orders

PATCH /api/orders/:id

Reviews:

GET /api/reviews

POST /api/reviews

PATCH /api/reviews/:id

These are conceptual examples.

Do NOT rename working routes solely to match these examples.

Existing reasonable conventions should generally be preserved.

---

# 23. Frontend Development Guidelines

When modifying the React application:

1. Inspect existing components before creating duplicates.
2. Reuse shared components where reasonable.
3. Preserve the existing visual language.
4. Keep customer/business navigation understandable.
5. Keep API logic organized.
6. Provide loading states where important.
7. Provide useful error states.
8. Avoid hardcoded production data when an API should supply it.
9. Avoid unnecessary dependencies.
10. Maintain responsive behavior.

Do not redesign the entire UI when implementing a backend feature unless explicitly requested.

---

# 24. Backend Development Guidelines

When modifying the Express backend:

Prefer separation between responsibilities where the existing project structure supports it.

Conceptually:

routes
→ request routing

controllers
→ request/response handling

services
→ reusable business logic where useful

database/repositories
→ database operations where useful

middleware
→ authentication, authorization, validation, etc.

Do not over-engineer a small university project.

Follow the architecture already established unless it has a concrete problem.

---

# 25. Database Development Guidelines

When modifying PostgreSQL:

* Use primary keys.
* Use foreign keys where relationships exist.
* Use NOT NULL appropriately.
* Use UNIQUE constraints appropriately.
* Use CHECK constraints where useful.
* Use timestamps consistently.
* Use indexes for important lookup/relationship columns where justified.
* Prefer NUMERIC/DECIMAL for monetary values rather than floating-point types.
* Preserve referential integrity.

Before destructive schema changes:

1. Identify dependent backend queries.
2. Identify dependent API response structures.
3. Identify dependent frontend components.
4. Determine whether existing data requires migration.
5. Prefer incremental migration.

Never drop a working table simply because a newer ER diagram uses a different name.

---

# 26. Testing Guidelines

Testing should focus on meaningful application behavior.

## Authentication tests

Examples:

* Registration succeeds with valid input.
* Duplicate email is rejected.
* Login succeeds with correct credentials.
* Login fails with incorrect credentials.
* Protected endpoint rejects unauthenticated request.

## Listing tests

Examples:

* Business can create listing.
* Listings can be retrieved.
* Listing can be updated.
* Listing can be deleted/deactivated.
* Invalid listing data is rejected.
* Unauthorized users cannot modify another business's listing.

## Order tests

Examples:

* Customer can create valid order.
* Order above available quantity is rejected.
* Inventory updates correctly.
* Unauthorized order access is rejected.

## Review tests

Examples:

* Valid review can be created.
* Invalid rating is rejected.
* Unauthorized review modification is rejected.

Generated tests should be reviewed rather than trusted automatically.

---

# 27. Course Development Context

The project is developed according to weekly course milestones.

## Week 1 — Initiation & SRS

Planned work included:

* Define scope
* Define objectives
* Define user roles
* Create SRS
* Set up GitHub repository
* Create contribution guidelines
* Generate initial README/task list

## Week 2 — Design & Planning

Planned work included:

* UI wireframes/prototype
* System architecture
* ER diagram
* System workflow
* AI/ML workflow
* GitHub Projects board

## Week 3–4 — Development Sprint 1

Course requirements:

* Build core modules
* Authentication
* Navigation
* Basic UI
* Use GitHub Copilot for code scaffolding
* AI-generated unit tests
* Weekly progress summaries
* Peer review through Pull Requests

## Week 5–6 — Development Sprint 2

Course requirements:

* CRUD operations
* Forms
* API integration
* AI-assisted sprint velocity monitoring
* AI-assisted backlog adjustment
* Weekly sprint retrospective
* AI-generated reports

At the time this base context was created, development had reached approximately Week 6.

This week number will become outdated.

Therefore, do NOT use this statement alone to infer current project status.

Inspect the repository and current user request.

---

# 28. Git & GitHub Workflow

Prefer development through feature/task branches rather than making every change directly on main.

Example:

main

feature/authentication

feature/listing-crud

feature/orders

feature/reviews

feature/ml-demand-prediction

Commit messages should be clear.

Examples:

feat: add listing creation endpoint

fix: prevent ordering unavailable quantity

test: add authentication API tests

docs: update database architecture

refactor: separate listing database queries

Use Pull Requests for review where required by the course workflow.

Do not rewrite Git history or force-push unless explicitly requested and the consequences are understood.

---

# 29. Documentation

Important project documentation may include:

* README
* SRS
* ER diagram
* Architecture diagram
* System workflow
* AI/ML workflow
* API documentation
* Sprint reports
* Retrospectives
* Test documentation

When documentation disagrees with actual code:

* Code/database determine current implementation behavior.
* Documentation describes intent unless confirmed otherwise.

Report discrepancies instead of silently assuming either side is correct.

---

# 30. Scope Boundaries

The initial PlateUp MVP does NOT need unnecessary complexity.

Features that may remain outside the initial scope include:

* Dedicated Android/iOS application
* Delivery-driver tracking
* Complex logistics management
* Advanced payment infrastructure
* Automated physical inventory hardware
* AI chatbot
* Automated food-quality inspection
* Enterprise-scale microservice architecture

Do not introduce these unless explicitly requested.

---

# 31. Development Priority Principles

When deciding what to implement next, generally prioritize dependencies.

Typical order:

Authentication
|
v
Database/API foundation
|
v
Core CRUD
|
v
Proper relationships
|
v
Orders/Reservations
|
v
Reviews/Search/Analytics
|
v
Historical sales data
|
v
ML functionality

Do not build sophisticated ML functionality while basic marketplace functionality is broken unless specifically requested for a course milestone.

---

# 32. Instructions Before Making Changes

For every substantial coding task:

## Step 1 — Understand

Read:

* this AGENTS.md
* relevant source files
* relevant configuration
* relevant database code/schema
* relevant tests

## Step 2 — Trace dependencies

Determine:

Frontend
→ API
→ Backend
→ Database

and identify what the proposed change affects.

## Step 3 — Preserve compatibility

Do not break working features unnecessarily.

## Step 4 — Implement minimally

Make the smallest coherent set of changes that correctly solves the requested problem.

## Step 5 — Validate

Run relevant:

* tests
* builds
* linting
* API checks

when available.

## Step 6 — Report

Explain:

* What changed
* Which files changed
* Why they changed
* What was tested
* Any remaining limitations

---

# 33. Instructions for Repository Audits

When asked to examine the project, inspect the actual repository.

At minimum, inspect relevant:

* Root files
* package.json files
* frontend source
* backend source
* React routes
* React pages/components
* API calls
* Express routes
* Controllers
* Services
* Middleware
* Authentication
* Database configuration
* SQL/schema/migrations
* Tests
* `.gitignore`
* Documentation

Ignore dependency/build/generated directories such as:

* node_modules
* dist
* build
* coverage

unless there is a specific reason to inspect them.

---

# 34. Audit Status Vocabulary

When reporting project status, use:

## IMPLEMENTED

Feature exists and appears functionally connected.

## PARTIALLY IMPLEMENTED

Some required pieces exist but the complete workflow does not.

## NOT IMPLEMENTED

No meaningful implementation was found.

## NEEDS FIX

Implementation exists but contains a significant functional, security, data-integrity, or integration issue.

## PLANNED

Feature exists in specifications/documentation but not necessarily in code.

Do not confuse PLANNED with IMPLEMENTED.

---

# 35. Critical Rules for AI Coding Agents

1. The repository is the source of truth for current implementation.
2. This file describes project intent and development conventions.
3. Read existing code before generating replacement code.
4. Do not assume a planned feature exists.
5. Do not assume a missing feature simply because it is absent from this document.
6. Do not rewrite working architecture without a concrete reason.
7. Preserve working frontend/backend/database integration.
8. Prefer incremental changes.
9. Do not perform destructive database changes without evaluating dependencies.
10. Do not expose secrets.
11. Do not store plaintext passwords.
12. Do not commit `.env`.
13. Use backend authorization, not frontend-only authorization.
14. Use parameterized/safe database queries.
15. Validate important input on the backend.
16. Do not introduce unnecessary frameworks or dependencies.
17. Do not over-engineer this university project.
18. Do not begin unrelated refactoring while implementing a requested feature.
19. When uncertain about an important architectural decision, explain the alternatives before making a destructive choice.
20. Always report what was actually changed and tested.

---

# 36. Default Behavior When Given a New Task

When asked:

"Implement X"

do not immediately generate a completely new subsystem.

First:

1. Locate existing code related to X.
2. Determine whether X is already fully or partially implemented.
3. Identify dependencies.
4. Reuse existing patterns.
5. Implement the missing functionality.
6. Test the relevant workflow.

For potentially disruptive changes such as:

* Database restructuring
* Authentication redesign
* Major dependency replacement
* Large architecture changes

first provide an impact assessment or implementation plan unless the user explicitly asks for immediate implementation.

---

# 37. Current Product Vision Summary

PlateUp should ultimately provide this core experience:

## Business

Register/Login
→ Create business profile
→ Publish surplus food
→ Set quantity and rescue price
→ Receive customer orders
→ Complete pickups
→ View sales/analytics
→ Eventually receive AI demand/pricing assistance

## Customer

Register/Login
→ Browse/search surplus food
→ View listing
→ Reserve/order discounted food
→ Pick up food
→ Review experience
→ Eventually receive personalized recommendations

## Platform

Authenticate users
→ Maintain marketplace data
→ Enforce permissions
→ Maintain inventory/order integrity
→ Store historical transaction data
→ Eventually support ML-driven insights

The primary objective is to build a coherent, secure, functional surplus-food marketplace first, then layer intelligent features on top of reliable marketplace data.
