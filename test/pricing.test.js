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

test('pricing respects cents, time windows, model range and fallback without fake predictions',()=>{
  const item={minimum_price:60,original_price:200,initial_quantity:20,remaining_quantity:20,
    offer_date:'2026-10-02',offer_start_time:'22:00:00',offer_end_time:'01:00:00',model_source:'synthetic'};
  const model={version:1,usable:true,weights:[-1,0,0,0,0],intercept:1.5,price_ratio_min:.2,price_ratio_max:.8};
  const during=new Date('2026-10-03T00:30:00+06:00');
  const decision=decidePrice(item,model,during);
  assert.equal(decision.source,'synthetic_model');assert.ok(decision.price>=60&&decision.price<=160);
  assert.equal(decidePrice(item,null,during).source,'fallback');
  assert.equal(decidePrice(item,model,new Date('2026-10-02T21:00:00+06:00')).source,'fallback');
  assert.equal(decidePrice(item,model,new Date('2026-10-03T01:00:00+06:00')).source,'fallback');
  assert.equal(decidePrice({...item,remaining_quantity:0},model,during).source,'fallback');
  assert.equal(decidePrice(item,{...model,price_ratio_min:.9},during).source,'fallback');
  const monday=features(item,100,'2026-10-05');assert.equal(monday[3],0);assert.equal(monday[4],1);
  const early=decidePrice({...item,remaining_quantity:3},model,new Date('2026-10-02T22:10:00+06:00'));
  const late=decidePrice(item,model,new Date('2026-10-03T00:55:00+06:00'));
  assert.ok(early.price>late.price,'Low remaining stock early supports a higher price than abundant stock near closing');
  for(let min=0;min<=80;min+=5) {
    const result=decidePrice({...item,minimum_price:min,original_price:100.03},model,during);
    assert.ok(result.price>=min&&result.price<=80.02);
  }
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
