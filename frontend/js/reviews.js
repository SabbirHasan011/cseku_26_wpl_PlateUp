import { state } from './state.js';
import { el, escapeHtml, closeModal } from './ui.js';
import { requestJson } from './api.js';
import { renderProfile } from './profile.js';
import { fetchListings } from './marketplace.js';

export function renderReviews() {
  if (!el('reviews-feed')) return;
  const name=state.profile?.business_name;
  const own=state.reviews.filter(review=>review.business_id===state.currentUser?.id && state.currentUser?.role==='business');
  const avg=own.length ? (own.reduce((sum,review)=>sum+Number(review.rating),0)/own.length).toFixed(1) : 'N/A';
  el('biz-avg-rating').textContent=avg==='N/A'?avg:avg+' ★';
  el('review-summary-tag').textContent=own.length+' reviews';
  el('reviews-feed').innerHTML=own.length ? own.map(review =>
    '<div class="review-item"><strong>' + escapeHtml(review.author_name) + '</strong> · ' +
    Number(review.rating) + ' ★<p>' + escapeHtml(review.comment) + '</p><small>' +
    escapeHtml(review.item_name) + '</small>' + (review.reply
      ? '<div class="review-reply">' + escapeHtml(review.reply) + '</div>'
      : '<div class="reply-input-box"><input id="reply-input-' + review.id +
        '" placeholder="Public reply"><button data-click="submitReviewReply" data-arg0="' + review.id +
        '">Reply</button></div>') + '</div>').join('')
    : '<div class="empty-history">No reviews yet.</div>';
}

export function renderHomeReviews() {
  if (!el('home')) return;
  const publicReviews=state.reviews.slice(0,6);
  el('home-reviews-carousel').innerHTML=publicReviews.length
    ? publicReviews.map((review,index)=>'<article class="home-review-slide ' +
      (index===0?'active':'') + '"><div class="home-review-stars">' +
      '★'.repeat(Number(review.rating)) + '</div><blockquote>“' +
      escapeHtml(review.comment) + '”</blockquote><div class="home-review-author"><strong>' +
      escapeHtml(review.author_name) + '</strong><span>' + escapeHtml(review.business_name) +
      '</span></div></article>').join('')
    : '<div class="empty-history">No reviews yet.</div>';
  el('review-carousel-dots').innerHTML=publicReviews.map((_,index)=>
    '<button aria-label="Show review ' + (index+1) + '" data-click="showReviewSlide" data-arg0="' + index + '"></button>').join('');
  if (state.carouselTimer) clearInterval(state.carouselTimer);
  if (publicReviews.length>1) state.carouselTimer=setInterval(()=>{
    const slides=[...document.querySelectorAll('.home-review-slide')];
    const active=slides.findIndex(slide=>slide.classList.contains('active'));
    showReviewSlide((active+1)%slides.length);
  },5000);
}

export function showReviewSlide(index) {
  document.querySelectorAll('.home-review-slide').forEach((slide,i)=>slide.classList.toggle('active',i===index));
  document.querySelectorAll('#review-carousel-dots button').forEach((dot,i)=>dot.classList.toggle('active',i===index));
}

export async function submitReviewReply(id) {
  try {
    await requestJson('/reviews/' + id + '/reply',{ method:'PATCH',
      body:JSON.stringify({ reply:el('reply-input-' + id).value }) });
    state.reviews=await requestJson('/reviews'); renderReviews(); renderHomeReviews();
  } catch(error) { alert(error.message); }
}

export function openReviewModal(orderId) {
  state.selectedReviewOrder=state.orders.find(order=>order.id===orderId);
  if (!state.selectedReviewOrder || state.selectedReviewOrder.status!=='completed') return;
  const existing=state.reviews.find(review=>review.order_id===orderId);
  state.editingReviewId=existing?.id||null;
  el('review-order-context').textContent=state.selectedReviewOrder.listing_title +
    ' from ' + state.selectedReviewOrder.business_name;
  el('rev-rating').value=existing?.rating||5;
  el('rev-comment').value=existing?.comment||'';
  el('review-modal').classList.add('active');
}

export async function submitCustomerReview() {
  if (!state.selectedReviewOrder) return;
  try {
    await requestJson('/reviews' + (state.editingReviewId?'/'+state.editingReviewId:''),{
      method:state.editingReviewId?'PUT':'POST',
      body:JSON.stringify({ order_id:state.selectedReviewOrder.id,rating:Number(el('rev-rating').value),
        comment:el('rev-comment').value })
    });
    closeModal('review-modal'); state.reviews=await requestJson('/reviews');
    renderProfile(); renderHomeReviews(); await fetchListings();
  } catch(error) { alert(error.message); }
}

export async function deleteReview(id) {
  if (!confirm('Delete your review?')) return;
  try {
    await requestJson('/reviews/' + id, { method:'DELETE' });
    state.reviews=await requestJson('/reviews'); renderProfile(); renderHomeReviews(); await fetchListings();
  } catch(error) { alert(error.message); }
}
