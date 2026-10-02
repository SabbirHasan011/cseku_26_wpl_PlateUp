const test=require('node:test');
const assert=require('node:assert/strict');
const {writeCsv,parseCsv,validateRows,offerEnd,eligibility,generateSynthetic}=require('../server/training-format');

test('synthetic data is deterministic, varied, labelled and valid, including overnight offers',()=>{
  const rows=generateSynthetic();
  assert.equal(rows.length,900);
  assert.deepEqual(rows,generateSynthetic());
  assert.notDeepEqual(rows,generateSynthetic({seed:43}));
  assert.deepEqual(validateRows(parseCsv(writeCsv(rows))).errors,[]);
  assert.ok(rows.some(row=>row.collected_quantity===0));
  assert.ok(rows.some(row=>row.remaining_quantity===0));
  assert.ok(rows.some(row=>row.expired_quantity>0));
  assert.ok(rows.every(row=>row.data_source==='synthetic'&&row.snapshot_quality==='synthetic'));
  const overnight=rows.find(row=>row.offer_end_time==='01:00');
  assert.equal(new Date(offerEnd(overnight)).toISOString(),overnight.offer_date+'T19:00:00.000Z');
  assert.throws(()=>generateSynthetic({days:1000}),/1–366/);
});
test('CSV supports quoted commas, UTF-8, newlines and safe spreadsheet cells without losing text',()=>{
  const row=generateSynthetic({days:1,items:1})[0];
  row.title='=SUM(1,2)';row.category='Meal "special", বাংলা\nBakery';
  const csv=writeCsv([row]);
  assert.ok(csv.includes("'=SUM"));
  const decoded=parseCsv('\uFEFF'+csv)[0];
  assert.equal(decoded.title,row.title);assert.equal(decoded.category,row.category);
  row.title="'=already literal";
  assert.equal(parseCsv(writeCsv([row]))[0].title,row.title);
  assert.throws(()=>parseCsv('wrong,headers\n1,2'),/headers/);
  assert.throws(()=>parseCsv(writeCsv([])+'"unclosed'),/Unclosed/);
});
test('validation rejects invalid dates, stock, prices, future outcomes and duplicate records',()=>{
  const row=generateSynthetic({days:1,items:1})[0];
  for(const patch of [{offer_date:'2025-02-30'},{rescue_unit_price:9999},{collected_quantity:999},
    {initial_quantity:''},{data_source:'fake'},{price_changed:'yes'},{revenue:999999},
    {offer_date:'2099-01-01'},{item_reference:'plateup:1'},{snapshot_quality:'captured'}]) {
    assert.ok(validateRows([{...row,...patch}]).errors.length,JSON.stringify(patch));
  }
  assert.ok(validateRows([row,row]).errors.some(error=>error.issues.some(issue=>issue.includes('Duplicate'))));
  assert.equal(eligibility({...row,snapshot_quality:'legacy_estimated'}).training_eligible,false);
  assert.equal(eligibility({...row,price_changed:true}).training_eligible,false);
  assert.equal(eligibility({...row,sales_mismatches:1}).training_eligible,false);
  assert.equal(eligibility({...row,pending_quantity:1}).finalized,false);
});
