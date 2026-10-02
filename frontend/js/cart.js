import { state } from './state.js';
import { showScreen, renderTopNav } from './router.js';
import { el, money, itemThumbnail, escapeHtml, pickupDate, closeModal } from './ui.js';
import { requestJson } from './api.js';
import { loadInitialData } from './marketplace.js';
import { renderProfile } from './profile.js';
import { refreshNotifications } from './notifications.js';

export function addToCart(id,quantity = 1) {
  if (state.orderSubmitting) return false;
  if (!state.currentUser || state.currentUser.role !== 'customer') { showScreen('login'); return false; }
  const item = state.detailItem?.id === id ? state.detailItem : state.listings.find(row => row.id === id);
  if (!item) return false;
  const reserved = state.cartItems.filter(row => row.listing_id === id).length;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity + reserved > Number(item.quantity)) {
    alert('Choose a whole number of portions within the available stock.'); return false;
  }
  for (let i = 0; i < quantity; i++) state.cartItems.push({ listing_id:id,title:item.title,price:Number(item.rescue_price),
    image_path:item.image_path,business_name:item.business_name });
  state.cartQuote=null; state.cartQuoteRequest++;
  persistCart();
  renderTopNav();
  return true;
}

export function groupedCart() {
  const grouped = new Map();
  state.cartItems.forEach(item => {
    if (!grouped.has(item.listing_id)) grouped.set(item.listing_id,{ ...item,quantity:0,total:0 });
    const row = grouped.get(item.listing_id); row.quantity++; row.total += item.price;
  });
  return [...grouped.values()];
}

export function renderCart() {
  const grouped=groupedCart();
  el('cart-portion-count').textContent=state.cartItems.length;
  el('cart-item-summary').textContent=grouped.length+' meal'+(grouped.length===1?'':'s')+' · '+state.cartItems.length+' portion'+(state.cartItems.length===1?'':'s');
  el('cart-grand-total').textContent=money(state.cartItems.reduce((sum,item)=>sum+item.price,0));
  el('cart-pickup-note').hidden=!state.cartItems.length;
  el('checkout-summary').innerHTML=state.cartItems.length ? grouped.map(item=>{
    const quoted=state.cartQuote?.items.find(row=>row.listing_id===item.listing_id);
    return '<article class="cart-line">'+itemThumbnail(item)+'<div class="cart-line-body"><div class="cart-line-heading"><div><span class="cart-restaurant">'+
      escapeHtml(item.business_name||'Restaurant pickup')+'</span><h3>'+escapeHtml(item.title)+'</h3></div><button type="button" class="cart-remove" '+
      (state.orderSubmitting?'disabled':'')+' data-click="removeCartItem" data-arg0="'+item.listing_id+'" aria-label="Remove '+escapeHtml(item.title)+'">&times;</button></div>'+
      '<p class="cart-unit-price">'+money(item.price)+' <span>per portion</span></p>'+
      (quoted?.pickup_deadline?'<p class="cart-pickup-deadline">Pick up by '+pickupDate(quoted.pickup_deadline)+'</p>':'')+
      '<div class="cart-line-controls"><div class="cart-stepper">'+
      '<button type="button" aria-label="Remove one portion of '+escapeHtml(item.title)+'" '+(state.orderSubmitting||item.quantity<=1?'disabled':'')+' data-click="stepCartQuantity" data-arg0="'+item.listing_id+'" data-arg1="-1">&minus;</button>'+
      '<input id="cart-quantity-'+item.listing_id+'" aria-label="Portions of '+escapeHtml(item.title)+'" type="number" inputmode="numeric" min="1" max="100000" step="1" value="'+item.quantity+'" '+
      (state.orderSubmitting?'disabled':'')+' data-change="changeCartQuantity" data-arg0="'+item.listing_id+'">'+
      '<button type="button" aria-label="Add one portion of '+escapeHtml(item.title)+'" '+(state.orderSubmitting||(quoted && item.quantity>=quoted.available_quantity)?'disabled':'')+' data-click="stepCartQuantity" data-arg0="'+item.listing_id+'" data-arg1="1">+</button></div>'+
      '<strong>'+money(item.total)+'</strong></div>'+(quoted?.error?'<p class="detail-feedback">'+escapeHtml(quoted.error)+'</p>':'')+'</div></article>';
  }).join('') : '<div class="cart-empty"><span aria-hidden="true">&#127858;</span><h3>A little room for good food</h3><p>Your cart is empty. Find a meal you love and give it a second chance.</p><button class="btn-sec" type="button" data-click="browseFromCart">Explore meals</button></div>';
  el('cart-confirm').disabled=state.orderSubmitting || !state.cartItems.length || !state.cartQuote?.valid;
  el('cart-confirm').textContent=state.orderSubmitting?'Reserving…':'Confirm Reservation';
  el('cart-clear').disabled=state.orderSubmitting || !state.cartItems.length;
}

