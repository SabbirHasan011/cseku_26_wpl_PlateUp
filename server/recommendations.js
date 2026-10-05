const pool = require('./db');
const { refreshPrices } = require('./pricing');

const categoryKey = value => String(value || '').trim().toLowerCase();
const recency = age => 2 ** (-Math.max(0, Number(age) || 0) / 60);
const increment = (map, key, value, cap) => {
  if (key !== null && key !== undefined && key !== '') map.set(key, Math.min(cap, (map.get(key) || 0) + value));
};

// Fixed, explainable preference weights. This is not a trained ML model.
// Repeated purchases are capped so one habit cannot drown out other interests.
function rankRecommendations(candidates, { orders = [], favorites = [], reviews = [] } = {}) {
  const itemOrders = new Map(), businessOrders = new Map(), categoryOrders = new Map();
  const savedItems = new Set(), savedBusinesses = new Set(), savedCategories = new Map();
  const itemReviews = new Map(), businessReviews = new Map(), categoryReviews = new Map();
  // Queries return newest reviews first; a customer's latest rating wins.
  for (const review of reviews) if (!itemReviews.has(review.listing_id)) itemReviews.set(review.listing_id, review);
  for (const review of itemReviews.values()) {
    if (Number(review.rating) >= 4) {
      increment(businessReviews, review.business_id, recency(review.age_days), 2);
      increment(categoryReviews, categoryKey(review.category), recency(review.age_days), 2);
    }
  }
  for (const order of orders) {
    if (Number(itemReviews.get(order.listing_id)?.rating) <= 2) continue;
    const weight = recency(order.age_days);
    increment(itemOrders, order.listing_id, weight, 2);
    increment(businessOrders, order.business_id, weight, 3);
    increment(categoryOrders, categoryKey(order.category), weight, 3);
  }
  for (const favorite of favorites) {
    if (favorite.listing_id) {
      savedItems.add(favorite.listing_id);
      increment(savedCategories, categoryKey(favorite.category), 2, 3);
    } else if (favorite.business_id) savedBusinesses.add(favorite.business_id);
  }
  const personalized = savedItems.size || savedBusinesses.size || itemOrders.size ||
    [...itemReviews.values()].some(review => Number(review.rating) >= 4);
  const scored = candidates.map(item => {
    const category = categoryKey(item.category), review = itemReviews.get(item.id);
    const positiveRating = Number(review?.rating) >= 4;
    const categoryAffinity = (categoryOrders.get(category) || 0) + (savedCategories.get(category) || 0) +
      (categoryReviews.get(category) || 0);
    const popularity = Math.min(1.5, Math.log1p(Number(item.completed_customers) || 0) / 2);
    const quality = (Number(item.average_rating) || 0) / 5 * Math.min(1, (Number(item.review_count) || 0) / 5);
    let score = popularity + quality + categoryAffinity + (itemOrders.get(item.id) || 0) * 2 +
      (businessOrders.get(item.business_id) || 0) + (businessReviews.get(item.business_id) || 0);
    if (savedItems.has(item.id)) score += 8;
    if (savedBusinesses.has(item.business_id)) score += 5;
    if (positiveRating) score += 3 * (Number(review.rating) - 3) * recency(review.age_days);
    if (Number(review?.rating) <= 2) score -= 8;
    const reason = savedItems.has(item.id) ? 'One of your saved meals' : positiveRating ? 'You rated this meal highly' :
      savedBusinesses.has(item.business_id) ? 'From a restaurant you saved' : itemOrders.has(item.id) ? 'A meal you enjoyed before' :
      categoryAffinity > 0 ? 'More from categories you enjoy' : businessOrders.has(item.business_id) ? 'From a restaurant you ordered from' :
      popularity > 0 ? 'Popular with local customers' : quality > 0 ? 'Well reviewed in your city' : 'Available near you now';
    return { item, score, reason, category };
  });
  const selected = [], businesses = new Map(), categories = new Map();
  while (selected.length < 6 && scored.length) {
    scored.sort((a, b) => (b.score - (categories.get(b.category) || 0) * .75) -
      (a.score - (categories.get(a.category) || 0) * .75) || Number(b.item.id) - Number(a.item.id));
    const next = scored.shift();
    if ((businesses.get(next.item.business_id) || 0) >= 2) continue;
    businesses.set(next.item.business_id, (businesses.get(next.item.business_id) || 0) + 1);
    categories.set(next.category, (categories.get(next.category) || 0) + 1);
    const { completed_customers, ...publicItem } = next.item;
    selected.push({ ...publicItem, recommendation_reason: next.reason });
  }
  return { algorithm: 'rules-v1', mode: personalized ? 'personalized' : 'local', listings: selected };
}

function registerRecommendations(app, { auth, role, wrap, listingSql, viewerCitySql }) {
  app.get('/api/recommendations', auth, role('customer'), wrap(async (req, res) => {
    await refreshPrices();
    const user = [req.user.userId];
    const [candidates, orders, favorites, reviews] = await Promise.all([
      pool.query(`SELECT items.*,COALESCE(pop.completed_customers,0) AS completed_customers
        FROM (${listingSql}) items
        JOIN users owner ON owner.id=items.business_id AND owner.role='business' AND owner.status='active'
        LEFT JOIN (SELECT listing_id,COUNT(DISTINCT customer_id)::int AS completed_customers FROM orders
          WHERE status='completed' AND order_time>=CURRENT_TIMESTAMP-INTERVAL '90 days'
          GROUP BY listing_id) pop ON pop.listing_id=items.id
        WHERE items.is_active AND items.daily_status='Active' AND items.quantity>0 AND items.city_id=${viewerCitySql}`, user),
      pool.query(`SELECT o.listing_id,l.business_id,l.category,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP::timestamp-o.order_time))/86400 AS age_days
        FROM orders o JOIN listings l ON l.id=o.listing_id
        WHERE o.customer_id=$1 AND o.status='completed' AND o.order_time>=CURRENT_TIMESTAMP-INTERVAL '180 days'
        ORDER BY o.order_time DESC,o.id DESC LIMIT 500`, user),
      pool.query(`SELECT f.listing_id,f.business_id,l.category FROM favorites f
        LEFT JOIN listings l ON l.id=f.listing_id WHERE f.customer_id=$1 ORDER BY f.created_at DESC,f.id DESC LIMIT 500`, user),
      pool.query(`SELECT r.listing_id,r.business_id,l.category,r.rating,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP::timestamp-r.created_at))/86400 AS age_days
        FROM reviews r JOIN listings l ON l.id=r.listing_id JOIN orders o ON o.id=r.order_id
        WHERE r.customer_id=$1 AND o.customer_id=$1 AND o.status='completed'
          AND r.created_at>=CURRENT_TIMESTAMP-INTERVAL '180 days'
        ORDER BY r.created_at DESC,r.id DESC LIMIT 500`, user)
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json(rankRecommendations(candidates.rows, {
      orders: orders.rows, favorites: favorites.rows, reviews: reviews.rows
    }));
  }));
}

module.exports = { rankRecommendations, registerRecommendations };
