import { state } from './state.js';
import { loadCities, renderProfile } from './profile.js';
import { requestJson } from './api.js';
import { renderTopNav, showScreen, navigateAfterLogin, clearReturnRoute } from './router.js';
import { restoreCart, persistCart } from './cart.js';
import { loadFavorites } from './favorites.js';
import { loadBusiness } from './business.js';
import { refreshNotifications } from './notifications.js';
import { el, closeModal } from './ui.js';
import { renderListings } from './marketplace.js';
import { notify } from './feedback.js';
import { resetRecommendations } from './recommendations.js';
import { resetBilling } from './billing.js';
import { hasView } from './views.js';

export async function openBusinessSignup() {
  if(!await showScreen('login'))return;
  const tab=[...document.querySelectorAll('.auth-tab')].find(node=>node.dataset.arg0==='signup');
  const role=[...document.querySelectorAll('.role-opt')].find(node=>node.dataset.arg0==='business');
  if(!tab||!role)return;
  switchAuthMode('signup',tab);selectRole('business',role);
  el('signup-name').focus();
}

export async function loadAccount(throwOnFailure = false) {
  if (!state.token) return;
  try {
    await loadCities();
    const data = await requestJson('/me');
    state.profile = data.profile;
    state.currentUser = { id:state.profile.id, name:state.profile.name, email:state.profile.email, role:state.profile.role };
    renderTopNav();
    if (state.currentUser.role === 'customer') {
      await restoreCart();
      state.orders = await requestJson('/orders');
      renderProfile();
      await loadFavorites();
    } else if (state.currentUser.role === 'business') {
      await loadBusiness();
    }
    if(state.currentUser.role!=='admin')await refreshNotifications();
  } catch (error) {
    if (throwOnFailure) throw error;
    console.warn(error.message);
  }
}

export function switchAuthMode(mode, tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  el('form-login').classList.toggle('active', mode === 'login');
  el('form-signup').classList.toggle('active', mode === 'signup');
  el('auth-title').textContent = mode === 'login' ? 'Welcome Back' : 'Create Account';
  el('auth-desc').textContent = mode === 'login' ? 'Select your account role to continue' : 'Join PlateUp';
  clearAuthBanners();
}

export function selectRole(role, element) {
  if(!['customer','business'].includes(role))return;
  state.selectedRole = role;
  document.querySelectorAll('.role-opt').forEach(item => item.classList.remove('selected'));
  element.classList.add('selected');
  el('name-label').textContent = role === 'business' ? 'Business name' : 'Full name';
}

export function clearAuthBanners() {
  el('auth-error-banner').style.display = 'none';
  el('auth-success-banner').style.display = 'none';
}

export function showAuthError(message) {
  el('auth-error-banner').textContent = message;
  el('auth-error-banner').style.display = 'block';
}

export function showAuthSuccess(message) {
  el('auth-success-banner').textContent = message;
  el('auth-success-banner').style.display = 'block';
}

export async function handleLogin(event) {
  event.preventDefault(); clearAuthBanners();
  try {
    const data = await requestJson('/auth/login', { method:'POST', body:JSON.stringify({
      email:el('login-email').value.trim(), password:el('login-pass').value, role:state.selectedRole
    }) });
    state.token = data.token;
    localStorage.setItem('plateup_token', state.token);
    await loadAccount(true);
    if (!state.currentUser) throw new Error('Could not load your account. Please try again.');
    await navigateAfterLogin();
  } catch (error) {
    if (!state.currentUser) {
      state.token = null;
      localStorage.removeItem('plateup_token');
    }
    showAuthError(error.message);
  }
}

export async function handleSignup(event) {
  event.preventDefault(); clearAuthBanners();
  const password = el('signup-pass').value;
  if (password !== el('signup-pass-confirm').value) return showAuthError('Passwords do not match');
  try {
    await requestJson('/auth/signup', { method:'POST', body:JSON.stringify({
      name:el('signup-name').value.trim(), email:el('signup-email').value.trim(), password, role:state.selectedRole
    }) });
    el('login-email').value = el('signup-email').value.trim();
    el('login-pass').value = '';
    el('form-signup').reset();
    switchAuthMode('login', document.querySelector('.auth-tab'));
    showAuthSuccess('Account created. Sign in to continue.');
  } catch (error) { showAuthError(error.message); }
}

