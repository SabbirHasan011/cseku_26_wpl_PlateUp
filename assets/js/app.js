const API_BASE = location.protocol !== 'file:' && location.port !== '5500' ? '/api' :
  'http://' + (location.hostname || 'localhost') + ':5000/api';
let token = localStorage.getItem('plateup_token');
let currentUser = null;
let profile = null;
let listings = [];
let restaurants = [];
let selectedRestaurantId = null;
let selectedRestaurant = null;
let restaurantListings = [];
let latestRestaurantsRequest = 0;
let latestRestaurantRequest = 0;
let businessListings = [];
let reviews = [];
let orders = [];
let businessOrders = [];
let cartItems = [];
let selectedRole = 'customer';
let activeCategory = 'All';
let activeScreen = 'home';
let editingListingId = null;
let foodCategories = [];
let latestCategoryRequest = 0;
let listingEditorVersion = 0;
let offerTimeDraft = null;
let editingReviewId = null;
let selectedReviewOrder = null;
let carouselTimer = null;
let homeBannerIndex = 0;
let homeBannerTimer = null;
let homeBannerPaused = false;
let homeBannerHovered = false;
let latestListingsRequest = 0;
let listingPreviewUrl = null;
let detailItem = null;
let detailReturnFocus = null;
let latestDetailRequest = 0;
let cities = [];
let notifications = [];
let unreadNotifications = 0;
let activityRefreshing = false;
let selectedPickupOrder = null;
let cartQuote = null;
let cartQuoteRequest = 0;
let orderSubmitting = false;
let cartReturnFocus = null;
let cartToastTimer = null;

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
function itemRating(item) {
  const count = Number(item.review_count) || 0;
  const rating = count ? Math.max(0, Math.min(5, Number(item.average_rating) || 0)) : 0;
  const label = count ? rating.toFixed(1) + ' out of 5 from ' + count + ' review' + (count === 1 ? '' : 's') : 'No reviews yet';
  const stars = Array.from({ length:5 }, (_,index) => '<span class="rating-star"><span class="rating-fill" style="width:' +
    Math.max(0,Math.min(100,(rating-index)*100)) + '%">&#9733;</span>&#9733;</span>').join('');
  return '<div class="item-rating" aria-label="' + label + '"><span class="rating-stars" aria-hidden="true">' +
    stars + '</span><span class="rating-caption">' + (count ? '<strong>' + rating.toFixed(1) +
    '</strong> (' + count + ' review' + (count === 1 ? '' : 's') + ')' : 'No reviews yet') + '</span></div>';
}
const profileCity = () => currentUser?.role === 'business' ? profile?.business_city : profile?.customer_city;
const normalizedCity = value => (value || '').trim().replace(/\s+/g,' ').toLowerCase();
async function loadCities() {
  if (cities.length) return;
  cities=await requestJson('/cities');
  el('city-options').innerHTML=cities.map(city=>'<option value="'+escapeHtml(city.name)+'"></option>').join('');
}
function selectedCityId(inputId) {
  const value=normalizedCity(el(inputId).value);
  if (!value) return null;
  const city=cities.find(city=>normalizedCity(city.name)===value || city.aliases?.includes(value));
  if (!city) throw new Error('Choose a city from the suggestions.');
  el(inputId).value=city.name;
  return city.id;
}
function openCitySettings() {
  if (!currentUser) return showScreen('login');
  if (currentUser.role === 'business') {
    showScreen('business'); switchBizTab('profile',el('business-profile-nav'));
  } else showScreen('profile');
}

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
    if (response.status===404) {
      throw new Error('The server at ' + API_BASE + ' is missing ' + path +
        '. An older backend may still be running. Stop the existing server with Ctrl+C, then run npm start again.');
    }
    throw new Error('Expected an API response from ' + API_BASE + path + ', but received a web page (HTTP ' +
      response.status + '). Open PlateUp using the address printed by npm start.');
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
  if (detailItem && el('listing-detail-modal').classList.contains('active')) {
    detailItem = listings.find(item => item.id === detailItem.id) || { ...detailItem,quantity:0 };
    updateDetailQuantity();
  }
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
    await loadCities();
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
    await refreshNotifications();
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
  restaurants=[]; selectedRestaurantId=null; selectedRestaurant=null; restaurantListings=[];
  latestRestaurantsRequest++; latestRestaurantRequest++;
  notifications=[]; unreadNotifications=0; cartQuote=null; cartQuoteRequest++;
  selectedPickupOrder=null;
  closeModal('notifications-modal'); closeModal('pickup-modal');
  listings = []; latestListingsRequest++;
  closeModal('listing-detail-modal'); closeModal('checkout-modal');
  clearTimeout(cartToastTimer); el('cart-toast').hidden=true;
  localStorage.removeItem('plateup_token');
  localStorage.removeItem('plateup_user');
  localStorage.removeItem('plateup_screen');
  renderTopNav(); renderListings(); showScreen('home');
}
function renderTopNav() {
  const controls = el('nav-controls');
  const navScreen = ['restaurants','restaurant'].includes(activeScreen) ? 'customer' : activeScreen;
  const navButton = (screen, label) => '<button class="' + (navScreen === screen ? 'active' : '') +
    '" aria-current="' + (navScreen === screen ? 'page' : 'false') +
    '" onclick="showScreen(\'' + screen + '\')">' + label + '</button>';
  const nav = '<div class="switch">' + navButton('home','Home') + navButton('customer','Browse Food') +
    (currentUser?.role === 'business' ? navButton('business','Business Portal') : '') + '</div>';
  controls.innerHTML = nav + (currentUser
    ? (currentUser.role === 'customer' ? '<button id="cart-open" class="cart-chip" onclick="openCheckoutModal()">Cart (<span id="cart-count">' +
      cartItems.length + '</span>)</button>' : '') +
      '<button class="notification-nav" onclick="openNotifications()" aria-label="Notifications, '+unreadNotifications+' unread">Updates <span id="notification-count">'+unreadNotifications+'</span></button>' +
      '<button class="profile-nav-btn ' + (activeScreen === 'profile' ? 'active' : '') +
      '" aria-current="' + (activeScreen === 'profile' ? 'page' : 'false') +
      '" onclick="showScreen(\'profile\')">Profile</button>' +
      '<button class="logout-btn" onclick="handleLogout()">Logout</button>'
    : '<button class="btn-pri" onclick="showScreen(\'login\')">Sign In</button>');
}
function showScreen(screen) {
  if (screen === 'restaurant' && !selectedRestaurantId) screen = 'restaurants';
  if (screen==='profile' && currentUser?.role==='business') {
    showScreen('business'); switchBizTab('profile',el('business-profile-nav')); return;
  }
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
  if (screen === 'restaurants') loadRestaurants();
  if (screen === 'restaurant') loadRestaurant();
}

