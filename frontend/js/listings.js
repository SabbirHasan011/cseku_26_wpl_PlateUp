import { itemThumbnail, itemRating, money } from './ui.js';
import { pricingLabel,itemPricingStatus } from './pricing.js';
import { notify } from './feedback.js';
import { state } from './state.js';
import { el, imageUrl, escapeHtml, offerTime, closeModal } from './ui.js';
import { requestJson } from './api.js';
import { loadMarketplaceCategories, loadInitialData, fetchListings } from './marketplace.js';
import { loadBusiness, switchBizTab } from './business.js';

export function openNewListingModal() {
  state.editingListingId=null;
  ['m-title','m-description','m-orig-price','m-rescue-price','m-image'].forEach(id=>el(id).value='');
  el('m-start').value='20:00'; el('m-end').value='00:00';
  el('listing-modal-title').textContent='Add Food Item';
  el('listing-submit-btn').textContent='Save Food Item';
  setFoodImagePreview(null);
  el('listing-feedback').hidden=true;
  el('new-listing-modal').classList.add('active');
  return prepareFoodEditor('');
}

export function openEditListingModal(id) {
  const item=state.businessListings.find(row=>row.id===id);
  if (!item) return;
  state.editingListingId=id;
  el('m-title').value=item.title; el('m-category').value=item.category;
  el('m-description').value=item.description||'';
  el('m-orig-price').value=item.original_price; el('m-rescue-price').value=item.minimum_price??item.rescue_price;
  el('m-start').value=item.offer_start_time?.slice(0,5)||'';
  el('m-end').value=item.offer_end_time?.slice(0,5)||'';
  el('m-image').value='';
  setFoodImagePreview(item.image_path ? imageUrl(item.image_path) : null);
  el('listing-modal-title').textContent='Edit Food Item';
  el('listing-submit-btn').textContent='Save Item Changes';
  el('listing-feedback').hidden=true;
  el('new-listing-modal').classList.add('active');
  return prepareFoodEditor(item.category);
}

export function prepareFoodEditor(category) {
  state.listingEditorVersion++;
  closeOfferTimePicker(false); updateOfferTimeLabels();
  toggleCategoryEditor(false);
  el('category-feedback').textContent='';
  el('save-category-btn').disabled=false;
  el('m-title').focus();
  return loadFoodCategories(category);
}

export async function loadFoodCategories(selected=el('m-category').value) {
  const requestId=++state.latestCategoryRequest, session=state.token;
  state.foodCategories=[];
  el('m-category').disabled=true;
  el('m-category').innerHTML='<option value="">Loading categories…</option>';
  try {
    const rows=await requestJson('/categories',{ cache:'no-store' });
    if (requestId!==state.latestCategoryRequest || session!==state.token) return;
    state.foodCategories=rows;
    el('m-category').innerHTML='<option value="">Choose a category</option>'+rows.map(row=>
      '<option value="'+escapeHtml(row.name)+'">'+escapeHtml(row.name)+'</option>').join('');
    el('m-category').value=rows.find(row=>row.name.toLowerCase()===selected.trim().toLowerCase())?.name||'';
    el('m-category').disabled=false;
  } catch(error) {
    if (requestId!==state.latestCategoryRequest || session!==state.token) return;
    el('m-category').innerHTML='<option value="">Categories unavailable</option>';
    el('category-feedback').textContent='Could not load categories. Reopen this form to retry. '+error.message;
  }
}

export function toggleCategoryEditor(show=el('category-editor').hidden) {
  el('category-editor').hidden=!show;
  el('add-category-toggle').setAttribute('aria-expanded',String(show));
  if (show) { el('new-category-name').value=''; el('category-feedback').textContent=''; el('new-category-name').focus(); }
}

