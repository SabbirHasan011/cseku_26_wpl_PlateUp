const test=require('node:test');
const assert=require('node:assert/strict');
const {PROFILES,generateItemHistory,generateIntervals}=require('../server/synthetic-sales');
const {parseCsv,writeCsv,validateRows}=require('../server/training-format');
test('item scenarios reconcile, preserve the importer format and vary independently by food',()=>{
  const rows=generateItemHistory(PROFILES[0]);
  assert.equal(rows.length,180);assert.deepEqual(rows,generateItemHistory(PROFILES[0]));
  assert.notDeepEqual(rows,generateItemHistory(PROFILES[0],{seed:2}));
  assert.deepEqual(validateRows(parseCsv(writeCsv(rows))).errors,[]);
  assert.ok(rows.some(row=>!row.collected_quantity));assert.ok(rows.some(row=>!row.remaining_quantity));
  assert.ok(rows.every(row=>row.data_source==='synthetic'&&!row.price_changed));
  assert.ok(new Set(rows.map(row=>row.rescue_unit_price)).size>30);
  assert.notDeepEqual(rows.map(r=>r.collected_quantity),generateItemHistory(PROFILES[1]).map(r=>r.collected_quantity));
});
test('three-minute scenarios preserve inventory, price limits, prior-only inputs and date-based holdout',()=>{
  const rows=generateIntervals(PROFILES[0],{days:5});
  const byDay=new Map();
  for(const row of rows) {
    if(!byDay.has(row.offer_date))byDay.set(row.offer_date,[]);byDay.get(row.offer_date).push(row);
    assert.equal(Date.parse(row.interval_end)-Date.parse(row.observed_at),180000);
    assert.equal(row.remaining_before-row.collected_next_3_minutes,row.remaining_after);
    assert.equal(row.booked_next_3_minutes,row.collected_next_3_minutes+row.cancelled_next_3_minutes+row.expired_next_3_minutes+row.rejected_next_3_minutes);
    assert.ok(row.collected_until_close<=row.remaining_before);
    assert.equal(row.data_source,'synthetic');
  }
  for(const day of byDay.values()) {
    assert.equal(new Set(day.map(r=>r.split)).size,1);
    for(let n=0;n<day.length;n++) {
      assert.equal(day[n].collected_previous_15_minutes,day.slice(Math.max(0,n-5),n).reduce((s,r)=>s+r.collected_next_3_minutes,0));
      assert.equal(day[n].collected_until_close,day.slice(n).reduce((s,r)=>s+r.collected_next_3_minutes,0));
      if(day[n].policy_kind==='gradual_policy') {
        assert.ok(day[n].effective_unit_price>=170&&day[n].effective_unit_price<=240);
        if(n)assert.ok(day[n].effective_unit_price<=day[n-1].effective_unit_price);
      }
    }
  }
  assert.ok(rows.some(r=>r.split==='holdout'));
  assert.ok(rows.filter(r=>r.split==='train').at(-1).offer_date<rows.find(r=>r.split==='holdout').offer_date);
  assert.equal(rows.at(-1).interval_end.slice(11,16),'18:00','Bangladesh midnight is UTC 18:00');
});
