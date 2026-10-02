import { ensureView } from './views.js';
import { state } from './state.js';
import { requestJson, API_BASE } from './api.js';
import { renderBusinessOrders } from './orders.js';
import { renderListings } from './marketplace.js';
import { el, money, escapeHtml, date } from './ui.js';
import { renderReviews } from './reviews.js';
import { renderProfile } from './profile.js';
import { loadTrainingData } from './training.js';

export async function loadBusiness() {
  if (!state.currentUser || state.currentUser.role !== 'business') return;
  const session = state.token;
  try {
    await ensureView('business');
    if (session !== state.token || state.currentUser?.role !== 'business') return;
    const [own, incoming, analytics, predictions] = await Promise.all([
      requestJson('/business/listings'), requestJson('/orders'),
      requestJson('/business/analytics'), requestJson('/business/predictions')
    ]);
    if (session !== state.token || state.currentUser?.role !== 'business') return;
    state.businessListings = own;
    state.businessOrders = incoming;
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
      ? predictions.map(p => p.prediction_type + ': ' + p.predicted_value).join(' · ')
      : 'No predictions yet. The ML module has not been developed.';
    el('biz-name-text').textContent = state.profile.business_name || state.currentUser.name;
    el('biz-avatar-text').textContent = (state.profile.business_name || state.currentUser.name).slice(0,2).toUpperCase();
    el('biz-role-text').textContent = 'Business ID: ' + state.currentUser.id;
    renderReviews();
  } catch (error) { alert('Could not load business data: ' + error.message); }
}

export async function refreshBusinessListings() {
  if (state.currentUser?.role!=='business') return;
  try {
    state.businessListings=await requestJson('/business/listings',{ cache:'no-store' });
    renderListings();
    if (el('biz-active-count')) el('biz-active-count').textContent=state.businessListings.filter(item=>item.daily_status==='Active').length;
  } catch(error) { console.error(error); }
}

export function switchBizTab(name, element) {
  el('biz-tab-overview').classList.toggle('listings-view',name === 'listings');
  document.querySelectorAll('.sidebar .navitem').forEach(item => item.classList.remove('on'));
  element?.classList.add('on');
  ['overview','orders','analytics','reviews','profile','training'].forEach(tab => {
    el('biz-tab-' + tab).style.display = tab === name || (name === 'listings' && tab === 'overview') ? 'block' : 'none';
  });
  if (name === 'profile') renderProfile();
  if (name === 'listings') loadBusiness();
  if (name === 'analytics') loadDailyAnalytics();
  if (name === 'training') loadTrainingData();
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