export async function saveFoodCategory() {
  if (el('save-category-btn').disabled) return;
  const name=el('new-category-name').value.trim().replace(/\s+/g,' ');
  if (!name || name.length>100) { el('category-feedback').textContent='Enter a category name between 1 and 100 characters.'; return; }
  const version=state.listingEditorVersion, session=state.token;
  el('save-category-btn').disabled=true;
  el('category-feedback').textContent='Adding category…';
  try {
    const data=await requestJson('/categories',{ method:'POST',body:JSON.stringify({ name }) });
    if (version!==state.listingEditorVersion || session!==state.token) return;
    await loadFoodCategories(data.category.name);
    if (version!==state.listingEditorVersion || session!==state.token) return;
    if (!el('m-category').disabled) {
      toggleCategoryEditor(false);
      el('category-feedback').textContent='Category added and selected.';
      el('m-category').focus();
      await loadMarketplaceCategories();
    }
  } catch(error) {
    if (version===state.listingEditorVersion && session===state.token) el('category-feedback').textContent=error.message;
  } finally { if (version===state.listingEditorVersion) el('save-category-btn').disabled=false; }
}

export function updateOfferTimeLabels() {
  ['m-start','m-end'].forEach(id=>el(id+'-display').textContent=offerTime(el(id).value));
  const start=el('m-start').value, end=el('m-end').value;
  el('offer-window-note').textContent=start && end ? start===end ? 'Available for 24 hours from the selected start time.' :
    end<start ? 'Ends the next day. Your offer continues past midnight.' : 'Starts and ends on the same day.' : 'Choose a start and end time.';
}

export function openOfferTimePicker(id) {
  if (!['m-start','m-end'].includes(id)) return;
  if (state.offerTimeDraft?.id===id) { closeOfferTimePicker(); return; }
  closeOfferTimePicker(false);
  const [hour,minute]=(el(id).value||'00:00').split(':').map(Number);
  state.offerTimeDraft={ id,hour:hour%12||12,minute,period:hour>=12?'PM':'AM',stage:'hour' };
  el(id+'-trigger').setAttribute('aria-expanded','true');
  el('offer-time-picker').hidden=false;
  el('time-picker-title').textContent=id==='m-start'?'Choose start time':'Choose end time';
  renderOfferTimePicker();
}

export function renderOfferTimePicker() {
  const draft=state.offerTimeDraft;
  if (!draft) return;
  el('time-picker-steps').innerHTML=['hour','minute','period'].map(stage=>
    '<button type="button" class="'+(stage===draft.stage?'selected':'')+'" aria-pressed="'+(stage===draft.stage)+'" data-click="setOfferTimeStage" data-arg0="'+stage+'">'+
    (stage==='hour'?'Hour · '+draft.hour:stage==='minute'?'Minute · '+String(draft.minute).padStart(2,'0'):'AM / PM · '+draft.period)+'</button>').join('');
  el('time-picker-instruction').textContent=({hour:'1 of 3 · Choose the hour',minute:'2 of 3 · Choose the minute',period:'3 of 3 · Choose AM or PM to save and close'})[draft.stage];
  const values=draft.stage==='period'?['AM','PM']:Array.from({ length:draft.stage==='hour'?12:60 },(_,i)=>draft.stage==='hour'?i+1:i);
  el('time-picker-options').innerHTML=values.map(value=>'<button type="button" class="'+(value===draft[draft.stage]?'selected':'')+
    '" aria-pressed="'+(value===draft[draft.stage])+'" data-click="selectOfferTimePart" data-arg0="'+draft.stage+'" data-arg1="'+value+'">'+
    (draft.stage==='minute'?String(value).padStart(2,'0'):value)+'</button>').join('');
  const options=el('time-picker-options');
  options.scrollTop=0;
  options.querySelectorAll('button')[0]?.focus();
}

export function setOfferTimeStage(stage) {
  if (!state.offerTimeDraft || !['hour','minute','period'].includes(stage)) return;
  state.offerTimeDraft.stage=stage; renderOfferTimePicker();
}

export function selectOfferTimePart(stage,value) {
  if (!state.offerTimeDraft || state.offerTimeDraft.stage!==stage) return;
  const number=Number(value);
  if (stage==='hour' && Number.isInteger(number) && number>=1 && number<=12) {
    state.offerTimeDraft.hour=number; setOfferTimeStage('minute');
  } else if (stage==='minute' && Number.isInteger(number) && number>=0 && number<=59) {
    state.offerTimeDraft.minute=number; setOfferTimeStage('period');
  } else if (stage==='period' && ['AM','PM'].includes(value)) {
    const hour=state.offerTimeDraft.hour%12+(value==='PM'?12:0);
    el(state.offerTimeDraft.id).value=String(hour).padStart(2,'0')+':'+String(state.offerTimeDraft.minute).padStart(2,'0');
    updateOfferTimeLabels(); closeOfferTimePicker();
  }
}

