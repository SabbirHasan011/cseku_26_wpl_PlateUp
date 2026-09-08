const API_BASE = 'http://localhost:5000/api';

let cartCount = 0;
let activeCategory = 'All';
let selectedRole = 'customer';
let authMode = 'login';
let currentUser = null;
let activeScreen = 'home';
let cartItems = [];
let orderHistory = [];
let selectedReviewOrder = null;
let reviewCarouselTimer = null;

function persistSession() {
  if (currentUser) {
    localStorage.setItem('plateup_user', JSON.stringify(currentUser));
  }
}

function restoreSession() {
  const savedUser = localStorage.getItem('plateup_user');

  if (!savedUser || !localStorage.getItem('plateup_token')) return;

  try {
    currentUser = JSON.parse(savedUser);
    loadOrderHistory();
    if (currentUser.role === 'business') {
      document.getElementById('biz-name-text').innerText = currentUser.name;
      document.getElementById('biz-avatar-text').innerText = currentUser.name.substring(0, 2).toUpperCase();
    }
  } catch (error) {
    localStorage.removeItem('plateup_user');
    localStorage.removeItem('plateup_token');
  }
}

function orderHistoryKey() {
  return currentUser ? `plateup_orders_${currentUser.email.toLowerCase()}` : null;
}

function loadOrderHistory() {
  const key = orderHistoryKey();
  if (!key) {
    orderHistory = [];
    return;
  }

  try {
    const savedOrders = JSON.parse(localStorage.getItem(key) || '[]');
    orderHistory = Array.isArray(savedOrders) ? savedOrders : [];
  } catch (error) {
    orderHistory = [];
  }
}

function saveOrderHistory() {
  const key = orderHistoryKey();
  if (key) localStorage.setItem(key, JSON.stringify(orderHistory));
}

function renderProfile() {
  if (!currentUser) {
    showScreen('login');
    return;
  }

  const name = currentUser.name || 'PlateUp User';
  const email = currentUser.email || '';
  const mealCount = orderHistory.reduce((total, order) => total + order.items.length, 0);

  document.getElementById('profile-avatar').innerText = name.substring(0, 2).toUpperCase();
  document.getElementById('profile-name').innerText = name;
  document.getElementById('profile-email').innerText = email;
  document.getElementById('profile-role').innerText = currentUser.role === 'business' ? 'Business' : 'Customer';
  document.getElementById('profile-order-count').innerText = orderHistory.length;
  document.getElementById('profile-meal-count').innerText = mealCount;

  const history = document.getElementById('order-history');
  if (orderHistory.length === 0) {
    history.innerHTML = '<div class="empty-history">Your completed reservations will appear here.</div>';
    return;
  }

  history.innerHTML = orderHistory.map(order => `
    <div class="order-row">
      <div class="order-main">
        <strong>Order #${order.id}</strong>
        <span>${order.date}</span>
      </div>
      <div class="order-items">${order.items.map(item => `<span>${item.title} · ${item.biz}</span>`).join('')}</div>
      <div class="order-total"><strong>৳${order.total}</strong><span class="badge active">Completed</span><button class="review-order-btn" onclick="openReviewModal('${order.id}')">Leave Review</button></div>
    </div>
  `).join('');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

async function loadInitialData() {
  try {
    const [listingData, reviewData] = await Promise.all([
      requestJson(`${API_BASE}/listings`),
      requestJson(`${API_BASE}/reviews`)
    ]);

    if (Array.isArray(listingData) && listingData.length > 0) {
      listings.splice(0, listings.length, ...listingData.map(item => ({
        id: item.id,
        title: item.title,
        category: item.category,
        biz: item.business_name ? `${item.business_name} · Local` : item.biz || 'Local Business',
        orig: Number(item.original_price || item.orig || 0),
        rescue: Number(item.rescue_price || item.rescue || 0),
        qty: Number(item.quantity || item.qty || 0),
        discount: item.discount || `-${Math.round((1 - (Number(item.rescue_price || item.rescue || 0) / (Number(item.original_price || item.orig || 1)))) * 100)}%`,
        time: item.time || 'Ends in 3h',
        aiRecommended: Boolean(item.aiRecommended)
      })));
    }

    if (Array.isArray(reviewData) && reviewData.length > 0) {
      reviewsDatabase.splice(0, reviewsDatabase.length, ...reviewData.map(review => ({
        id: review.id,
        biz: review.business_name,
        author: review.author_name || 'Verified Customer',
        rating: Number(review.rating || 5),
        time: review.time || 'Just now',
        item: review.item_name,
        comment: review.comment,
        reply: review.reply || null
      })));
    }
  } catch (error) {
    console.warn('Backend unavailable, using fallback demo data:', error.message);
  }

  renderListings();
  renderReviews();
  renderHomeReviews();
}

function renderHomeReviews() {
  const carousel = document.getElementById('home-reviews-carousel');
  const dots = document.getElementById('review-carousel-dots');
  if (!carousel || !dots) return;

  const publicReviews = reviewsDatabase.slice(0, 6);
  if (publicReviews.length === 0) {
    carousel.innerHTML = '<div class="empty-history">Customer reviews will appear here.</div>';
    dots.innerHTML = '';
    return;
  }

  carousel.innerHTML = publicReviews.map((review, index) => `
    <article class="home-review-slide ${index === 0 ? 'active' : ''}">
      <div class="home-review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
      <blockquote>“${review.comment}”</blockquote>
      <div class="home-review-author"><strong>${review.author}</strong><span>${review.biz} · ${review.item}</span></div>
    </article>
  `).join('');
  dots.innerHTML = publicReviews.map((_, index) => `<button class="${index === 0 ? 'active' : ''}" aria-label="Show review ${index + 1}" onclick="showReviewSlide(${index})"></button>`).join('');

  if (reviewCarouselTimer) clearInterval(reviewCarouselTimer);
  if (publicReviews.length > 1) {
    reviewCarouselTimer = setInterval(() => {
      const activeIndex = [...document.querySelectorAll('.home-review-slide')].findIndex(slide => slide.classList.contains('active'));
      showReviewSlide((activeIndex + 1) % publicReviews.length);
    }, 5000);
  }
}

function showReviewSlide(index) {
  document.querySelectorAll('.home-review-slide').forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === index));
  document.querySelectorAll('.review-carousel-dots button').forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === index));
}