async function loadRestaurants() {
  const requestId=++latestRestaurantsRequest, session=token;
  el('restaurant-directory-status').textContent='Loading restaurants…';
  try {
    const data=await requestJson('/restaurants',{ cache:'no-store' });
    if (requestId!==latestRestaurantsRequest || session!==token) return;
    restaurants=data; renderRestaurants();
  } catch(error) {
    if (requestId!==latestRestaurantsRequest || session!==token) return;
    restaurants=[]; el('restaurant-grid').innerHTML='';
    el('restaurant-directory-status').textContent='Could not load restaurants: '+error.message;
  }
}
function renderRestaurants() {
  const query=el('restaurant-search').value.trim().toLowerCase();
  const visible=restaurants.filter(item=>(item.business_name+' '+(item.city||'')).toLowerCase().includes(query));
  el('restaurant-directory-status').textContent=visible.length+' restaurant'+(visible.length===1?'':'s')+
    ' · Meals are available for pickup in your profile city.';
  el('restaurant-grid').innerHTML=visible.length ? visible.map(item=>
    '<button type="button" class="restaurant-card" onclick="openRestaurant('+item.id+')" aria-label="View '+escapeHtml(item.business_name)+'">'+
    '<span class="restaurant-card-top"><span class="restaurant-monogram" aria-hidden="true">'+escapeHtml(item.business_name.slice(0,2).toUpperCase())+
    '</span><span class="restaurant-city">'+escapeHtml(item.city||'City not set')+'</span></span>'+
    '<span class="restaurant-card-name">'+escapeHtml(item.business_name)+'</span>'+itemRating(item)+
    '<span class="restaurant-card-description">'+escapeHtml(item.description||'Discover surplus meals from this PlateUp kitchen.')+'</span>'+
    '<span class="restaurant-card-footer"><span>'+escapeHtml(item.address||'Restaurant pickup')+'</span><strong>View meals ↗</strong></span></button>'
  ).join('') : '<div class="feed-empty"><strong>'+ (query ? 'No restaurants match your search.' : 'No restaurants registered yet.')+'</strong><p>'+
    (query ? 'Try another restaurant name or city.' : 'Check back as more kitchens join PlateUp.')+'</p></div>';
}
function openRestaurant(id) {
  selectedRestaurantId=id; selectedRestaurant=null; restaurantListings=[];
  el('restaurant-food-search').value='';
  el('restaurant-profile').innerHTML=''; el('restaurant-menu-grid').innerHTML='';
  showScreen('restaurant');
}
async function loadRestaurant() {
  if (!selectedRestaurantId) return;
  const id=selectedRestaurantId, requestId=++latestRestaurantRequest, session=token;
  el('restaurant-menu-status').textContent='Loading restaurant menu…';
  try {
    const data=await requestJson('/restaurants/'+id,{ cache:'no-store' });
    if (requestId!==latestRestaurantRequest || id!==selectedRestaurantId || session!==token) return;
    selectedRestaurant=data.restaurant; restaurantListings=data.listings;
    const item=selectedRestaurant;
    el('restaurant-profile').innerHTML='<div class="restaurant-profile-card"><div class="restaurant-monogram" aria-hidden="true">'+
      escapeHtml(item.business_name.slice(0,2).toUpperCase())+'</div><div class="restaurant-profile-copy"><p class="profile-label">A PlateUp kitchen</p><h1>'+
      escapeHtml(item.business_name)+'</h1>'+itemRating(item)+'<p>'+escapeHtml(item.description||'Good food from a local kitchen. Browse today’s available rescue meals below.')+
      '</p><div class="restaurant-profile-meta"><span>'+escapeHtml([item.address,item.city].filter(Boolean).join(' · ')||'Pickup location not set')+'</span>'+
      (item.opening_time && item.closing_time ? '<span>Business hours: '+offerTime(item.opening_time)+' – '+offerTime(item.closing_time)+' · Bangladesh time</span>' : '')+
      '</div></div><span class="restaurant-pickup-tag">Pickup at restaurant</span></div>';
    renderRestaurantMenu();
    if (detailItem?.business_id===id && el('listing-detail-modal').classList.contains('active')) {
      detailItem=restaurantListings.find(item=>item.id===detailItem.id)||{ ...detailItem,quantity:0 };
      updateDetailQuantity();
    }
  } catch(error) {
    if (requestId!==latestRestaurantRequest || id!==selectedRestaurantId || session!==token) return;
    selectedRestaurant=null; restaurantListings=[];
    el('restaurant-profile').innerHTML=''; el('restaurant-menu-grid').innerHTML='';
    el('restaurant-menu-status').textContent='Could not load restaurant: '+error.message;
  }
}
function renderRestaurantMenu() {
  if (!selectedRestaurant) return;
  const query=el('restaurant-food-search').value.trim().toLowerCase();
  const visible=restaurantListings.filter(item=>[item.title,item.description,item.category].join(' ').toLowerCase().includes(query));
  el('restaurant-menu-status').textContent=visible.length+' of '+restaurantListings.length+' meals available now · Prices per portion';
  const city=profileCity();
  const needsCity=!currentUser || !city || normalizedCity(city)!==normalizedCity(selectedRestaurant.city);
  el('restaurant-menu-grid').innerHTML=visible.length ? visible.map(foodCard).join('') :
    '<div class="feed-empty"><strong>'+ (query && restaurantListings.length ? 'No meals match your search.' : 'No meals available to reserve right now.')+
    '</strong><p>'+ (!currentUser ? 'Sign in and save your city to see meals available for local pickup.' : !city ?
    'Set your profile city to see meals available for local pickup.' : needsCity ? 'This restaurant is in another city. Only meals in your profile city are shown.' :
    query && restaurantListings.length ? 'Try a different meal name or category.' : 'Meals appear during their daily offer window while portions remain. Check back soon.')+'</p>'+
    (needsCity ? '<button class="btn-sec" onclick="openCitySettings()">'+(!currentUser?'Sign in':'Update my city')+'</button>' : '')+'</div>';
}

