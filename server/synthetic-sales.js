// Academic simulation assumptions, not measured restaurant behaviour.
const {validDate}=require('./training-format');
const {decidePrice,offerWindow}=require('./pricing-policy');
const PROFILES=[
  {slug:'chicken-biryani',title:'Chicken Biryani',category:'Main Meal',original_price:300,minimum_price:170,stock:26,demand:.72,sensitivity:1.1,start:'20:00',end:'00:00'},
  {slug:'beef-biryani',title:'Beef Biryani',category:'Main Meal',original_price:350,minimum_price:220,stock:20,demand:.65,sensitivity:.65,start:'20:00',end:'01:00'},
  {slug:'pastry-box',title:'Pastry Box',category:'Bakery',original_price:250,minimum_price:120,stock:18,demand:.82,sensitivity:1.5,start:'18:00',end:'22:00'},
  {slug:'mint-mojito',title:'Mint Mojito',category:'Cafe',original_price:180,minimum_price:100,stock:15,demand:.52,sensitivity:.45,start:'17:00',end:'21:00'},
  {slug:'mango-juice',title:'Mango Juice',category:'Cafe',original_price:170,minimum_price:85,stock:22,demand:.6,sensitivity:1.25,start:'18:00',end:'23:00'},
  {slug:'polao',title:'Polao',category:'Main Meal',original_price:250,minimum_price:160,stock:30,demand:.75,sensitivity:.8,start:'21:00',end:'01:00'}
];
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function rng(seed) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
function hash(text) {return Array.from(text).reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,0)>>>0;}
function poisson(mean,random) {
  let product=1,count=0,limit=Math.exp(-mean);
  do {count++;product*=random();}while(product>limit);
  return count-1;
}
function outcomes(booked,random) {
  let collected=0,cancelled=0,expired=0,rejected=0;
  for(let n=0;n<booked;n++) {
    const draw=random();
    if(draw<.04)cancelled++;else if(draw<.07)expired++;else if(draw<.08)rejected++;else collected++;
  }
  return {collected,cancelled,expired,rejected};
}
function daySettings(profile,day,date,random) {
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  const busy=weekday===5||weekday===6;
  const shock=random(),factor=shock<.04?0:shock<.18?.35:shock>.88?1.55:1;
  const quantity=Math.max(3,Math.round(profile.stock*(.65+random()*.7)));
  return {quantity,demand:profile.demand*(busy?1.18:1)*factor*(.86+random()*.28),
    weekday};
}
function demandFraction(profile,settings,ratio) {
  if(settings.demand===0)return 0;
  return clamp(settings.demand-profile.sensitivity*(ratio-.6),0,1.4);
}
function generateItemHistory(profile,{seed=20261005,days=180,start='2025-10-01'}={}) {
  if(!validDate(start)||!Number.isInteger(days)||days<1||days>366||!Number.isInteger(seed)||seed<0||seed>4294967295)
    throw new Error('Use a valid start date, 1–366 days, and a uint32 seed.');
  const random=rng((seed+hash(profile.slug||profile.title))>>>0),rows=[];
  for(let day=0;day<days;day++) {
    const date=new Date(Date.parse(start+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
    const settings=daySettings(profile,day,date,random);
    // Randomized constant-price offers avoid pretending a changing day has one price.
    const ratio=day%12===0?.8:day%12===1?.3:.3+random()*.5;
    const price=Math.round(profile.original_price*ratio*100)/100;
    const fraction=demandFraction(profile,settings,ratio);
    const demand=poisson(fraction*settings.quantity,random);
    const result=outcomes(Math.min(settings.quantity,demand),random);
    rows.push({schema_version:1,item_reference:'scenario-'+seed+'-'+(profile.slug||hash(profile.title)),
      offer_date:date,title:profile.title,category:profile.category,original_unit_price:profile.original_price,
      rescue_unit_price:price,offer_start_time:profile.start,offer_end_time:profile.end,
      initial_quantity:settings.quantity,collected_quantity:result.collected,cancelled_quantity:result.cancelled,
      rejected_quantity:result.rejected,expired_quantity:result.expired,remaining_quantity:settings.quantity-result.collected,
      revenue:Math.round(result.collected*price*100)/100,data_source:'synthetic',snapshot_quality:'synthetic',
      price_changed:false,quantity_changed:false,item_changed:false});
  }
  return rows;
}
const INTERVAL_COLUMNS=['dataset_version','data_source','item_reference','offer_date','title','category','split','policy_kind',
  'observed_at','interval_end','original_unit_price','minimum_unit_price','effective_unit_price','initial_quantity',
  'remaining_before','minutes_remaining','collected_previous_15_minutes','booked_next_3_minutes',
  'collected_next_3_minutes','cancelled_next_3_minutes','expired_next_3_minutes','rejected_next_3_minutes',
  'remaining_after','interval_revenue','collected_until_close'];
function generateIntervals(profile,{seed=20261005,days=180,start='2025-10-01'}={}) {
  // Reuse input validation without coupling either dataset's random stream.
  generateItemHistory(profile,{seed,days,start});
  const random=rng((seed+hash(profile.slug+'-interval'))>>>0),rows=[];
  for(let day=0;day<days;day++) {
    const date=new Date(Date.parse(start+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
    const settings=daySettings(profile,day,date,random),offerRows=[];
    const policyKind=day%5===0?'randomized_fixed_price':'gradual_policy';
    const fixedPrice=Math.round((profile.minimum_price+(profile.original_price*.8-profile.minimum_price)*random())*100)/100;
    let item={...profile,offer_date:date,offer_start_time:profile.start,offer_end_time:profile.end,
      initial_quantity:settings.quantity,remaining_quantity:settings.quantity};
    const {start:opens,end:closes}=offerWindow(item),count=(closes-opens)/180000;
    for(let interval=0;interval<count;interval++) {
      const now=new Date(opens.getTime()+interval*180000),elapsed=interval/count;
      const price=policyKind==='gradual_policy'?decidePrice(item,null,now).price:fixedPrice;
      const recent=offerRows.slice(-5).reduce((sum,row)=>sum+row.collected_next_3_minutes,0);
      // Assumed evening arrival shape and item-specific price response, plus noise.
      const shape=.7+.6*Math.sin(Math.PI*elapsed);
      const mean=demandFraction(profile,settings,price/profile.original_price)*settings.quantity/count*shape;
      const booked=Math.min(item.remaining_quantity,poisson(mean,random)),result=outcomes(booked,random);
      const remaining=item.remaining_quantity-result.collected;
      offerRows.push({dataset_version:'experimental-interval-v1',data_source:'synthetic',
        item_reference:'interval-'+seed+'-'+profile.slug,offer_date:date,title:profile.title,category:profile.category,
        split:day<Math.floor(days*.8)?'train':'holdout',policy_kind:policyKind,observed_at:now.toISOString(),
        interval_end:new Date(now.getTime()+180000).toISOString(),original_unit_price:profile.original_price,
        minimum_unit_price:profile.minimum_price,effective_unit_price:price,initial_quantity:settings.quantity,
        remaining_before:item.remaining_quantity,minutes_remaining:(closes-now)/60000,
        collected_previous_15_minutes:recent,booked_next_3_minutes:booked,collected_next_3_minutes:result.collected,
        cancelled_next_3_minutes:result.cancelled,expired_next_3_minutes:result.expired,rejected_next_3_minutes:result.rejected,
        remaining_after:remaining,interval_revenue:Math.round(result.collected*price*100)/100});
      item={...item,remaining_quantity:remaining,last_price:price,last_priced_at:now};
    }
    let future=0;
    for(let n=offerRows.length-1;n>=0;n--){future+=offerRows[n].collected_next_3_minutes;offerRows[n].collected_until_close=future;}
    rows.push(...offerRows);
  }
  return rows;
}
module.exports={PROFILES,generateItemHistory,generateIntervals,INTERVAL_COLUMNS};
