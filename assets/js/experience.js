// Customer conveniences share the existing API client, authentication, and cart.
let restoredCartOwner=null;
let favorites={saved:[],restaurants:[],listings:[]};
let favoriteRequest=0;
let orderTab='active';
let resetPasswordToken=null;
let dailyAnalytics=null;
let analyticsRequest=0;

function persistCart() {
  if (currentUser?.role!=='customer') return;
  try { localStorage.setItem('plateup_cart_'+currentUser.id,JSON.stringify({
    version:1,city_id:profile?.customer_city_id||null,items:groupedCart()
  })); } catch(_) { /* Private browsing/storage limits must not prevent checkout. */ }
}
async function restoreCart() {
  if (currentUser?.role!=='customer' || restoredCartOwner===currentUser.id) return;
  restoredCartOwner=currentUser.id; cartItems=[]; cartQuote=null;
  try {
    const saved=JSON.parse(localStorage.getItem('plateup_cart_'+currentUser.id)||'null');
    if (saved?.version===1 && saved.city_id===(profile?.customer_city_id||null) && Array.isArray(saved.items) && saved.items.length<=30) {
      let total=0;
      for (const row of saved.items) {
        if (!Number.isSafeInteger(row.listing_id)||row.listing_id<1||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>100000) continue;
        total+=row.quantity; if (total>100000) break;
        const item={listing_id:row.listing_id,title:String(row.title||'Saved meal').slice(0,255),
          business_name:String(row.business_name||'Restaurant pickup').slice(0,255),
          price:Number.isFinite(row.price)&&row.price>=0?row.price:0};
        for(let i=0;i<row.quantity;i++) cartItems.push({...item});
      }
    }
  } catch(_) { cartItems=[]; }
  renderTopNav(); persistCart();
  if (cartItems.length) await refreshCartQuote();
}
async function loadMarketplaceCategories() {
  const rows=await requestJson('/categories',{cache:'no-store'});
  if (activeCategory!=='All' && !rows.some(row=>row.name===activeCategory)) activeCategory='All';
  el('marketplace-categories').innerHTML=['All',...rows.map(row=>row.name)].map(name=>
    '<button type="button" class="chip '+(name===activeCategory?'on':'')+'" data-category="'+escapeHtml(name)+
    '" onclick="filterCategory(this.dataset.category,this)">'+escapeHtml(name)+'</button>').join('');
  renderListings();
}
function favoriteButton(kind,id) {
  if(currentUser?.role!=='customer') return '';
  const saved=favorites.saved.some(row=>(kind==='listing'?row.listing_id:row.business_id)===id);
  return '<button class="favorite-btn '+(saved?'saved':'')+'" type="button" aria-pressed="'+saved+'" onclick="toggleFavorite(\''+kind+'\','+id+')">'+
    (saved?'♥ Saved':'♡ Save')+'</button>';
}
async function loadFavorites() {
  if(currentUser?.role!=='customer') return;
  const request=++favoriteRequest, session=token;
  try {
    const data=await requestJson('/favorites',{cache:'no-store'});
    if(request!==favoriteRequest||session!==token)return;
    favorites=data; renderFavorites(); renderListings();
    if(activeScreen==='restaurant') updateRestaurantFavorite();
  } catch(error) { if(request===favoriteRequest&&session===token) el('favorites-status').textContent=error.message; }
}
async function toggleFavorite(kind,id) {
  if(currentUser?.role!=='customer') return showScreen('login');
  const saved=favorites.saved.some(row=>(kind==='listing'?row.listing_id:row.business_id)===id);
  try {
    await requestJson('/favorites/'+kind+'/'+id,{method:saved?'DELETE':'PUT'});
    await loadFavorites();
    if(activeScreen==='restaurant') renderRestaurantMenu();
  } catch(error) { alert(error.message); }
}
function updateRestaurantFavorite() {
  const holder=el('restaurant-favorite');
  if(holder&&selectedRestaurant) holder.innerHTML=favoriteButton('business',selectedRestaurant.id);
}
function renderFavorites() {
  el('favorites-status').textContent='Saved to your account. Meals are shown only while available in your city.';
  el('favorite-restaurants').innerHTML=favorites.restaurants.length?favorites.restaurants.map(item=>
    '<article class="saved-restaurant"><div><h3>'+escapeHtml(item.business_name)+'</h3><p>'+escapeHtml(item.city||'City not set')+'</p></div><button class="btn-sec" onclick="openRestaurant('+item.id+')">View meals</button>'+favoriteButton('business',item.id)+'</article>').join(''):'<p>No saved restaurants yet. Open a restaurant and select Save.</p>';
  el('favorite-meals').innerHTML=favorites.listings.length?favorites.listings.map(foodCard).join(''):'<p>No saved meals available right now.</p>';
  const unavailable=favorites.saved.filter(row=>row.listing_id?!favorites.listings.some(item=>item.id===row.listing_id):!favorites.restaurants.some(item=>item.id===row.business_id));
  el('unavailable-favorites').innerHTML=unavailable.map(row=>'<div class="unavailable-favorite"><span>'+escapeHtml(row.title)+' · Currently unavailable</span>'+favoriteButton(row.listing_id?'listing':'business',row.listing_id||row.business_id)+'</div>').join('');
}
const pickupDate=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})+' BST':'Not specified';
function setOrderTab(tab) { orderTab=tab; renderMyOrders(); }
async function loadMyOrders() {
  const session=token;
  el('my-orders-status').textContent='Refreshing your orders…';
  try {
    const rows=await requestJson('/orders');
    if(session!==token)return;
    orders=rows; renderMyOrders();
  } catch(error) { if(session===token)el('my-orders-status').textContent=error.message; }
}
function renderMyOrders() {
  const active=['pending','confirmed','ready'];
  const rows=orders.filter(order=>orderTab==='active'?active.includes(order.status):orderTab==='completed'?order.status==='completed':!active.includes(order.status)&&order.status!=='completed');
  document.querySelectorAll('[data-order-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.orderTab===orderTab);button.setAttribute('aria-pressed',String(button.dataset.orderTab===orderTab));});
  el('my-orders-status').textContent=rows.length+' '+orderTab+' reservation'+(rows.length===1?'':'s');
  el('my-orders-list').innerHTML=rows.length?rows.map(order=>{
    const stages=['pending','confirmed','ready','completed'], current=stages.indexOf(order.status);
    const timeline=current>=0?'<ol class="order-timeline">'+stages.map((stage,i)=>'<li class="'+(i<=current?'reached':'')+'">'+({pending:'Reserved',confirmed:'Confirmed',ready:'Ready',completed:'Collected'})[stage]+'</li>').join('')+'</ol>':'';
    return '<article class="customer-order-card"><div class="order-card-heading"><div><small>Order #'+order.id+'</small><h3>'+escapeHtml(order.listing_title)+'</h3><span>'+escapeHtml(order.business_name)+' · '+order.quantity+' portions</span></div><strong>'+money(order.total_price)+'</strong></div>'+timeline+
      '<div class="order-pickup-details"><p><strong>Pickup by</strong> '+pickupDate(order.pickup_deadline)+'</p><p>'+escapeHtml([order.pickup_address,order.city].filter(Boolean).join(' · '))+'</p></div>'+
      (order.pickup_code?'<div class="pickup-code"><span>Show this code at pickup</span><strong>'+escapeHtml(order.pickup_code)+'</strong></div>':'')+
      '<p class="order-state">'+escapeHtml(order.status)+(order.status_reason?' · '+escapeHtml(order.status_reason):'')+'</p>'+
      (['pending','confirmed'].includes(order.status)?'<button class="btn-sec" onclick="changeOrder('+order.id+',\'cancelled\')">Cancel reservation</button>':order.status==='completed'?'<button class="btn-sec" onclick="openReviewModal('+order.id+')">'+(reviews.some(row=>row.order_id===order.id)?'Edit review':'Review meal')+'</button>':'')+'</article>';
  }).join(''):'<div class="feed-empty">No '+orderTab+' reservations.</div>';
}
let rejectOrderId=null;
function openRejectOrder(id) {
  rejectOrderId=id;el('reject-reason').value='';el('reject-feedback').textContent='';el('reject-order-modal').classList.add('active');el('reject-reason').focus();
}
async function rejectOrder(event) {
  event.preventDefault(); if(!rejectOrderId||el('reject-submit').disabled)return;
  el('reject-submit').disabled=true;
  try { await requestJson('/orders/'+rejectOrderId,{method:'PATCH',body:JSON.stringify({status:'rejected',reason:el('reject-reason').value})});closeModal('reject-order-modal');await loadBusiness();await refreshNotifications(); }
  catch(error){el('reject-feedback').textContent=error.message;}
  finally{el('reject-submit').disabled=false;}
}
function analyticsQuery() {
  return '?from='+encodeURIComponent(el('analytics-from').value)+'&to='+encodeURIComponent(el('analytics-to').value);
}
async function loadDailyAnalytics() {
  const session=token, request=++analyticsRequest; el('analytics-feedback').textContent='Loading daily report…';
  try {
    const data=await requestJson('/business/analytics/daily'+analyticsQuery());
    if(session!==token||request!==analyticsRequest)return;
    dailyAnalytics=data; el('analytics-from').value=data.from;el('analytics-to').value=data.to;
    const totals=data.days.reduce((sum,row)=>{for(const key of ['offered','reserved','collected','remaining','missed','revenue'])sum[key]+=Number(row[key]);return sum;},{offered:0,reserved:0,collected:0,remaining:0,missed:0,revenue:0});
    el('analytics-summary').innerHTML=[['Offered',totals.offered],['Awaiting pickup',totals.reserved],['Collected',totals.collected],['Unreserved / left over',totals.remaining],['Missed pickup portions',totals.missed],['Revenue',money(totals.revenue)]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('');
    el('analytics-days').innerHTML=data.days.map(row=>'<tr>'+[row.date,row.offered,row.reserved,row.collected,row.remaining,row.missed,money(row.revenue)].map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('');
    el('analytics-feedback').textContent=data.days.length?'Based on daily offer dates in Bangladesh time.':'No daily inventory in this date range.';
  } catch(error){if(session===token&&request===analyticsRequest)el('analytics-feedback').textContent=error.message;}
}
async function exportDailyAnalytics() {
  try {
    const response=await fetch(API_BASE+'/business/analytics/daily'+analyticsQuery()+'&format=csv',{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)throw new Error((await response.json()).message||'Could not export report.');
    const url=URL.createObjectURL(await response.blob()), link=document.createElement('a');
    link.href=url;link.download='plateup-daily-sales.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error){el('analytics-feedback').textContent=error.message;}
}
function openPasswordChange() {
  el('password-change-form').reset();el('password-change-feedback').textContent='';el('password-change-modal').classList.add('active');
}
async function changePassword(event) {
  event.preventDefault(); if(el('password-change-submit').disabled)return;
  if(el('password-new').value!==el('password-confirm').value){el('password-change-feedback').textContent='New passwords do not match.';return;}
  el('password-change-submit').disabled=true;
  try{const result=await requestJson('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:el('password-current').value,new_password:el('password-new').value})});closeModal('password-change-modal');el('password-change-form').reset();handleLogout();showScreen('login');alert(result.message);}
  catch(error){el('password-change-feedback').textContent=error.message;}
  finally{el('password-change-submit').disabled=false;}
}
function openForgotPassword() {el('recovery-feedback').textContent='';showScreen('recovery');}
async function requestPasswordReset(event) {
  event.preventDefault();if(el('recovery-submit').disabled)return;el('recovery-submit').disabled=true;
  try{const result=await requestJson('/auth/forgot-password',{method:'POST',body:JSON.stringify({email:el('recovery-email').value})});el('recovery-feedback').textContent=result.message;}
  catch(error){el('recovery-feedback').textContent=error.message;}
  finally{el('recovery-submit').disabled=false;}
}
function captureResetLink() {
  const match=/^#reset=([a-f0-9]{64})$/.exec(location.hash||'');
  if(!match)return false;
  resetPasswordToken=match[1];history.replaceState(null,'',location.pathname+location.search);showScreen('reset-password');return true;
}
async function resetPassword(event) {
  event.preventDefault();if(el('reset-submit').disabled)return;
  if(el('reset-new').value!==el('reset-confirm').value){el('reset-feedback').textContent='Passwords do not match.';return;}
  el('reset-submit').disabled=true;
  try{const result=await requestJson('/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetPasswordToken,new_password:el('reset-new').value})});resetPasswordToken=null;el('reset-form').reset();handleLogout();showScreen('login');alert(result.message);}
  catch(error){el('reset-feedback').textContent=error.message;}
  finally{el('reset-submit').disabled=false;}
}