export async function refreshCartQuote() {
  const requestId=++state.cartQuoteRequest, session=state.token;
  state.cartQuote=null; renderCart();
  if (!state.cartItems.length) { el('cart-feedback').textContent=''; return; }
  el('cart-feedback').textContent='Checking current prices and availability…';
  try {
    const quote=await requestJson('/cart/quote',{ method:'POST',body:JSON.stringify({
      items:groupedCart().map(item=>({ listing_id:item.listing_id,quantity:item.quantity }))
    }) });
    if (requestId!==state.cartQuoteRequest || session!==state.token) return;
    let changed=false;
    state.cartItems.forEach(item=>{
      const current=quote.items.find(row=>row.listing_id===item.listing_id);
      if (current?.unit_price!=null) {
        if (item.price!==current.unit_price) changed=true;
        item.price=current.unit_price;
        item.title=current.title||item.title;
        item.business_name=current.business_name||item.business_name;
        item.image_path=current.image_path||item.image_path;
      }
    });
    state.cartQuote=quote; persistCart(); renderCart();
    el('cart-feedback').textContent=!quote.valid?'Update or remove unavailable items before confirming.':
      changed?'Prices have changed. Review the updated total before confirming.':'Prices and stock checked. Portions are reserved when you confirm.';
  } catch(error) {
    if (requestId!==state.cartQuoteRequest || session!==state.token) return;
    el('cart-feedback').textContent=error.message;
  }
}

export function changeCartQuantity(id,value) {
  if (state.orderSubmitting) return;
  const quantity=Number(value),item=state.cartItems.find(row=>row.listing_id===id);
  if (!item) return;
  if (!Number.isSafeInteger(quantity) || quantity<1 || quantity>100000) {
    renderCart(); el('cart-feedback').textContent='Enter a positive whole number of portions.'; return;
  }
  state.cartItems=state.cartItems.filter(row=>row.listing_id!==id);
  for (let i=0;i<quantity;i++) state.cartItems.push({ ...item });
  persistCart(); renderTopNav(); refreshCartQuote();
}

export function stepCartQuantity(id,delta) {
  const item=groupedCart().find(row=>row.listing_id===id);
  if (item) changeCartQuantity(id,Math.max(1,item.quantity+delta));
}

export function removeCartItem(id) {
  if (state.orderSubmitting) return;
  state.cartItems=state.cartItems.filter(item=>item.listing_id!==id);
  persistCart(); renderTopNav(); refreshCartQuote();
}

export function clearCart() {
  if (state.orderSubmitting) return;
  state.cartItems=[]; persistCart(); renderTopNav(); refreshCartQuote();
}

export function openCheckoutModal() {
  state.cartReturnFocus=document.activeElement?.closest?.('#cart-toast') ? el('cart-open') : document.activeElement;
  el('cart-toast').hidden=true;
  el('checkout-modal').classList.add('active');
  document.body.classList.add('cart-is-open');
  el('cart-close').focus();
  if (!state.orderSubmitting) refreshCartQuote();
}

export async function confirmOrder() {
  if (state.orderSubmitting || !state.cartItems.length) return;
  if (!state.cartQuote?.valid) { await refreshCartQuote(); return; }
  const session=state.token;
  state.orderSubmitting=true; renderCart();
  try {
    await requestJson('/orders', { method:'POST', body:JSON.stringify({
      items:groupedCart().map(item=>({ listing_id:item.listing_id,quantity:item.quantity,unit_price:item.price })),
      payment_method:el('pay-method').value
    }) });
    if (session!==state.token) return;
    state.cartItems=[]; persistCart(); state.cartQuote=null; state.cartQuoteRequest++; closeModal('checkout-modal'); renderTopNav();
    state.orders=await requestJson('/orders'); await loadInitialData(); renderProfile(); await refreshNotifications();
    showScreen('my-orders');
    alert('Reservation placed. Find your pickup code and deadline in My Orders.');
  } catch(error) {
    if (session!==state.token) return;
    await refreshCartQuote(); el('cart-feedback').textContent=error.message;
  } finally { state.orderSubmitting=false; renderCart(); }
}

export function persistCart() {
  if (state.currentUser?.role!=='customer') return;
  try { localStorage.setItem('plateup_cart_'+state.currentUser.id,JSON.stringify({
    version:1,city_id:state.profile?.customer_city_id||null,items:groupedCart()
  })); } catch(_) { /* Private browsing/storage limits must not prevent checkout. */ }
}

export async function restoreCart() {
  if (state.currentUser?.role!=='customer' || state.restoredCartOwner===state.currentUser.id) return;
  state.restoredCartOwner=state.currentUser.id; state.cartItems=[]; state.cartQuote=null;
  try {
    const saved=JSON.parse(localStorage.getItem('plateup_cart_'+state.currentUser.id)||'null');
    if (saved?.version===1 && saved.city_id===(state.profile?.customer_city_id||null) && Array.isArray(saved.items) && saved.items.length<=30) {
      let total=0;
      for (const row of saved.items) {
        if (!Number.isSafeInteger(row.listing_id)||row.listing_id<1||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>100000) continue;
        total+=row.quantity; if (total>100000) break;
        const item={listing_id:row.listing_id,title:String(row.title||'Saved meal').slice(0,255),
          business_name:String(row.business_name||'Restaurant pickup').slice(0,255),
          price:Number.isFinite(row.price)&&row.price>=0?row.price:0};
        for(let i=0;i<row.quantity;i++) state.cartItems.push({...item});
      }
    }
  } catch(_) { state.cartItems=[]; }
  renderTopNav(); persistCart();
  if (state.cartItems.length) await refreshCartQuote();
}
