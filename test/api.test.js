const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcrypt');
const fs = require('node:fs/promises');
const path = require('node:path');
const app = require('../server/index');
const pool = require('../server/db');

test('relational marketplace flow and ownership rules', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const marker = Date.now() + '-' + Math.random().toString(36).slice(2);
  const emails = ['customer','business','other'].map(kind => kind + '-' + marker + '@plateup.test');
  const ids = [];
  const listingIds = [];
  const imagePaths = [];
  const password = 'TestPassword123!';
  async function call(route, method = 'GET', body, token) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body:JSON.stringify(body) })
    });
    return { status:response.status, body:await response.json() };
  }
  try {
    const health = await call('/health');
    assert.deepEqual(health.body,{ status:'ok',database:'connected' });
    for (const [index,role] of ['customer','business','business'].entries()) {
      const result=await call('/auth/signup','POST',{
        name:role + ' ' + marker + ' ' + index,email:emails[index],password,role
      });
      assert.equal(result.status,201);
      ids.push(result.body.user.id);
    }
    const stored=await pool.query('SELECT password_hash FROM users WHERE id=$1',[ids[0]]);
    assert.notEqual(stored.rows[0].password_hash,password);
    assert.equal(await bcrypt.compare(password,stored.rows[0].password_hash),true);
    const login=async (email,role)=>{
      const result=await call('/auth/login','POST',{ email,password,role });
      assert.equal(result.status,200);
      return result.body.token;
    };
    const customer=await login(emails[0],'customer');
    const business=await login(emails[1],'business');
    const other=await login(emails[2],'business');
    assert.equal((await call('/me')).status,401);
    assert.equal((await call('/listings','POST',{ title:'unauthorized' })).status,401);
    const customerProfile=await call('/me','PUT',{ name:'Updated Customer',city:'Dhaka',address:'Test address' },customer);
    assert.equal(customerProfile.status,200);
    const ownProfile=await call('/me','GET',undefined,customer);
    assert.equal(ownProfile.body.profile.customer_city,'Dhaka');
    const listing=await call('/listings','POST',{
      title:'Test meal ' + marker,category:'Bakery',description:'Pickup today',
      original_price:100,rescue_price:50,offer_start_time:'00:00',offer_end_time:'00:00'
    },business);
    assert.equal(listing.status,201);
    const listingId=listing.body.listing.id;
    listingIds.push(listingId);
    assert.equal(listing.body.listing.business_id,ids[1]);
    assert.equal(listing.body.listing.daily_status,'Not Available Today');
    assert.equal((await call('/business/listings','GET',undefined,business)).body
      .some(item=>item.id===listingId),true);
    assert.equal((await call('/business/listings/'+listingId,'GET',undefined,business)).body
      .listing.daily_status,'Not Available Today');
    assert.equal((await call('/business/listings/'+listingId,'GET',undefined,other)).status,404);
    assert.equal((await call('/listings')).body.some(item=>item.id===listingId),false);
    assert.equal((await call('/listings/' + listingId,'PUT',{
      title:'Stolen',category:'Bakery',original_price:100,rescue_price:50,
      offer_start_time:'00:00',offer_end_time:'00:00'
    },other)).status,404);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:2 },other)).status,404);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:2 },business)).status,200);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:2 },business)).status,200);
    const daily=await pool.query('SELECT id,offer_date::text,initial_quantity,remaining_quantity FROM daily_availability WHERE listing_id=$1',[listingId]);
    assert.equal(daily.rows.length,1);
    assert.equal(daily.rows[0].initial_quantity,2);
    assert.equal(daily.rows[0].remaining_quantity,2);
    assert.equal((await call('/listings')).body.some(item=>item.id===listingId),true);
    const statuses=await pool.query(`SELECT
      plateup_daily_status(NULL,NULL,'20:00','00:00','2026-09-22 20:00') AS unavailable,
      plateup_daily_status('2026-09-22',5,'20:00','00:00','2026-09-22 19:59') AS scheduled,
      plateup_daily_status('2026-09-22',5,'20:00','00:00','2026-09-22 20:00') AS active,
      plateup_daily_status('2026-09-22',0,'20:00','00:00','2026-09-22 20:00') AS sold_out,
      plateup_daily_status('2026-09-22',5,'20:00','00:00','2026-09-23 00:00') AS closed,
      plateup_daily_status('2026-09-22',5,'22:00','01:00','2026-09-23 00:30') AS after_midnight`);
    assert.deepEqual(statuses.rows[0],{
      unavailable:'Not Available Today',scheduled:'Scheduled for Today',active:'Active',
      sold_out:'Sold Out',closed:'Closed for Today',after_midnight:'Active'
    });
    const itemFields={ title:'Image item '+marker,category:'Bakery',description:'Photo test',
      original_price:'100',rescue_price:'50',offer_start_time:'00:00',offer_end_time:'00:00' };
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    async function sendImage(route,method,bytes,type,fields=itemFields,authToken=business) {
      const form=new FormData();
      for (const [key,value] of Object.entries(fields)) form.append(key,value);
      if (bytes) form.append('image',new Blob([bytes],{ type }),'picture.bin');
      const response=await fetch(base+route,{ method,
        headers:{ Authorization:'Bearer '+authToken },body:form });
      return { status:response.status,body:await response.json() };
    }
    assert.equal((await sendImage('/listings','POST',Buffer.from('not an image'),'image/png')).status,400);
    assert.equal((await sendImage('/listings','POST',png,'text/plain')).status,400);
    assert.equal((await sendImage('/listings','POST',Buffer.alloc(5*1024*1024+1),'image/png')).status,400);
    const pictured=await sendImage('/listings','POST',png,'image/png');
    assert.equal(pictured.status,201);
    const picturedId=pictured.body.listing.id;
    listingIds.push(picturedId);
    imagePaths.push(pictured.body.listing.image_path);
    assert.match(imagePaths[0],/^\/uploads\/food\/[0-9a-f-]+\.png$/);
    const served=await fetch('http://127.0.0.1:'+server.address().port+imagePaths[0]);
    assert.equal(served.status,200);
    assert.match(served.headers.get('content-type'),/^image\/png/);
    assert.equal((await sendImage('/listings/'+picturedId,'PUT',png,'image/png',itemFields,other)).status,404);
    const unchanged=await call('/listings/'+picturedId,'PUT',itemFields,business);
    assert.equal(unchanged.status,200);
    assert.equal(unchanged.body.listing.image_path,imagePaths[0]);
    const replaced=await sendImage('/listings/'+picturedId,'PUT',png,'image/png');
    assert.equal(replaced.status,200);
    imagePaths.push(replaced.body.listing.image_path);
    assert.notEqual(imagePaths[0],imagePaths[1]);
    assert.equal((await fetch('http://127.0.0.1:'+server.address().port+imagePaths[0])).status,404);
    assert.equal((await fetch('http://127.0.0.1:'+server.address().port+imagePaths[1])).status,200);
    assert.equal((await call('/listings/'+picturedId+'/today','PUT',{ initial_quantity:1 },business)).status,200);
    const picturedMarketplace=(await call('/listings')).body.find(item=>item.id===picturedId);
    assert.equal(picturedMarketplace.image_path,imagePaths[1]);
    assert.equal((await call('/orders','POST',{ listing_id:listingId,quantity:3 },customer)).status,409);
    assert.equal((await call('/orders','POST',{ listing_id:listingId,quantity:1 },business)).status,403);
    const placed=await call('/orders','POST',{ listing_id:listingId,quantity:2,payment_method:'Pay at pickup' },customer);
    assert.equal(placed.status,201);
    const orderId=placed.body.orders[0].id;
    assert.equal(placed.body.orders[0].daily_availability_id,daily.rows[0].id);
    assert.equal((await call('/business/listings','GET',undefined,business)).body
      .find(item=>item.id===listingId).daily_status,'Sold Out');
    assert.equal((await call('/listings')).body.some(item=>item.id===listingId),false);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:1 },business)).status,409);
    assert.equal((await call('/orders','POST',{ listing_id:listingId,quantity:1 },customer)).status,409);
    assert.equal((await call('/orders/' + orderId,'PATCH',{ status:'confirmed' },other)).status,403);
    assert.equal((await call('/reviews','POST',{ order_id:orderId,rating:5,comment:'Too early' },customer)).status,403);
    assert.equal((await call('/orders/' + orderId,'PATCH',{ status:'confirmed' },business)).status,200);
    assert.equal((await call('/orders/' + orderId,'PATCH',{ status:'ready' },business)).status,200);
    assert.equal((await call('/orders/' + orderId,'PATCH',{ status:'completed' },business)).status,200);
    const sale=await pool.query('SELECT quantity_sold,price FROM sales_data WHERE order_id=$1',[orderId]);
    assert.equal(sale.rows[0].quantity_sold,2);
    assert.equal(Number(sale.rows[0].price),100);
    const reviewed=await call('/reviews','POST',{ order_id:orderId,rating:5,comment:'Great meal' },customer);
    assert.equal(reviewed.status,201);
    const reviewId=reviewed.body.review.id;
    assert.equal(reviewed.body.review.listing_id,listingId);
    assert.equal((await call('/reviews/' + reviewId,'PUT',{ rating:1,comment:'Tamper' },other)).status,403);
    assert.equal((await call('/reviews/' + reviewId + '/reply','PATCH',{ reply:'Wrong owner' },other)).status,404);
    assert.equal((await call('/reviews/' + reviewId + '/reply','PATCH',{ reply:'Thank you' },business)).status,200);
    assert.equal((await call('/reviews/' + reviewId,'PUT',{ rating:4,comment:'Still good' },customer)).status,200);
    assert.equal((await call('/reviews/' + reviewId,'DELETE',undefined,customer)).status,200);
    assert.equal((await call('/business/analytics','GET',undefined,business)).body.summary.meals_rescued,2);
    assert.deepEqual((await call('/business/predictions','GET',undefined,business)).body,[]);
    const restocked=await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:3 },business);
    assert.equal(restocked.status,200);
    assert.equal(restocked.body.listing.initial_quantity,3);
    assert.equal(restocked.body.listing.remaining_quantity,1);
    const second=await call('/orders','POST',{ listing_id:listingId,quantity:1 },customer);
    assert.equal(second.status,201);
    assert.equal((await call('/orders/' + second.body.orders[0].id,'PATCH',{ status:'cancelled' },customer)).status,200);
    const stock=await pool.query('SELECT initial_quantity,remaining_quantity FROM daily_availability WHERE listing_id=$1 AND offer_date=$2',
      [listingId,daily.rows[0].offer_date]);
    assert.equal(stock.rows[0].initial_quantity,3);
    assert.equal(stock.rows[0].remaining_quantity,1);
    const yesterday=await pool.query("INSERT INTO daily_availability (listing_id,offer_date,initial_quantity,remaining_quantity) VALUES ($1,$2::date-1,4,2) RETURNING id",
      [listingId,daily.rows[0].offer_date]);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:4 },business)).status,200);
    const preserved=await pool.query('SELECT initial_quantity,remaining_quantity FROM daily_availability WHERE id=$1',[yesterday.rows[0].id]);
    assert.deepEqual(preserved.rows[0],{ initial_quantity:4,remaining_quantity:2 });
    assert.equal((await call('/listings/' + listingId,'DELETE',undefined,business)).status,200);
    assert.equal((await call('/listings/' + listingId)).status,404);
    assert.equal((await call('/listings/' + listingId + '/today','PUT',{ initial_quantity:5 },business)).status,404);
  } finally {
    await pool.query('DELETE FROM sales_data WHERE order_id IN (SELECT id FROM orders WHERE customer_id=$1)',[ids[0]]);
    await pool.query('DELETE FROM reviews WHERE customer_id=$1',[ids[0]]);
    await pool.query('DELETE FROM orders WHERE customer_id=$1',[ids[0]]);
    await pool.query('DELETE FROM daily_availability WHERE listing_id=ANY($1)',[listingIds]);
    await pool.query('DELETE FROM listings WHERE business_id=ANY($1)',[ids.slice(1)]);
    await pool.query('DELETE FROM customers WHERE user_id=$1',[ids[0]]);
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1)',[ids.slice(1)]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)',[ids]);
    for (const imagePath of imagePaths) await fs.rm(path.join(__dirname,'..','server','uploads','food',path.basename(imagePath)),{ force:true });
    await new Promise(resolve=>server.close(resolve));
  }
});
