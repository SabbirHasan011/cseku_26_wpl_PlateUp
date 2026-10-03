import { state } from './state.js';
import { el } from './ui.js';
import { activateBusinessTab, loadBusiness } from './business.js';
import { readPageUrl,writePageUrl,businessTabs } from './page-urls.js';
import { renderProfile } from './profile.js';
import { refreshMarketplace } from './marketplace.js';
import { loadRestaurants, loadRestaurant } from './restaurants.js';
import { loadMyOrders } from './orders.js';
import { loadFavorites } from './favorites.js';
import { ensureView, hasView, showLoadError } from './views.js';
import { initHomeBanner } from './home.js';
import { renderHomeReviews } from './reviews.js';

export function renderTopNav() {
  const controls = el('nav-controls');
  if (!controls) return;
  const navScreen = ['restaurants','restaurant'].includes(state.activeScreen) ? 'customer' : state.activeScreen;
  const navButton = (screen, label) => '<button class="' + (navScreen === screen ? 'active' : '') +
    '" aria-current="' + (navScreen === screen ? 'page' : 'false') +
    '" data-click="showScreen" data-arg0="' + screen + '">' + label + '</button>';
  const nav = '<div class="switch">' + navButton('home','Home') + navButton('customer','Browse Food') +
    (state.currentUser?.role === 'customer' ? navButton('my-orders','My Orders') + navButton('favorites','Favorites') : '') +
    (state.currentUser?.role === 'business' ? navButton('business','Business Portal') : '') + '</div>';
  const account=state.currentUser?'<button class="profile-nav-btn ' +
    (state.activeScreen==='profile'||state.activeScreen==='business'&&state.activeBusinessTab==='profile'?'active':'')+
    '" data-click="showScreen" data-arg0="profile">Profile</button><button class="logout-btn" data-click="handleLogout">Logout</button>':
    '<button class="btn-pri" data-click="showScreen" data-arg0="login">Sign In</button>';
  controls.innerHTML = '<button id="nav-menu-toggle" class="nav-menu-toggle" type="button" aria-expanded="false" aria-controls="nav-menu" data-click="toggleNavigation">Menu <span aria-hidden="true">☰</span></button>'+
    '<div id="nav-menu" class="nav-menu">'+nav+account+'</div>' + (state.currentUser
    ? (state.currentUser.role === 'customer' ? '<button id="cart-open" class="cart-chip" data-click="openCheckoutModal">Cart (<span id="cart-count">' +
      state.cartItems.length + '</span>)</button>' : '') +
      '<button class="notification-nav" data-click="openNotifications" aria-label="Notifications, '+state.unreadNotifications+' unread">Updates <span id="notification-count">'+state.unreadNotifications+'</span></button>' +
      '' : '');
}

export const routes = Object.freeze({
  home: { init: () => { initHomeBanner(); renderHomeReviews(); return refreshMarketplace(); } },
  login: {}, customer: { init: refreshMarketplace },
  restaurants: { init: loadRestaurants }, restaurant: { init: loadRestaurant },
  'my-orders': { role: 'customer', init: loadMyOrders },
  favorites: { role: 'customer', init: loadFavorites },
  recovery: {}, 'reset-password': {},
  profile: { authenticated: true, init: renderProfile },
  business: { role: 'business', init: loadBusiness }
});
let navigation = 0;
let requestedScreen = 'home';
let requestedOptions = {};
let returnAfterLogin = null;
let historyInstalled = false;

export function resolveScreen(screen,options={}) {
  if (!Object.hasOwn(routes, screen)) return 'home';
  if((routes[screen].role||routes[screen].authenticated)&&!state.currentUser)return 'login';
  if (routes[screen].role && state.currentUser?.role !== routes[screen].role) {
    return screen === 'business' ? 'customer' : 'login';
  }
  if (screen==='reset-password' && !state.resetPasswordToken) screen='recovery';
  if (screen === 'restaurant' && !(options.restaurantId||state.selectedRestaurantId)) screen = 'restaurants';
  if (screen==='profile' && state.currentUser?.role==='business') return 'business';
  if (screen === 'profile' && !state.currentUser) screen = 'login';
  return screen;
}

export async function showScreen(requested,options={}) {
  requestedScreen = requested;
  requestedOptions = options;
  const version = ++navigation;
  const session = state.token;
  const screen = resolveScreen(requested,options);
  const tab=requested==='profile'&&screen==='business'?'profile':businessTabs.includes(options.tab)?options.tab:'overview';
  if(screen==='login'&&requested!=='login'&&!state.currentUser) returnAfterLogin={screen:requested,...options};
  try {
    if (!hasView(screen)) await ensureView(screen);
    if (version !== navigation || session !== state.token) return false;
    state.activeScreen = screen;
    if(screen==='restaurant'&&options.restaurantId&&options.restaurantId!==state.selectedRestaurantId) {
      state.selectedRestaurantId=options.restaurantId;state.selectedRestaurant=null;state.restaurantListings=[];
      state.latestRestaurantRequest++;
    }
    localStorage.setItem('plateup_screen', screen);
    document.querySelectorAll('.screen').forEach(item => item.classList.remove('active'));
    el(screen).classList.add('active');
    el('app-status').hidden = true;
    const tabReady=screen==='business'?activateBusinessTab(tab):null;
    const redirected=screen!==requested&&!(requested==='profile'&&screen==='business');
    writePageUrl(screen,{tab,restaurantId:state.selectedRestaurantId},redirected?'replace':options.historyMode||'push');
    renderTopNav();
    await Promise.all([routes[screen].init?.(),tabReady]);
    return true;
  } catch (error) {
    if (version === navigation) showLoadError(error);
    return false;
  }
}

export function retryNavigation() { return showScreen(requestedScreen,requestedOptions); }
export function navigateFromLocation() {
  const {screen,...options}=readPageUrl();
  // popstate must restore the view without adding another history entry.
  return showScreen(screen,{...options,historyMode:'replace'});
}
export function installPageHistory() {
  if(historyInstalled)return;
  historyInstalled=true;
  window.addEventListener('popstate',navigateFromLocation);
  window.addEventListener('hashchange',()=>{if(location.hash?.startsWith('#/'))navigateFromLocation();});
}
export function clearReturnRoute() { returnAfterLogin=null; }
export function navigateAfterLogin() {
  const target=returnAfterLogin;
  returnAfterLogin=null;
  return target?showScreen(target.screen,{...target,historyMode:'replace'}):
    showScreen(state.currentUser.role==='business'?'business':'customer',{historyMode:'replace'});
}