function foodCard(item) {
  return '<div class="food-card">' + itemThumbnail(item) + '<div class="food-body"><div class="biz-line">' +
    escapeHtml(item.business_name) + '</div><p class="food-title">' + escapeHtml(item.title) +
    '</p>' + itemRating(item) + '<div class="food-meta">' + item.quantity + ' available · ' + escapeHtml(item.city || 'Pickup') +
    ' · Ends ' + offerTime(item.offer_end_time) + '</div><div class="ticket"><span class="orig-price">' + money(item.original_price) +
    '</span><span class="rescue-price">' + money(item.rescue_price) +
    '</span></div><button class="reserve-btn" onclick="openListingDetails(' + item.id + ')">View details</button></div></div>';
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
      ' · ' + escapeHtml(order.business_name) + ' · Qty ' + order.quantity +
      (order.pickup_code ? '<div class="pickup-code"><span>Show this code at pickup</span><strong>'+escapeHtml(order.pickup_code)+'</strong></div>' : '') +
      '</div><div class="order-total"><strong>' +
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
    const cityId=selectedCityId('profile-edit-city');
    const cityChanged = Number(profile.customer_city_id||0)!==Number(cityId||0);
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('profile-edit-name').value, phone:el('profile-edit-phone').value,
      address:el('profile-edit-address').value, city_id:cityId,
      preferred_location:el('profile-edit-location').value
    }) });
    if (cityChanged) {
      cartItems = []; cartQuote=null; cartQuoteRequest++; listings = []; latestListingsRequest++;
      closeModal('listing-detail-modal'); closeModal('checkout-modal'); renderListings();
    }
    await loadAccount(); await fetchListings();
    alert(cityChanged ? 'Profile saved. Your feed now uses your updated city, and your cart has been cleared.' : 'Profile saved.');
  } catch(error) { alert(error.message); }
}
async function saveBusinessProfile(event) {
  event.preventDefault();
  try {
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('business-profile-name').value, business_name:el('business-profile-name').value,
      phone:el('business-profile-phone').value, description:el('business-profile-description').value,
      address:el('business-profile-address').value, city_id:selectedCityId('business-profile-city'),
      opening_time:el('business-profile-open').value, closing_time:el('business-profile-close').value,
      latitude:el('business-profile-lat').value, longitude:el('business-profile-lon').value
    }) });
    await loadAccount(); await loadInitialData(); alert('Business profile saved.');
  } catch(error) { alert(error.message); }
}

