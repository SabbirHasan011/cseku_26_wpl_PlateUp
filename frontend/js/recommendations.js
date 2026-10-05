import { state } from './state.js';
import { requestJson } from './api.js';
import { el, escapeHtml } from './ui.js';
import { foodCard } from './marketplace.js';
import { hasView } from './views.js';
import { profileCity } from './profile.js';
import { skeletonCards } from './feedback.js';

const contextKey = () => state.currentUser?.role === 'customer' && state.token ?
  JSON.stringify([state.currentUser.id, state.token, state.profile?.customer_city_id, profileCity()]) : null;

export function resetRecommendations() {
  state.recommendationRequest++;
  state.recommendations = [];
  state.recommendationContext = null;
  state.recommendationStatus = 'idle';
  state.recommendationError = '';
  renderRecommendations();
}

export function renderRecommendations() {
  const section = el('home-recommendations');
  if (!section) return;
  const context = contextKey();
  section.hidden = !context;
  if (!context) {
    el('recommendation-grid').innerHTML = '';
    el('recommendation-grid').setAttribute('aria-busy', 'false');
    el('recommendation-status').textContent = '';
    return;
  }
  // Cached views must never show meals from another account or city.
  if (state.recommendationContext !== context) {
    state.recommendationRequest++;
    state.recommendations = [];
    state.recommendationContext = context;
    state.recommendationStatus = 'idle';
    state.recommendationError = '';
  }
  const grid = el('recommendation-grid'), status = el('recommendation-status');
  grid.setAttribute('aria-busy', String(state.recommendationStatus === 'loading'));
  if (!profileCity()) {
    status.textContent = 'Choose your city to find meals near you.';
    grid.innerHTML = '<div class="feed-empty"><strong>Where would you like to pick up?</strong><p>Save your city to see local suggestions.</p><button class="btn-sec" data-click="openCitySettings">Set my city</button></div>';
  } else if (state.recommendationStatus === 'error') {
    status.textContent = 'Suggestions could not be loaded.';
    grid.innerHTML = '<div class="feed-empty"><strong>Try again in a moment</strong><p>' + escapeHtml(state.recommendationError) +
      '</p><button class="btn-sec" data-click="loadRecommendations">Try again</button></div>';
  } else if ((state.recommendationStatus === 'loading' && !state.recommendations.length) || state.recommendationStatus === 'idle') {
    status.textContent = 'Finding your next meal...';
    grid.innerHTML = skeletonCards();
  } else {
    status.textContent = state.recommendationMode === 'personalized' ?
      'Picked using your completed orders, saved meals and reviews.' : 'Local picks to get you started. Save or review meals to make these more personal.';
    grid.innerHTML = state.recommendations.length ? state.recommendations.map(item =>
      '<div class="recommended-meal">' + foodCard(item) + '<p class="recommendation-reason">' +
      escapeHtml(item.recommendation_reason) + '</p></div>').join('') :
      '<div class="feed-empty"><strong>No suggestions available right now</strong><p>Check back when local restaurants add portions during their offer hours.</p></div>';
  }
}

export async function loadRecommendations() {
  if (!hasView('home')) return;
  renderRecommendations();
  const context = contextKey();
  if (!context || !profileCity()) return;
  const request = ++state.recommendationRequest;
  state.recommendationStatus = 'loading';
  renderRecommendations();
  try {
    const result = await requestJson('/recommendations', { cache: 'no-store' });
    if (request !== state.recommendationRequest || context !== contextKey()) return;
    state.recommendations = result.listings;
    state.recommendationMode = result.mode;
    state.recommendationStatus = 'ready';
    state.recommendationError = '';
  } catch (error) {
    if (request !== state.recommendationRequest || context !== contextKey()) return;
    state.recommendations = [];
    state.recommendationStatus = 'error';
    state.recommendationError = error.message;
  }
  renderRecommendations();
}
