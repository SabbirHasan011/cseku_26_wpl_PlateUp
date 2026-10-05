import { renderBusinessListings } from './listings.js';
import { state } from './state.js';
import { requestJson } from './api.js';
import { el, itemThumbnail, escapeHtml, itemRating, offerTime, money, imageUrl, closeModal,pickupDeadline } from './ui.js';
import { notify,skeletonCards } from './feedback.js';
import { renderReviews, renderHomeReviews } from './reviews.js';
import { favoriteButton } from './favorites.js';
import { profileCity } from './profile.js';
import { addToCart } from './cart.js';

export async function fetchListings() {
  const requestId = ++state.latestListingsRequest;
  const grids=['listing-grid','home-featured-grid'].map(el).filter(Boolean);
  grids.forEach(grid=>{grid.setAttribute('aria-busy','true');if(!state.listings.length)grid.innerHTML=skeletonCards();});
  let freshListings;
  try {freshListings=await requestJson('/listings', { cache:'no-store' });}
  catch(error) {
    if(requestId===state.latestListingsRequest&&!state.listings.length)grids.forEach(grid=>{
      grid.innerHTML='<div class="feed-empty"><strong>Meals could not be loaded</strong><p>'+escapeHtml(error.message)+
        '</p><button class="btn-sec" data-click="refreshMarketplace">Try again</button></div>';
    });
    throw error;
  }finally {if(requestId===state.latestListingsRequest)grids.forEach(grid=>grid.setAttribute('aria-busy','false'));}
  if (requestId !== state.latestListingsRequest) return;
  state.listings = freshListings;
  renderListings();
  if (state.detailItem && el('listing-detail-modal').classList.contains('active')) {
    state.detailItem = state.listings.find(item => item.id === state.detailItem.id) || { ...state.detailItem,quantity:0 };
    updateDetailQuantity();
  }
}

export async function refreshMarketplace() {
  if (el('listing-status')) el('listing-status').textContent = 'Refreshing listings…';
  try { await Promise.all([fetchListings(),loadMarketplaceCategories()]); }
  catch (error) {
    console.error(error);
    const status = el('listing-status');
    if (status) status.textContent = 'Could not refresh listings: ' + error.message;
    else if(state.listings.length)notify('Could not refresh listings: '+error.message,'error');
  }
}

export async function loadInitialData() {
  try {
    await Promise.all([fetchListings(),loadMarketplaceCategories(), requestJson('/reviews').then(data => { state.reviews = data; })]);
    renderReviews();
    renderHomeReviews();
  } catch (error) { console.error(error); notify('Could not load marketplace data: ' + error.message,'error'); }
}

export function foodCard(item) {
  const original=Number(item.original_price),price=Number(item.rescue_price);
  const discount=original>0?Math.max(0,Math.floor((1-price/original)*100+1e-9)):0;
  const quantity=Number(item.quantity)||0;
  return '<article class="food-card meal-card"><div class="meal-photo">'+itemThumbnail(item)+
    '<span class="save-pill">'+(discount?discount+'% off':'Rescue price')+'</span></div>'+
    '<div class="food-body"><div class="biz-line" title="'+escapeHtml(item.business_name)+'">'+escapeHtml(item.business_name)+'</div>'+
    '<h3 class="food-title" title="'+escapeHtml(item.title)+'">'+escapeHtml(item.title)+'</h3>'+itemRating(item)+
    '<div class="meal-facts"><span class="stock-badge '+(quantity<=3?'low':'')+'">'+quantity+' portion'+(quantity===1?'':'s')+
    ' left</span><span class="meal-city">'+escapeHtml(item.city||'Pickup')+'</span></div>'+
    '<p class="meal-pickup"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'+
    '<span>Pick up by <strong>'+escapeHtml(pickupDeadline(item))+'</strong></span></p>'+
    (item.pricing_source==='synthetic_model'?'<small class="pricing-demo-label">Demo model price</small>':'')+'</div>'+
    '<div class="meal-card-footer"><div class="price-block"><div class="meal-price-line"><span class="rescue-price">'+money(item.rescue_price)+
    '</span><del class="orig-price">'+money(item.original_price)+'</del></div><small>per portion</small></div>'+
    '<div class="meal-card-actions">'+favoriteButton('listing',item.id,true)+
    '<button type="button" class="reserve-btn" data-click="openListingDetails" data-arg0="'+item.id+'">View details <span aria-hidden="true">&rarr;</span></button></div></div></article>';
}

