# Personalized meal recommendations

PlateUp's customer homepage includes **Recommended for you**. This is a deterministic,
rule-based feature; it does not train or run an ML recommendation model and does not
change dynamic pricing. No schema migration or training command is needed.

`GET /api/recommendations` requires an authenticated customer. The server uses the
customer ID from the verified token; it accepts no customer-ID override. Responses
are private and not cached. They contain `algorithm: "rules-v1"`, a `mode` of
`personalized` or `local`, and up to six listing objects with a `recommendation_reason`.
They never contain another customer's history, internal preference weights or scores.

Before ranking, the server excludes items outside the customer's saved city,
inactive items/businesses, unavailable daily inventory, scheduled/closed offers and
zero stock. Existing Bangladesh-time offer logic also handles midnight-crossing
windows. Prices use the existing refresh policy; recommendations don't reserve stock.
The normal details, cart and order APIs validate availability again before purchase.

## Ranking rules

- A saved meal adds 8 points; a saved restaurant adds 5.
- Completed orders from the last 180 days add item, restaurant and category affinity.
  Contributions halve every 60 days. Each item's order affinity is capped at 2,
  each restaurant and category at 3; item affinity is weighted twice.
- Saved-meal categories add 2 points each, capped at 3 per category.
- The latest own review for a meal, from completed orders in the last 180 days,
  adds preference when rated 4 or 5. Direct-meal points are
  `3 * (rating - 3) * recency`; positive category/restaurant affinity is capped at 2.
  Ratings of 1 or 2 subtract 8 points and suppress that item's order affinity.
- Public completed-customer counts over 90 days add at most 1.5 points. Public
  average ratings add at most 1 point, tempered by the review count.
- Selection allows at most two meals per restaurant. Already-selected categories
  receive a 0.75-point selection penalty to encourage variety. Ties use listing ID.

New customers get local suggestions using the public popularity/review signals,
with available meals as a fallback. A single restaurant can therefore provide only
two recommendations even if it has more items. No random percentages or ML predictions
are used. At most 500 recent rows of each personal signal are read per request.

## Frontend behavior and limits

The section is hidden for guests and business accounts. Customers without a city get
a profile-city prompt. Each meal has a short explanation and the usual meal actions.
The section refreshes with existing marketplace polling, when returning to Home,
after favorites change, and after review/order flows refresh marketplace data.
Account/city changes invalidate pending responses; logout clears personal suggestions.
Loading, empty and retryable error states are included.

This initial version doesn't track clicks, infer dietary/allergy restrictions, provide
explicit preference editing or claim recommendation accuracy. Historical item edits
use the current category/restaurant, since the existing history has no category snapshot.
It can later be evaluated with real usage or replaced with ML ranking while keeping
the same eligibility and authorization checks.
