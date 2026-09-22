const API_BASE = location.protocol !== 'file:' && location.port !== '5500' ? '/api' :
  'http://' + (location.hostname || 'localhost') + ':5000/api';
let token = localStorage.getItem('plateup_token');
let currentUser = null;
let profile = null;
let listings = [];
let businessListings = [];
let reviews = [];
let orders = [];
let businessOrders = [];
let cartItems = [];
let selectedRole = 'customer';
let activeCategory = 'All';
let activeScreen = 'home';
let editingListingId = null;
let editingReviewId = null;
let selectedReviewOrder = null;
let carouselTimer = null;
let latestListingsRequest = 0;
let listingPreviewUrl = null;

const el = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const money = amount => '৳' + Number(amount || 0).toFixed(2);
const date = value => value ? new Date(value).toLocaleString() : 'Any time';
const offerTime = value => {
  if (!value) return 'Not set';
  const [hour,minute] = value.slice(0,5).split(':').map(Number);
  return (hour % 12 || 12) + ':' + String(minute).padStart(2,'0') + (hour < 12 ? ' AM' : ' PM');
};
const imageUrl = path => path ? API_BASE.replace(/\/api$/,'') + path : '';
const itemThumbnail = item => '<div class="food-thumb">' + (item.image_path
  ? '<img src="' + escapeHtml(imageUrl(item.image_path)) + '" alt="' + escapeHtml(item.title) + '" loading="lazy">'
  : '<span class="initial">' + escapeHtml(item.title.slice(0,2)) + '</span>') + '</div>';

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type':'application/json' }),
        ...(token ? { Authorization:'Bearer ' + token } : {}), ...(options.headers || {}) }
    });
  } catch (error) {
    throw new Error('Cannot connect to PlateUp at ' + API_BASE + '. Run npm start, then open http://localhost:5000/.');
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error('PlateUp API is unavailable at ' + API_BASE + '. Run npm start, then open http://localhost:5000/.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && !path.startsWith('/auth/')) handleLogout();
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

async function fetchListings() {
  const requestId = ++latestListingsRequest;
  const freshListings = await requestJson('/listings', { cache:'no-store' });
  if (requestId !== latestListingsRequest) return;
  listings = freshListings;
  renderListings();
}

async function refreshMarketplace() {
  el('listing-status').textContent = 'Refreshing listings…';
  try { await fetchListings(); }
  catch (error) {
    console.error(error);
    el('listing-status').textContent = 'Could not refresh listings: ' + error.message;
  }
}

async function loadInitialData() {
  try {
    await Promise.all([fetchListings(), requestJson('/reviews').then(data => { reviews = data; })]);
    renderReviews();
    renderHomeReviews();
  } catch (error) { console.error(error); alert('Could not load marketplace data: ' + error.message); }
}

async function loadAccount(throwOnFailure = false) {
  if (!token) return;
  try {
    const data = await requestJson('/me');
    profile = data.profile;
    currentUser = { id:profile.id, name:profile.name, email:profile.email, role:profile.role };
    renderTopNav();
    if (currentUser.role === 'customer') {
      orders = await requestJson('/orders');
      renderProfile();
    } else {
      await loadBusiness();
    }
  } catch (error) {
    if (throwOnFailure) throw error;
    console.warn(error.message);
  }
}

async function loadBusiness() {
  if (!currentUser || currentUser.role !== 'business') return;
  try {
    const [own, incoming, analytics, predictions] = await Promise.all([
      requestJson('/business/listings'), requestJson('/orders'),
      requestJson('/business/analytics'), requestJson('/business/predictions')
    ]);
    businessListings = own;
    businessOrders = incoming;
    renderBusinessOrders();
    renderListings();
    el('biz-active-count').textContent = analytics.summary.active_listings;
    el('biz-meals-count').textContent = analytics.summary.meals_rescued;
    el('biz-revenue').textContent = money(analytics.summary.revenue);
    el('business-sales').innerHTML = analytics.sales.length
      ? analytics.sales.map(s => '<div class="order-row"><strong>' + escapeHtml(s.title) + '</strong><span>' +
        s.quantity_sold + ' sold · ' + money(s.price) + '</span><span>' + date(s.sale_time) + '</span></div>').join('')
      : '<div class="empty-history">No completed sales yet.</div>';
    el('business-predictions').textContent = predictions.length
      ? predictions.map(p => p.prediction_type + ': ' + p.predicted_value).join(' · ')
      : 'No predictions yet. The ML module has not been developed.';
    el('biz-name-text').textContent = profile.business_name || currentUser.name;
    el('biz-avatar-text').textContent = (profile.business_name || currentUser.name).slice(0,2).toUpperCase();
    el('biz-role-text').textContent = 'Business ID: ' + currentUser.id;
    renderReviews();
  } catch (error) { alert('Could not load business data: ' + error.message); }
}
async function refreshBusinessListings() {
  if (currentUser?.role!=='business') return;
  try {
    businessListings=await requestJson('/business/listings',{ cache:'no-store' });
    renderListings();
    el('biz-active-count').textContent=businessListings.filter(item=>item.daily_status==='Active').length;
  } catch(error) { console.error(error); }
}

function switchAuthMode(mode, tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  el('form-login').classList.toggle('active', mode === 'login');
  el('form-signup').classList.toggle('active', mode === 'signup');
  el('auth-title').textContent = mode === 'login' ? 'Welcome Back' : 'Create Account';
  el('auth-desc').textContent = mode === 'login' ? 'Select your account role to continue' : 'Join PlateUp';
  clearAuthBanners();
}
function selectRole(role, element) {
  selectedRole = role;
  document.querySelectorAll('.role-opt').forEach(item => item.classList.remove('selected'));
  element.classList.add('selected');
  el('name-label').textContent = role === 'business' ? 'Business name' : 'Full name';
}
function clearAuthBanners() {
  el('auth-error-banner').style.display = 'none';
  el('auth-success-banner').style.display = 'none';
}
function showAuthError(message) {
  el('auth-error-banner').textContent = message;
  el('auth-error-banner').style.display = 'block';
}
function showAuthSuccess(message) {
  el('auth-success-banner').textContent = message;
  el('auth-success-banner').style.display = 'block';
}
async function handleLogin(event) {
  event.preventDefault(); clearAuthBanners();
  try {
    const data = await requestJson('/auth/login', { method:'POST', body:JSON.stringify({
      email:el('login-email').value.trim(), password:el('login-pass').value, role:selectedRole
    }) });
    token = data.token;
    localStorage.setItem('plateup_token', token);
    await loadAccount(true);
    if (!currentUser) throw new Error('Could not load your account. Please try again.');
    showScreen(currentUser.role === 'business' ? 'business' : 'customer');
  } catch (error) {
    if (!currentUser) {
      token = null;
      localStorage.removeItem('plateup_token');
    }
    showAuthError(error.message);
  }
}
async function handleSignup(event) {
  event.preventDefault(); clearAuthBanners();
  const password = el('signup-pass').value;
  if (password !== el('signup-pass-confirm').value) return showAuthError('Passwords do not match');
  try {
    await requestJson('/auth/signup', { method:'POST', body:JSON.stringify({
      name:el('signup-name').value.trim(), email:el('signup-email').value.trim(), password, role:selectedRole
    }) });
    el('login-email').value = el('signup-email').value.trim();
    el('login-pass').value = '';
    el('form-signup').reset();
    switchAuthMode('login', document.querySelector('.auth-tab'));
    showAuthSuccess('Account created. Sign in to continue.');
  } catch (error) { showAuthError(error.message); }
}
function handleLogout() {
  token = null; currentUser = null; profile = null; orders = []; businessOrders = [];
  businessListings = []; cartItems = [];
  localStorage.removeItem('plateup_token');
  localStorage.removeItem('plateup_user');
  localStorage.removeItem('plateup_screen');
  renderTopNav(); renderListings(); showScreen('home');
}
function renderTopNav() {
  const controls = el('nav-controls');
  const navButton = (screen, label) => '<button class="' + (activeScreen === screen ? 'active' : '') +
    '" aria-current="' + (activeScreen === screen ? 'page' : 'false') +
    '" onclick="showScreen(\'' + screen + '\')">' + label + '</button>';
  const nav = '<div class="switch">' + navButton('home','Home') + navButton('customer','Browse Food') +
    (currentUser?.role === 'business' ? navButton('business','Business Portal') : '') + '</div>';
  controls.innerHTML = nav + (currentUser
    ? (currentUser.role === 'customer' ? '<button class="cart-chip" onclick="openCheckoutModal()">Cart (<span id="cart-count">' +
      cartItems.length + '</span>)</button>' : '') +
      '<button class="profile-nav-btn ' + (activeScreen === 'profile' ? 'active' : '') +
      '" aria-current="' + (activeScreen === 'profile' ? 'page' : 'false') +
      '" onclick="showScreen(\'profile\')">Profile</button>' +
      '<button class="logout-btn" onclick="handleLogout()">Logout</button>'
    : '<button class="btn-pri" onclick="showScreen(\'login\')">Sign In</button>');
}
function showScreen(screen) {
  if (screen === 'profile' && !currentUser) screen = 'login';
  if (screen === 'business' && currentUser?.role !== 'business') screen = 'customer';
  activeScreen = screen;
  localStorage.setItem('plateup_screen', screen);
  document.querySelectorAll('.screen').forEach(item => item.classList.remove('active'));
  el(screen).classList.add('active');
  renderTopNav();
  if (screen === 'profile') renderProfile();
  if (screen === 'business') loadBusiness();
  if (screen === 'home' || screen === 'customer') refreshMarketplace();
}

function renderProfile() {
  if (!currentUser || !profile) return;
  el('profile-avatar').textContent = currentUser.name.slice(0,2).toUpperCase();
  el('profile-name').textContent = currentUser.name;
  el('profile-email').textContent = currentUser.email;
  el('profile-role').textContent = currentUser.role;
  el('profile-member-since').textContent = date(profile.created_at);
  el('profile-edit-name').value = profile.name || '';
  el('profile-edit-phone').value = profile.phone || '';
  el('profile-edit-address').value = profile.customer_address || '';
  el('profile-edit-city').value = profile.customer_city || '';
  el('profile-edit-location').value = profile.preferred_location || '';
  const completed = orders.filter(order => order.status === 'completed');
  el('profile-order-count').textContent = completed.length;
  el('profile-meal-count').textContent = completed.reduce((sum, order) => sum + order.quantity, 0);
  el('order-history').innerHTML = orders.length ? orders.map(order => {
    const review = reviews.find(item => item.order_id === order.id);
    const action = ['pending','confirmed'].includes(order.status)
      ? '<button class="review-order-btn" onclick="changeOrder(' + order.id + ',\'cancelled\')">Cancel</button>'
      : order.status === 'completed'
        ? '<button class="review-order-btn" onclick="openReviewModal(' + order.id + ')">' + (review ? 'Edit review' : 'Leave review') + '</button>' +
          (review ? '<button class="review-order-btn danger-action" onclick="deleteReview(' + review.id + ')">Delete review</button>' : '')
        : '';
    return '<div class="order-row"><div class="order-main"><strong>Order #' + order.id + '</strong><span>' +
      date(order.order_time) + '</span></div><div class="order-items">' + escapeHtml(order.listing_title) +
      ' · ' + escapeHtml(order.business_name) + ' · Qty ' + order.quantity + '</div><div class="order-total"><strong>' +
      money(order.total_price) + '</strong><span class="badge active">' + escapeHtml(order.status) +
      '</span>' + action + '</div></div>';
  }).join('') : '<div class="empty-history">No reservations yet.</div>';
  el('business-profile-name').value = profile.business_name || '';
  el('business-profile-phone').value = profile.business_phone || '';
  el('business-profile-description').value = profile.description || '';
  el('business-profile-address').value = profile.business_address || '';
  el('business-profile-city').value = profile.business_city || '';
  el('business-profile-open').value = (profile.opening_time || '').slice(0,5);
  el('business-profile-close').value = (profile.closing_time || '').slice(0,5);
  el('business-profile-lat').value = profile.latitude ?? '';
  el('business-profile-lon').value = profile.longitude ?? '';
}
async function saveProfile(event) {
  event.preventDefault();
  try {
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('profile-edit-name').value, phone:el('profile-edit-phone').value,
      address:el('profile-edit-address').value, city:el('profile-edit-city').value,
      preferred_location:el('profile-edit-location').value
    }) });
    await loadAccount(); alert('Profile saved.');
  } catch(error) { alert(error.message); }
}
async function saveBusinessProfile(event) {
  event.preventDefault();
  try {
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('business-profile-name').value, business_name:el('business-profile-name').value,
      phone:el('business-profile-phone').value, description:el('business-profile-description').value,
      address:el('business-profile-address').value, city:el('business-profile-city').value,
      opening_time:el('business-profile-open').value, closing_time:el('business-profile-close').value,
      latitude:el('business-profile-lat').value, longitude:el('business-profile-lon').value
    }) });
    await loadAccount(); await loadInitialData(); alert('Business profile saved.');
  } catch(error) { alert(error.message); }
}

