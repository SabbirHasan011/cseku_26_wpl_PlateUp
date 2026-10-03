const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const cents=value=>Math.round(Number(value)*100);
function features(item,price,date) {
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
  const duration=(minutes(item.offer_end_time)-minutes(item.offer_start_time)+1440)%1440||1440;
  // Date at UTC noon has the same calendar date; Monday=0 as Python date.weekday().
  const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
  return [price/Number(item.original_price),Math.log1p(Number(item.initial_quantity)),duration/60,
    Math.sin(2*Math.PI*day/7),Math.cos(2*Math.PI*day/7)];
}
function decidePrice(item,artifact,now=new Date()) {
  const floor=cents(item.minimum_price),ceiling=Math.floor(cents(item.original_price)*80/100);
  const fallback=reason=>({price:floor/100,source:'fallback',reason});
  if(!artifact?.usable || artifact.version!==1 || !Array.isArray(artifact.weights) || artifact.weights.length!==5 ||
    !artifact.weights.every(Number.isFinite) || !Number.isFinite(artifact.intercept))
    return fallback(artifact?.reason||'No usable item model yet. The restaurant minimum is used.');
  if(!item.offer_date || !Number(item.initial_quantity) || !Number(item.remaining_quantity))
    return fallback('Set available quantity for an active offer to use model pricing.');
  const start=new Date(item.offer_date+'T'+item.offer_start_time.slice(0,8)+'+06:00');
  const end=new Date(item.offer_date+'T'+item.offer_end_time.slice(0,8)+'+06:00');
  if(end<=start)end.setDate(end.getDate()+1);
  if(now<start || now>=end)return fallback('The offer is outside its active window.');
  const elapsed=clamp((now-start)/(end-start),0,1),remaining=Number(item.remaining_quantity);
  const committed=Number(item.initial_quantity)-remaining;
  let best=null;
  // Balance expected revenue with portions rescued. The explicit waste penalty
  // rises toward closing; this objective and the pace adjustment are policy.
  for(let i=0;i<=20;i++) {
    const priceCents=Math.round(floor+(ceiling-floor)*i/20),price=priceCents/100;
    const ratio=price/Number(item.original_price);
    if(ratio<artifact.price_ratio_min-0.001 || ratio>artifact.price_ratio_max+0.001)continue;
    const x=features(item,price,item.offer_date);
    const fraction=clamp(artifact.intercept+x.reduce((n,v,j)=>n+v*artifact.weights[j],0),0,1);
    const fullOffer=fraction*Number(item.initial_quantity);
    const pace=elapsed>=.1?committed/elapsed:fullOffer;
    const expected=clamp((.75*fullOffer+.25*pace)*(1-elapsed),0,remaining);
    const candidate={price,expected,score:expected*(price+floor/100*(1+4*elapsed))};
    if(!best || candidate.score>best.score+.00001 || (Math.abs(candidate.score-best.score)<=.00001 && price>best.price))best=candidate;
  }
  if(!best)return fallback('Allowed prices are outside the training price range. Add relevant history and retrain.');
  return {price:clamp(cents(best.price),floor,ceiling)/100,expected:best.expected,
    source:item.model_source==='synthetic'?'synthetic_model':'model',
    reason:'Item sales model with remaining-time and reservation-pace adjustment.'};
}
module.exports={decidePrice,features};