export function renderListings() {
  const query = el('food-search')?.value.trim().toLowerCase() || '';
  if (el('customer')) {
    const city = profileCity()?.trim();
    el('loc-search').value = city || '';
    el('loc-search').readOnly = true;
    el('loc-search').placeholder = state.currentUser ? 'Set your profile city' : 'Sign in to find nearby food';
    el('loc-search').setAttribute('aria-label','Your profile city');
    const filtersActive = state.activeCategory !== 'All' || Boolean(query);
    const visible = state.listings.filter(item => (state.activeCategory === 'All' || item.category === state.activeCategory)
      && (!query || (item.title + ' ' + item.business_name).toLowerCase().includes(query)));
    el('listing-status').textContent = visible.length + ' of ' + state.listings.length + ' available listings' +
      (filtersActive ? ' · Filters active' : '');
    el('clear-listing-filters').hidden = !filtersActive;
    const empty = '<div class="empty-history feed-empty"><strong>' + (!state.currentUser ? 'Find food in your city' : !city ?
      'Where would you like to pick up?' : 'No available meals ' + (filtersActive ? 'match your filters' : 'in ' + escapeHtml(city))) +
      '</strong><p>' + (!state.currentUser ? 'Sign in and save your city to discover local meals.' : !city ?
      'Add your city to your profile to see food from local restaurants.' : 'Try again when restaurants add portions during their offer hours.') +
      '</p><button class="btn-sec" data-click="'+(filtersActive&&city?'clearListingFilters':'openCitySettings')+'">' +
      (filtersActive&&city?'Clear filters':!state.currentUser ? 'Sign in' : city ? 'Change city' : 'Set my city') + '</button></div>';
    el('listing-grid').innerHTML = visible.length ? visible.map(foodCard).join('') : empty;
  }
  if (el('home-featured-grid')) {
    el('home-featured-grid').innerHTML = state.listings.length ? state.listings.slice(0,3).map(foodCard).join('') :
      '<div class="empty-history feed-empty"><strong>' + (!state.currentUser ? 'Find food in your city' : !profileCity() ? 'Where would you like to pick up?' : 'No available meals in ' + escapeHtml(profileCity())) + '</strong><p>' + (!state.currentUser ? 'Sign in and save your city to discover local meals.' : !profileCity() ? 'Add your city to your profile to see food from local restaurants.' : 'Try again when restaurants add portions during their offer hours.') + '</p><button class="btn-sec" data-click="openCitySettings">' + (!state.currentUser ? 'Sign in' : profileCity() ? 'Change city' : 'Set my city') + '</button></div>';
  }
  renderBusinessListings();
}

export function filterListings() { renderListings(); }

export function filterCategory(category, element) {
  state.activeCategory = category;
  document.querySelectorAll('.chip').forEach(item => item.classList.remove('on'));
  element.classList.add('on'); renderListings();
}

export function clearListingFilters() {
  el('food-search').value = '';
  el('loc-search').value = '';
  state.activeCategory = 'All';
  document.querySelectorAll('.chip-row .chip').forEach(item => item.classList.remove('on'));
  document.querySelector('.chip-row .chip').classList.add('on');
  renderListings();
}

