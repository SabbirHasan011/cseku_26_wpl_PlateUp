import { notify } from './feedback.js';
import { state } from './state.js';
import { requestJson } from './api.js';
import { el, escapeHtml, date, closeModal } from './ui.js';
import { showScreen } from './router.js';
import { loadAccount } from './auth.js';
import { renderBusinessOrders, renderMyOrders } from './orders.js';
import { renderProfile } from './profile.js';

export async function refreshNotifications() {
  if (!state.token || !state.currentUser) return;
  const session=state.token;
  const data=await requestJson('/notifications');
  if (session!==state.token) return;
  state.notifications=data.notifications; state.unreadNotifications=data.unread_count;
  const badge=el('notification-count');
  if (badge) badge.textContent=state.unreadNotifications;
  const button=document.querySelector('.notification-nav');
  if (button) button.setAttribute('aria-label','Notifications, '+state.unreadNotifications+' unread');
  el('notifications-list').innerHTML=state.notifications.length?state.notifications.map(note=>
    '<article class="notification-item '+(note.read_at?'':'unread')+'"><p>'+escapeHtml(note.message)+'</p><small>'+date(note.created_at)+
    '</small><div><button class="review-order-btn" data-click="openNotificationOrder" data-arg0="'+note.id+'">View order</button>'+
    (!note.read_at?'<button class="review-order-btn" data-click="markNotificationRead" data-arg0="'+note.id+'">Mark read</button>':'')+'</div></article>').join(''):
    '<div class="empty-history">No order updates yet.</div>';
}

export async function openNotifications() {
  el('notifications-modal').classList.add('active');
  try { await refreshNotifications(); }
  catch(error) { el('notifications-list').textContent=error.message; }
}

export async function markNotificationRead(id) {
  try { await requestJson('/notifications/'+id+'/read',{ method:'PATCH' }); await refreshNotifications(); }
  catch(error) { notify(error.message,'error'); }
}

export async function markNotificationsRead() {
  if (!state.notifications.length) return;
  try {
    await requestJson('/notifications/read',{ method:'PATCH',body:JSON.stringify({ through_id:Math.max(...state.notifications.map(note=>note.id)) }) });
    await refreshNotifications();
  } catch(error) { notify(error.message,'error'); }
}

export async function openNotificationOrder(id) {
  const note=state.notifications.find(note=>note.id===id);
  if (!note) return;
  await markNotificationRead(id); closeModal('notifications-modal');
  if (state.currentUser?.role==='business') await showScreen('business',{tab:'orders'});
  else { await loadAccount(); showScreen('my-orders'); }
}

export async function refreshOrderActivity() {
  if (document.visibilityState==='hidden' || !state.token || !state.currentUser || state.activityRefreshing) return;
  state.activityRefreshing=true;
  const session=state.token;
  try {
    await refreshNotifications();
    const fresh=await requestJson('/orders');
    if (session!==state.token) return;
    if (state.currentUser.role==='business') { state.businessOrders=fresh; renderBusinessOrders(); }
    else { state.orders=fresh; if(state.activeScreen==='my-orders')renderMyOrders(); if (state.activeScreen==='profile' && !el('profile-form').contains(document.activeElement)) renderProfile(); }
  } catch(error) { console.warn(error.message); }
  finally { state.activityRefreshing=false; }
}
