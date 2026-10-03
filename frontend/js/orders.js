import { notify } from './feedback.js';
import { state } from './state.js';
import { requestJson } from './api.js';
import { loadBusiness } from './business.js';
import { renderProfile } from './profile.js';
import { loadInitialData } from './marketplace.js';
import { refreshNotifications } from './notifications.js';
import { el, escapeHtml, money, pickupDate, closeModal } from './ui.js';

export async function changeOrder(id,status) {
  try {
    await requestJson('/orders/' + id, { method:'PATCH',body:JSON.stringify({ status }) });
    if (state.currentUser.role === 'business') await loadBusiness();
    else { state.orders=await requestJson('/orders'); renderProfile(); }
    await loadInitialData();
    await refreshNotifications();
  } catch(error) { notify(error.message,'error'); }
}

export function renderBusinessOrders() {
  if (!el('business-orders')) return;
  el('business-orders').innerHTML = state.businessOrders.length ? state.businessOrders.map(order => {
    const next = ({ pending:'confirmed',confirmed:'ready',ready:'completed' })[order.status];
    return '<div class="order-row"><strong>#' + order.id + ' · ' + escapeHtml(order.listing_title) +
      '</strong><span>' + order.quantity + ' units · ' + money(order.total_price) +
    '</span><span>' + escapeHtml(order.status) + '</span><small>Pickup by '+pickupDate(order.pickup_deadline)+'</small>'+
      (order.status_reason?'<p>'+escapeHtml(order.status_reason)+'</p>':'') + (next==='completed'
        ? '<button class="review-order-btn" data-click="openPickupVerification" data-arg0="'+order.id+'">Verify pickup</button>' : next
        ? '<button class="review-order-btn" data-click="changeOrder" data-arg0="' + order.id + '" data-arg1="' + next +
          '">Mark ' + next + '</button>' : '') +
      (next?'<button class="review-order-btn danger-action" data-click="openRejectOrder" data-arg0="'+order.id+'">Reject</button>':'')+'</div>';
  }).join('') : '<div class="empty-history">No reservations yet.</div>';
}

export function openPickupVerification(id) {
  const order=state.businessOrders.find(order=>order.id===id && order.status==='ready');
  if (!order) return;
  state.selectedPickupOrder=id;
  el('pickup-context').textContent='Order #'+id+' · '+order.listing_title+' · '+order.quantity+' portions';
  el('pickup-code-input').value=''; el('pickup-feedback').textContent='';
  el('pickup-modal').classList.add('active'); el('pickup-code-input').focus();
}

export async function verifyPickup(event) {
  event.preventDefault();
  if (!state.selectedPickupOrder || el('pickup-submit').disabled) return;
  el('pickup-submit').disabled=true;
  try {
    await requestJson('/orders/'+state.selectedPickupOrder,{ method:'PATCH',body:JSON.stringify({
      status:'completed',pickup_code:el('pickup-code-input').value.trim()
    }) });
    closeModal('pickup-modal'); state.selectedPickupOrder=null;
    await loadBusiness(); await refreshNotifications();
  } catch(error) { el('pickup-feedback').textContent=error.message; }
  finally { el('pickup-submit').disabled=false; }
}

export function setOrderTab(tab) { state.orderTab=tab; renderMyOrders(); }

export async function loadMyOrders() {
  const session=state.token;
  el('my-orders-status').textContent='Refreshing your orders…';
  try {
    const rows=await requestJson('/orders');
    if(session!==state.token)return;
    state.orders=rows; renderMyOrders();
  } catch(error) { if(session===state.token)el('my-orders-status').textContent=error.message; }
}

export function renderMyOrders() {
  if (!el('my-orders')) return;
  const active=['pending','confirmed','ready'];
  const rows=state.orders.filter(order=>state.orderTab==='active'?active.includes(order.status):state.orderTab==='completed'?order.status==='completed':!active.includes(order.status)&&order.status!=='completed');
  document.querySelectorAll('[data-order-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.orderTab===state.orderTab);button.setAttribute('aria-pressed',String(button.dataset.orderTab===state.orderTab));});
  el('my-orders-status').textContent=rows.length+' '+state.orderTab+' reservation'+(rows.length===1?'':'s');
  el('my-orders-list').innerHTML=rows.length?rows.map(order=>{
    const stages=['pending','confirmed','ready','completed'], current=stages.indexOf(order.status);
    const timeline=current>=0?'<ol class="order-timeline">'+stages.map((stage,i)=>'<li class="'+(i<=current?'reached':'')+'">'+({pending:'Reserved',confirmed:'Confirmed',ready:'Ready',completed:'Collected'})[stage]+'</li>').join('')+'</ol>':'';
    return '<article class="customer-order-card"><div class="order-card-heading"><div><small>Order #'+order.id+'</small><h3>'+escapeHtml(order.listing_title)+'</h3><span>'+escapeHtml(order.business_name)+' · '+order.quantity+' portions</span></div><strong>'+money(order.total_price)+'</strong></div>'+timeline+
      '<div class="order-pickup-details"><p><strong>Pickup by</strong> '+pickupDate(order.pickup_deadline)+'</p><p>'+escapeHtml([order.pickup_address,order.city].filter(Boolean).join(' · '))+'</p></div>'+
      (order.pickup_code?'<div class="pickup-code"><span>Show this code at pickup</span><strong>'+escapeHtml(order.pickup_code)+'</strong></div>':'')+
      '<p class="order-state">'+escapeHtml(order.status)+(order.status_reason?' · '+escapeHtml(order.status_reason):'')+'</p>'+
      (['pending','confirmed'].includes(order.status)?'<button class="btn-sec" data-click="changeOrder" data-arg0="'+order.id+'" data-arg1="cancelled">Cancel reservation</button>':order.status==='completed'?'<button class="btn-sec" data-click="openReviewModal" data-arg0="'+order.id+'">'+(state.reviews.some(row=>row.order_id===order.id)?'Edit review':'Review meal')+'</button>':'')+'</article>';
  }).join(''):'<div class="feed-empty">No '+state.orderTab+' reservations.</div>';
}

export function openRejectOrder(id) {
  state.rejectOrderId=id;el('reject-reason').value='';el('reject-feedback').textContent='';el('reject-order-modal').classList.add('active');el('reject-reason').focus();
}

export async function rejectOrder(event) {
  event.preventDefault(); if(!state.rejectOrderId||el('reject-submit').disabled)return;
  el('reject-submit').disabled=true;
  try { await requestJson('/orders/'+state.rejectOrderId,{method:'PATCH',body:JSON.stringify({status:'rejected',reason:el('reject-reason').value})});closeModal('reject-order-modal');await loadBusiness();await refreshNotifications(); }
  catch(error){el('reject-feedback').textContent=error.message;}
  finally{el('reject-submit').disabled=false;}
}
