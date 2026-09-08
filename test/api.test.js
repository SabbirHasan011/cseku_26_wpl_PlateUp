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
