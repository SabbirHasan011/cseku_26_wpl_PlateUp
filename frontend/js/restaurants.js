import { state } from './state.js';
import { el, escapeHtml, itemRating, offerTime } from './ui.js';
import { requestJson } from './api.js';
import { showScreen } from './router.js';
import { favoriteButton } from './favorites.js';
import { updateDetailQuantity, foodCard } from './marketplace.js';
import { profileCity, normalizedCity } from './profile.js';

export async function loadRestaurants() {
  const requestId=++state.latestRestaurantsRequest, session=state.token;
  el('restaurant-directory-status').textContent='Loading restaurants…';
  try {
    const data=await requestJson('/restaurants',{ cache:'no-store' });
    if (requestId!==state.latestRestaurantsRequest || session!==state.token) return;
    state.restaurants=data; renderRestaurants();
  } catch(error) {
    if (requestId!==state.latestRestaurantsRequest || session!==state.token) return;
    state.restaurants=[]; el('restaurant-grid').innerHTML='';
    el('restaurant-directory-status').textContent='Could not load restaurants: '+error.message;
  }
}

export function renderRestaurants() {
  const query=el('restaurant-search').value.trim().toLowerCase();
  const visible=state.restaurants.filter(item=>(item.business_name+' '+(item.city||'')).toLowerCase().includes(query));
  el('restaurant-directory-status').textContent=visible.length+' restaurant'+(visible.length===1?'':'s')+
    ' · Meals are available for pickup in your profile city.';
  el('restaurant-grid').innerHTML=visible.length ? visible.map(item=>
    '<button type="button" class="restaurant-card" data-click="openRestaurant" data-arg0="'+item.id+'" aria-label="View '+escapeHtml(item.business_name)+'">'+
    '<span class="restaurant-card-top"><span class="restaurant-monogram" aria-hidden="true">'+escapeHtml(item.business_name.slice(0,2).toUpperCase())+
    '</span><span class="restaurant-city">'+escapeHtml(item.city||'City not set')+'</span></span>'+
    '<span class="restaurant-card-name">'+escapeHtml(item.business_name)+'</span>'+itemRating(item)+
    '<span class="restaurant-card-description">'+escapeHtml(item.description||'Discover surplus meals from this PlateUp kitchen.')+'</span>'+
    '<span class="restaurant-card-footer"><span>'+escapeHtml(item.address||'Restaurant pickup')+'</span><strong>View meals ↗</strong></span></button>'
  ).join('') : '<div class="feed-empty"><strong>'+ (query ? 'No restaurants match your search.' : 'No restaurants registered yet.')+'</strong><p>'+
    (query ? 'Try another restaurant name or city.' : 'Check back as more kitchens join PlateUp.')+'</p></div>';
}

export async function openRestaurant(id) {
  state.selectedRestaurantId=id; state.selectedRestaurant=null; state.restaurantListings=[];
  return showScreen('restaurant');
}

export async function loadRestaurant() {
  if (!state.selectedRestaurantId) return;
  if (!state.selectedRestaurant) {
    el('restaurant-food-search').value='';
    el('restaurant-profile').innerHTML=''; el('restaurant-menu-grid').innerHTML='';
  }
  const id=state.selectedRestaurantId, requestId=++state.latestRestaurantRequest, session=state.token;
  el('restaurant-menu-status').textContent='Loading restaurant menu…';
  try {
    const data=await requestJson('/restaurants/'+id,{ cache:'no-store' });
    if (requestId!==state.latestRestaurantRequest || id!==state.selectedRestaurantId || session!==state.token) return;
    state.selectedRestaurant=data.restaurant; state.restaurantListings=data.listings;
    const item=state.selectedRestaurant;
    el('restaurant-profile').innerHTML='<div class="restaurant-profile-card"><div class="restaurant-monogram" aria-hidden="true">'+
      escapeHtml(item.business_name.slice(0,2).toUpperCase())+'</div><div class="restaurant-profile-copy"><p class="profile-label">A PlateUp kitchen</p><h1>'+
      escapeHtml(item.business_name)+'</h1>'+itemRating(item)+'<p>'+escapeHtml(item.description||'Good food from a local kitchen. Browse today’s available rescue meals below.')+
      '</p><div class="restaurant-profile-meta"><span>'+escapeHtml([item.address,item.city].filter(Boolean).join(' · ')||'Pickup location not set')+'</span>'+
      (item.opening_time && item.closing_time ? '<span>Business hours: '+offerTime(item.opening_time)+' – '+offerTime(item.closing_time)+' · Bangladesh time</span>' : '')+
      '</div></div><div><span class="restaurant-pickup-tag">Pickup at restaurant</span><div id="restaurant-favorite">'+favoriteButton('business',item.id)+'</div></div></div>';
    renderRestaurantMenu();
    if (state.detailItem?.business_id===id && el('listing-detail-modal').classList.contains('active')) {
      state.detailItem=state.restaurantListings.find(item=>item.id===state.detailItem.id)||{ ...state.detailItem,quantity:0 };
      updateDetailQuantity();
    }
  } catch(error) {
    if (requestId!==state.latestRestaurantRequest || id!==state.selectedRestaurantId || session!==state.token) return;
    state.selectedRestaurant=null; state.restaurantListings=[];
    el('restaurant-profile').innerHTML=''; el('restaurant-menu-grid').innerHTML='';
    el('restaurant-menu-status').textContent='Could not load restaurant: '+error.message;
  }
}

export function renderRestaurantMenu() {
  if (!state.selectedRestaurant) return;
  const query=el('restaurant-food-search').value.trim().toLowerCase();
  const visible=state.restaurantListings.filter(item=>[item.title,item.description,item.category].join(' ').toLowerCase().includes(query));
  el('restaurant-menu-status').textContent=visible.length+' of '+state.restaurantListings.length+' meals available now · Prices per portion';
  const city=profileCity();
  const needsCity=!state.currentUser || !city || normalizedCity(city)!==normalizedCity(state.selectedRestaurant.city);
  el('restaurant-menu-grid').innerHTML=visible.length ? visible.map(foodCard).join('') :
    '<div class="feed-empty"><strong>'+ (query && state.restaurantListings.length ? 'No meals match your search.' : 'No meals available to reserve right now.')+
    '</strong><p>'+ (!state.currentUser ? 'Sign in and save your city to see meals available for local pickup.' : !city ?
    'Set your profile city to see meals available for local pickup.' : needsCity ? 'This restaurant is in another city. Only meals in your profile city are shown.' :
    query && state.restaurantListings.length ? 'Try a different meal name or category.' : 'Meals appear during their daily offer window while portions remain. Check back soon.')+'</p>'+
    (needsCity ? '<button class="btn-sec" data-click="openCitySettings">'+(!state.currentUser?'Sign in':'Update my city')+'</button>' : '')+'</div>';
}