function switchAuthMode(mode, tabEl) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');

  clearAuthBanners();

  const loginForm = document.getElementById('form-login');
  const signupForm = document.getElementById('form-signup');
  const title = document.getElementById('auth-title');
  const desc = document.getElementById('auth-desc');

  if (mode === 'login') {
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
    title.innerText = 'Welcome Back';
    desc.innerText = 'Select your account role to continue';
  } else {
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    title.innerText = 'Create Account';
    desc.innerText = 'Join PlateUp to rescue fresh surplus food';
  }
}

function selectRole(role, el) {
  selectedRole = role;
  document.querySelectorAll('.role-opt').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
  clearAuthBanners();

  const loginEmail = document.getElementById('login-email');
  const nameLabel = document.getElementById('name-label');

  if (role === 'customer') {
    loginEmail.value = 'user@plateup.com';
    nameLabel.innerText = 'Full Name';
  } else {
    loginEmail.value = 'spicetrail@plateup.com';
    nameLabel.innerText = 'Business / Restaurant Name';
  }
}

function showAuthError(msg) {
  const banner = document.getElementById('auth-error-banner');
  banner.innerText = msg;
  banner.style.display = 'block';
  document.getElementById('auth-success-banner').style.display = 'none';
}

function showAuthSuccess(msg) {
  const banner = document.getElementById('auth-success-banner');
  banner.innerText = msg;
  banner.style.display = 'block';
  document.getElementById('auth-error-banner').style.display = 'none';
}

