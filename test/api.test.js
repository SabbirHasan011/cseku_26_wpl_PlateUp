const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const API_BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432
});

const testEmail = `test-${Date.now()}@plateup.test`;
const testListingTitle = `Automated test listing ${Date.now()}`;
const testReviewItem = `Automated review item ${Date.now()}`;
let createdListingId;
let createdReviewId;

async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test.after(async () => {
  await pool.query('DELETE FROM listings WHERE title = $1', [testListingTitle]);
  await pool.query('DELETE FROM reviews WHERE item_name = $1', [testReviewItem]);
  await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
  await pool.end();
});

test('health endpoint confirms the database connection', async () => {
  const { response, body } = await requestJson('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'ok', database: 'connected' });
});

test('signup stores a bcrypt hash instead of the plain password', async () => {
  const password = 'TestPassword123!';
  const { response, body } = await requestJson('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Automated Test User',
      email: testEmail,
      password,
      role: 'customer'
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.user.email, testEmail);
  assert.equal(body.user.password_hash, undefined);

  const result = await pool.query(
    'SELECT password_hash FROM users WHERE email = $1',
    [testEmail]
  );
  const storedHash = result.rows[0].password_hash;

  assert.notEqual(storedHash, password);
  assert.match(storedHash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(password, storedHash), true);
});

test('login returns a token for valid credentials', async () => {
  const { response, body } = await requestJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: 'TestPassword123!',
      role: 'customer'
    })
  });

  assert.equal(response.status, 200);
  assert.equal(typeof body.token, 'string');
  assert.equal(body.user.email, testEmail);
});

test('creating a listing persists it in PostgreSQL', async () => {
  const { response, body } = await requestJson('/listings', {
    method: 'POST',
    body: JSON.stringify({
      title: testListingTitle,
      category: 'Automated Test',
      business_name: 'Test Kitchen',
      original_price: 100,
      rescue_price: 50,
      quantity: 2
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.listing.title, testListingTitle);
  createdListingId = body.listing.id;

  const result = await pool.query(
    'SELECT title, category, quantity FROM listings WHERE title = $1',
    [testListingTitle]
  );

  assert.deepEqual(result.rows[0], {
    title: testListingTitle,
    category: 'Automated Test',
    quantity: 2
  });
});

test('listing CRUD supports reading, updating, and deleting a listing', async () => {
  const read = await requestJson(`/listings/${createdListingId}`);
  assert.equal(read.response.status, 200);
  assert.equal(read.body.listing.id, createdListingId);

  const update = await requestJson(`/listings/${createdListingId}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: testListingTitle,
      category: 'Updated Test',
      business_name: 'Updated Kitchen',
      original_price: 150,
      rescue_price: 75,
      quantity: 4
    })
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.listing.category, 'Updated Test');
  assert.equal(update.body.listing.quantity, 4);

  const invalid = await requestJson(`/listings/${createdListingId}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: testListingTitle,
      category: 'Updated Test',
      original_price: 10,
      rescue_price: 20,
      quantity: 1
    })
  });
  assert.equal(invalid.response.status, 400);

  const remove = await requestJson(`/listings/${createdListingId}`, { method: 'DELETE' });
  assert.equal(remove.response.status, 200);

  const missing = await requestJson(`/listings/${createdListingId}`);
  assert.equal(missing.response.status, 404);
});

test('review CRUD supports creating, updating, and deleting a review', async () => {
  const create = await requestJson('/reviews', {
    method: 'POST',
    body: JSON.stringify({
      business_name: 'Test Kitchen',
      item_name: testReviewItem,
      author_name: 'Automated Tester',
      rating: 4,
      comment: 'Good test meal.'
    })
  });
  assert.equal(create.response.status, 201);
  createdReviewId = create.body.review.id;

  const update = await requestJson(`/reviews/${createdReviewId}`, {
    method: 'PUT',
    body: JSON.stringify({
      business_name: 'Test Kitchen',
      item_name: testReviewItem,
      author_name: 'Automated Tester',
      rating: 5,
      comment: 'Excellent test meal.',
      reply: 'Thank you for testing.'
    })
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.review.rating, 5);
  assert.equal(update.body.review.reply, 'Thank you for testing.');

  const remove = await requestJson(`/reviews/${createdReviewId}`, { method: 'DELETE' });
  assert.equal(remove.response.status, 200);

  const missing = await requestJson(`/reviews/${createdReviewId}`);
  assert.equal(missing.response.status, 404);
});
