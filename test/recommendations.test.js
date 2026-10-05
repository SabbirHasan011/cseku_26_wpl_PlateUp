const test = require('node:test');
const assert = require('node:assert/strict');
const { rankRecommendations } = require('../server/recommendations');

const meal = (id, business = id, category = 'Bakery', extra = {}) => ({
  id, business_id: business, category, title: 'Meal ' + id, quantity: 10,
  rescue_price: '100.00', original_price: '200.00', ...extra
});

test('recommendations use saved meals, restaurants, completed-order categories and good reviews with explanations', () => {
  const items = [meal(1), meal(2, 2, 'Main Meal'), meal(3, 3, 'Dessert'), meal(4, 4, 'Drinks')];
  let result = rankRecommendations(items, { favorites: [{ listing_id: 1, category: 'Bakery' }] });
  assert.equal(result.mode, 'personalized');
  assert.equal(result.listings[0].id, 1); assert.match(result.listings[0].recommendation_reason, /saved meals/);
  result = rankRecommendations(items, { favorites: [{ business_id: 3 }] });
  assert.equal(result.listings[0].id, 3); assert.match(result.listings[0].recommendation_reason, /restaurant you saved/);
  result = rankRecommendations(items, { orders: [{ listing_id: 90, business_id: 90, category: ' MAIN meal ', age_days: 0 }] });
  assert.equal(result.listings[0].id, 2); assert.match(result.listings[0].recommendation_reason, /categories/);
  result = rankRecommendations(items, { reviews: [{ listing_id: 4, business_id: 4, category: 'Drinks', rating: 5, age_days: 0 }] });
  assert.equal(result.listings[0].id, 4); assert.match(result.listings[0].recommendation_reason, /rated/);
});

test('recent purchases count more, repeat activity is capped, and poor reviews reduce repeated-meal preference', () => {
  const items = [meal(1, 1, 'A'), meal(2, 2, 'B'), meal(3, 3, 'C')];
  const first = { listing_id: 1, business_id: 1, category: 'A', age_days: 120 };
  const second = { listing_id: 2, business_id: 2, category: 'B', age_days: 0 };
  assert.equal(rankRecommendations(items, { orders: [first, second] }).listings[0].id, 2);
  const orders = Array.from({ length: 500 }, () => first);
  const favorite = { listing_id: 3, category: 'C' };
  assert.equal(rankRecommendations(items, { orders, favorites: [favorite] }).listings[0].id, 3);
  assert.equal(rankRecommendations(items, { orders, reviews: [
    { listing_id: 1, business_id: 1, category: 'A', rating: 1, age_days: 0 }
  ] }).listings.at(-1).id, 1);
});

test('new-customer suggestions use popularity/reviews, stay deterministic and limit each restaurant to two meals', () => {
  const items = Array.from({ length: 9 }, (_, n) => meal(n + 1, n < 5 ? 1 : n));
  items[0].completed_customers = 20;
  items[5].average_rating = '5.0'; items[5].review_count = 10;
  const result = rankRecommendations(items);
  assert.equal(result.mode, 'local'); assert.equal(result.listings.length, 6);
  assert.equal(result.listings[0].id, 1); assert.match(result.listings[0].recommendation_reason, /Popular/);
  assert.ok(result.listings.filter(item => item.business_id === 1).length <= 2);
  assert.deepEqual(result, rankRecommendations([...items].reverse()));
  assert.ok(result.listings.every(item => !('completed_customers' in item) && !('score' in item)));
  assert.equal(items[0].recommendation_reason, undefined, 'Ranking must not mutate source listings');
  assert.deepEqual(rankRecommendations([]).listings, []);
});