function renderListings() {
  const query = el('food-search').value.trim().toLowerCase();
  const city = profileCity()?.trim();
  el('loc-search').value = city || '';
  el('loc-search').readOnly = true;
  el('loc-search').placeholder = currentUser ? 'Set your profile city' : 'Sign in to find nearby food';
  el('loc-search').setAttribute('aria-label','Your profile city');
  const filtersActive = activeCategory !== 'All' || Boolean(query);
  const visible = listings.filter(item => (activeCategory === 'All' || item.category === activeCategory)
    && (!query || (item.title + ' ' + item.business_name).toLowerCase().includes(query)));
  el('listing-status').textContent = visible.length + ' of ' + listings.length + ' available listings' +
    (filtersActive ? ' · Filters active' : '');
  el('clear-listing-filters').hidden = !filtersActive;
  const empty = '<div class="empty-history feed-empty"><strong>' + (!currentUser ? 'Find food in your city' : !city ?
    'Where would you like to pick up?' : 'No available meals ' + (filtersActive ? 'match your filters' : 'in ' + escapeHtml(city))) +
    '</strong><p>' + (!currentUser ? 'Sign in and save your city to discover local meals.' : !city ?
    'Add your city to your profile to see food from local restaurants.' : 'Try again when restaurants add portions during their offer hours.') +
    '</p><button class="btn-sec" onclick="openCitySettings()">' + (!currentUser ? 'Sign in' : city ? 'Change city' : 'Set my city') + '</button></div>';
  el('listing-grid').innerHTML = visible.length ? visible.map(foodCard).join('') : empty;
  el('home-featured-grid').innerHTML = listings.length ? listings.slice(0,3).map(foodCard).join('') : empty;
  el('business-item-count').textContent = businessListings.length;
  el('business-listings').innerHTML = businessListings.length ? businessListings.map(item =>
    '<article class="manage-item">' +
      '<div class="manage-item-top">' + itemThumbnail(item) + '<div class="manage-item-heading"><span class="manage-category">' +
      escapeHtml(item.category) + '</span><h4>' + escapeHtml(item.title) + '</h4>' + itemRating(item) + '</div></div>' +
      '<div class="manage-item-facts"><div><span class="manage-label">Price per portion</span><div class="manage-prices"><strong>' +
      money(item.rescue_price) + '</strong><del title="Original price">' + money(item.original_price) + '</del></div></div>' +
      '<div><span class="manage-label">Daily offer</span><strong class="manage-window">' + offerTime(item.offer_start_time) +
      ' – ' + offerTime(item.offer_end_time) + '</strong></div></div>' +
      '<div class="manage-inventory"><div><span>Made available</span><strong>' + (item.initial_quantity ?? '—') +
      '</strong></div><div><span>Remaining</span><strong>' + (item.remaining_quantity ?? '—') + '</strong></div>' +
      '<span class="badge ' + (item.daily_status==='Active'?'active':item.daily_status==='Sold Out'?'sold':
        item.daily_status==='Scheduled for Today'?'low':'neutral') + '">' + escapeHtml(item.daily_status) + '</span></div>' +
      '<div class="manage-item-actions"><label for="daily-qty-' + item.id + '">Today\'s total quantity</label>' +
      '<input id="daily-qty-' + item.id + '" type="number" inputmode="numeric" min="0" step="1" value="' +
      (item.initial_quantity ?? '') + '" placeholder="Portions">' +
      '<button id="daily-save-' + item.id + '" class="btn-pri" onclick="submitDailyQuantity(' +
      item.id + ')">Update Today\'s Quantity</button></div>' +
      '<div class="manage-item-footer"><span class="manage-date">' + (item.offer_date ? 'Offer date · ' + escapeHtml(item.offer_date) : 'No quantity set today') +
      '</span><div class="manage-item-links"><button class="review-order-btn" onclick="openEditListingModal(' +
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
async function openListingDetails(id) {
  const requestId = ++latestDetailRequest;
  try {
    const { listing:item } = await requestJson('/listings/' + id,{ cache:'no-store' });
    if (requestId !== latestDetailRequest) return;
    detailReturnFocus = document.activeElement;
    detailItem = item;
    const index = listings.findIndex(row => row.id === id);
    if (index >= 0) listings[index] = item;
    el('detail-title').textContent = item.title;
    el('detail-category').textContent = item.category + ' / Rescue meal';
    const savings = Number(item.original_price) > 0 ? Math.round((1-Number(item.rescue_price)/Number(item.original_price))*100) : 0;
    el('detail-media').innerHTML = (item.image_path ? '<img src="' + escapeHtml(imageUrl(item.image_path)) +
      '" alt="' + escapeHtml(item.title) + '">' : '<div class="detail-placeholder"><span aria-hidden="true">&#127858;</span><span>A good meal. A little less waste.</span></div>') +
      (savings > 0 ? '<span class="detail-savings">Save ' + savings + '%</span>' : '');
    el('detail-body').innerHTML = itemRating(item) + '<p class="detail-description">' +
      escapeHtml(item.description || 'A delicious surplus meal, ready for a second chance. Collect it directly from the restaurant.') +
      '</p><div class="detail-price"><strong>' + money(item.rescue_price) + '</strong><span>per portion</span>' +
      '<del>' + money(item.original_price) + '</del></div><div class="detail-pickup"><div><span class="detail-label">Pick up from</span><strong>' +
      escapeHtml(item.business_name) + '</strong><p>' + escapeHtml(item.pickup_address || 'Ask the restaurant for pickup directions') +
      ' · ' + escapeHtml(item.city) + '</p></div><div><span class="detail-label">Offer window</span><strong>' +
      offerTime(item.offer_start_time) + ' – ' + offerTime(item.offer_end_time) +
      '</strong><p>Bangladesh time' + (item.offer_end_time <= item.offer_start_time ? ' · Ends the next day' : '') + '</p></div></div>';
    el('detail-quantity').value = '1';
    updateDetailQuantity();
    el('listing-detail-modal').classList.add('active');
    document.body.classList.add('meal-dialog-open');
    el('detail-close').focus();
  } catch (error) {
    if (requestId !== latestDetailRequest) return;
    alert('This meal is no longer available: ' + error.message);
    await refreshMarketplace();
  }
}
function detailAvailableQuantity() {
  if (!detailItem) return 0;
  return Math.max(0,Number(detailItem.quantity) - cartItems.filter(row => row.listing_id === detailItem.id).length);
}
function updateDetailQuantity() {
  if (!detailItem) return;
  const available = detailAvailableQuantity();
  const quantity = Number(el('detail-quantity').value);
  const valid = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= available;
  el('detail-quantity').max = String(available);
  el('detail-quantity').disabled = available === 0;
  el('detail-minus').disabled = !available || quantity <= 1;
  el('detail-plus').disabled = !available || quantity >= available;
  el('detail-stock').textContent = available + ' portion' + (available === 1 ? '' : 's') + ' available to add' +
    (Number(detailItem.quantity) > available ? ' · Your cart is already counted' : '');
  el('detail-total').textContent = money(valid ? quantity * Number(detailItem.rescue_price) : 0);
  el('detail-feedback').textContent = !available ? 'No more portions can be added. Check your cart or browse another meal.' :
    !valid ? 'Choose a whole number from 1 to ' + available + '.' : '';
  el('detail-reserve').disabled = !valid || currentUser?.role !== 'customer';
  el('detail-reserve').textContent = currentUser?.role === 'customer' ? 'Add to reservation' : 'Customer account required';
}
function stepDetailQuantity(delta) {
  const available = detailAvailableQuantity();
  if (!available) return;
  const current = Number(el('detail-quantity').value) || 1;
  el('detail-quantity').value = String(Math.max(1,Math.min(available,Math.trunc(current)+delta)));
  updateDetailQuantity();
}
function reserveDetail(event) {
  event.preventDefault();
  if (!detailItem) return;
  updateDetailQuantity();
  if (el('detail-reserve').disabled) return;
  const quantity=Number(el('detail-quantity').value);
  if (addToCart(detailItem.id,quantity)) {
    closeModal('listing-detail-modal');
    el('cart-toast-message').textContent=quantity+' portion'+(quantity===1?'':'s')+' added to your cart';
    el('cart-toast').hidden=false;
    clearTimeout(cartToastTimer);
    cartToastTimer=setTimeout(()=>{ el('cart-toast').hidden=true; },4500);
  }
}
function addToCart(id,quantity = 1) {
  if (orderSubmitting) return false;
  if (!currentUser || currentUser.role !== 'customer') { showScreen('login'); return false; }
  const item = detailItem?.id === id ? detailItem : listings.find(row => row.id === id);
  if (!item) return false;
  const reserved = cartItems.filter(row => row.listing_id === id).length;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity + reserved > Number(item.quantity)) {
    alert('Choose a whole number of portions within the available stock.'); return false;
  }
  for (let i = 0; i < quantity; i++) cartItems.push({ listing_id:id,title:item.title,price:Number(item.rescue_price),
    image_path:item.image_path,business_name:item.business_name });
  cartQuote=null; cartQuoteRequest++;
  renderTopNav();
  return true;
}
function groupedCart() {
  const grouped = new Map();
  cartItems.forEach(item => {
    if (!grouped.has(item.listing_id)) grouped.set(item.listing_id,{ ...item,quantity:0,total:0 });
    const row = grouped.get(item.listing_id); row.quantity++; row.total += item.price;
  });
  return [...grouped.values()];
}
function renderCart() {
  const grouped=groupedCart();
  el('cart-portion-count').textContent=cartItems.length;
  el('cart-item-summary').textContent=grouped.length+' meal'+(grouped.length===1?'':'s')+' · '+cartItems.length+' portion'+(cartItems.length===1?'':'s');
  el('cart-grand-total').textContent=money(cartItems.reduce((sum,item)=>sum+item.price,0));
  el('cart-pickup-note').hidden=!cartItems.length;
  el('checkout-summary').innerHTML=cartItems.length ? grouped.map(item=>{
    const quoted=cartQuote?.items.find(row=>row.listing_id===item.listing_id);
    return '<article class="cart-line">'+itemThumbnail(item)+'<div class="cart-line-body"><div class="cart-line-heading"><div><span class="cart-restaurant">'+
      escapeHtml(item.business_name||'Restaurant pickup')+'</span><h3>'+escapeHtml(item.title)+'</h3></div><button type="button" class="cart-remove" '+
      (orderSubmitting?'disabled':'')+' onclick="removeCartItem('+item.listing_id+')" aria-label="Remove '+escapeHtml(item.title)+'">&times;</button></div>'+
      '<p class="cart-unit-price">'+money(item.price)+' <span>per portion</span></p><div class="cart-line-controls"><div class="cart-stepper">'+
      '<button type="button" aria-label="Remove one portion of '+escapeHtml(item.title)+'" '+(orderSubmitting||item.quantity<=1?'disabled':'')+' onclick="stepCartQuantity('+item.listing_id+',-1)">&minus;</button>'+
      '<input id="cart-quantity-'+item.listing_id+'" aria-label="Portions of '+escapeHtml(item.title)+'" type="number" inputmode="numeric" min="1" max="100000" step="1" value="'+item.quantity+'" '+
      (orderSubmitting?'disabled':'')+' onchange="changeCartQuantity('+item.listing_id+',this.value)">'+
      '<button type="button" aria-label="Add one portion of '+escapeHtml(item.title)+'" '+(orderSubmitting||(quoted && item.quantity>=quoted.available_quantity)?'disabled':'')+' onclick="stepCartQuantity('+item.listing_id+',1)">+</button></div>'+
      '<strong>'+money(item.total)+'</strong></div>'+(quoted?.error?'<p class="detail-feedback">'+escapeHtml(quoted.error)+'</p>':'')+'</div></article>';
  }).join('') : '<div class="cart-empty"><span aria-hidden="true">&#127858;</span><h3>A little room for good food</h3><p>Your cart is empty. Find a meal you love and give it a second chance.</p><button class="btn-sec" type="button" onclick="closeModal(\'checkout-modal\'); showScreen(\'customer\')">Explore meals</button></div>';
  el('cart-confirm').disabled=orderSubmitting || !cartItems.length || !cartQuote?.valid;
  el('cart-confirm').textContent=orderSubmitting?'Reserving…':'Confirm Reservation';
  el('cart-clear').disabled=orderSubmitting || !cartItems.length;
}
async function refreshCartQuote() {
  const requestId=++cartQuoteRequest, session=token;
  cartQuote=null; renderCart();
  if (!cartItems.length) { el('cart-feedback').textContent=''; return; }
  el('cart-feedback').textContent='Checking current prices and availability…';
  try {
    const quote=await requestJson('/cart/quote',{ method:'POST',body:JSON.stringify({
      items:groupedCart().map(item=>({ listing_id:item.listing_id,quantity:item.quantity }))
    }) });
    if (requestId!==cartQuoteRequest || session!==token) return;
    let changed=false;
    cartItems.forEach(item=>{
      const current=quote.items.find(row=>row.listing_id===item.listing_id);
      if (current?.unit_price!=null) {
        if (item.price!==current.unit_price) changed=true;
        item.price=current.unit_price;
      }
    });
    cartQuote=quote; renderCart();
    el('cart-feedback').textContent=!quote.valid?'Update or remove unavailable items before confirming.':
      changed?'Prices have changed. Review the updated total before confirming.':'Prices and stock checked. Portions are reserved when you confirm.';
  } catch(error) {
    if (requestId!==cartQuoteRequest || session!==token) return;
    el('cart-feedback').textContent=error.message;
  }
}
function changeCartQuantity(id,value) {
  if (orderSubmitting) return;
  const quantity=Number(value),item=cartItems.find(row=>row.listing_id===id);
  if (!item) return;
  if (!Number.isSafeInteger(quantity) || quantity<1 || quantity>100000) {
    renderCart(); el('cart-feedback').textContent='Enter a positive whole number of portions.'; return;
  }
  cartItems=cartItems.filter(row=>row.listing_id!==id);
  for (let i=0;i<quantity;i++) cartItems.push({ ...item });
  renderTopNav(); refreshCartQuote();
}
function stepCartQuantity(id,delta) {
  const item=groupedCart().find(row=>row.listing_id===id);
  if (item) changeCartQuantity(id,Math.max(1,item.quantity+delta));
}
function removeCartItem(id) {
  if (orderSubmitting) return;
  cartItems=cartItems.filter(item=>item.listing_id!==id);
  renderTopNav(); refreshCartQuote();
}
function clearCart() {
  if (orderSubmitting) return;
  cartItems=[]; renderTopNav(); refreshCartQuote();
}
function openCheckoutModal() {
  cartReturnFocus=document.activeElement?.closest?.('#cart-toast') ? el('cart-open') : document.activeElement;
  el('cart-toast').hidden=true;
  el('checkout-modal').classList.add('active');
  document.body.classList.add('cart-is-open');
  el('cart-close').focus();
  if (!orderSubmitting) refreshCartQuote();
}
async function confirmOrder() {
  if (orderSubmitting || !cartItems.length) return;
  if (!cartQuote?.valid) { await refreshCartQuote(); return; }
  const session=token;
  orderSubmitting=true; renderCart();
  try {
    await requestJson('/orders', { method:'POST', body:JSON.stringify({
      items:groupedCart().map(item=>({ listing_id:item.listing_id,quantity:item.quantity,unit_price:item.price })),
      payment_method:el('pay-method').value
    }) });
    if (session!==token) return;
    cartItems=[]; cartQuote=null; cartQuoteRequest++; closeModal('checkout-modal'); renderTopNav();
    orders=await requestJson('/orders'); await loadInitialData(); renderProfile(); await refreshNotifications();
    alert('Reservation placed. Find your pickup code and order status in your profile.');
  } catch(error) {
    if (session!==token) return;
    await refreshCartQuote(); el('cart-feedback').textContent=error.message;
  } finally { orderSubmitting=false; renderCart(); }
}
async function changeOrder(id,status) {
  try {
    await requestJson('/orders/' + id, { method:'PATCH',body:JSON.stringify({ status }) });
    if (currentUser.role === 'business') await loadBusiness();
    else { orders=await requestJson('/orders'); renderProfile(); }
    await loadInitialData();
    await refreshNotifications();
  } catch(error) { alert(error.message); }
}
function renderBusinessOrders() {
  el('business-orders').innerHTML = businessOrders.length ? businessOrders.map(order => {
    const next = ({ pending:'confirmed',confirmed:'ready',ready:'completed' })[order.status];
    return '<div class="order-row"><strong>#' + order.id + ' · ' + escapeHtml(order.listing_title) +
      '</strong><span>' + order.quantity + ' units · ' + money(order.total_price) +
      '</span><span>' + escapeHtml(order.status) + '</span>' + (next==='completed'
        ? '<button class="review-order-btn" onclick="openPickupVerification('+order.id+')">Verify pickup</button>' : next
        ? '<button class="review-order-btn" onclick="changeOrder(' + order.id + ',\'' + next +
          '\')">Mark ' + next + '</button>' : '') + '</div>';
  }).join('') : '<div class="empty-history">No reservations yet.</div>';
}
function openPickupVerification(id) {
  const order=businessOrders.find(order=>order.id===id && order.status==='ready');
  if (!order) return;
  selectedPickupOrder=id;
  el('pickup-context').textContent='Order #'+id+' · '+order.listing_title+' · '+order.quantity+' portions';
  el('pickup-code-input').value=''; el('pickup-feedback').textContent='';
  el('pickup-modal').classList.add('active'); el('pickup-code-input').focus();
}
async function verifyPickup(event) {
  event.preventDefault();
  if (!selectedPickupOrder || el('pickup-submit').disabled) return;
  el('pickup-submit').disabled=true;
  try {
    await requestJson('/orders/'+selectedPickupOrder,{ method:'PATCH',body:JSON.stringify({
      status:'completed',pickup_code:el('pickup-code-input').value.trim()
    }) });
    closeModal('pickup-modal'); selectedPickupOrder=null;
    await loadBusiness(); await refreshNotifications();
  } catch(error) { el('pickup-feedback').textContent=error.message; }
  finally { el('pickup-submit').disabled=false; }
}
async function refreshNotifications() {
  if (!token || !currentUser) return;
  const session=token;
  const data=await requestJson('/notifications');
  if (session!==token) return;
  notifications=data.notifications; unreadNotifications=data.unread_count;
  const badge=el('notification-count');
  if (badge) badge.textContent=unreadNotifications;
  const button=document.querySelector('.notification-nav');
  if (button) button.setAttribute('aria-label','Notifications, '+unreadNotifications+' unread');
  el('notifications-list').innerHTML=notifications.length?notifications.map(note=>
    '<article class="notification-item '+(note.read_at?'':'unread')+'"><p>'+escapeHtml(note.message)+'</p><small>'+date(note.created_at)+
    '</small><div><button class="review-order-btn" onclick="openNotificationOrder('+note.id+')">View order</button>'+
    (!note.read_at?'<button class="review-order-btn" onclick="markNotificationRead('+note.id+')">Mark read</button>':'')+'</div></article>').join(''):
    '<div class="empty-history">No order updates yet.</div>';
}
async function openNotifications() {
  el('notifications-modal').classList.add('active');
  try { await refreshNotifications(); }
  catch(error) { el('notifications-list').textContent=error.message; }
}
async function markNotificationRead(id) {
  try { await requestJson('/notifications/'+id+'/read',{ method:'PATCH' }); await refreshNotifications(); }
  catch(error) { alert(error.message); }
}
async function markNotificationsRead() {
  if (!notifications.length) return;
  try {
    await requestJson('/notifications/read',{ method:'PATCH',body:JSON.stringify({ through_id:Math.max(...notifications.map(note=>note.id)) }) });
    await refreshNotifications();
  } catch(error) { alert(error.message); }
}
async function openNotificationOrder(id) {
  const note=notifications.find(note=>note.id===id);
  if (!note) return;
  await markNotificationRead(id); closeModal('notifications-modal');
  if (currentUser?.role==='business') { showScreen('business'); switchBizTab('orders',document.querySelector('[data-biz-tab="orders"]')); }
  else { await loadAccount(); showScreen('profile'); }
}
async function refreshOrderActivity() {
  if (document.visibilityState==='hidden' || !token || !currentUser || activityRefreshing) return;
  activityRefreshing=true;
  const session=token;
  try {
    await refreshNotifications();
    const fresh=await requestJson('/orders');
    if (session!==token) return;
    if (currentUser.role==='business') { businessOrders=fresh; renderBusinessOrders(); }
    else { orders=fresh; if (activeScreen==='profile' && !el('profile-form').contains(document.activeElement)) renderProfile(); }
  } catch(error) { console.warn(error.message); }
  finally { activityRefreshing=false; }
}
function switchBizTab(name, element) {
  el('biz-tab-overview').classList.toggle('listings-view',name === 'listings');
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
  el('m-start').value='20:00'; el('m-end').value='00:00';
  el('listing-modal-title').textContent='Add Food Item';
  el('listing-submit-btn').textContent='Save Food Item';
  setFoodImagePreview(null);
  el('listing-feedback').hidden=true;
  el('new-listing-modal').classList.add('active');
  return prepareFoodEditor('');
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
  return prepareFoodEditor(item.category);
}
function prepareFoodEditor(category) {
  listingEditorVersion++;
  closeOfferTimePicker(false); updateOfferTimeLabels();
  toggleCategoryEditor(false);
  el('category-feedback').textContent='';
  el('save-category-btn').disabled=false;
  el('m-title').focus();
  return loadFoodCategories(category);
}
async function loadFoodCategories(selected=el('m-category').value) {
  const requestId=++latestCategoryRequest, session=token;
  foodCategories=[];
  el('m-category').disabled=true;
  el('m-category').innerHTML='<option value="">Loading categories…</option>';
  try {
    const rows=await requestJson('/categories',{ cache:'no-store' });
    if (requestId!==latestCategoryRequest || session!==token) return;
    foodCategories=rows;
    el('m-category').innerHTML='<option value="">Choose a category</option>'+rows.map(row=>
      '<option value="'+escapeHtml(row.name)+'">'+escapeHtml(row.name)+'</option>').join('');
    el('m-category').value=rows.find(row=>row.name.toLowerCase()===selected.trim().toLowerCase())?.name||'';
    el('m-category').disabled=false;
  } catch(error) {
    if (requestId!==latestCategoryRequest || session!==token) return;
    el('m-category').innerHTML='<option value="">Categories unavailable</option>';
    el('category-feedback').textContent='Could not load categories. Reopen this form to retry. '+error.message;
  }
}
function toggleCategoryEditor(show=el('category-editor').hidden) {
  el('category-editor').hidden=!show;
  el('add-category-toggle').setAttribute('aria-expanded',String(show));
  if (show) { el('new-category-name').value=''; el('category-feedback').textContent=''; el('new-category-name').focus(); }
}
async function saveFoodCategory() {
  if (el('save-category-btn').disabled) return;
  const name=el('new-category-name').value.trim().replace(/\s+/g,' ');
  if (!name || name.length>100) { el('category-feedback').textContent='Enter a category name between 1 and 100 characters.'; return; }
  const version=listingEditorVersion, session=token;
  el('save-category-btn').disabled=true;
  el('category-feedback').textContent='Adding category…';
  try {
    const data=await requestJson('/categories',{ method:'POST',body:JSON.stringify({ name }) });
    if (version!==listingEditorVersion || session!==token) return;
    await loadFoodCategories(data.category.name);
    if (version!==listingEditorVersion || session!==token) return;
    if (!el('m-category').disabled) {
      toggleCategoryEditor(false);
      el('category-feedback').textContent='Category added and selected.';
      el('m-category').focus();
    }
  } catch(error) {
    if (version===listingEditorVersion && session===token) el('category-feedback').textContent=error.message;
  } finally { if (version===listingEditorVersion) el('save-category-btn').disabled=false; }
}
function updateOfferTimeLabels() {
  ['m-start','m-end'].forEach(id=>el(id+'-display').textContent=offerTime(el(id).value));
  const start=el('m-start').value, end=el('m-end').value;
  el('offer-window-note').textContent=start && end ? start===end ? 'Available for 24 hours from the selected start time.' :
    end<start ? 'Ends the next day. Your offer continues past midnight.' : 'Starts and ends on the same day.' : 'Choose a start and end time.';
}
function openOfferTimePicker(id) {
  if (!['m-start','m-end'].includes(id)) return;
  if (offerTimeDraft?.id===id) { closeOfferTimePicker(); return; }
  closeOfferTimePicker(false);
  const [hour,minute]=(el(id).value||'00:00').split(':').map(Number);
  offerTimeDraft={ id,hour:hour%12||12,minute,period:hour>=12?'PM':'AM',stage:'hour' };
  el(id+'-trigger').setAttribute('aria-expanded','true');
  el('offer-time-picker').hidden=false;
  el('time-picker-title').textContent=id==='m-start'?'Choose start time':'Choose end time';
  renderOfferTimePicker();
}
function renderOfferTimePicker() {
  const draft=offerTimeDraft;
  if (!draft) return;
  el('time-picker-steps').innerHTML=['hour','minute','period'].map(stage=>
    '<button type="button" class="'+(stage===draft.stage?'selected':'')+'" aria-pressed="'+(stage===draft.stage)+'" onclick="setOfferTimeStage(\''+stage+'\')">'+
    (stage==='hour'?'Hour · '+draft.hour:stage==='minute'?'Minute · '+String(draft.minute).padStart(2,'0'):'AM / PM · '+draft.period)+'</button>').join('');
  el('time-picker-instruction').textContent=({hour:'1 of 3 · Choose the hour',minute:'2 of 3 · Choose the minute',period:'3 of 3 · Choose AM or PM to save and close'})[draft.stage];
  const values=draft.stage==='period'?['AM','PM']:Array.from({ length:draft.stage==='hour'?12:60 },(_,i)=>draft.stage==='hour'?i+1:i);
  el('time-picker-options').innerHTML=values.map(value=>'<button type="button" class="'+(value===draft[draft.stage]?'selected':'')+
    '" aria-pressed="'+(value===draft[draft.stage])+'" onclick="selectOfferTimePart(\''+draft.stage+'\',\''+value+'\')">'+
    (draft.stage==='minute'?String(value).padStart(2,'0'):value)+'</button>').join('');
  const options=el('time-picker-options');
  options.scrollTop=0;
  options.querySelectorAll('button')[0]?.focus();
}
function setOfferTimeStage(stage) {
  if (!offerTimeDraft || !['hour','minute','period'].includes(stage)) return;
  offerTimeDraft.stage=stage; renderOfferTimePicker();
}
function selectOfferTimePart(stage,value) {
  if (!offerTimeDraft || offerTimeDraft.stage!==stage) return;
  const number=Number(value);
  if (stage==='hour' && Number.isInteger(number) && number>=1 && number<=12) {
    offerTimeDraft.hour=number; setOfferTimeStage('minute');
  } else if (stage==='minute' && Number.isInteger(number) && number>=0 && number<=59) {
    offerTimeDraft.minute=number; setOfferTimeStage('period');
  } else if (stage==='period' && ['AM','PM'].includes(value)) {
    const hour=offerTimeDraft.hour%12+(value==='PM'?12:0);
    el(offerTimeDraft.id).value=String(hour).padStart(2,'0')+':'+String(offerTimeDraft.minute).padStart(2,'0');
    updateOfferTimeLabels(); closeOfferTimePicker();
  }
}
function closeOfferTimePicker(restoreFocus=true) {
  if (offerTimeDraft) {
    const trigger=el(offerTimeDraft.id+'-trigger');
    trigger.setAttribute('aria-expanded','false');
    if (restoreFocus) trigger.focus();
  }
  offerTimeDraft=null;
  el('offer-time-picker').hidden=true;
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
  if (el('listing-submit-btn').disabled) return;
  const errorBox=el('listing-feedback');
  const showError=message=>{ errorBox.textContent=message; errorBox.hidden=false; };
  errorBox.hidden=true;
  if (!foodCategories.some(row=>row.name===el('m-category').value)) return showError('Choose a category from the dropdown, or add a new category first.');
  if (offerTimeDraft) return showError('Finish choosing AM or PM to save your offer time.');
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
  if (id==='new-listing-modal') { listingEditorVersion++; latestCategoryRequest++; closeOfferTimePicker(false); }
  if (id==='checkout-modal') {
    document.body.classList.remove('cart-is-open');
    if (cartReturnFocus?.isConnected) cartReturnFocus.focus();
    else if (cartReturnFocus) el('cart-open')?.focus();
    cartReturnFocus=null;
  }
  if (id === 'listing-detail-modal') {
    latestDetailRequest++; detailItem = null;
    document.body.classList.remove('meal-dialog-open');
    if (detailReturnFocus?.isConnected) detailReturnFocus.focus();
    detailReturnFocus = null;
  }
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
    renderProfile(); renderHomeReviews(); await fetchListings();
  } catch(error) { alert(error.message); }
}
async function deleteReview(id) {
  if (!confirm('Delete your review?')) return;
  try {
    await requestJson('/reviews/' + id, { method:'DELETE' });
    reviews=await requestJson('/reviews'); renderProfile(); renderHomeReviews(); await fetchListings();
  } catch(error) { alert(error.message); }
}

