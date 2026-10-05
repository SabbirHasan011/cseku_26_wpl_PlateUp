const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../server/index');
const pool=require('../server/db');
const {generateSynthetic,writeCsv,parseCsv}=require('../server/training-format');
const fs=require('node:fs');
const path=require('node:path');

test('offer snapshots, isolated imports, data checks, expiry and price events are integrated and owned',async()=>{
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port+'/api',marker=Date.now();
  const users=[],listingIds=[];
  async function call(route,method='GET',body,token,csv=false) {
    const response=await fetch(base+route,{method,headers:{'Content-Type':csv?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      ...(body===undefined?{}:{body:csv?body:JSON.stringify(body)})});
    return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};
  }
  try {
    for(const role of ['business','business','customer']) {
      const email='training-'+users.length+'-'+marker+'@plateup.test',password='TrainingPassword123!';
      const signup=await call('/auth/signup','POST',{name:'Training test',email,password,role});assert.equal(signup.status,201);
      const login=await call('/auth/login','POST',{email,password,role});assert.equal(login.status,200);
      users.push({...signup.body.user,token:login.body.token});
      assert.equal((await call('/me','PUT',{name:'Training test',city:'Dhaka'},login.body.token)).status,200);
    }
    const [business,other,customer]=users;
    assert.equal((await call('/business/training-data')).status,401);
    assert.equal((await call('/business/training-data','GET',undefined,customer.token)).status,403);
    const created=await call('/listings','POST',{title:'Snapshot meal',category:'Bakery',original_price:200,rescue_price:100,
      offer_start_time:'00:00',offer_end_time:'00:00'},business.token);
    assert.equal(created.status,201);const id=created.body.listing.id;listingIds.push(id);
    assert.equal((await call('/listings/'+id+'/today','PUT',{initial_quantity:10},other.token)).status,404);
    await call('/listings/'+id+'/today','PUT',{initial_quantity:10},business.token);
    const a=(await pool.query('SELECT * FROM daily_availability WHERE listing_id=$1',[id])).rows[0];
    const snapshot=(await pool.query('SELECT * FROM offer_snapshots WHERE daily_availability_id=$1',[a.id])).rows[0];
    assert.equal(snapshot.quality,'captured');assert.equal(snapshot.rescue_unit_price,'160.00');
    const order=(await call('/orders','POST',{listing_id:id,quantity:2,unit_price:160},customer.token)).body.orders[0];
    assert.ok(order.id);
    const editing={title:'Renamed meal',category:'Bakery',original_price:175,rescue_price:80,offer_start_time:'00:00',offer_end_time:'00:00'};
    assert.equal((await call('/listings/'+id,'PUT',editing,business.token)).status,200);
    await call('/listings/'+id+'/today','PUT',{initial_quantity:12},business.token);
    const unchanged=(await pool.query('SELECT * FROM offer_snapshots WHERE daily_availability_id=$1',[a.id])).rows[0];
    assert.deepEqual(unchanged,snapshot,'Edits must preserve the first snapshot.');
    const events=await call('/business/training-data/events','GET',undefined,business.token);
    assert.equal(events.status,200);assert.match(events.body,/price_changed/);assert.match(events.body,/quantity_changed/);
    assert.match(events.body,/reservation_created/);assert.match(events.body,/160\.0000/);
    assert.ok(!(await call('/business/training-data/events','GET',undefined,other.token)).body.includes('plateup:'+id));
    await pool.query("UPDATE orders SET pickup_deadline=NOW()-INTERVAL '1 minute' WHERE id=$1",[order.id]);
    const history=await call('/business/training-data','GET',undefined,business.token);
    assert.equal(history.status,200);const row=history.body.rows.find(row=>row.item_reference==='plateup:'+id);
    assert.equal(row.title,'Snapshot meal');assert.equal(row.rescue_unit_price,'160.00');assert.equal(row.price_changed,true);
    assert.equal(row.quantity_changed,true);assert.equal(row.expired_quantity,2);assert.equal(row.remaining_quantity,12);
    assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status,'expired');
    assert.equal((await call('/business/training-data?format=csv','GET',undefined,business.token)).body.includes('plateup:'+id),false);

    // A closed zero-sales offer should be included; no sale row is required for zero.
    const past=(await pool.query(`INSERT INTO daily_availability(listing_id,offer_date,initial_quantity,remaining_quantity)
      VALUES($1,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-2,4,4) RETURNING id`,[id])).rows[0];
    const clean=await call('/business/training-data?format=csv','GET',undefined,business.token);
    assert.equal(parseCsv(clean.body).length,1);assert.equal(parseCsv(clean.body)[0].collected_quantity,'0');
    const completed=(await pool.query(`INSERT INTO orders(customer_id,listing_id,daily_availability_id,quantity,total_price,status)
      VALUES($1,$2,$3,1,140,'completed') RETURNING id`,[customer.id,id,past.id])).rows[0];
    await pool.query('UPDATE daily_availability SET remaining_quantity=3 WHERE id=$1',[past.id]);
    let check=(await call('/business/training-data','GET',undefined,business.token)).body.rows.find(row=>row.daily_availability_id===past.id);
    assert.equal(check.training_eligible,false);assert.ok(check.quality_issues.some(issue=>issue.includes('sales records')));
    await pool.query('INSERT INTO sales_data(business_id,listing_id,order_id,quantity_sold,price) VALUES($1,$2,$3,1,140)',[business.id,id,completed.id]);
    check=(await call('/business/training-data','GET',undefined,business.token)).body.rows.find(row=>row.daily_availability_id===past.id);
    assert.equal(check.training_eligible,true,'Consistent ended offers become eligible.');
    await call('/listings/'+id,'DELETE',{},business.token);
    assert.equal(parseCsv((await call('/business/training-data?format=csv','GET',undefined,business.token)).body).length,1,'Deactivation preserves historical offers.');
    const snapshotCount=Number((await pool.query('SELECT COUNT(*) FROM offer_snapshots WHERE daily_availability_id=ANY($1)',[[a.id,past.id]])).rows[0].count);
    await pool.query(fs.readFileSync(path.join(__dirname,'../server/migrations/005-training-data.sql'),'utf8'));
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM offer_snapshots WHERE daily_availability_id=ANY($1)',[[a.id,past.id]])).rows[0].count),snapshotCount);
    assert.equal((await pool.query('SELECT quality FROM offer_snapshots WHERE daily_availability_id=$1',[a.id])).rows[0].quality,'captured');

    const samples=generateSynthetic({days:2,items:2,seed:123}),csv=writeCsv(samples);
    const salesBefore=(await pool.query('SELECT COUNT(*) FROM sales_data')).rows[0].count;
    assert.equal((await call('/business/training-data/import?dry_run=true','POST',csv,business.token,true)).body.count,4);
    assert.equal((await pool.query('SELECT COUNT(*) FROM training_records WHERE business_id=$1',[business.id])).rows[0].count,'0');
    const invalid=writeCsv([...samples,{...samples[0],item_reference:'invalid',remaining_quantity:999}]);
    assert.equal((await call('/business/training-data/import','POST',invalid,business.token,true)).status,400);
    assert.equal((await call('/business/training-data/import','POST',csv,business.token,true)).status,201);
    assert.equal((await call('/business/training-data/import','POST',csv,business.token,true)).status,409);
    const duplicateAndNew=writeCsv([samples[0],{...samples[0],item_reference:'must-not-partially-import'}]);
    assert.equal((await call('/business/training-data/import','POST',duplicateAndNew,business.token,true)).status,409);
    assert.equal((await pool.query('SELECT COUNT(*) FROM training_records WHERE business_id=$1',[business.id])).rows[0].count,'4','Duplicate batches do not partially save new rows.');
    assert.equal((await call('/business/training-data?source=synthetic','GET',undefined,business.token)).body.summary.total,4);
    assert.equal((await call('/business/training-data?source=synthetic','GET',undefined,other.token)).body.summary.total,0);
    assert.equal((await pool.query('SELECT COUNT(*) FROM sales_data')).rows[0].count,salesBefore);
    const real={...samples[0],item_reference:'restaurant-biryani',data_source:'real',snapshot_quality:'self_reported'};
    assert.equal((await call('/business/training-data/import','POST',writeCsv([real]),business.token,true)).status,201);
    assert.equal((await call('/business/training-data?source=restaurant','GET',undefined,business.token)).body.summary.total,1);
    const generated=await call('/business/training-data/synthetic','POST',{seed:9,days:3,items:2},business.token);
    assert.equal(generated.body.count,6);assert.equal(generated.body.csv,(await call('/business/training-data/synthetic','POST',{seed:9,days:3,items:2},business.token)).body.csv);
    assert.equal((await call('/business/training-data/synthetic','POST',{start:'2099-01-01'},business.token)).status,400);
  } finally {
    const ids=users.map(user=>user.id);
    await pool.query('DELETE FROM sales_data WHERE business_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM orders WHERE customer_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM daily_availability WHERE listing_id=ANY($1)',[listingIds]);
    await pool.query('DELETE FROM listings WHERE id=ANY($1)',[listingIds]);
    await pool.query('DELETE FROM customers WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)',[ids]);
    await new Promise(resolve=>server.close(resolve));
  }
});
