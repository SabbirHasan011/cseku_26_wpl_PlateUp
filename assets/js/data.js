const fallbackUsersDatabase = [
  { name: 'Demo Customer', email: 'user@plateup.com', pass: 'password123', role: 'customer' },
  { name: 'Spice Trail Kitchen', email: 'spicetrail@plateup.com', pass: 'password123', role: 'business' }
];

const fallbackListings = [
  { id: 1, title: 'Mixed pastry surprise box', category: 'Bakery', biz: 'Aromas Bakery · Dhanmondi', orig: 450, rescue: 180, qty: 6, discount: '-60%', time: 'Ends in 1h 40m', aiRecommended: true },
  { id: 2, title: 'Chicken biryani, end-of-day tray', category: 'Restaurant meal', biz: 'Spice Trail Kitchen · Mohammadpur', orig: 320, rescue: 140, qty: 3, discount: '-56%', time: 'Ends in 2h 10m', aiRecommended: false },
  { id: 3, title: 'Ripe produce crate', category: 'Produce', biz: 'Green Basket Grocers · Dhanmondi', orig: 600, rescue: 220, qty: 2, discount: '-63%', time: 'Ends in 40m', aiRecommended: true },
  { id: 4, title: 'Sandwich and salad bundle', category: 'Cafe', biz: 'Cafe Cornerstone · Uttara', orig: 390, rescue: 160, qty: 5, discount: '-59%', time: 'Ends in 3h', aiRecommended: false },
  { id: 5, title: 'Assorted bread, day-old', category: 'Bakery', biz: 'Daily Dozen Bakes · Gulshan', orig: 280, rescue: 90, qty: 10, discount: '-68%', time: 'Ends in 4h', aiRecommended: false },
  { id: 6, title: 'Pasta and grill leftovers box', category: 'Restaurant meal', biz: 'Rosun Deli · Banani', orig: 500, rescue: 200, qty: 4, discount: '-60%', time: 'Ends in 2h', aiRecommended: true }
];

const fallbackReviewsDatabase = [
  {
    id: 1,
    biz: 'Spice Trail Kitchen',
    author: 'Tanvir Hossain',
    rating: 5,
    time: '2 hours ago',
    item: 'Chicken biryani, end-of-day tray',
    comment: 'Food was warm and tasted perfectly fresh! Packaging was neat. Unbelievable deal for the price.',
    reply: 'Thank you Tanvir! Glad you enjoyed the meal and helped us reduce surplus food!'
  },
  {
    id: 2,
    biz: 'Spice Trail Kitchen',
    author: 'Nabila K.',
    rating: 4,
    time: 'Yesterday',
    item: 'Special Mutton Curry Box',
    comment: 'Great portion size. A bit spicy for my personal taste, but incredible value.',
    reply: null
  },
  {
    id: 3,
    biz: 'Aromas Bakery',
    author: 'Sajid Ahmed',
    rating: 5,
    time: '3 days ago',
    item: 'Mixed pastry surprise box',
    comment: 'The croissants were still buttery and crisp! Will order again tomorrow.',
    reply: 'Thanks Sajid! See you next time.'
  }
];

window.plateupFallbackData = {
  users: fallbackUsersDatabase,
  listings: fallbackListings,
  reviews: fallbackReviewsDatabase
};

const usersDatabase = [...fallbackUsersDatabase];
const listings = [...fallbackListings];
const reviewsDatabase = [...fallbackReviewsDatabase];
