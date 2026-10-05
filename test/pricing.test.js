const test=require('node:test');
const assert=require('node:assert/strict');
const {decidePrice,features}=require('../server/pricing-policy');
const {trainPython,historyReady}=require('../server/pricing');
const {generateSynthetic}=require('../server/training-format');

test('pricing readiness requires distinct eligible dates and meaningful price variation',()=>{
  const rows=generateSynthetic({items:1}).slice(0,30);
  assert.equal(historyReady(rows),true);
  assert.equal(historyReady(rows.slice(0,29)),false);
  assert.equal(historyReady(rows.map(row=>({...row,offer_date:rows[0].offer_date}))),false);
  assert.equal(historyReady(rows.map(row=>({...row,rescue_unit_price:100}))),false);
  assert.equal(historyReady(rows.map(row=>({...row,quantity_changed:true}))),false);
  assert.equal(historyReady(rows.map(row=>({...row,pending_quantity:1}))),false);
  assert.equal(historyReady(rows.map(row=>({...row,initial_quantity:0}))),false);
});

const item={minimum_price:170,original_price:300,initial_quantity:20,remaining_quantity:20,
  offer_date:'2026-10-02',offer_start_time:'20:00:00',offer_end_time:'00:00:00',model_source:'synthetic'};
const at=minutes=>new Date(new Date('2026-10-02T20:00:00+06:00').getTime()+minutes*60000);
const model={version:1,usable:true,weights:[-1,0,0,0,0],intercept:1.5,price_ratio_min:.2,price_ratio_max:.8};

test('daily prices open at 20% off, decline without a model and use whole taka across midnight',()=>{
  assert.equal(decidePrice(item,null,at(0)).price,240);
  assert.equal(decidePrice(item,model,at(0)).price,240);
  assert.equal(decidePrice(item,null,at(-1)).price,240);
  let current={...item},previous=240;
  for(let minute=0;minute<240;minute+=3) {
    const decision=decidePrice(current,null,at(minute));
    assert.equal(decision.source,'time_policy');
    assert.ok(Number.isInteger(decision.price));
    assert.ok(decision.price>=170&&decision.price<=previous);
    assert.ok(previous-decision.price<=15+.000001);
    current={...current,last_price:decision.price,last_priced_at:at(minute)};
    previous=decision.price;
    if(minute===120)assert.ok(previous<220&&previous>190,'No orders should still gradually reduce the price');
  }
  assert.ok(previous<=170.5,'Slow offers approach the minimum near closing');
  assert.equal(decidePrice(current,null,at(240)).price,previous,'Closing does not reset the price');
  assert.equal(decidePrice({...current,remaining_quantity:0},null,at(200)).price,previous);
  assert.equal(decidePrice({...item,offer_date:'2026-10-03'},null,new Date('2026-10-03T20:00:00+06:00')).price,240);
  for(let min=0;min<=80;min+=5) {
    const decision=decidePrice({...item,minimum_price:min,original_price:100.03},null,at(0));
    assert.ok(decision.price>=min&&decision.price<=80.02);
    assert.ok(Number.isInteger(decision.price));
  }
  const monday=features(item,100,'2026-10-05');assert.equal(monday[3],0);assert.equal(monday[4],1);
});

test('legacy fractions become whole prices inside bounds without bypassing the daily clock',()=>{
  const current={...item,minimum_price:170.32,last_price:210.82,last_priced_at:at(60)};
  assert.equal(decidePrice(current,model,at(61)).price,210);
  for(let minute=63;minute<240;minute+=3) {
    const decision=decidePrice(current,model,at(minute));
    assert.ok(Number.isInteger(decision.price));
    assert.ok(decision.price>=170.32&&decision.price<=210);
  }
  assert.match(decidePrice({...item,last_price:170},model,at(120)).reason,/Minimum price reached/);
  assert.match(decidePrice({...item,minimum_price:240,last_price:240},null,at(120)).reason,/no discount range/);
  assert.throws(()=>decidePrice({...item,original_price:1,minimum_price:.5},null,at(0)),/No whole-taka price/);
});

test('strong reservations and little stock hold prices while slow sales accelerate reductions',()=>{
  const current={...item,last_price:210,last_priced_at:at(80)};
  const slow=decidePrice(current,null,at(120));
  const normal=decidePrice({...current,remaining_quantity:12},null,at(120));
  assert.ok(slow.price<normal.price);
  assert.equal(decidePrice({...current,remaining_quantity:10},model,at(120)).price,210);
  assert.equal(decidePrice({...current,remaining_quantity:2},model,at(230)).price,210);
  assert.ok(decidePrice({...current,initial_quantity:2,remaining_quantity:2},null,at(120)).price<210,
    'A small offer with no orders should still receive gradual discounts');
});

test('ML adjusts the policy by at most 10% of the spread and never raises a daily price',()=>{
  const current={...item,last_price:210,last_priced_at:at(115)};
  const baseline=decidePrice(current,null,at(120));
  for(const intercept of [0,1.5,4]) {
    const decision=decidePrice(current,{...model,intercept},at(120));
    assert.equal(decision.source,'synthetic_model');
    assert.ok(Math.abs(decision.price-baseline.price)<=7.01);
    assert.ok(decision.price<=210&&decision.price>=195);
  }
  assert.equal(decidePrice(current,{...model,usable:false},at(120)).price,baseline.price);
  assert.equal(decidePrice(current,{...model,price_ratio_min:.9},at(120)).price,baseline.price);
  assert.equal(decidePrice({...current,last_price:170},model,at(120)).price,170);
});

test('quantity changes and retraining cannot bypass the daily three-minute drop limit',()=>{
  const current={...item,last_price:230,last_priced_at:at(60)};
  assert.equal(decidePrice(current,null,at(62)).price,230);
  assert.equal(decidePrice({...current,initial_quantity:30,remaining_quantity:30},model,at(62)).price,230);
  assert.ok(decidePrice(current,null,at(63)).price<230);
  const overnight={...current,offer_start_time:'22:00:00',offer_end_time:'01:00:00',last_priced_at:null};
  assert.ok(decidePrice(overnight,null,new Date('2026-10-03T00:30:00+06:00')).price<230);
});

test('actual Python model has chronological evaluation and portable predictions; rejects insufficient history',async()=>{
  const rows=generateSynthetic({items:1});
  const model=await trainPython(rows);
  assert.equal(model.rows,180);assert.equal(model.test_rows,36);assert.equal(model.usable,true);
  assert.ok(model.test_from>rows[model.training_rows-1].offer_date);
  assert.ok(Number.isFinite(model.mae_portions));assert.ok(model.mae_portions<model.baseline_mae_portions);
  assert.equal(model.weights.length,5);
  await assert.rejects(trainPython(rows.slice(0,5)),/At least 30/);
  await assert.rejects(trainPython(rows.map(r=>({...r,rescue_unit_price:100}))),/three distinct/);
});