function showHomeBanner(index) {
  const slides = [...document.querySelectorAll('.home-banner-slide')];
  if (!slides.length) return;
  homeBannerIndex = (index % slides.length + slides.length) % slides.length;
  slides.forEach((slide,i) => {
    const active = i === homeBannerIndex;
    slide.classList.toggle('active',active);
    slide.setAttribute('aria-hidden',String(!active));
    slide.inert = !active;
  });
  document.querySelectorAll('.banner-dots button').forEach((dot,i) => {
    dot.classList.toggle('active',i === homeBannerIndex);
    dot.setAttribute('aria-current',String(i === homeBannerIndex));
  });
  el('banner-caption').textContent = homeBannerIndex === 0
    ? 'Good food. Better possibilities.' : 'Rescue. Pick up. Share your experience.';
  scheduleHomeBanner();
}
function scheduleHomeBanner() {
  clearTimeout(homeBannerTimer);
  homeBannerTimer = null;
  if (homeBannerPaused || homeBannerHovered || document.visibilityState === 'hidden') return;
  homeBannerTimer = setTimeout(() => {
    if (activeScreen === 'home') showHomeBanner(homeBannerIndex + 1);
    else scheduleHomeBanner();
  },5000);
}
function setHomeBannerPaused(paused) {
  homeBannerPaused = paused;
  el('banner-pause').textContent = paused ? 'Play' : 'Pause';
  el('banner-pause').setAttribute('aria-label',paused ? 'Start automatic banners' : 'Pause automatic banners');
  el('banner-pause').setAttribute('aria-pressed',String(paused));
  scheduleHomeBanner();
}
function toggleHomeBannerPlayback() {
  setHomeBannerPaused(!homeBannerPaused);
}
function initHomeBanner() {
  const banner = el('home-banner');
  setHomeBannerPaused(false);
  banner.addEventListener('pointerenter',() => { homeBannerHovered = true; scheduleHomeBanner(); });
  banner.addEventListener('pointerleave',() => { homeBannerHovered = false; scheduleHomeBanner(); });
  document.addEventListener('visibilitychange',scheduleHomeBanner);
}