function renderListings() {
  const query = el('food-search').value.trim().toLowerCase();
  const city = el('loc-search').value.trim().toLowerCase();
  const filtersActive = activeCategory !== 'All' || Boolean(query || city);
  const visible = listings.filter(item => (activeCategory === 'All' || item.category === activeCategory)
    && (!query || (item.title + ' ' + item.business_name).toLowerCase().includes(query))
    && (!city || !item.city || item.city.toLowerCase().includes(city.split(',')[0])));
  el('listing-status').textContent = visible.length + ' of ' + listings.length + ' available listings' +
    (filtersActive ? ' · Filters active' : '');
  el('clear-listing-filters').hidden = !filtersActive;
  const card = item => '<div class="food-card">' + itemThumbnail(item) + '<div class="food-body"><div class="biz-line">' +
    escapeHtml(item.business_name) + '</div><p class="food-title">' + escapeHtml(item.title) +
    '</p><div class="food-meta">' + item.quantity + ' available · ' + escapeHtml(item.city || 'Pickup') +
    ' · Ends ' + offerTime(item.offer_end_time) + '</div><div class="ticket"><span class="orig-price">' + money(item.original_price) +
    '</span><span class="rescue-price">' + money(item.rescue_price) +
    '</span></div><button class="reserve-btn" onclick="openListingDetails(' + item.id + ')">View details</button></div></div>';
  el('listing-grid').innerHTML = visible.length ? visible.map(card).join('')
    : '<div class="empty-history">No listings match your search.</div>';
  el('home-featured-grid').innerHTML = listings.slice(0,3).map(card).join('');
  el('business-listings').innerHTML = businessListings.length ? businessListings.map(item =>
    '<article class="manage-item">' + itemThumbnail(item) + '<div class="manage-item-content">' +
      '<div class="manage-item-heading"><div><h4>' + escapeHtml(item.title) + '</h4><span>' +
      escapeHtml(item.category) + '</span></div><span class="badge ' +
      (item.daily_status==='Active'?'active':item.daily_status==='Sold Out'?'sold':'low') + '">' +
      escapeHtml(item.daily_status) + '</span></div>' +
      '<p>Original price: <strong>' + money(item.original_price) + '</strong> · Rescue price: <strong>' +
      money(item.rescue_price) + '</strong></p><p>Daily offer: <strong>' +
      offerTime(item.offer_start_time) + ' – ' + offerTime(item.offer_end_time) + '</strong> (Bangladesh time)</p>' +
      (item.offer_date ? '<p>Offer date: <strong>' + escapeHtml(item.offer_date) + '</strong></p>' : '') +
      '<p>Today made available: <strong>' + (item.initial_quantity ?? 'Not entered') +
      '</strong> · Remaining: <strong>' + (item.remaining_quantity ?? '—') + '</strong></p>' +
      '<div class="manage-item-actions"><label for="daily-qty-' + item.id + '">Today\'s total quantity</label>' +
      '<input id="daily-qty-' + item.id + '" type="number" min="0" step="1" value="' +
      (item.initial_quantity ?? '') + '" placeholder="Enter quantity">' +
      '<button id="daily-save-' + item.id + '" class="btn-pri" onclick="submitDailyQuantity(' +
      item.id + ')">Update Today\'s Quantity</button></div>' +
      '<div class="manage-item-links"><button class="review-order-btn" onclick="openEditListingModal(' +
      item.id + ')">Edit Item</button><button class="review-order-btn danger-action" onclick="deleteListing(' +
      item.id + ')">Deactivate</button></div></div></article>').join('')
    : '<div class="empty-history">No food items yet. Add one to start offering it each day.</div>';
}
function filterListings() { renderListings(); }
function filterCategory(category, element) {
  activeCategory = category;
  document.querySelectorAll('.chip').forEach(item => item.classList.remove('on'));
  element.classList.add('on'); renderListings();
}
function clearListingFilters() {
  el('food-search').value = '';
  el('loc-search').value = '';
  activeCategory = 'All';
  document.querySelectorAll('.chip-row .chip').forEach(item => item.classList.remove('on'));
  document.querySelector('.chip-row .chip').classList.add('on');
  renderListings();
}
function openListingDetails(id) {
  const item = listings.find(row => row.id === id);
  if (!item) return;
  el('detail-title').textContent = item.title;
  el('detail-body').innerHTML = (item.image_path ? '<img class="detail-food-image" src="' +
    escapeHtml(imageUrl(item.image_path)) + '" alt="' + escapeHtml(item.title) + '">' : '') +
    '<p>' + escapeHtml(item.description || 'Surplus food available for pickup.') +
    '</p><p><strong>Business:</strong> ' + escapeHtml(item.business_name) +
    '<br><strong>Pickup:</strong> ' + escapeHtml(item.pickup_address || 'Contact business for pickup details') +
    '<br><strong>City:</strong> ' + escapeHtml(item.city || 'Not specified') +
    '<br><strong>Daily offer:</strong> ' + offerTime(item.offer_start_time) + ' – ' +
    offerTime(item.offer_end_time) + ' (Bangladesh time)' +
    '<br><strong>Quantity:</strong> ' + item.quantity +
    '<br><strong>Rescue price:</strong> ' + money(item.rescue_price) + '</p>';
  el('detail-reserve').onclick = () => { addToCart(id); closeModal('listing-detail-modal'); };
  el('listing-detail-modal').classList.add('active');
}
function addToCart(id) {
  if (!currentUser || currentUser.role !== 'customer') return showScreen('login');
  const item = listings.find(row => row.id === id);
  if (!item) return;
  const reserved = cartItems.filter(row => row.listing_id === id).length;
  if (reserved >= item.quantity) return alert('No more units are available.');
  cartItems.push({ listing_id:id,title:item.title,price:Number(item.rescue_price) });
  renderTopNav();
}
function openCheckoutModal() {
  if (!cartItems.length) return alert('Your cart is empty.');
  el('checkout-summary').innerHTML = cartItems.map(item => '<div>' + escapeHtml(item.title) + ' · ' +
    money(item.price) + '</div>').join('') + '<strong>Total: ' +
    money(cartItems.reduce((sum,item)=>sum+item.price,0)) + '</strong>';
  el('checkout-modal').classList.add('active');
}
async function confirmOrder() {
  const counts = new Map();
  cartItems.forEach(item => counts.set(item.listing_id,(counts.get(item.listing_id)||0)+1));
  try {
    await requestJson('/orders', { method:'POST', body:JSON.stringify({
      items:[...counts].map(([listing_id,quantity])=>({ listing_id,quantity })),
      payment_method:el('pay-method').value
    }) });
    cartItems=[]; closeModal('checkout-modal'); renderTopNav();
    orders=await requestJson('/orders'); await loadInitialData(); renderProfile();
    alert('Reservation placed. Track its status in your profile.');
  } catch(error) { alert(error.message); }
}
async function changeOrder(id,status) {
  try {
    await requestJson('/orders/' + id, { method:'PATCH',body:JSON.stringify({ status }) });
    if (currentUser.role === 'business') await loadBusiness();
    else { orders=await requestJson('/orders'); renderProfile(); }
    await loadInitialData();
  } catch(error) { alert(error.message); }
}
function renderBusinessOrders() {
  el('business-orders').innerHTML = businessOrders.length ? businessOrders.map(order => {
    const next = ({ pending:'confirmed',confirmed:'ready',ready:'completed' })[order.status];
    return '<div class="order-row"><strong>#' + order.id + ' · ' + escapeHtml(order.listing_title) +
      '</strong><span>' + order.quantity + ' units · ' + money(order.total_price) +
      '</span><span>' + escapeHtml(order.status) + '</span>' + (next
        ? '<button class="review-order-btn" onclick="changeOrder(' + order.id + ',\'' + next +
          '\')">Mark ' + next + '</button>' : '') + '</div>';
  }).join('') : '<div class="empty-history">No reservations yet.</div>';
}
function switchBizTab(name, element) {
  document.querySelectorAll('.sidebar .navitem').forEach(item => item.classList.remove('on'));
  element.classList.add('on');
  ['overview','orders','analytics','reviews','profile'].forEach(tab => {
    el('biz-tab-' + tab).style.display = tab === name || (name === 'listings' && tab === 'overview') ? 'block' : 'none';
  });
  if (name === 'profile') renderProfile();
  if (name === 'listings') loadBusiness();
}
function openNewListingModal() {
  editingListingId=null;
  ['m-title','m-description','m-orig-price','m-rescue-price','m-image'].forEach(id=>el(id).value='');
  el('m-category').value='Bakery';
  el('m-start').value='20:00'; el('m-end').value='00:00';
  el('listing-modal-title').textContent='Add Food Item';
  el('listing-submit-btn').textContent='Save Food Item';
  setFoodImagePreview(null);
  el('listing-feedback').hidden=true;
  el('new-listing-modal').classList.add('active');
}
function openEditListingModal(id) {
  const item=businessListings.find(row=>row.id===id);
  if (!item) return;
  editingListingId=id;
  el('m-title').value=item.title; el('m-category').value=item.category;
  el('m-description').value=item.description||'';
  el('m-orig-price').value=item.original_price; el('m-rescue-price').value=item.rescue_price;
  el('m-start').value=item.offer_start_time?.slice(0,5)||'';
  el('m-end').value=item.offer_end_time?.slice(0,5)||'';
  el('m-image').value='';
  setFoodImagePreview(item.image_path ? imageUrl(item.image_path) : null);
  el('listing-modal-title').textContent='Edit Food Item';
  el('listing-submit-btn').textContent='Save Item Changes';
  el('listing-feedback').hidden=true;
  el('new-listing-modal').classList.add('active');
}
function setFoodImagePreview(src) {
  if (listingPreviewUrl) URL.revokeObjectURL(listingPreviewUrl);
  listingPreviewUrl=null;
  el('m-image-preview').hidden=!src;
  el('m-image-preview').src=src||'';
}
function previewFoodImage() {
  const file=el('m-image').files[0];
  if (!file) {
    const existing=businessListings.find(item=>item.id===editingListingId);
    return setFoodImagePreview(existing?.image_path ? imageUrl(existing.image_path) : null);
  }
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {
    el('listing-feedback').textContent='Choose a JPG, PNG, or WebP image of 5 MB or less.';
    el('listing-feedback').hidden=false;
    el('m-image').value='';
    return;
  }
  setFoodImagePreview(null);
  listingPreviewUrl=URL.createObjectURL(file);
  el('m-image-preview').src=listingPreviewUrl;
  el('m-image-preview').hidden=false;
  el('listing-feedback').hidden=true;
}
async function submitNewListing() {
  const errorBox=el('listing-feedback');
  const showError=message=>{ errorBox.textContent=message; errorBox.hidden=false; };
  errorBox.hidden=true;
  const title=el('m-title').value.trim();
  const original=Number(el('m-orig-price').value);
  const rescue=Number(el('m-rescue-price').value);
  if (!title || !el('m-orig-price').value || !el('m-rescue-price').value ||
    !Number.isFinite(original) || original<0 || !Number.isFinite(rescue) || rescue<0 || rescue>original ||
    !el('m-start').value || !el('m-end').value) {
    return showError('Enter a title, valid prices, and daily offer start/end times. Rescue price cannot exceed original price.');
  }
  const payload=new FormData();
  Object.entries({ title,category:el('m-category').value,description:el('m-description').value,
    original_price:original,rescue_price:rescue,offer_start_time:el('m-start').value,
    offer_end_time:el('m-end').value }).forEach(([key,value])=>payload.append(key,value));
  if (el('m-image').files[0]) payload.append('image',el('m-image').files[0]);
  const button=el('listing-submit-btn');
  button.disabled=true;
  button.textContent='Saving…';
  try {
    await requestJson('/listings' + (editingListingId ? '/' + editingListingId : ''), {
      method:editingListingId?'PUT':'POST',body:payload
    });
    const message=editingListingId ? 'Food item updated.' :
      'Food item saved. Enter today\'s quantity below to make it available during its offer window.';
    closeModal('new-listing-modal');
    await loadInitialData(); await loadBusiness();
    switchBizTab('listings', document.querySelector('[data-biz-tab="listings"]'));
    el('business-feedback').textContent=message;
    el('business-feedback').hidden=false;
  } catch(error) { showError(error.message); }
  finally {
    button.disabled=false;
    button.textContent=editingListingId ? 'Save Item Changes' : 'Save Food Item';
  }
}
async function submitDailyQuantity(id) {
  const input=el('daily-qty-'+id);
  const value=Number(input.value);
  if (input.value==='' || !Number.isSafeInteger(value) || value<0) {
    el('business-feedback').textContent='Enter a non-negative whole-number quantity.';
    el('business-feedback').hidden=false;
    return;
  }
  const button=el('daily-save-'+id);
  button.disabled=true; button.textContent='Saving…';
  try {
    await requestJson('/listings/'+id+'/today',{
      method:'PUT',body:JSON.stringify({ initial_quantity:value })
    });
    await loadBusiness(); await fetchListings();
    el('business-feedback').textContent='Today\'s quantity updated.';
    el('business-feedback').hidden=false;
  } catch(error) {
    el('business-feedback').textContent=error.message;
    el('business-feedback').hidden=false;
    button.disabled=false; button.textContent='Update Today\'s Quantity';
  }
}
async function deleteListing(id) {
  if (!confirm('Deactivate this food item? Its order and daily history will remain.')) return;
  try { await requestJson('/listings/' + id,{ method:'DELETE' }); await loadInitialData(); await loadBusiness(); }
  catch(error) { alert(error.message); }
}
function closeModal(id) {
  el(id).classList.remove('active');
  if (id==='new-listing-modal' && listingPreviewUrl) {
    URL.revokeObjectURL(listingPreviewUrl); listingPreviewUrl=null;
  }
}

