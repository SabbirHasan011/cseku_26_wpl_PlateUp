import { notify } from './feedback.js';
import { state } from './state.js';
import { requestJson } from './api.js';
import { renderListings, foodCard } from './marketplace.js';
import { el, escapeHtml } from './ui.js';
import { showScreen } from './router.js';
import { renderRestaurantMenu } from './restaurants.js';

export function favoriteButton(kind,id) {
  if(state.currentUser?.role!=='customer') return '';
  const saved=state.favorites.saved.some(row=>(kind==='listing'?row.listing_id:row.business_id)===id);
  return '<button class="favorite-btn '+(saved?'saved':'')+'" type="button" aria-pressed="'+saved+'" data-click="toggleFavorite" data-arg0="'+kind+'" data-arg1="'+id+'">'+
    (saved?'♥ Saved':'♡ Save')+'</button>';
}

export async function loadFavorites() {
  if(state.currentUser?.role!=='customer') return;
  const request=++state.favoriteRequest, session=state.token;
  try {
    const data=await requestJson('/favorites',{cache:'no-store'});
    if(request!==state.favoriteRequest||session!==state.token)return;
    state.favorites=data; renderFavorites(); renderListings();
    if(state.activeScreen==='restaurant') updateRestaurantFavorite();
  } catch(error) { if(request===state.favoriteRequest&&session===state.token&&el('favorites-status')) el('favorites-status').textContent=error.message; }
}

export async function toggleFavorite(kind,id) {
  if(state.currentUser?.role!=='customer') return showScreen('login');
  const saved=state.favorites.saved.some(row=>(kind==='listing'?row.listing_id:row.business_id)===id);
  try {
    await requestJson('/favorites/'+kind+'/'+id,{method:saved?'DELETE':'PUT'});
    await loadFavorites();
    if(state.activeScreen==='restaurant') renderRestaurantMenu();
  } catch(error) { notify(error.message,'error'); }
}

export function updateRestaurantFavorite() {
  const holder=el('restaurant-favorite');
  if(holder&&state.selectedRestaurant) holder.innerHTML=favoriteButton('business',state.selectedRestaurant.id);
}

export function renderFavorites() {
  if (!el('favorites')) return;
  el('favorites-status').textContent='Saved to your account. Meals are shown only while available in your city.';
  el('favorite-restaurants').innerHTML=state.favorites.restaurants.length?state.favorites.restaurants.map(item=>
    '<article class="saved-restaurant"><div><h3>'+escapeHtml(item.business_name)+'</h3><p>'+escapeHtml(item.city||'City not set')+'</p></div><button class="btn-sec" data-click="openRestaurant" data-arg0="'+item.id+'">View meals</button>'+favoriteButton('business',item.id)+'</article>').join(''):'<p>No saved restaurants yet. Open a restaurant and select Save.</p>';
  el('favorite-meals').innerHTML=state.favorites.listings.length?state.favorites.listings.map(foodCard).join(''):'<p>No saved meals available right now.</p>';
  const unavailable=state.favorites.saved.filter(row=>row.listing_id?!state.favorites.listings.some(item=>item.id===row.listing_id):!state.favorites.restaurants.some(item=>item.id===row.business_id));
  el('unavailable-favorites').innerHTML=unavailable.map(row=>'<div class="unavailable-favorite"><span>'+escapeHtml(row.title)+' · Currently unavailable</span>'+favoriteButton(row.listing_id?'listing':'business',row.listing_id||row.business_id)+'</div>').join('');
}
