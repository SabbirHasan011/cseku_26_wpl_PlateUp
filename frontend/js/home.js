import { state } from './state.js';
import { el } from './ui.js';

export function showHomeBanner(index) {
  const slides = [...document.querySelectorAll('.home-banner-slide')];
  if (!slides.length) return;
  state.homeBannerIndex = (index % slides.length + slides.length) % slides.length;
  slides.forEach((slide,i) => {
    const active = i === state.homeBannerIndex;
    slide.classList.toggle('active',active);
    slide.setAttribute('aria-hidden',String(!active));
    slide.inert = !active;
  });
  document.querySelectorAll('.banner-dots button').forEach((dot,i) => {
    dot.classList.toggle('active',i === state.homeBannerIndex);
    dot.setAttribute('aria-current',String(i === state.homeBannerIndex));
  });
  el('banner-caption').textContent = state.homeBannerIndex === 0
    ? 'Good food. Better possibilities.' : 'Rescue. Pick up. Share your experience.';
  scheduleHomeBanner();
}

export function scheduleHomeBanner() {
  clearTimeout(state.homeBannerTimer);
  state.homeBannerTimer = null;
  if (state.homeBannerPaused || state.homeBannerHovered || document.visibilityState === 'hidden') return;
  state.homeBannerTimer = setTimeout(() => {
    if (state.activeScreen === 'home') showHomeBanner(state.homeBannerIndex + 1);
    else scheduleHomeBanner();
  },5000);
}

export function setHomeBannerPaused(paused) {
  state.homeBannerPaused = paused;
  el('banner-pause').textContent = paused ? 'Play' : 'Pause';
  el('banner-pause').setAttribute('aria-label',paused ? 'Start automatic banners' : 'Pause automatic banners');
  el('banner-pause').setAttribute('aria-pressed',String(paused));
  scheduleHomeBanner();
}

export function toggleHomeBannerPlayback() {
  setHomeBannerPaused(!state.homeBannerPaused);
}

let initialized = false;
export function initHomeBanner() {
  if (initialized) return;
  initialized = true;
  const banner = el('home-banner');
  setHomeBannerPaused(false);
  banner.addEventListener('pointerenter',() => { state.homeBannerHovered = true; scheduleHomeBanner(); });
  banner.addEventListener('pointerleave',() => { state.homeBannerHovered = false; scheduleHomeBanner(); });
  document.addEventListener('visibilitychange',scheduleHomeBanner);
}