function renderReviews() {
  const name=profile?.business_name;
  const own=reviews.filter(review=>review.business_id===currentUser?.id && currentUser?.role==='business');
  const avg=own.length ? (own.reduce((sum,review)=>sum+Number(review.rating),0)/own.length).toFixed(1) : 'N/A';
  el('biz-avg-rating').textContent=avg==='N/A'?avg:avg+' ★';
  el('review-summary-tag').textContent=own.length+' reviews';
  el('reviews-feed').innerHTML=own.length ? own.map(review =>
    '<div class="review-item"><strong>' + escapeHtml(review.author_name) + '</strong> · ' +
    Number(review.rating) + ' ★<p>' + escapeHtml(review.comment) + '</p><small>' +
    escapeHtml(review.item_name) + '</small>' + (review.reply
      ? '<div class="review-reply">' + escapeHtml(review.reply) + '</div>'
      : '<div class="reply-input-box"><input id="reply-input-' + review.id +
        '" placeholder="Public reply"><button onclick="submitReviewReply(' + review.id +
        ')">Reply</button></div>') + '</div>').join('')
    : '<div class="empty-history">No reviews yet.</div>';
}
function renderHomeReviews() {
  const publicReviews=reviews.slice(0,6);
  el('home-reviews-carousel').innerHTML=publicReviews.length
    ? publicReviews.map((review,index)=>'<article class="home-review-slide ' +
      (index===0?'active':'') + '"><div class="home-review-stars">' +
      '★'.repeat(Number(review.rating)) + '</div><blockquote>“' +
      escapeHtml(review.comment) + '”</blockquote><div class="home-review-author"><strong>' +
      escapeHtml(review.author_name) + '</strong><span>' + escapeHtml(review.business_name) +
      '</span></div></article>').join('')
    : '<div class="empty-history">No reviews yet.</div>';
  el('review-carousel-dots').innerHTML=publicReviews.map((_,index)=>
    '<button aria-label="Show review ' + (index+1) + '" onclick="showReviewSlide(' + index + ')"></button>').join('');
  if (carouselTimer) clearInterval(carouselTimer);
  if (publicReviews.length>1) carouselTimer=setInterval(()=>{
    const slides=[...document.querySelectorAll('.home-review-slide')];
    const active=slides.findIndex(slide=>slide.classList.contains('active'));
    showReviewSlide((active+1)%slides.length);
  },5000);
}
function showReviewSlide(index) {
  document.querySelectorAll('.home-review-slide').forEach((slide,i)=>slide.classList.toggle('active',i===index));
  document.querySelectorAll('#review-carousel-dots button').forEach((dot,i)=>dot.classList.toggle('active',i===index));
}
async function submitReviewReply(id) {
  try {
    await requestJson('/reviews/' + id + '/reply',{ method:'PATCH',
      body:JSON.stringify({ reply:el('reply-input-' + id).value }) });
    reviews=await requestJson('/reviews'); renderReviews(); renderHomeReviews();
  } catch(error) { alert(error.message); }
}
function openReviewModal(orderId) {
  selectedReviewOrder=orders.find(order=>order.id===orderId);
  if (!selectedReviewOrder || selectedReviewOrder.status!=='completed') return;
  const existing=reviews.find(review=>review.order_id===orderId);
  editingReviewId=existing?.id||null;
  el('review-order-context').textContent=selectedReviewOrder.listing_title +
    ' from ' + selectedReviewOrder.business_name;
  el('rev-rating').value=existing?.rating||5;
  el('rev-comment').value=existing?.comment||'';
  el('review-modal').classList.add('active');
}
async function submitCustomerReview() {
  if (!selectedReviewOrder) return;
  try {
    await requestJson('/reviews' + (editingReviewId?'/'+editingReviewId:''),{
      method:editingReviewId?'PUT':'POST',
      body:JSON.stringify({ order_id:selectedReviewOrder.id,rating:Number(el('rev-rating').value),
        comment:el('rev-comment').value })
    });
    closeModal('review-modal'); reviews=await requestJson('/reviews');
    renderProfile(); renderHomeReviews();
  } catch(error) { alert(error.message); }
}
async function deleteReview(id) {
  if (!confirm('Delete your review?')) return;
  try {
    await requestJson('/reviews/' + id, { method:'DELETE' });
    reviews=await requestJson('/reviews'); renderProfile(); renderHomeReviews();
  } catch(error) { alert(error.message); }
}

renderTopNav();
loadInitialData();
loadAccount().then(()=>{
  const savedScreen = localStorage.getItem('plateup_screen') || 'home';
  const target = currentUser || ['home','customer','login'].includes(savedScreen) ? savedScreen : 'home';
  showScreen(target);
});
function refreshVisibleData() {
  if (document.visibilityState==='hidden') return;
  if (activeScreen==='home' || activeScreen==='customer') refreshMarketplace();
  if (activeScreen==='business') refreshBusinessListings();
}
window.addEventListener('focus',refreshVisibleData);
setInterval(refreshVisibleData,30000);
