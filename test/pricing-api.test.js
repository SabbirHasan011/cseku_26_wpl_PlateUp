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
    assert.equal(before.pricing_source,'fallback');
    const order=await call('/orders','POST',{items:[{listing_id:id,quantity:1,unit_price:60}]},customer.token);
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
    const current=(await call('/listings/'+id,'GET',undefined,customer.token)).body.listing;
    assert.equal(current.pricing_source,'synthetic_model');assert.ok(Number(current.rescue_price)>=60&&Number(current.rescue_price)<=160);
    assert.equal(await readiness(),'Model active');
    const quote=await call('/cart/quote','POST',{items:[{listing_id:id,quantity:1}]},customer.token);
    assert.equal(quote.body.items[0].unit_price,Number(current.rescue_price));
    assert.equal((await call('/orders','POST',{items:[{listing_id:id,quantity:1,unit_price:199}]},customer.token)).status,409);
    assert.equal((await pool.query('SELECT total_price FROM orders WHERE id=$1',[orderId])).rows[0].total_price,'60.00');
    const stored=(await pool.query('SELECT COUNT(*) FROM ml_predictions WHERE listing_id=$1',[id])).rows[0];assert.ok(Number(stored.count)>0);
    await assert.rejects(pool.query('UPDATE listings SET rescue_price=161 WHERE id=$1',[id]),e=>e.code==='23514');
    await assert.rejects(pool.query('UPDATE listings SET rescue_price=59 WHERE id=$1',[id]),e=>e.code==='23514');
    // A new item configuration invalidates its model, keeping the saved history.
    assert.equal((await call('/listings/'+id,'PUT',{...fields,title:'Changed meal'},owner.token)).status,200);
    const after=await call(pricing+'/pricing','GET',undefined,owner.token);
    assert.equal(after.body.model,null);assert.equal(after.body.imported[0].records,180);
    assert.equal(after.body.item.pricing_source,'fallback');
    assert.equal(await readiness(),'Ready to train','Saved history remains usable after item settings change');
    await pool.query('INSERT INTO pricing_models(listing_id,artifact,source) VALUES ($1,$2,$3)',[id,JSON.stringify({usable:false}),'synthetic']);
    assert.equal(await readiness(),'Fallback active','A trained model that cannot price the item is distinguished from missing history');
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
