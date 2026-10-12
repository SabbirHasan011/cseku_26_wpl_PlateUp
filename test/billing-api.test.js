const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=require('../server/index');
const pool=require('../server/db');
const {createAdmin}=require('../tools/create-admin');
const {recordCommission,amountInCents}=require('../server/billing');

test('billing records completion fees once, protects monthly statements, separates demo receipts and audits payments',async()=>{
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port+'/api',users=[],items=[];
  const password='BillingTestPassword123!',marker=Date.now();
  const call=async(route,method='GET',body,token)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  try {
    for(const role of ['business','business','customer']) {
      const credentials={name:'Billing test',email:'billing-'+marker+'-'+users.length+'@plateup.test',password,role};
      const signup=await call('/auth/signup','POST',credentials);assert.equal(signup.status,201);
      const login=await call('/auth/login','POST',credentials);assert.equal(login.status,200);
      users.push({...signup.body.user,token:login.body.token});
      await call('/me','PUT',{name:'Billing test',city:'Dhaka'},login.body.token);
    }
    const [owner,other,customer]=users;
    const admin=await createAdmin({email:'admin-'+marker+'@plateup.test',name:'Billing admin',password});users.push(admin);
    assert.equal((await call('/auth/signup','POST',{name:'Untrusted',email:'bad-admin-'+marker+'@plateup.test',password,role:'admin'})).status,400);
    await assert.rejects(createAdmin({email:owner.email,name:'Cannot promote',password}),/already exists/);
    assert.equal((await call('/auth/login','POST',{email:admin.email,password,role:'admin'})).status,401);
    const login=await call('/auth/admin/login','POST',{email:admin.email,password});assert.equal(login.status,200);admin.token=login.body.token;
    assert.equal((await call('/admin/revenue')).status,401);
    assert.equal((await call('/admin/revenue','GET',undefined,owner.token)).status,403);
    assert.equal((await call('/business/billing','GET',undefined,customer.token)).status,403);
    const created=await call('/listings','POST',{title:'Billing bread',category:'Bakery',original_price:250,minimum_price:100,offer_start_time:'00:00',offer_end_time:'00:00'},owner.token);
    assert.equal(created.status,201);const item=created.body.listing.id;items.push(item);
    assert.equal((await call('/listings/'+item+'/today','PUT',{initial_quantity:40},owner.token)).status,200);
    const reserve=async quantity=>{
      const result=await call('/orders','POST',{items:[{listing_id:item,quantity,unit_price:200}],commission_rate_bps:0},customer.token);
      assert.equal(result.status,201,JSON.stringify(result.body));return result.body.orders[0];
    };
    const finish=async order=>{
      for(const status of ['confirmed','ready','completed']) {
        const result=await call('/orders/'+order.id,'PATCH',{status,pickup_code:order.pickup_code},owner.token);
        assert.equal(result.status,200,JSON.stringify(result.body));
      }
    };
    const first=await reserve(1), second=await reserve(2), cancelled=await reserve(1),rejected=await reserve(1),expired=await reserve(1),legacy=await reserve(1);
    assert.equal(first.commission_rate_bps,1000,'Clients cannot override the fee snapshot');
    assert.equal((await call('/business/billing','GET',undefined,owner.token)).body.invoices.length,0,'Reservations alone produce no fee');
    await call('/orders/'+cancelled.id,'PATCH',{status:'cancelled'},customer.token);
    await call('/orders/'+rejected.id,'PATCH',{status:'rejected',reason:'No stock'},owner.token);
    await pool.query("UPDATE orders SET pickup_deadline=NOW()-INTERVAL '1 minute' WHERE id=$1",[expired.id]);
    await call('/orders','GET',undefined,customer.token);
    await pool.query('UPDATE orders SET commission_rate_bps=NULL WHERE id=$1',[legacy.id]);
    await finish(legacy);
    await finish(first);await finish(second);
    const billing=(await call('/business/billing','GET',undefined,owner.token)).body;
    assert.equal(billing.commission_rate_bps,1000);
    assert.equal(billing.summary.gross_sales,'800.00');assert.equal(billing.summary.commission_total,'80.00');
    assert.equal(billing.summary.restaurant_net,'720.00');assert.equal(billing.summary.outstanding,'80.00');
    const platform=await call('/admin/revenue','GET',undefined,admin.token);
    assert.equal(platform.status,200);assert.equal(platform.body.commission_rate_bps,1000);
    const totals=(await pool.query('SELECT COALESCE(SUM(gross_amount),0)::text AS sales,COALESCE(SUM(fee_amount),0)::text AS fees FROM platform_commissions')).rows[0];
    assert.equal(platform.body.summary.gross_sales,totals.sales);assert.equal(platform.body.summary.commission_total,totals.fees);
    assert.ok(platform.body.invoices.some(i=>i.business_id===owner.id&&i.commission_total==='80.00'));
    assert.equal(billing.invoices.length,1);const invoice=billing.invoices[0];
    assert.equal(invoice.period_open,true);
    assert.equal(invoice.period_start,(await pool.query("SELECT DATE_TRUNC('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date::text AS month")).rows[0].month);
    assert.equal((await call('/business/billing/invoices/'+invoice.id,'GET',undefined,other.token)).status,404);
    assert.equal((await call('/business/billing/invoices/'+invoice.id,'GET',undefined,customer.token)).status,403);
    const detail=(await call('/business/billing/invoices/'+invoice.id,'GET',undefined,owner.token)).body;
    assert.equal(detail.entries.length,3);assert.deepEqual(detail.entries.map(e=>e.fee_amount).sort(),['20.00','20.00','40.00']);
    assert.equal((await pool.query('SELECT commission_rate_bps FROM orders WHERE id=$1',[legacy.id])).rows[0].commission_rate_bps,1000);
    assert.equal((await call('/orders/'+first.id,'PATCH',{status:'completed',pickup_code:first.pickup_code},owner.token)).status,400);
    await recordCommission(pool,{...first,status:'completed',business_id:owner.id,listing_title:'Different later name'});
    assert.equal((await call('/business/billing','GET',undefined,owner.token)).body.summary.commission_total,'80.00');
    const payment=(kind,amount,reference)=>({kind,amount,reference,method:'bank_transfer',received_at:new Date().toISOString(),verified:true});
    const endpoint='/admin/billing/invoices/'+invoice.id+'/payments';
    assert.equal((await call(endpoint,'POST',payment('real','5.00','forbidden'),owner.token)).status,403);
    assert.equal((await call(endpoint,'POST',{...payment('real','5.00','unverified'),verified:false},admin.token)).status,400);
    for(const amount of ['-1','0','1.001','NaN','1e2'])assert.equal((await call(endpoint,'POST',payment('real',amount,'invalid-'+amount),admin.token)).status,400);
    assert.equal((await call(endpoint,'POST',payment('demo','80.00','demo-'+marker),admin.token)).status,201);
    let report=(await call('/business/billing','GET',undefined,owner.token)).body;
    assert.equal(report.summary.demo_received,'80.00');assert.equal(report.summary.real_received,'0.00');assert.equal(report.summary.outstanding,'80.00');
    const partial=await call(endpoint,'POST',payment('real','10.00','actual-'+marker),admin.token);assert.equal(partial.status,201);
    assert.equal((await call(endpoint,'POST',payment('real','10.00','actual-'+marker),admin.token)).status,409);
    assert.equal((await call(endpoint,'POST',payment('real','71.00','too-much-'+marker),admin.token)).status,409);
    const concurrent=await Promise.all(['a','b'].map(s=>call(endpoint,'POST',payment('real','50.00','concurrent-'+marker+s),admin.token)));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409],'Row locks prevent concurrent overpayment');
    report=(await call('/business/billing','GET',undefined,owner.token)).body;
    assert.equal(report.summary.real_received,'60.00');assert.equal(report.summary.outstanding,'20.00');assert.equal(report.invoices[0].payment_status,'partial');
    assert.equal((await call('/admin/billing/payments/'+partial.body.payment.id+'/void','POST',{reason:'Wrong receipt'},owner.token)).status,403);
    assert.equal((await call('/admin/billing/payments/'+partial.body.payment.id+'/void','POST',{reason:'Wrong reference'},admin.token)).status,200);
    assert.equal((await call('/admin/billing/payments/'+partial.body.payment.id+'/void','POST',{reason:'Repeated'},admin.token)).status,409);
    report=(await call('/business/billing','GET',undefined,owner.token)).body;assert.equal(report.summary.outstanding,'30.00');
    assert.equal((await call(endpoint,'POST',payment('real','30.00','settled-'+marker),admin.token)).status,201);
    report=(await call('/business/billing','GET',undefined,owner.token)).body;assert.equal(report.summary.outstanding,'0.00');assert.equal(report.invoices[0].payment_status,'paid');
    const ledger=(await call('/admin/billing/invoices/'+invoice.id,'GET',undefined,admin.token)).body;
    assert.ok(ledger.payments.some(p=>p.voided_by===admin.id&&p.void_reason==='Wrong reference'));
    assert.equal((await call('/admin/revenue?month=bad','GET',undefined,admin.token)).status,400);
    assert.equal((await call('/business/billing?business_id='+owner.id,'GET',undefined,other.token)).body.invoices.length,0);
    // Rerunning the foundational migration preserves the new policy and charges.
    const count=(await pool.query('SELECT COUNT(*)::int AS n FROM platform_commissions')).rows[0].n;
    await pool.query(fs.readFileSync(path.join(__dirname,'../server/migrations/008-platform-billing.sql'),'utf8'));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM platform_commissions')).rows[0].n,count);
    assert.equal((await pool.query('SELECT commission_rate_bps FROM orders WHERE id=$1',[legacy.id])).rows[0].commission_rate_bps,1000);
  } finally {
    const ids=users.map(u=>u.id);
    await pool.query('DELETE FROM billing_payments WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE business_id=ANY($1))',[ids]);
    await pool.query('DELETE FROM platform_commissions WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE business_id=ANY($1))',[ids]);
    await pool.query('DELETE FROM billing_invoices WHERE business_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM sales_data WHERE business_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM orders WHERE customer_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM ml_predictions WHERE listing_id=ANY($1)',[items]);
    await pool.query('DELETE FROM daily_availability WHERE listing_id=ANY($1)',[items]);
    await pool.query('DELETE FROM listings WHERE id=ANY($1)',[items]);
    await pool.query('DELETE FROM customers WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1)',[ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)',[ids]);
    await new Promise(resolve=>server.close(resolve));
  }
});

test('receipt amounts require exact cents and reject unsafe numbers',()=>{
  assert.equal(amountInCents('10.01'),1001);assert.equal(amountInCents('10.1'),1010);
  for(const value of ['-1','1.001','NaN','Infinity','1e3','99999999999999999999',null])assert.equal(amountInCents(value),null);
});
