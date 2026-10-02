import { state } from './state.js';
import { el } from './ui.js';
import { switchBizTab, loadBusiness } from './business.js';
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
  controls.innerHTML = nav + (state.currentUser
    ? (state.currentUser.role === 'customer' ? '<button id="cart-open" class="cart-chip" data-click="openCheckoutModal">Cart (<span id="cart-count">' +
      state.cartItems.length + '</span>)</button>' : '') +
      '<button class="notification-nav" data-click="openNotifications" aria-label="Notifications, '+state.unreadNotifications+' unread">Updates <span id="notification-count">'+state.unreadNotifications+'</span></button>' +
      '<button class="profile-nav-btn ' + (state.activeScreen === 'profile' ? 'active' : '') +
      '" aria-current="' + (state.activeScreen === 'profile' ? 'page' : 'false') +
      '" data-click="showScreen" data-arg0="profile">Profile</button>' +
      '<button class="logout-btn" data-click="handleLogout">Logout</button>'
    : '<button class="btn-pri" data-click="showScreen" data-arg0="login">Sign In</button>');
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

export function resolveScreen(screen) {
  if (!Object.hasOwn(routes, screen)) return 'home';
  if (routes[screen].role && state.currentUser?.role !== routes[screen].role) {
    return screen === 'business' ? 'customer' : 'login';
  }
  if (screen==='reset-password' && !state.resetPasswordToken) screen='recovery';
  if (screen === 'restaurant' && !state.selectedRestaurantId) screen = 'restaurants';
  if (screen==='profile' && state.currentUser?.role==='business') return 'business';
  if (screen === 'profile' && !state.currentUser) screen = 'login';
  return screen;
}

export async function showScreen(requested) {
  requestedScreen = requested;
  const version = ++navigation;
  const session = state.token;
  const screen = resolveScreen(requested);
  try {
    if (!hasView(screen)) await ensureView(screen);
    if (version !== navigation || session !== state.token) return false;
    state.activeScreen = screen;
    localStorage.setItem('plateup_screen', screen);
    document.querySelectorAll('.screen').forEach(item => item.classList.remove('active'));
    el(screen).classList.add('active');
    el('app-status').hidden = true;
    renderTopNav();
    await routes[screen].init?.();
    if (version === navigation && requested === 'profile' && screen === 'business') {
      switchBizTab('profile', el('business-profile-nav'));
    }
    return true;
  } catch (error) {
    if (version === navigation) showLoadError(error);
    return false;
  }
}

export function retryNavigation() { return showScreen(requestedScreen); }
