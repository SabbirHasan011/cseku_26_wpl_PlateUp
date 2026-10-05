const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../server/index');
const pool=require('../server/db');
const {parseCsv,writeCsv}=require('../server/training-format');

test('item history, actual training, pricing bounds, ownership and reservation snapshots work together',async()=>{
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port+'/api',users=[],items=[];
  const call=async(route,method='GET',body,token,csv=false)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':csv?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      ...(body===undefined?{}:{body:csv?body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  try {
    for(const role of ['business','business','customer']) {
      const credentials={name:'ML test',role,email:'ml-'+Date.now()+'-'+users.length+'@plateup.test',password:'MlTestPassword123!'};
      const signup=await call('/auth/signup','POST',credentials);assert.equal(signup.status,201);
      const login=await call('/auth/login','POST',credentials);users.push({...signup.body.user,token:login.body.token});
      assert.equal((await call('/me','PUT',{name:'ML test',city:'Dhaka'},login.body.token)).status,200);
    }
    const [owner,other,customer]=users;
    const fields={title:'Pricing meal',category:'Bakery',original_price:200,minimum_price:60,offer_start_time:'00:00',offer_end_time:'00:00'};
    assert.equal((await call('/listings','POST',{...fields,minimum_price:161},owner.token)).status,400);
    assert.equal((await call('/listings','POST',{...fields,original_price:200.32},owner.token)).status,400);
    assert.equal((await call('/listings','POST',{...fields,minimum_price:60.32},owner.token)).status,400);
    const created=await call('/listings','POST',fields,owner.token);assert.equal(created.status,201);
    const id=created.body.listing.id;items.push(id);
    assert.equal(created.body.listing.minimum_price,'60.00');
    const pricing='/business/listings/'+id;
    const readiness=async()=>(await call('/business/listings','GET',undefined,owner.token)).body.find(item=>item.id===id).pricing_readiness;
    assert.equal(await readiness(),'History needed');
    assert.equal((await call(pricing+'/pricing')).status,401);
    assert.equal((await call(pricing+'/pricing','GET',undefined,other.token)).status,404);
    assert.equal((await call(pricing+'/train','POST',{source:'synthetic'},customer.token)).status,403);
    assert.equal((await call(pricing+'/train','POST',{source:'synthetic'},other.token)).status,404);
    assert.equal((await call(pricing+'/train','POST',{source:'restaurant'},owner.token)).status,422);
    await call('/listings/'+id+'/today','PUT',{initial_quantity:20},owner.token);
    const before=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(before.pricing_source,'time_policy');assert.equal(Number(before.rescue_price),160);
    const order=await call('/orders','POST',{items:[{listing_id:id,quantity:1,unit_price:160}]},customer.token);
    assert.equal(order.status,201);const orderId=order.body.orders[0].id;
    const sample=await call(pricing+'/sample','POST',{},owner.token);assert.equal(sample.status,200);
    const csv=sample.body.csv,importPath='/business/training-data/import?listing_id='+id;
    assert.equal((await call(importPath,'POST',csv,other.token,true)).status,404);
    const mixed=writeCsv([...parseCsv(csv),{...parseCsv(csv)[0],item_reference:'another-item'}]);
    assert.equal((await call(importPath,'POST',mixed,owner.token,true)).status,400);
    assert.equal((await call(importPath,'POST',csv,owner.token,true)).status,201);
    assert.equal(await readiness(),'Ready to train');
    assert.equal((await call(importPath,'POST',csv,owner.token,true)).status,409);
    const trained=await call(pricing+'/train','POST',{source:'synthetic'},owner.token);
    assert.equal(trained.status,200,JSON.stringify(trained.body));assert.equal(trained.body.metrics.usable,true);
    const details=await call(pricing+'/pricing','GET',undefined,owner.token);
    assert.equal(details.body.model.source,'synthetic');assert.equal(details.body.model.artifact.rows,180);
    assert.equal(details.body.model.artifact.weights,undefined,'Business status excludes coefficient payload');
    assert.equal(details.body.imported[0].records,180);
    // An immediate retrain cannot reset this day's opening price or bypass its clock.
    const immediate=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(Number(immediate.rescue_price),160);
    await pool.query("UPDATE daily_availability SET last_price=140,last_priced_at=NOW()-INTERVAL '4 minutes' WHERE listing_id=$1",[id]);
    await pool.query('UPDATE listings SET rescue_price=140,pricing_updated_at=NULL WHERE id=$1',[id]);
    const current=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(current.pricing_source,'synthetic_model',current.pricing_reason);assert.ok(Number(current.rescue_price)>=60&&Number(current.rescue_price)<=160);
    assert.equal(await readiness(),'Model active');
    // Requests before three minutes retain the previous calculation. Advancing
    // only this fixture's timestamp exercises the real SQL gate without waiting.
    const recent=(await pool.query("UPDATE listings SET pricing_updated_at=NOW()-INTERVAL '2 minutes' WHERE id=$1 RETURNING pricing_updated_at,rescue_price",[id])).rows[0];
    const held=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(held.pricing_updated_at,recent.pricing_updated_at.toISOString());
    assert.equal(held.rescue_price,recent.rescue_price);
    const due=(await pool.query("UPDATE listings SET pricing_updated_at=NOW()-INTERVAL '181 seconds' WHERE id=$1 RETURNING pricing_updated_at",[id])).rows[0];
    await pool.query("UPDATE daily_availability SET last_priced_at=NOW()-INTERVAL '181 seconds' WHERE listing_id=$1",[id]);
    const refreshed=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.ok(Date.parse(refreshed.pricing_updated_at)>due.pricing_updated_at.getTime());
    assert.ok(Number(refreshed.rescue_price)>=60&&Number(refreshed.rescue_price)<=160);
    assert.ok(Number(refreshed.rescue_price)<=Number(held.rescue_price));
    assert.ok(Number.isInteger(Number(refreshed.rescue_price)));
    assert.ok(Number(held.rescue_price)-Number(refreshed.rescue_price)<=10.001);
    const quantityUpdate=await call('/listings/'+id+'/today','PUT',{initial_quantity:25},owner.token);
    assert.equal(quantityUpdate.status,200);
    const quantityPrice=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(quantityPrice.rescue_price,refreshed.rescue_price,'Quantity edits cannot cause another drop immediately');
    const quote=await call('/cart/quote','POST',{items:[{listing_id:id,quantity:1}]},customer.token);
    assert.equal(quote.body.items[0].unit_price,Number(refreshed.rescue_price));
    assert.equal((await call('/orders','POST',{items:[{listing_id:id,quantity:1,unit_price:199}]},customer.token)).status,409);
    assert.equal((await pool.query('SELECT total_price FROM orders WHERE id=$1',[orderId])).rows[0].total_price,'160.00');
    const stored=(await pool.query('SELECT COUNT(*) FROM ml_predictions WHERE listing_id=$1',[id])).rows[0];assert.ok(Number(stored.count)>0);
    await assert.rejects(pool.query('UPDATE listings SET rescue_price=161 WHERE id=$1',[id]),e=>e.code==='23514');
    await assert.rejects(pool.query('UPDATE listings SET rescue_price=59 WHERE id=$1',[id]),e=>e.code==='23514');
    // A new item configuration invalidates its model, keeping the saved history.
    assert.equal((await call('/listings/'+id,'PUT',{...fields,title:'Changed meal'},owner.token)).status,200);
    const after=await call(pricing+'/pricing','GET',undefined,owner.token);
    assert.equal(after.body.model,null);assert.equal(after.body.imported[0].records,180);
    assert.equal(after.body.item.pricing_source,'time_policy');
    assert.equal(await readiness(),'Ready to train','Saved history remains usable after item settings change');
    await pool.query('INSERT INTO pricing_models(listing_id,artifact,source) VALUES ($1,$2,$3)',[id,JSON.stringify({usable:false}),'synthetic']);
    assert.equal(await readiness(),'Baseline active','A trained model that cannot price the item is distinguished from missing history');
    // Every active item uses its inventory clock, even when a different read
    // recently updated the listing clock. One item at its floor cannot stop another.
    const second=await call('/listings','POST',{...fields,title:'Second pricing meal'},owner.token);
    assert.equal(second.status,201);const secondId=second.body.listing.id;items.push(secondId);
    await call('/listings/'+secondId+'/today','PUT',{initial_quantity:10},owner.token);
    await pool.query("UPDATE daily_availability SET last_price=150.82,last_priced_at=NOW()-INTERVAL '181 seconds' WHERE listing_id=$1",[secondId]);
    await pool.query("UPDATE daily_availability SET last_price=60,last_priced_at=NOW()-INTERVAL '181 seconds' WHERE listing_id=$1",[id]);
    await pool.query('UPDATE listings SET pricing_updated_at=NOW() WHERE id=ANY($1)',[[id,secondId]]);
    const all=(await call('/business/listings','GET',undefined,owner.token)).body;
    for(const itemId of [id,secondId]) {
      const row=all.find(item=>item.id===itemId);
      assert.ok(Number.isInteger(Number(row.rescue_price)));
      assert.ok(Date.now()-Date.parse(row.last_priced_at)<10000,'Each due inventory clock must be reviewed');
    }
    assert.equal(Number(all.find(item=>item.id===id).rescue_price),60);
    assert.match(all.find(item=>item.id===id).pricing_reason,/Minimum price reached/);
    const otherPrice=Number(all.find(item=>item.id===secondId).rescue_price);
    assert.ok(otherPrice>=140&&otherPrice<=150);
    assert.equal((await pool.query('SELECT total_price FROM orders WHERE id=$1',[orderId])).rows[0].total_price,'160.00');
  }finally {
    const ids=users.map(u=>u.id);
    await pool.query('DELETE FROM ml_predictions WHERE listing_id=ANY($1)',[items]);
    await pool.query('DELETE FROM orders WHERE customer_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM daily_availability WHERE listing_id=ANY($1)',[items]);
    await pool.query('DELETE FROM listings WHERE id=ANY($1)',[items]);
    await pool.query('DELETE FROM customers WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)',[ids]);
    await new Promise(resolve=>server.close(resolve));
  }
});
