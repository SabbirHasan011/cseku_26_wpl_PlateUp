import { state } from './state.js';
import { API_BASE } from './api.js';
import { closeOfferTimePicker, saveFoodCategory } from './listings.js';

export const el = id => document.getElementById(id);

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export const money = amount => '৳' + Number(amount || 0).toFixed(2);

export const date = value => value ? new Date(value).toLocaleString() : 'Any time';

export const offerTime = value => {
  if (!value) return 'Not set';
  const [hour,minute] = value.slice(0,5).split(':').map(Number);
  return (hour % 12 || 12) + ':' + String(minute).padStart(2,'0') + (hour < 12 ? ' AM' : ' PM');
};

export const imageUrl = path => path ? API_BASE.replace(/\/api$/,'') + path : '';

export const itemThumbnail = item => '<div class="food-thumb">' + (item.image_path
  ? '<img src="' + escapeHtml(imageUrl(item.image_path)) + '" alt="' + escapeHtml(item.title) + '" loading="lazy">'
  : '<span class="initial">' + escapeHtml(item.title.slice(0,2)) + '</span>') + '</div>';

export function itemRating(item) {
  const count = Number(item.review_count) || 0;
  const rating = count ? Math.max(0, Math.min(5, Number(item.average_rating) || 0)) : 0;
  const label = count ? rating.toFixed(1) + ' out of 5 from ' + count + ' review' + (count === 1 ? '' : 's') : 'No reviews yet';
  const stars = Array.from({ length:5 }, (_,index) => '<span class="rating-star"><span class="rating-fill" style="width:' +
    Math.max(0,Math.min(100,(rating-index)*100)) + '%">&#9733;</span>&#9733;</span>').join('');
  return '<div class="item-rating" aria-label="' + label + '"><span class="rating-stars" aria-hidden="true">' +
    stars + '</span><span class="rating-caption">' + (count ? '<strong>' + rating.toFixed(1) +
    '</strong> (' + count + ' review' + (count === 1 ? '' : 's') + ')' : 'No reviews yet') + '</span></div>';
}

export const pickupDate=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})+' BST':'Not specified';

export function closeModal(id) {
  el(id).classList.remove('active');
  if (id==='new-listing-modal') { state.listingEditorVersion++; state.latestCategoryRequest++; closeOfferTimePicker(false); }
  if (id==='checkout-modal') {
    document.body.classList.remove('cart-is-open');
    if (state.cartReturnFocus?.isConnected) state.cartReturnFocus.focus();
    else if (state.cartReturnFocus) el('cart-open')?.focus();
    state.cartReturnFocus=null;
  }
  if (id === 'listing-detail-modal') {
    state.latestDetailRequest++; state.detailItem = null;
    document.body.classList.remove('meal-dialog-open');
    if (state.detailReturnFocus?.isConnected) state.detailReturnFocus.focus();
    state.detailReturnFocus = null;
  }
  if (id==='new-listing-modal' && state.listingPreviewUrl) {
    URL.revokeObjectURL(state.listingPreviewUrl); state.listingPreviewUrl=null;
  }
}

let keyboardInstalled = false;
export function installDialogKeyboard() {
  if (keyboardInstalled) return;
  keyboardInstalled = true;
document.addEventListener('keydown',event => {
  if (event.key === 'Enter' && event.target?.id === 'new-category-name') {
    event.preventDefault(); saveFoodCategory(); return;
  }
  if (event.key==='Escape' && state.offerTimeDraft) { event.preventDefault(); closeOfferTimePicker(); return; }
  const modalId=['password-change-modal','reject-order-modal','checkout-modal','listing-detail-modal','new-listing-modal'].find(id=>el(id)?.classList.contains('active'));
  if (!modalId) return;
  if (event.key === 'Escape') { event.preventDefault(); closeModal(modalId); }
  if (event.key === 'Tab') {
    const focusable = [...el(modalId).querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
      .filter(node=>node.getClientRects().length>0);
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
}