export async function openListingDetails(id) {
  const requestId = ++state.latestDetailRequest;
  try {
    const { listing:item } = await requestJson('/listings/' + id,{ cache:'no-store' });
    if (requestId !== state.latestDetailRequest) return;
    state.detailReturnFocus = document.activeElement;
    state.detailItem = item;
    const index = state.listings.findIndex(row => row.id === id);
    if (index >= 0) state.listings[index] = item;
    el('detail-title').textContent = item.title;
    el('detail-category').textContent = item.category + (item.pricing_source==='synthetic_model'?' / Demo model price':' / Rescue meal');
    const savings = Number(item.original_price) > 0 ? Math.floor((1-Number(item.rescue_price)/Number(item.original_price))*100+1e-9) : 0;
    el('detail-media').innerHTML = (item.image_path ? '<img src="' + escapeHtml(imageUrl(item.image_path)) +
      '" alt="' + escapeHtml(item.title) + '">' : '<div class="detail-placeholder"><span aria-hidden="true">&#127858;</span><span>A good meal. A little less waste.</span></div>') +
      (savings > 0 ? '<span class="detail-savings">Save ' + savings + '%</span>' : '');
    el('detail-body').innerHTML = itemRating(item) + '<p class="detail-description">' +
      escapeHtml(item.description || 'A delicious surplus meal, ready for a second chance. Collect it directly from the restaurant.') +
      '</p><div class="detail-price"><strong id="detail-live-price">' + money(item.rescue_price) + '</strong><span>per portion</span>' +
      '<del>' + money(item.original_price) + '</del></div><p class="pricing-customer-note">Prices can change before reservation. Your confirmed reservation keeps its agreed price.</p><div class="detail-pickup"><div><span class="detail-label">Pick up from</span><strong>' +
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
    if (requestId !== state.latestDetailRequest) return;
    notify('This meal is no longer available: ' + error.message,'error');
    await refreshMarketplace();
  }
}

export function detailAvailableQuantity() {
  if (!state.detailItem) return 0;
  return Math.max(0,Number(state.detailItem.quantity) - state.cartItems.filter(row => row.listing_id === state.detailItem.id).length);
}

export function updateDetailQuantity() {
  if (!state.detailItem) return;
  if(el('detail-live-price'))el('detail-live-price').textContent=money(state.detailItem.rescue_price);
  const available = detailAvailableQuantity();
  const quantity = Number(el('detail-quantity').value);
  const valid = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= available;
  el('detail-quantity').max = String(available);
  el('detail-quantity').disabled = available === 0;
  el('detail-minus').disabled = !available || quantity <= 1;
  el('detail-plus').disabled = !available || quantity >= available;
  el('detail-stock').textContent = available + ' portion' + (available === 1 ? '' : 's') + ' available to add' +
    (Number(state.detailItem.quantity) > available ? ' · Your cart is already counted' : '');
  el('detail-total').textContent = money(valid ? quantity * Number(state.detailItem.rescue_price) : 0);
  el('detail-feedback').textContent = !available ? 'No more portions can be added. Check your cart or browse another meal.' :
    !valid ? 'Choose a whole number from 1 to ' + available + '.' : '';
  el('detail-reserve').disabled = !valid || state.currentUser?.role !== 'customer';
  el('detail-reserve').textContent = state.currentUser?.role === 'customer' ? 'Add to reservation' : 'Customer account required';
}

export function stepDetailQuantity(delta) {
  const available = detailAvailableQuantity();
  if (!available) return;
  const current = Number(el('detail-quantity').value) || 1;
  el('detail-quantity').value = String(Math.max(1,Math.min(available,Math.trunc(current)+delta)));
  updateDetailQuantity();
}

export function reserveDetail(event) {
  event.preventDefault();
  if (!state.detailItem) return;
  updateDetailQuantity();
  if (el('detail-reserve').disabled) return;
  const quantity=Number(el('detail-quantity').value);
  if (addToCart(state.detailItem.id,quantity)) {
    closeModal('listing-detail-modal');
    el('cart-toast-message').textContent=quantity+' portion'+(quantity===1?'':'s')+' added to your cart';
    el('cart-toast').hidden=false;
    clearTimeout(state.cartToastTimer);
    state.cartToastTimer=setTimeout(()=>{ el('cart-toast').hidden=true; },4500);
  }
}

export async function loadMarketplaceCategories() {
  const rows=await requestJson('/categories',{cache:'no-store'});
  if (state.activeCategory!=='All' && !rows.some(row=>row.name===state.activeCategory)) state.activeCategory='All';
  if (!el('marketplace-categories')) return;
  el('marketplace-categories').innerHTML=['All',...rows.map(row=>row.name)].map(name=>
    '<button type="button" class="chip '+(name===state.activeCategory?'on':'')+'" data-category="'+escapeHtml(name)+
    '" data-click="filterCategory">'+escapeHtml(name)+'</button>').join('');
  renderListings();
}
