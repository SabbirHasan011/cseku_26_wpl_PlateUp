const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const cents=value=>Math.round(Number(value)*100);
const POLICY_VERSION=3;
const REFRESH_MS=3*60*1000;
function features(item,price,date) {
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
  const duration=(minutes(item.offer_end_time)-minutes(item.offer_start_time)+1440)%1440||1440;
  const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
  return [price/Number(item.original_price),Math.log1p(Number(item.initial_quantity)),duration/60,
    Math.sin(2*Math.PI*day/7),Math.cos(2*Math.PI*day/7)];
}
function offerWindow(item) {
  if(!item.offer_date)return null;
  const start=new Date(item.offer_date+'T'+item.offer_start_time.slice(0,8)+'+06:00');
  let end=new Date(item.offer_date+'T'+item.offer_end_time.slice(0,8)+'+06:00');
  if(end<=start)end=new Date(end.getTime()+86400000);
  return {start,end};
}
function modelFraction(item,artifact,price) {
  const ratio=price/Number(item.original_price);
  if(!artifact?.usable || artifact.version!==1 || !Array.isArray(artifact.weights) || artifact.weights.length!==5 ||
    !artifact.weights.every(Number.isFinite) || !Number.isFinite(artifact.intercept) ||
    !Number.isFinite(artifact.price_ratio_min) || !Number.isFinite(artifact.price_ratio_max) ||
    ratio<artifact.price_ratio_min-0.001 || ratio>artifact.price_ratio_max+0.001)return null;
  return clamp(artifact.intercept+features(item,price,item.offer_date).reduce((n,v,j)=>n+v*artifact.weights[j],0),0,1);
}
function decidePrice(item,artifact,now=new Date()) {
  // Work in whole taka. Round boundaries inward so neither the restaurant's
  // minimum nor the customer's minimum 20% discount can be violated.
  const floor=Math.ceil(cents(item.minimum_price)/100),ceiling=Math.floor(cents(item.original_price)*80/10000),spread=ceiling-floor;
  if(floor>ceiling)throw new RangeError('No whole-taka price fits these boundaries. Edit the original and minimum prices.');
  const previous=item.last_price==null?null:clamp(Math.floor(cents(item.last_price)/100),floor,ceiling);
  const result=(price,reason,extra={})=>({price:clamp(Math.round(price),floor,ceiling),
    source:'time_policy',reason,policy_version:POLICY_VERSION,...extra});
  const window=offerWindow(item);
  if(!window || !Number(item.initial_quantity))return result(previous??ceiling,'Enter available portions. New daily offers start at 20% off.');
  if(now<window.start)return result(previous??ceiling,'Scheduled offer: opening price is 20% off.');
  if(now>=window.end)return result(previous??ceiling,'Offer closed. The last price is retained.');
  if(!Number(item.remaining_quantity))return result(previous??ceiling,'Sold out. The last price is retained.');
  if(previous===null)return result(ceiling,'Daily opening price: 20% off.');
  if(previous===floor)return result(floor,spread===0?'Opening price equals your minimum: no discount range is available.':'Minimum price reached. This offer cannot be discounted further.');
  const lastAt=item.last_priced_at?new Date(item.last_priced_at):null;
  if(lastAt && now-lastAt<REFRESH_MS)return result(previous,'Price held until the next three-minute review.');
  const elapsed=clamp((now-window.start)/(window.end-window.start),0,1);
  const initial=Number(item.initial_quantity),remaining=Number(item.remaining_quantity);
  const committed=Math.max(0,initial-remaining),pace=elapsed>=.1?committed/(initial*elapsed):null;
  const littleStock=committed>0&&remaining<=Math.max(2,Math.ceil(initial*.15));
  const strong=pace!==null&&pace>=1;
  if(littleStock||strong)return result(previous,littleStock?'Low remaining stock: price held.':'Reservations are on track: price held.');
  const baseline=ceiling-spread*elapsed;
  const slow=pace!==null&&pace<.75;
  let target=baseline-(slow?spread*.1*elapsed:0),reason=slow?'Slow reservations: gradual discount accelerated.':'Time-based gradual discount.';
  if(slow&&elapsed>=.85) {
    const at85=ceiling-spread*.85-spread*.1*.85;
    target=at85+(floor-at85)*(elapsed-.85)/.15;
    reason='Closing soon with substantial stock: moving toward your minimum.';
  }
  // Ridge estimates full-offer collections. Its bounded signal may adjust the
  // schedule; it is not an interval-demand forecast and cannot replace policy.
  const fraction=modelFraction(item,artifact,clamp(target,floor,ceiling));
  let source='time_policy',expected;
  if(fraction!==null) {
    expected=clamp(fraction*initial-committed,0,remaining);
    const sellThrough=remaining?expected/remaining:1;
    const adjustment=clamp((sellThrough-.7)/.3,-1,1)*spread*.1*elapsed;
    target+=adjustment;
    source=item.model_source==='synthetic'?'synthetic_model':'model';
    reason+=' Bounded sales-model adjustment.';
  }
  const maxDrop=Math.max(1,Math.floor(cents(item.original_price)*5/10000));
  const price=clamp(Math.round(target),Math.max(floor,previous-maxDrop),previous);
  if(price===previous)reason+=' Whole-taka rounding keeps this review at the same price.';
  return result(price,reason,{source,baseline_price:Math.round(baseline),
    ...(expected===undefined?{}:{expected}),elapsed_fraction:elapsed});
}
module.exports={decidePrice,features,offerWindow,POLICY_VERSION,REFRESH_MS};
