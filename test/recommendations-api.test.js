const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/index');
const pool = require('../server/db');

test('recommendation API protects personal history, enforces marketplace eligibility and preserves inventory', async () => {
  const server = app.listen(0), base = 'http://127.0.0.1:' + server.address().port + '/api';
  const users = [], items = [];
  const call = async (route, method = 'GET', body, token) => {
    const response = await fetch(base + route, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
  };
  try {
    for (const [role, city] of [['business', 'Dhaka'], ['business', 'Dhaka'], ['business', 'Khulna'],
      ['customer', 'Dhaka'], ['customer', 'Dhaka'], ['customer', 'Dhaka']]) {
      const credentials = { name: 'Recommendation test', role, email: 'rec-' + Date.now() + '-' + users.length + '@plateup.test', password: 'RecTestPassword123!' };
      const signup = await call('/auth/signup', 'POST', credentials); assert.equal(signup.status, 201);
      const login = await call('/auth/login', 'POST', credentials);
      users.push({ ...signup.body.user, token: login.body.token });
      assert.equal((await call('/me', 'PUT', { name: credentials.name, city }, login.body.token)).status, 200);
    }
    const [owner, other, outside, customer, second, newcomer] = users;
    const create = async (business, title, quantity = 10) => {
      const result = await call('/listings', 'POST', { title, category: 'Bakery', original_price: 200, minimum_price: 80,
        offer_start_time: '00:00', offer_end_time: '00:00' }, business.token);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const id = result.body.listing.id; items.push(id);
      if (quantity !== null) assert.equal((await call('/listings/' + id + '/today', 'PUT', { initial_quantity: quantity }, business.token)).status, 200);
      return id;
    };
    const preferred = await create(owner, 'Saved bread'), alternative = await create(other, 'Other saved bread');
    const wrongCity = await create(outside, 'Outside city'), noQuantity = await create(owner, 'No quantity', null);
    const soldOut = await create(owner, 'Sold out', 0), inactive = await create(owner, 'Deactivated bread');
    const scheduled = await create(owner, 'Scheduled bread'), closed = await create(owner, 'Closed bread');
    await pool.query('UPDATE listings SET is_active=FALSE WHERE id=$1', [inactive]);
    // Windows remain on the same offer date and avoid fixed clock assumptions.
    await pool.query(`WITH clock AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time AS t)
      UPDATE listings SET offer_start_time=clock.t+(TIME '24:00'-clock.t)/2,offer_end_time='00:00'
      FROM clock WHERE id=$1`, [scheduled]);
    await pool.query(`WITH clock AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time AS t)
      UPDATE listings SET offer_start_time='00:00',offer_end_time=TIME '00:00'+(clock.t-TIME '00:00')/2
      FROM clock WHERE id=$1`, [closed]);
    await pool.query(`INSERT INTO daily_availability(listing_id,offer_date,initial_quantity,remaining_quantity)
      VALUES ($1,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-3,12,7)`, [noQuantity]);
    assert.equal((await call('/recommendations')).status, 401);
    assert.equal((await call('/recommendations', 'GET', undefined, owner.token)).status, 403);
    assert.equal((await call('/favorites/listing/' + preferred, 'PUT', {}, customer.token)).status, 200);
    assert.equal((await call('/favorites/listing/' + alternative, 'PUT', {}, second.token)).status, 200);
    const before = (await pool.query('SELECT listing_id,offer_date,initial_quantity,remaining_quantity FROM daily_availability WHERE listing_id=ANY($1) ORDER BY id', [items])).rows;
    const first = await call('/recommendations', 'GET', undefined, customer.token);
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.match(first.cache, /private.*no-store/);
    assert.equal(first.body.mode, 'personalized'); assert.equal(first.body.listings[0].id, preferred);
    assert.match(first.body.listings[0].recommendation_reason, /saved meals/);
    for (const item of first.body.listings) {
      assert.equal(item.city, 'Dhaka'); assert.equal(item.daily_status, 'Active'); assert.ok(item.quantity > 0);
      assert.ok(Number.isInteger(Number(item.rescue_price))); assert.equal(item.is_active, true);
      assert.equal(item.score, undefined); assert.equal(item.customer_id, undefined);
      assert.ok(![wrongCity, noQuantity, soldOut, inactive, scheduled, closed].includes(item.id));
    }
    const another = await call('/recommendations', 'GET', undefined, second.token);
    assert.equal(another.body.listings[0].id, alternative);
    const forged = await call('/recommendations?customer_id=' + second.id, 'GET', undefined, customer.token);
    assert.deepEqual(forged.body, first.body, 'Query parameters must not expose another customer\'s preferences');
    const cold = await call('/recommendations', 'GET', undefined, newcomer.token);
    assert.equal(cold.body.mode, 'local'); assert.ok(cold.body.listings.length <= 6);
    assert.equal(cold.body.listings.some(item => /you saved|you enjoyed|you rated/.test(item.recommendation_reason)), false);
    // Real completed-order review eligibility is reused; these are isolated history fixtures.
    const order = (await pool.query(`INSERT INTO orders(customer_id,listing_id,quantity,total_price,status)
      VALUES ($1,$2,1,160,'completed') RETURNING id`, [newcomer.id, alternative])).rows[0];
    assert.equal((await call('/reviews', 'POST', { order_id: order.id, rating: 5, comment: 'A great meal' }, newcomer.token)).status, 201);
    const reviewed = await call('/recommendations', 'GET', undefined, newcomer.token);
    assert.equal(reviewed.body.mode, 'personalized'); assert.equal(reviewed.body.listings[0].id, alternative);
    assert.match(reviewed.body.listings[0].recommendation_reason, /rated this meal highly/);
    const after = (await pool.query('SELECT listing_id,offer_date,initial_quantity,remaining_quantity FROM daily_availability WHERE listing_id=ANY($1) ORDER BY id', [items])).rows;
    assert.deepEqual(after, before, 'Recommendations must not consume stock or alter historical quantities');
    await call('/me', 'PUT', { name: 'Recommendation test', city_id: null }, newcomer.token);
    assert.deepEqual((await call('/recommendations', 'GET', undefined, newcomer.token)).body.listings, []);
    await call('/me', 'PUT', { name: 'Recommendation test', city: 'Khulna' }, newcomer.token);
    const moved = await call('/recommendations', 'GET', undefined, newcomer.token);
    assert.equal(moved.body.listings[0].id, wrongCity); assert.ok(moved.body.listings.every(item => item.city === 'Khulna'));
    await pool.query("UPDATE users SET status='inactive' WHERE id=$1", [outside.id]);
    assert.equal((await call('/recommendations', 'GET', undefined, newcomer.token)).body.listings.some(item => item.id === wrongCity), false);
  } finally {
    const ids = users.map(user => user.id);
    await pool.query('DELETE FROM reviews WHERE customer_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM orders WHERE customer_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM ml_predictions WHERE listing_id=ANY($1)', [items]);
    await pool.query('DELETE FROM daily_availability WHERE listing_id=ANY($1)', [items]);
    await pool.query('DELETE FROM listings WHERE id=ANY($1)', [items]);
    await pool.query('DELETE FROM customers WHERE user_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)', [ids]);
    await new Promise(resolve => server.close(resolve));
  }
});