function clearAuthBanners() {
  document.getElementById('auth-error-banner').style.display = 'none';
  document.getElementById('auth-success-banner').style.display = 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  clearAuthBanners();

  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;

  try {
    const data = await requestJson(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: pass, role: selectedRole })
    });

    currentUser = data.user;
    localStorage.setItem('plateup_token', data.token || '');
    persistSession();
    loadOrderHistory();
    renderTopNav();

    if (currentUser.role === 'business') {
      document.getElementById('biz-name-text').innerText = currentUser.name;
      document.getElementById('biz-avatar-text').innerText = currentUser.name.substring(0, 2).toUpperCase();
      showScreen('business');
      renderReviews();
    } else {
      showScreen('customer');
    }
  } catch (error) {
    const match = usersDatabase.find(u => u.email === email && u.pass === pass && u.role === selectedRole);
    if (match) {
      currentUser = match;
      localStorage.setItem('plateup_token', 'demo-session');
      persistSession();
      loadOrderHistory();
      renderTopNav();
      if (currentUser.role === 'business') {
        document.getElementById('biz-name-text').innerText = currentUser.name;
        document.getElementById('biz-avatar-text').innerText = currentUser.name.substring(0, 2).toUpperCase();
        showScreen('business');
        renderReviews();
      } else {
        showScreen('customer');
      }
      return;
    }

    showAuthError(`Invalid ${selectedRole} email or password.`);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  clearAuthBanners();

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-pass').value;
  const passConfirm = document.getElementById('signup-pass-confirm').value;

  if (pass !== passConfirm) {
    showAuthError('Passwords do not match. Please re-enter.');
    return;
  }

  try {
    const data = await requestJson(`${API_BASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify({ name, email, password: pass, role: selectedRole })
    });

    usersDatabase.push({
      name: data.user.name,
      email: data.user.email,
      pass,
      role: data.user.role
    });
  } catch (error) {
    const exists = usersDatabase.some(u => u.email === email);
    if (exists) {
      showAuthError('An account with this email address already exists.');
      return;
    }

    usersDatabase.push({ name, email, pass, role: selectedRole });
  }

  document.getElementById('signup-name').value = '';
  document.getElementById('signup-email').value = '';
  document.getElementById('signup-pass').value = '';
  document.getElementById('signup-pass-confirm').value = '';

  switchAuthMode('login', document.querySelectorAll('.auth-tab')[0]);
  document.getElementById('login-email').value = email;
  document.getElementById('login-pass').value = pass;

  showAuthSuccess('Account created successfully! Click Sign In to continue.');
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('plateup_token');
  localStorage.removeItem('plateup_user');
  localStorage.removeItem('plateup_screen');
  renderTopNav();
  clearAuthBanners();
  showScreen('home');
}

function renderTopNav() {
  const container = document.getElementById('nav-controls');

  if (!currentUser) {
    container.innerHTML = `
      <div class="switch">
        <button class="${activeScreen === 'home' ? 'active' : ''}" onclick="showScreen('home')">Home</button>
        <button class="${activeScreen === 'customer' ? 'active' : ''}" onclick="showScreen('customer')">Marketplace</button>
      </div>
      <button class="btn-pri" style="border-radius:999px; padding: 8px 18px; font-size:13px;" onclick="showScreen('login')">Sign In</button>
    `;
    return;
  }

  if (currentUser.role === 'customer') {
    container.innerHTML = `
      <span class="user-badge">CUSTOMER: ${currentUser.email}</span>
      <button class="cart-chip" onclick="openCheckoutModal()">🛒 Cart (<span id="cart-count">${cartCount}</span>)</button>
      <div class="switch">
        <button class="${activeScreen === 'home' ? 'active' : ''}" onclick="showScreen('home')">Home</button>
        <button class="${activeScreen === 'customer' ? 'active' : ''}" onclick="showScreen('customer')">Browse Food</button>
      </div>
      <button class="profile-nav-btn" onclick="showScreen('profile')">Profile</button>
      <button class="logout-btn" onclick="handleLogout()">Logout</button>
    `;
  } else {
    container.innerHTML = `
      <span class="user-badge">BUSINESS: ${currentUser.email}</span>
      <div class="switch">
        <button class="${activeScreen === 'home' ? 'active' : ''}" onclick="showScreen('home')">Home</button>
        <button class="${activeScreen === 'customer' ? 'active' : ''}" onclick="showScreen('customer')">Browse Food</button>
        <button class="${activeScreen === 'business' ? 'active' : ''}" onclick="showScreen('business')">Business Portal</button>
      </div>
      <button class="profile-nav-btn" onclick="showScreen('profile')">Profile</button>
      <button class="logout-btn" onclick="handleLogout()">Logout</button>
    `;
  }
}

function renderListings() {
  const grid = document.getElementById('listing-grid');
  const homeGrid = document.getElementById('home-featured-grid');
  const tableBody = document.querySelector('#business-table tbody');
  const query = document.getElementById('food-search').value.toLowerCase();

  grid.innerHTML = '';
  if (homeGrid) homeGrid.innerHTML = '';
  tableBody.innerHTML = '';

  listings.forEach((item, idx) => {
    const matchesCat = activeCategory === 'All' || item.category === activeCategory;
    const matchesSearch = item.title.toLowerCase().includes(query) || item.biz.toLowerCase().includes(query);

    const cardMarkup = `
      <div class="food-card">
        <div class="food-thumb">
          <div class="urgency">${item.time}</div>
          ${item.aiRecommended ? '<div class="ai-tag">AI Optimal</div>' : ''}
          <span class="initial">${item.title.substring(0, 2)}</span>
        </div>
        <div class="food-body">
          <div class="biz-line">${item.biz}</div>
          <p class="food-title">${item.title}</p>
          <div class="food-meta">${item.qty} items left · Pickup today</div>
          <div class="ticket">
            <div class="price-block">
              <span class="orig-price">৳${item.orig}</span>
              <span class="rescue-price">৳${item.rescue}</span>
            </div>
            <span class="save-pill">${item.discount}</span>
          </div>
          <button class="reserve-btn" onclick="addToCart(${item.id})">Reserve Meal</button>
        </div>
      </div>
    `;

    if (matchesCat && matchesSearch) {
      grid.innerHTML += cardMarkup;
    }

    if (idx < 3 && homeGrid) {
      homeGrid.innerHTML += cardMarkup;
    }

    let badgeClass = item.qty > 5 ? 'active' : item.qty > 0 ? 'low' : 'sold';
    let statusText = item.qty > 5 ? 'Active' : item.qty > 0 ? 'Low Stock' : 'Sold Out';

    tableBody.innerHTML += `
      <tr>
        <td><b>${item.title}</b></td>
        <td>${item.category}</td>
        <td>${item.qty} units</td>
        <td class="rowprice">৳${item.rescue}</td>
        <td><span class="badge ${badgeClass}">${statusText}</span></td>
      </tr>
    `;
  });
}

function renderReviews() {
  const container = document.getElementById('reviews-feed');
  const currentBizName = currentUser && currentUser.role === 'business' ? currentUser.name : 'Spice Trail Kitchen';

  const filtered = reviewsDatabase.filter(r => r.biz.toLowerCase() === currentBizName.toLowerCase());

  if (filtered.length > 0) {
    const avgScore = (filtered.reduce((sum, r) => sum + r.rating, 0) / filtered.length).toFixed(1);
    document.getElementById('biz-avg-rating').innerText = `${avgScore} ★`;
    document.getElementById('review-summary-tag').innerText = `Total Reviews: ${filtered.length} | Avg Rating: ${avgScore} / 5.0`;
  } else {
    document.getElementById('biz-avg-rating').innerText = 'N/A';
    document.getElementById('review-summary-tag').innerText = 'No reviews received yet.';
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--ink-soft); font-size: 13px;">No customer reviews posted yet for ${currentBizName}.</div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(rev => {
    let stars = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);

    let replyHtml = '';
    if (rev.reply) {
      replyHtml = `
        <div class="review-reply">
          <div class="review-reply-title">Owner Response</div>
          <div>${rev.reply}</div>
        </div>
      `;
    } else {
      replyHtml = `
        <div class="reply-input-box">
          <input type="text" id="reply-input-${rev.id}" placeholder="Write a polite public response...">
          <button onclick="submitReviewReply(${rev.id})">Reply</button>
        </div>
      `;
    }

    container.innerHTML += `
      <div class="review-item">
        <div class="review-header">
          <div class="review-author">${rev.author} <span class="review-time">• ${rev.time}</span></div>
          <div class="review-stars">${stars} (${rev.rating}.0)</div>
        </div>
        <div class="review-item-name">Meal Rescued: ${rev.item}</div>
        <div class="review-comment">"${rev.comment}"</div>
        ${replyHtml}
      </div>
    `;
  });
}

function submitReviewReply(reviewId) {
  const input = document.getElementById(`reply-input-${reviewId}`);
  if (!input || !input.value.trim()) return;

  const rev = reviewsDatabase.find(r => r.id === reviewId);
  if (rev) {
    rev.reply = input.value.trim();
    renderReviews();
  }
}

function openReviewModal(orderId) {
  selectedReviewOrder = orderHistory.find(order => order.id === orderId) || null;
  const context = document.getElementById('review-order-context');
  if (selectedReviewOrder) {
    const firstItem = selectedReviewOrder.items[0];
    const businessName = firstItem.biz.replace(/ · Local$/, '');
    const businessSelect = document.getElementById('rev-biz');
    if (![...businessSelect.options].some(option => option.value === businessName)) {
      businessSelect.add(new Option(businessName, businessName));
    }
    businessSelect.value = businessName;
    document.getElementById('rev-item').value = firstItem.title;
    context.innerText = `Reviewing order #${selectedReviewOrder.id}`;
  } else {
    context.innerText = '';
  }
  document.getElementById('review-modal').classList.add('active');
}

async function submitCustomerReview() {
  const biz = document.getElementById('rev-biz').value;
  const item = document.getElementById('rev-item').value.trim();
  const rating = parseInt(document.getElementById('rev-rating').value, 10);
  const comment = document.getElementById('rev-comment').value.trim();

  if (!item || !comment) {
    alert('Please fill in both the meal title and review details.');
    return;
  }

  const newReview = {
    id: `local-${Date.now()}`,
    biz,
    author: currentUser ? currentUser.name : 'Verified Customer',
    rating,
    time: 'Just now',
    item,
    comment,
    reply: null
  };

  try {
    await requestJson(`${API_BASE}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        business_name: biz,
        item_name: item,
        author_name: currentUser ? currentUser.name : 'Verified Customer',
        rating,
        comment
      })
    });
  } catch (error) {
    console.warn('Review backend unavailable, showing review locally:', error.message);
  }

  reviewsDatabase.unshift(newReview);

  alert('Thank you! Your feedback has been submitted to the restaurant.');

  document.getElementById('rev-item').value = '';
  document.getElementById('rev-comment').value = '';
  closeModal('review-modal');

  renderReviews();
  renderHomeReviews();
  selectedReviewOrder = null;
}

function switchBizTab(tabName, el) {
  document.querySelectorAll('.sidebar .navitem').forEach(n => n.classList.remove('on'));
  if (el) el.classList.add('on');

  if (tabName === 'reviews') {
    document.getElementById('biz-tab-overview').style.display = 'none';
    document.getElementById('biz-tab-reviews').style.display = 'block';
    renderReviews();
  } else {
    document.getElementById('biz-tab-overview').style.display = 'block';
    document.getElementById('biz-tab-reviews').style.display = 'none';
  }
}

function addToCart(id) {
  const item = listings.find(l => l.id === id);
  if (item && item.qty > 0) {
    item.qty--;
    cartItems.push({ title: item.title, biz: item.biz, price: item.rescue });
    cartCount++;
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.innerText = cartCount;
    renderListings();
  } else {
    alert('Sorry, this surplus item is sold out!');
  }
}

function filterCategory(cat, el) {
  activeCategory = cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderListings();
}

function filterListings() {
  renderListings();
}

function toggleView(view, btn) {
  document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (view === 'map') {
    document.getElementById('map-view').style.display = 'block';
    document.getElementById('listing-grid').style.display = 'none';
  } else {
    document.getElementById('map-view').style.display = 'none';
    document.getElementById('listing-grid').style.display = 'grid';
  }
}

function showScreen(screenId) {
  if (screenId === 'profile' && !currentUser) {
    screenId = 'login';
  }

  if (screenId === 'business' && (!currentUser || currentUser.role !== 'business')) {
    screenId = 'customer';
  }

  activeScreen = screenId;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  localStorage.setItem('plateup_screen', screenId);

  renderTopNav();
  if (screenId === 'business') {
    renderReviews();
  }
  if (screenId === 'profile') {
    renderProfile();
  }
}

function openNewListingModal() {
  document.getElementById('new-listing-modal').classList.add('active');
}

function openCheckoutModal() {
  if (cartCount === 0) {
    alert('Your rescue cart is empty!');
    return;
  }
  document.getElementById('checkout-summary').innerHTML = `<b>Total Reserved Items:</b> ${cartCount} items`;
  document.getElementById('checkout-modal').classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function submitNewListing() {
  const title = document.getElementById('m-title').value || 'Surplus Box';
  const category = document.getElementById('m-category').value;
  const qty = parseInt(document.getElementById('m-qty').value, 10) || 1;
  const orig = parseInt(document.getElementById('m-orig-price').value, 10) || 300;
  const rescue = parseInt(document.getElementById('m-rescue-price').value, 10) || 120;

  try {
    await requestJson(`${API_BASE}/listings`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        category,
        business_name: currentUser ? currentUser.name : 'Spice Trail Kitchen',
        original_price: orig,
        rescue_price: rescue,
        quantity: qty
      })
    });
  } catch (error) {
    const newItem = {
      id: listings.length + 1,
      title,
      category,
      biz: currentUser ? `${currentUser.name} · Local` : 'Spice Trail Kitchen · Local',
      orig,
      rescue,
      qty,
      discount: `-${Math.round((1 - rescue / orig) * 100)}%`,
      time: 'Ends in 3h',
      aiRecommended: true
    };

    listings.unshift(newItem);
  }

  renderListings();
  closeModal('new-listing-modal');
}

function confirmOrder() {
  if (cartItems.length === 0) return;

  orderHistory.unshift({
    id: `PU-${Date.now().toString().slice(-6)}`,
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    items: cartItems,
    total: cartItems.reduce((total, item) => total + item.price, 0)
  });
  saveOrderHistory();
  alert('Order placed successfully! Please check your order pickup time window.');
  cartCount = 0;
  cartItems = [];
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.innerText = 0;
  closeModal('checkout-modal');
}

restoreSession();
renderTopNav();
const savedScreen = localStorage.getItem('plateup_screen');
if (savedScreen && document.getElementById(savedScreen)) {
  showScreen(savedScreen);
}
loadInitialData();