export function closeOfferTimePicker(restoreFocus=true) {
  if (state.offerTimeDraft) {
    const trigger=el(state.offerTimeDraft.id+'-trigger');
    trigger.setAttribute('aria-expanded','false');
    if (restoreFocus) trigger.focus();
  }
  state.offerTimeDraft=null;
  el('offer-time-picker').hidden=true;
}

export function setFoodImagePreview(src) {
  if (state.listingPreviewUrl) URL.revokeObjectURL(state.listingPreviewUrl);
  state.listingPreviewUrl=null;
  el('m-image-preview').hidden=!src;
  el('m-image-preview').src=src||'';
}

export function previewFoodImage() {
  const file=el('m-image').files[0];
  if (!file) {
    const existing=state.businessListings.find(item=>item.id===state.editingListingId);
    return setFoodImagePreview(existing?.image_path ? imageUrl(existing.image_path) : null);
  }
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {
    el('listing-feedback').textContent='Choose a JPG, PNG, or WebP image of 5 MB or less.';
    el('listing-feedback').hidden=false;
    el('m-image').value='';
    return;
  }
  setFoodImagePreview(null);
  state.listingPreviewUrl=URL.createObjectURL(file);
  el('m-image-preview').src=state.listingPreviewUrl;
  el('m-image-preview').hidden=false;
  el('listing-feedback').hidden=true;
}

export async function submitNewListing() {
  if (el('listing-submit-btn').disabled) return;
  const errorBox=el('listing-feedback');
  const showError=message=>{ errorBox.textContent=message; errorBox.hidden=false; };
  errorBox.hidden=true;
  if (!state.foodCategories.some(row=>row.name===el('m-category').value)) return showError('Choose a category from the dropdown, or add a new category first.');
  if (state.offerTimeDraft) return showError('Finish choosing AM or PM to save your offer time.');
  const title=el('m-title').value.trim();
  const original=Number(el('m-orig-price').value);
  const rescue=Number(el('m-rescue-price').value);
  if (!title || !el('m-orig-price').value || !el('m-rescue-price').value ||
    !Number.isFinite(original) || original<0 || !Number.isFinite(rescue) || rescue<0 || Math.round(rescue*100)>Math.floor(Math.round(original*100)*.8) ||
    !el('m-start').value || !el('m-end').value) {
    return showError('Enter a title, valid offer times, and prices. Minimum price must be at most 80% of original price (at least 20% off).');
  }
  const payload=new FormData();
  Object.entries({ title,category:el('m-category').value,description:el('m-description').value,
    original_price:original,minimum_price:rescue,offer_start_time:el('m-start').value,
    offer_end_time:el('m-end').value }).forEach(([key,value])=>payload.append(key,value));
  if (el('m-image').files[0]) payload.append('image',el('m-image').files[0]);
  const button=el('listing-submit-btn');
  button.disabled=true;
  button.textContent='Saving…';
  try {
    await requestJson('/listings' + (state.editingListingId ? '/' + state.editingListingId : ''), {
      method:state.editingListingId?'PUT':'POST',body:payload
    });
    const message=state.editingListingId ? 'Food item updated.' :
      'Food item saved. Enter today\'s quantity below to make it available during its offer window.';
    closeModal('new-listing-modal');
    await loadInitialData(); await loadBusiness();
    switchBizTab('listings', document.querySelector('[data-biz-tab="listings"]'));
    el('business-feedback').textContent=message;
    el('business-feedback').hidden=false;
  } catch(error) { showError(error.message); }
  finally {
    button.disabled=false;
    button.textContent=state.editingListingId ? 'Save Item Changes' : 'Save Food Item';
  }
}