document.addEventListener('keydown',event => {
  if (event.key==='Escape' && offerTimeDraft) { event.preventDefault(); closeOfferTimePicker(); return; }
  const modalId=['checkout-modal','listing-detail-modal','new-listing-modal'].find(id=>el(id).classList.contains('active'));
  if (!modalId) return;
  if (event.key === 'Escape') { event.preventDefault(); closeModal(modalId); }
  if (event.key === 'Tab') {
    const focusable = [...el(modalId).querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
      .filter(node=>node.getClientRects().length>0);
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
renderTopNav();
loadInitialData();
initHomeBanner();
loadAccount().then(()=>{
  const savedScreen = localStorage.getItem('plateup_screen') || 'home';
  const target = currentUser || ['home','customer','login','restaurants','restaurant'].includes(savedScreen) ? savedScreen : 'home';
  showScreen(target);
});
function refreshVisibleData() {
  if (document.visibilityState==='hidden') return;
  if (activeScreen==='home' || activeScreen==='customer') refreshMarketplace();
  if (activeScreen==='business') refreshBusinessListings();
  if (activeScreen==='restaurants') loadRestaurants();
  if (activeScreen==='restaurant') loadRestaurant();
}
window.addEventListener('focus',refreshVisibleData);
setInterval(refreshVisibleData,30000);
window.addEventListener('focus',refreshOrderActivity);
setInterval(refreshOrderActivity,15000);
