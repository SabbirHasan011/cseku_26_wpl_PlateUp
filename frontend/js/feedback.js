import { el } from './ui.js';

let dismissTimer=null;
export function dismissNotice() {
  clearTimeout(dismissTimer);
  if(el('app-notice'))el('app-notice').hidden=true;
}
export function notify(message,type='success') {
  const box=el('app-notice'),text=el('app-notice-message');
  if(!box||!text)return;
  clearTimeout(dismissTimer);
  box.dataset.tone=type;box.hidden=false;text.textContent=message;
  if(type!=='error')dismissTimer=setTimeout(dismissNotice,6000);
}
export function skeletonCards(count=3) {
  return '<div class="loading-label" role="status">Loading fresh finds…</div>'+Array.from({length:count},()=>
    '<article class="food-card skeleton-card" aria-hidden="true"><div class="skeleton-media shimmer"></div>'+ 
    '<div class="food-body"><div class="skeleton-line shimmer"></div><div class="skeleton-line long shimmer"></div>'+ 
    '<div class="skeleton-line shimmer"></div><div class="skeleton-button shimmer"></div></div></article>').join('');
}
