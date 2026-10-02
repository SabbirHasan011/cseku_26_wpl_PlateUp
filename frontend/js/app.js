import { state } from './state.js';
import { refreshMarketplace } from './marketplace.js';
import { refreshBusinessListings } from './business.js';
import { loadRestaurants, loadRestaurant } from './restaurants.js';
import { loadFavorites } from './favorites.js';
import { ensureView, hasView, showLoadError } from './views.js';
import { installActions } from './events.js';
import { installDialogKeyboard } from './ui.js';
import { renderTopNav, showScreen, retryNavigation } from './router.js';
import { loadAccount, captureResetLink } from './auth.js';
import { loadInitialData } from './marketplace.js';
import { refreshOrderActivity } from './notifications.js';

export function refreshVisibleData() {
  if (document.visibilityState==='hidden' || !hasView(state.activeScreen)) return;
  if (state.activeScreen==='home' || state.activeScreen==='customer') refreshMarketplace();
  if (state.activeScreen==='business') refreshBusinessListings();
  if (state.activeScreen==='restaurants') loadRestaurants();
  if (state.activeScreen==='restaurant') loadRestaurant();
  if (state.activeScreen==='favorites') loadFavorites();
}

let started = false;
let starting = false;
export async function startApp() {
  if (started || starting) return;
  starting = true;
  try {
    await Promise.all([ensureView('navbar'), ensureView('dialogs')]);
    installActions();
    installDialogKeyboard();
    renderTopNav();
    await loadAccount();
    await loadInitialData();
    if (!await captureResetLink()) {
      await showScreen(localStorage.getItem('plateup_screen') || 'home');
    }
    window.addEventListener('focus', refreshVisibleData);
    window.addEventListener('focus', refreshOrderActivity);
    setInterval(refreshVisibleData, 30000);
    setInterval(refreshOrderActivity, 15000);
    started = true;
  } catch (error) { showLoadError(error); }
  finally { starting = false; }
}

document.getElementById('app-retry').addEventListener('click', () => started ? retryNavigation() : startApp());
startApp();
