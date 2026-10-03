import { ensureView } from './views.js';
import { state } from './state.js';
import { requestJson, API_BASE } from './api.js';
import { renderBusinessOrders } from './orders.js';
import { renderListings } from './marketplace.js';
import { el, money, escapeHtml, date } from './ui.js';
import { renderReviews } from './reviews.js';
import { renderProfile } from './profile.js';
import { loadTrainingData } from './training.js';
import { showScreen } from './router.js';
import { businessTabs } from './page-urls.js';
import { notify, skeletonCards } from './feedback.js';

export async function loadBusiness() {
  if (!state.currentUser || state.currentUser.role !== 'business') return;
  const session = state.token;
  try {
    await ensureView('business');
    if (session !== state.token || state.currentUser?.role !== 'business') return;
    if(!state.businessListings.length)el('business-listings').innerHTML=skeletonCards(2);
    const [own, incoming, analytics, predictions] = await Promise.all([
      requestJson('/business/listings'), requestJson('/orders'),
      requestJson('/business/analytics'), requestJson('/business/predictions')
    ]);
    if (session !== state.token || state.currentUser?.role !== 'business') return;
    state.businessListings = own;
    state.businessOrders = incoming;
    const today=analytics.today;
    el('biz-today-portions').textContent=today?.remaining_portions??'—';
    el('biz-today-incoming').textContent=today?.incoming_orders??'—';
    el('biz-today-pickups').textContent=today?.completed_pickups??'—';
    el('biz-today-revenue').textContent=today?money(today.revenue):'—';
    const missing=own.filter(item=>item.initial_quantity==null).length;
    el('business-next-steps').innerHTML=!own.length
      ? '<strong>Build your daily menu</strong><p>Add a food item once, then enter its portions each day.</p><button class="btn-pri" data-click="openNewListingModal">Add your first item</button>'
      : '<strong>Your next steps</strong><p>'+ (missing?missing+' food item'+(missing===1?' needs':'s need')+' today’s quantity.':'Daily quantities have been entered for all your items.')+'</p>'+
        '<button class="btn-sec" data-click="switchBizTab" data-arg0="listings">'+(missing?'Set daily quantities':'Review daily quantities')+'</button>'+
        (Number(today?.incoming_orders)>0?'<p>'+today.incoming_orders+' incoming order'+(Number(today.incoming_orders)===1?' is':'s are')+' waiting for your response.</p><button class="btn-sec" data-click="switchBizTab" data-arg0="orders">Review incoming orders</button>':'');
    renderBusinessOrders();
    renderListings();
    el('biz-active-count').textContent = analytics.summary.active_listings;
    el('biz-meals-count').textContent = analytics.summary.meals_rescued;
    el('biz-revenue').textContent = money(analytics.summary.revenue);
    el('business-sales').innerHTML = analytics.sales.length
      ? analytics.sales.map(s => '<div class="order-row"><strong>' + escapeHtml(s.title) + '</strong><span>' +
        s.quantity_sold + ' sold · ' + money(s.price) + '</span><span>' + date(s.sale_time) + '</span></div>').join('')
      : '<div class="empty-history">No completed sales yet.</div>';
    el('business-predictions').textContent = predictions.length
      ? predictions.slice(0,10).map(p => (p.listing_title||'Item #'+p.listing_id) + ': '+money(p.predicted_value)+
        (p.model_source==='synthetic_model'?' (synthetic demo)':' (model)')+' · '+date(p.prediction_date)).join(' | ')
      : 'No model price changes yet. Open Pricing & item history on a food item to train its model.';
    el('biz-name-text').textContent = state.profile.business_name || state.currentUser.name;
    el('biz-avatar-text').textContent = (state.profile.business_name || state.currentUser.name).slice(0,2).toUpperCase();
    el('biz-role-text').textContent = 'Business ID: ' + state.currentUser.id;
    renderReviews();
  } catch (error) {
    if(session!==state.token)return;
    if(!state.businessListings.length)el('business-listings').innerHTML='<div class="feed-empty"><strong>Could not load your menu</strong><p>'+escapeHtml(error.message)+'</p><button class="btn-sec" data-click="loadBusiness">Try again</button></div>';
    notify('Could not load business data: ' + error.message,'error');
  }
}