export async function submitDailyQuantity(id) {
  const input=el('daily-qty-'+id);
  const value=Number(input.value);
  if (input.value==='' || !Number.isSafeInteger(value) || value<0) {
    el('business-feedback').textContent='Enter a non-negative whole-number quantity.';
    el('business-feedback').hidden=false;
    return;
  }
  const button=el('daily-save-'+id);
  button.disabled=true; button.textContent='Saving…';
  try {
    await requestJson('/listings/'+id+'/today',{
      method:'PUT',body:JSON.stringify({ initial_quantity:value })
    });
    await loadBusiness(); await fetchListings();
    el('business-feedback').textContent='Today\'s quantity updated.';
    el('business-feedback').hidden=false;
  } catch(error) {
    el('business-feedback').textContent=error.message;
    el('business-feedback').hidden=false;
    button.disabled=false; button.textContent='Update Today\'s Quantity';
  }
}

export async function deleteListing(id) {
  if (!confirm('Deactivate this food item? Its order and daily history will remain.')) return;
  try { await requestJson('/listings/' + id,{ method:'DELETE' }); await loadInitialData(); await loadBusiness(); }
  catch(error) { notify(error.message,'error'); }
}

export function renderBusinessListings() {
  if (!el('business-listings')) return;
  el('business-item-count').textContent = state.businessListings.length;
  el('business-listings').innerHTML = state.businessListings.length ? state.businessListings.map(item =>
    '<article class="manage-item">' +
      '<div class="manage-item-top">' + itemThumbnail(item) + '<div class="manage-item-heading"><span class="manage-category">' +
      escapeHtml(item.category) + '</span><h4>' + escapeHtml(item.title) + '</h4>' + itemRating(item) + '</div></div>' +
      '<div class="manage-item-facts"><div><span class="manage-label">Price per portion</span><div class="manage-prices"><strong>' +
      money(item.rescue_price) + '</strong><del title="Original price">' + money(item.original_price) + '</del></div></div>' +
      '<div><span class="manage-label">Daily offer</span><strong class="manage-window">' + offerTime(item.offer_start_time) +
      ' – ' + offerTime(item.offer_end_time) + '</strong></div></div>' +
      '<div class="manage-inventory"><div><span>Made available</span><strong>' + (item.initial_quantity ?? '—') +
      '</strong></div><div><span>Remaining</span><strong>' + (item.remaining_quantity ?? '—') + '</strong></div>' +
      '<span class="badge ' + (item.daily_status==='Active'?'active':item.daily_status==='Sold Out'?'sold':
        item.daily_status==='Scheduled for Today'?'low':'neutral') + '">' + escapeHtml(item.daily_status) + '</span></div>' +
      '<div class="item-pricing-state"><span class="badge '+(itemPricingStatus(item)==='Model active'?'active':'neutral')+'">'+escapeHtml(itemPricingStatus(item))+'</span>'+
      '<span>'+escapeHtml(pricingLabel(item.pricing_source))+'</span></div>'+
      '<p class="pricing-item-note">Minimum '+money(item.minimum_price??item.rescue_price)+'</p>' +
      '<button class="upload-history-btn" data-click="uploadItemHistory" data-arg0="'+item.id+'">Upload Sales History</button>' +
      '<button class="pricing-history-btn" data-click="openItemPricing" data-arg0="'+item.id+'">Pricing &amp; item history</button>' +
      '<div class="manage-item-actions"><label for="daily-qty-' + item.id + '">Today\'s total quantity</label>' +
      '<input id="daily-qty-' + item.id + '" type="number" inputmode="numeric" min="0" step="1" value="' +
      (item.initial_quantity ?? '') + '" placeholder="Portions">' +
      '<button id="daily-save-' + item.id + '" class="btn-pri" data-click="submitDailyQuantity" data-arg0="' +
      item.id + '">Update Today\'s Quantity</button></div>' +
      '<div class="manage-item-footer"><span class="manage-date">' + (item.offer_date ? 'Offer date · ' + escapeHtml(item.offer_date) : 'No quantity set today') +
      '</span><div class="manage-item-links"><button class="review-order-btn" data-click="openEditListingModal" data-arg0="' +
      item.id + '">Edit Item</button><button class="review-order-btn danger-action" data-click="deleteListing" data-arg0="' +
      item.id + '">Deactivate</button></div></div></article>').join('')
    : '<div class="empty-history feed-empty"><strong>Your menu starts here</strong><p>Save a food item once, then set its available portions each day.</p><button class="btn-pri" data-click="openNewListingModal">Add your first item</button></div>';
}

