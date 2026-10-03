import { state } from './state.js';
import { requestJson } from './api.js';
import { el,escapeHtml,money } from './ui.js';
import { loadBusiness } from './business.js';

let itemId=null,version=0,busy=false;
export function pricingLabel(source) {
  return source==='model'?'Model pricing':source==='synthetic_model'?'Demo model pricing':'Fallback price';
}
export async function openItemPricing(id,focusUpload=false) {
  itemId=id;version++;
  el('item-pricing-modal').classList.add('active');
  el('pricing-file').value='';el('pricing-feedback').textContent='Loading item history…';
  el('pricing-title').textContent='Item pricing & history';
  el('pricing-source').value='restaurant';
  el('pricing-state').textContent='';el('pricing-counts').textContent='';
  el('pricing-summary').innerHTML='';el('pricing-metrics').innerHTML='';
  await refreshItemPricing();
  if(itemId===id&&el('item-pricing-modal').classList.contains('active'))el(focusUpload?'pricing-file':'pricing-source').focus();
}
export function itemPricingStatus(item) {
  return item.pricing_readiness|| (item.pricing_source==='model'||item.pricing_source==='synthetic_model'?'Model active':'History needed');
}
async function refreshItemPricing() {
  const request=version,session=state.token;
  try {
    const data=await requestJson('/business/listings/'+itemId+'/pricing',{cache:'no-store'});
    if(request!==version||session!==state.token)return;
    const item=data.item,model=data.model,m=model?.artifact;
    el('pricing-title').textContent=item.title+' · Pricing & history';
    el('pricing-summary').innerHTML='<div><span>Current price</span><strong>'+money(item.rescue_price)+'</strong></div>'+ 
      '<div><span>Your minimum</span><strong>'+money(item.minimum_price)+'</strong></div>'+ 
      '<div><span>20% discount ceiling</span><strong>'+money(Math.floor(Number(item.original_price)*80)/100)+'</strong></div>';
    el('pricing-state').textContent=pricingLabel(item.pricing_source)+'. '+(item.pricing_reason||'Add item history, then train a model.');
    el('pricing-counts').textContent=data.platform_count+' eligible PlateUp offers · '+
      (data.imported.find(r=>r.data_source==='real')?.records||0)+' imported restaurant offers · '+
      (data.imported.find(r=>r.data_source==='synthetic')?.records||0)+' synthetic offers';
    el('pricing-metrics').innerHTML=m?'<strong>'+escapeHtml(model.source==='synthetic'?'Synthetic demonstration model':'Item sales model')+'</strong>'+ 
      '<p>'+escapeHtml(m.algorithm)+' · '+m.rows+' offers · trained '+escapeHtml(model.trained_at.slice(0,10))+'</p>'+ 
      '<p>Latest-date test: '+m.test_rows+' offers. Mean absolute error: '+Number(m.mae_portions).toFixed(2)+
      ' portions; baseline: '+Number(m.baseline_mae_portions).toFixed(2)+' portions.</p><p>'+escapeHtml(m.reason)+'</p>'+ 
      (model.source==='synthetic'?'<p>Demo results do not measure real restaurant performance.</p>':''):
      '<p>No model trained for this item. The minimum price is used until a suitable model is available.</p>';
    el('pricing-feedback').textContent='';
  }catch(error){if(request===version&&session===state.token)el('pricing-feedback').textContent=error.message;}
}
async function pricingAction(work) {
  if(busy)return;
  const id=itemId,request=version,session=state.token;busy=true;
  document.querySelectorAll('[data-pricing-action]').forEach(b=>b.disabled=true);
  el('pricing-feedback').textContent='Working… Training can take up to a minute.';
  try {
    const message=await work(id);
    if(request!==version||session!==state.token)return;
    await refreshItemPricing();await loadBusiness();
    if(request===version&&session===state.token)el('pricing-feedback').textContent=message;
  }catch(error){if(request===version&&session===state.token)el('pricing-feedback').textContent=error.message+
    (error.details?.errors?.slice(0,3).map(row=>' Row '+row.row+': '+row.issues.join(', ')).join('')||'');}
  finally{busy=false;document.querySelectorAll('[data-pricing-action]').forEach(b=>b.disabled=false);}
}
export async function importItemHistory() {
  const file=el('pricing-file').files?.[0];
  if(!file){el('pricing-feedback').textContent='Choose a CSV containing history for this food item.';return;}
  if(file.size>1024*1024){el('pricing-feedback').textContent='Choose a CSV smaller than 1 MB.';return;}
  return pricingAction(async id=>{
    const result=await requestJson('/business/training-data/import?listing_id='+id,
      {method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});
    return result.count+' item history records saved. Choose their source and train or retrain the model.';
  });
}
export async function trainItemModel() {
  const source=el('pricing-source').value;
  return pricingAction(async id=>{
    const result=await requestJson('/business/listings/'+id+'/train',{method:'POST',body:JSON.stringify({source})});
    return result.message;
  });
}
export async function useItemSample() {
  const session=state.token,request=version;
  return pricingAction(async id=>{
    const sample=await requestJson('/business/listings/'+id+'/sample',{method:'POST',body:'{}'});
    if(session!==state.token||request!==version)return '';
    const result=await requestJson('/business/training-data/import?listing_id='+id,
      {method:'POST',headers:{'Content-Type':'text/csv'},body:sample.csv});
    if(session===state.token&&request===version)el('pricing-source').value='synthetic';
    return result.count+' synthetic demo offers saved separately. Click Train / retrain to use this demo model.';
  });
}