export async function handleAdminLogin(event) {
  event.preventDefault();
  const button=el('admin-login-submit'),errorBanner=el('admin-login-error');
  if(button.disabled)return;
  button.disabled=true;button.textContent='Signing in…';errorBanner.style.display='none';
  try {
    const data=await requestJson('/auth/admin/login',{method:'POST',body:JSON.stringify({
      email:el('admin-login-email').value.trim(),password:el('admin-login-password').value
    })});
    if(data.user?.role!=='admin')throw new Error('Invalid credentials');
    state.token=data.token;localStorage.setItem('plateup_token',state.token);
    await loadAccount(true);
    if(state.currentUser?.role!=='admin')throw new Error('Could not load your administrator account.');
    el('admin-login-password').value='';
    await navigateAfterLogin();
  } catch(error) {
    if(!state.currentUser) {state.token=null;localStorage.removeItem('plateup_token');}
    errorBanner.textContent=error.message;errorBanner.style.display='block';
  } finally {button.disabled=false;button.textContent='Sign in to administration';}
}

export function handleLogout() {
  const wasAdmin=state.currentUser?.role==='admin';
  clearReturnRoute();
  persistCart(); state.restoredCartOwner=null; state.favoriteRequest++;
  state.favorites={saved:[],restaurants:[],listings:[]};
  closeModal('password-change-modal'); closeModal('reject-order-modal');
  state.token = null; state.currentUser = null; state.profile = null; state.orders = []; state.businessOrders = [];
  resetRecommendations();
  resetBilling();
  state.businessListings = []; state.cartItems = [];
  state.restaurants=[]; state.selectedRestaurantId=null; state.selectedRestaurant=null; state.restaurantListings=[];
  state.latestRestaurantsRequest++; state.latestRestaurantRequest++;
  state.notifications=[]; state.unreadNotifications=0; state.cartQuote=null; state.cartQuoteRequest++;
  state.selectedPickupOrder=null;
  closeModal('notifications-modal'); closeModal('pickup-modal');
  state.listings = []; state.latestListingsRequest++;
  closeModal('listing-detail-modal'); closeModal('checkout-modal');
  clearTimeout(state.cartToastTimer); el('cart-toast').hidden=true;
  localStorage.removeItem('plateup_token');
  localStorage.removeItem('plateup_user');
  localStorage.removeItem('plateup_screen');
  if(hasView('admin-login')) {
    el('admin-login-form').reset();el('admin-login-error').style.display='none';
  }
  renderTopNav(); renderListings(); showScreen(wasAdmin?'admin-login':'home');
}

export function openPasswordChange() {
  el('password-change-form').reset();el('password-change-feedback').textContent='';el('password-change-modal').classList.add('active');
}

export async function changePassword(event) {
  event.preventDefault(); if(el('password-change-submit').disabled)return;
  if(el('password-new').value!==el('password-confirm').value){el('password-change-feedback').textContent='New passwords do not match.';return;}
  el('password-change-submit').disabled=true;
  try{const wasAdmin=state.currentUser?.role==='admin';const result=await requestJson('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:el('password-current').value,new_password:el('password-new').value})});closeModal('password-change-modal');el('password-change-form').reset();handleLogout();await showScreen(wasAdmin?'admin-login':'login');notify(result.message);}
  catch(error){el('password-change-feedback').textContent=error.message;}
  finally{el('password-change-submit').disabled=false;}
}

export async function openForgotPassword() { await showScreen('recovery'); if (el('recovery-feedback')) el('recovery-feedback').textContent=''; }

export async function requestPasswordReset(event) {
  event.preventDefault();if(el('recovery-submit').disabled)return;el('recovery-submit').disabled=true;
  try{const result=await requestJson('/auth/forgot-password',{method:'POST',body:JSON.stringify({email:el('recovery-email').value})});el('recovery-feedback').textContent=result.message;}
  catch(error){el('recovery-feedback').textContent=error.message;}
  finally{el('recovery-submit').disabled=false;}
}

export async function captureResetLink(hash=location.hash) {
  const match=/^#reset=([a-f0-9]{64})$/.exec(hash||'');
  if(!match)return false;
  state.resetPasswordToken=match[1];history.replaceState(null,'',location.pathname+location.search);await showScreen('reset-password',{historyMode:'replace'});return true;
}

export async function resetPassword(event) {
  event.preventDefault();if(el('reset-submit').disabled)return;
  if(el('reset-new').value!==el('reset-confirm').value){el('reset-feedback').textContent='Passwords do not match.';return;}
  el('reset-submit').disabled=true;
  try{const result=await requestJson('/auth/reset-password',{method:'POST',body:JSON.stringify({token:state.resetPasswordToken,new_password:el('reset-new').value})});state.resetPasswordToken=null;el('reset-form').reset();handleLogout();await showScreen('login');notify(result.message);}
  catch(error){el('reset-feedback').textContent=error.message;}
  finally{el('reset-submit').disabled=false;}
}