export async function refreshBusinessListings() {
  if (state.currentUser?.role!=='business') return;
  if(state.activeScreen==='business' && state.activeBusinessTab==='overview')return loadBusiness();
  const session=state.token;
  try {
    const items=await requestJson('/business/listings',{ cache:'no-store' });
    if(session!==state.token)return;
    state.businessListings=items;
    renderListings();
    if (el('biz-active-count')) el('biz-active-count').textContent=state.businessListings.filter(item=>item.daily_status==='Active').length;
  } catch(error) { console.error(error); }
}

export function switchBizTab(name, element) {
  if(!businessTabs.includes(name))return;
  return showScreen('business',{tab:name});
}

export function activateBusinessTab(name) {
  state.activeBusinessTab=name;
  document.querySelectorAll('.sidebar .navitem').forEach(item => {
    item.classList.toggle('on',item.dataset.arg0===name);
    item.setAttribute('aria-current',item.dataset.arg0===name?'page':'false');
  });
  ['overview','listings','orders','analytics','reviews','profile','training'].forEach(tab => {
    el('biz-tab-' + tab).style.display = tab === name ? 'block' : 'none';
  });
  const headings={overview:['Today at your kitchen','Your daily offers and pickups, at a glance.'],listings:['Manage Listings','Save your menu once. Update today’s portions when they’re ready.'],orders:['Manage Orders','Confirm reservations and help customers collect their meals.'],analytics:['Sales & Analytics','Track the food rescued and revenue earned by your kitchen.'],training:['Sales History','Prepare and inspect your historical sales data.'],reviews:['Customer Reviews','See customer feedback and reply to their experience.'],profile:['Business Profile','Keep your kitchen’s location and contact details up to date.']};
  el('business-mobile-tab').value=name;
  el('business-page-title').textContent=headings[name][0];
  el('business-page-caption').textContent=headings[name][1];
  if (name === 'profile') renderProfile();
  if (name === 'analytics') return loadDailyAnalytics();
  if (name === 'training') return loadTrainingData();
}

export function analyticsQuery() {
  return '?from='+encodeURIComponent(el('analytics-from').value)+'&to='+encodeURIComponent(el('analytics-to').value);
}

export async function loadDailyAnalytics() {
  const session=state.token, request=++state.analyticsRequest; el('analytics-feedback').textContent='Loading daily report…';
  try {
    const data=await requestJson('/business/analytics/daily'+analyticsQuery());
    if(session!==state.token||request!==state.analyticsRequest)return;
    state.dailyAnalytics=data; el('analytics-from').value=data.from;el('analytics-to').value=data.to;
    const totals=data.days.reduce((sum,row)=>{for(const key of ['offered','reserved','collected','remaining','missed','revenue'])sum[key]+=Number(row[key]);return sum;},{offered:0,reserved:0,collected:0,remaining:0,missed:0,revenue:0});
    el('analytics-summary').innerHTML=[['Offered',totals.offered],['Awaiting pickup',totals.reserved],['Collected',totals.collected],['Unreserved / left over',totals.remaining],['Missed pickup portions',totals.missed],['Revenue',money(totals.revenue)]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('');
    el('analytics-days').innerHTML=data.days.map(row=>'<tr>'+[row.date,row.offered,row.reserved,row.collected,row.remaining,row.missed,money(row.revenue)].map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('');
    el('analytics-feedback').textContent=data.days.length?'Based on daily offer dates in Bangladesh time.':'No daily inventory in this date range.';
  } catch(error){if(session===state.token&&request===state.analyticsRequest)el('analytics-feedback').textContent=error.message;}
}

export async function exportDailyAnalytics() {
  try {
    const response=await fetch(API_BASE+'/business/analytics/daily'+analyticsQuery()+'&format=csv',{headers:{Authorization:'Bearer '+state.token}});
    if(!response.ok)throw new Error((await response.json()).message||'Could not export report.');
    const url=URL.createObjectURL(await response.blob()), link=document.createElement('a');
    link.href=url;link.download='plateup-daily-sales.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error){el('analytics-feedback').textContent=error.message;}
}
