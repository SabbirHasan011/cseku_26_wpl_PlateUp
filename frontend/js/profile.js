import { notify } from './feedback.js';
import { state } from './state.js';
import { requestJson } from './api.js';
import { el, escapeHtml, date, money, closeModal } from './ui.js';
import { showScreen } from './router.js';
import { renderMyOrders } from './orders.js';
import { persistCart } from './cart.js';
import { renderListings, fetchListings, loadInitialData } from './marketplace.js';
import { loadAccount } from './auth.js';

export const profileCity = () => state.currentUser?.role === 'business' ? state.profile?.business_city : state.profile?.customer_city;

export const normalizedCity = value => (value || '').trim().replace(/\s+/g,' ').toLowerCase();

export async function loadCities() {
  if (state.cities.length) return;
  state.cities=await requestJson('/cities');
  el('city-options').innerHTML=state.cities.map(city=>'<option value="'+escapeHtml(city.name)+'"></option>').join('');
}

export function selectedCityId(inputId) {
  const value=normalizedCity(el(inputId).value);
  if (!value) return null;
  const city=state.cities.find(city=>normalizedCity(city.name)===value || city.aliases?.includes(value));
  if (!city) throw new Error('Choose a city from the suggestions.');
  el(inputId).value=city.name;
  return city.id;
}

export async function openCitySettings() {
  if (!state.currentUser) return showScreen('login');
  if (state.currentUser.role === 'business') {
    await showScreen('business',{tab:'profile'});
  } else showScreen('profile');
}

export function renderProfile() {
  if (!state.currentUser || !state.profile) return;
  renderMyOrders();
  if (el('profile')) {
    el('profile-avatar').textContent = state.currentUser.name.slice(0,2).toUpperCase();
    el('profile-name').textContent = state.currentUser.name;
    el('profile-email').textContent = state.currentUser.email;
    el('profile-role').textContent = state.currentUser.role;
    el('profile-member-since').textContent = date(state.profile.created_at);
    el('profile-edit-name').value = state.profile.name || '';
    el('profile-edit-phone').value = state.profile.phone || '';
    el('profile-edit-address').value = state.profile.customer_address || '';
    el('profile-edit-city').value = state.profile.customer_city || '';
    el('profile-edit-location').value = state.profile.preferred_location || '';
    const completed = state.orders.filter(order => order.status === 'completed');
    el('profile-order-count').textContent = completed.length;
    el('profile-meal-count').textContent = completed.reduce((sum, order) => sum + order.quantity, 0);
    el('order-history').innerHTML = state.orders.length ? state.orders.map(order => {
      const review = state.reviews.find(item => item.order_id === order.id);
      const action = ['pending','confirmed'].includes(order.status)
        ? '<button class="review-order-btn" data-click="changeOrder" data-arg0="' + order.id + '" data-arg1="cancelled">Cancel</button>'
        : order.status === 'completed'
          ? '<button class="review-order-btn" data-click="openReviewModal" data-arg0="' + order.id + '">' + (review ? 'Edit review' : 'Leave review') + '</button>' +
            (review ? '<button class="review-order-btn danger-action" data-click="deleteReview" data-arg0="' + review.id + '">Delete review</button>' : '')
          : '';
      return '<div class="order-row"><div class="order-main"><strong>Order #' + order.id + '</strong><span>' +
        date(order.order_time) + '</span></div><div class="order-items">' + escapeHtml(order.listing_title) +
        ' · ' + escapeHtml(order.business_name) + ' · Qty ' + order.quantity +
        (order.pickup_code ? '<div class="pickup-code"><span>Show this code at pickup</span><strong>'+escapeHtml(order.pickup_code)+'</strong></div>' : '') +
        '</div><div class="order-total"><strong>' +
        money(order.total_price) + '</strong><span class="badge active">' + escapeHtml(order.status) +
        '</span>' + action + '</div></div>';
    }).join('') : '<div class="empty-history">No reservations yet.</div>';
  }
  if (!el('business-profile-name')) return;
  el('business-profile-name').value = state.profile.business_name || '';
  el('business-profile-phone').value = state.profile.business_phone || '';
  el('business-profile-description').value = state.profile.description || '';
  el('business-profile-address').value = state.profile.business_address || '';
  el('business-profile-city').value = state.profile.business_city || '';
  el('business-profile-open').value = (state.profile.opening_time || '').slice(0,5);
  el('business-profile-close').value = (state.profile.closing_time || '').slice(0,5);
  el('business-profile-lat').value = state.profile.latitude ?? '';
  el('business-profile-lon').value = state.profile.longitude ?? '';
}

export async function saveProfile(event) {
  event.preventDefault();
  try {
    const cityId=selectedCityId('profile-edit-city');
    const cityChanged = Number(state.profile.customer_city_id||0)!==Number(cityId||0);
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('profile-edit-name').value, phone:el('profile-edit-phone').value,
      address:el('profile-edit-address').value, city_id:cityId,
      preferred_location:el('profile-edit-location').value
    }) });
    if (cityChanged) {
      state.cartItems = []; state.cartQuote=null; state.cartQuoteRequest++; state.listings = []; state.latestListingsRequest++;
      persistCart();
      closeModal('listing-detail-modal'); closeModal('checkout-modal'); renderListings();
    }
    await loadAccount(); await fetchListings();
    notify(cityChanged ? 'Profile saved. Your feed now uses your updated city, and your cart has been cleared.' : 'Profile saved.');
  } catch(error) { notify(error.message,'error'); }
}

export async function saveBusinessProfile(event) {
  event.preventDefault();
  try {
    await requestJson('/me', { method:'PUT', body:JSON.stringify({
      name:el('business-profile-name').value, business_name:el('business-profile-name').value,
      phone:el('business-profile-phone').value, description:el('business-profile-description').value,
      address:el('business-profile-address').value, city_id:selectedCityId('business-profile-city'),
      opening_time:el('business-profile-open').value, closing_time:el('business-profile-close').value,
      latitude:el('business-profile-lat').value, longitude:el('business-profile-lon').value
    }) });
    await loadAccount(); await loadInitialData(); notify('Business profile saved.');
  } catch(error) { notify(error.message,'error'); }
}
