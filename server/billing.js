const pool = require('./db');
const COMMISSION_RATE_BPS = 1000;
const METHODS = ['bank_transfer','bkash','nagad','cash','other'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max) => typeof value==='string' ? value.trim().slice(0,max) : '';

function amountInCents(value) {
  const match=/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  const cents=match ? Number(match[1])*100 + Number((match[2]||'').padEnd(2,'0')) : null;
  return Number.isSafeInteger(cents) ? cents : null;
}

// Called inside the existing pickup transaction. All completed orders use 10%;
// a unique order FK prevents duplicate charges on retries.
async function recordCommission(db, order) {
  if (order.status !== 'completed') throw fail(400,'Only completed pickups can incur a commission.');
  // Read the original completion timestamp in SQL so legacy wall-clock values
  // never depend on the Node/browser timezone. Update older in-flight snapshots.
  const completed=(await db.query(`UPDATE orders o SET commission_rate_bps=$2
    FROM listings l WHERE o.id=$1 AND o.listing_id=l.id AND o.status='completed'
    RETURNING o.id,o.total_price,l.business_id,l.title,
      COALESCE(o.pickup_time,(SELECT s.sale_time FROM sales_data s WHERE s.order_id=o.id),
        o.updated_at,o.order_time,o.created_at) AT TIME ZONE 'Asia/Dhaka' AS completed_at`,
    [order.id,COMMISSION_RATE_BPS])).rows[0];
  if(!completed)throw fail(400,'Only completed pickups can incur a commission.');
  const invoice = (await db.query(`INSERT INTO billing_invoices(business_id,period_start)
    VALUES ($1,DATE_TRUNC('month',$2::timestamptz AT TIME ZONE 'Asia/Dhaka')::date)
    ON CONFLICT(business_id,period_start) DO UPDATE SET business_id=EXCLUDED.business_id RETURNING id`,
    [completed.business_id,completed.completed_at])).rows[0];
  await db.query(`INSERT INTO platform_commissions(invoice_id,order_id,item_title,gross_amount,rate_bps,fee_amount,completed_at)
    VALUES ($1,$2,$3,$4::numeric,$5::int,ROUND($4::numeric*$5::int/10000,2),$6) ON CONFLICT(order_id) DO NOTHING`,
    [invoice.id,completed.id,completed.title,completed.total_price,COMMISSION_RATE_BPS,completed.completed_at]);
}

const invoiceSql = `SELECT i.id,i.business_id,i.period_start::text,i.created_at,b.business_name,
  'PU-'||TO_CHAR(i.period_start,'YYYYMM')||'-'||i.id AS invoice_number,
  i.period_start=DATE_TRUNC('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date AS period_open,
  c.gross_sales,c.commission_total,c.order_count,p.real_received,p.demo_received,
  c.commission_total-p.real_received AS outstanding,
  CASE WHEN p.real_received>=c.commission_total THEN 'paid'
    WHEN p.real_received>0 THEN 'partial' ELSE 'unpaid' END AS payment_status
  FROM billing_invoices i JOIN businesses b ON b.user_id=i.business_id
  CROSS JOIN LATERAL (SELECT COALESCE(SUM(gross_amount),0)::numeric AS gross_sales,
    COALESCE(SUM(fee_amount),0)::numeric AS commission_total,COUNT(*)::int AS order_count
    FROM platform_commissions WHERE invoice_id=i.id) c
  CROSS JOIN LATERAL (SELECT COALESCE(SUM(amount) FILTER (WHERE kind='real'),0)::numeric AS real_received,
    COALESCE(SUM(amount) FILTER (WHERE kind='demo'),0)::numeric AS demo_received
    FROM billing_payments WHERE invoice_id=i.id AND voided_at IS NULL) p`;

function registerBilling(app, {auth,role,wrap,validId}) {
  const getInvoices = async (businessId, month) => {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400,'Select a valid billing month.');
    return (await pool.query(`${invoiceSql} WHERE ($1::int IS NULL OR i.business_id=$1)
      AND ($2::date IS NULL OR i.period_start=$2) ORDER BY i.period_start DESC,i.id DESC`,
      [businessId,month ? month+'-01' : null])).rows;
  };
  const summary = invoices => invoices.reduce((sum,i) => {
    for (const key of ['gross_sales','commission_total','real_received','demo_received','outstanding']) {
      sum[key] += amountInCents(i[key]);
    }
    sum.order_count += i.order_count;
    return sum;
  }, {gross_sales:0,commission_total:0,real_received:0,demo_received:0,outstanding:0,order_count:0});
  const report = async (businessId, month) => {
    const invoices=await getInvoices(businessId,month), totals=summary(invoices);
    for (const key of ['gross_sales','commission_total','real_received','demo_received','outstanding']) totals[key]=(totals[key]/100).toFixed(2);
    totals.restaurant_net=((amountInCents(totals.gross_sales)-amountInCents(totals.commission_total))/100).toFixed(2);
    return {commission_rate_bps:COMMISSION_RATE_BPS,summary:totals,invoices,
      payment_instructions:process.env.BILLING_PAYMENT_INSTRUCTIONS||'Arrange payment with the PlateUp platform owner and keep your transaction reference. The administrator records your verified receipt.'};
  };
  app.get('/api/business/billing',auth,role('business'),wrap(async(req,res)=>{
    res.set('Cache-Control','private, no-store'); res.json(await report(req.user.userId,req.query.month));
  }));
  app.get('/api/admin/revenue',auth,role('admin'),wrap(async(req,res)=>{
    res.set('Cache-Control','private, no-store'); res.json(await report(null,req.query.month));
  }));

  const invoiceDetail = wrap(async(req,res)=>{
    if(!validId(req.params.id)) throw fail(400,'Invalid invoice.');
    const db=await pool.connect();
    try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const invoice=(await db.query(`${invoiceSql} WHERE i.id=$1 AND ($2::int IS NULL OR i.business_id=$2)`,
      [req.params.id,req.user.role==='admin'?null:req.user.userId])).rows[0];
    if(!invoice) throw fail(404,'Invoice not found.');
    const [entries,payments]=await Promise.all([
      db.query('SELECT order_id,item_title,gross_amount,rate_bps,fee_amount,completed_at FROM platform_commissions WHERE invoice_id=$1 ORDER BY completed_at,order_id',[invoice.id]),
      db.query(`SELECT p.*,u.name AS recorded_by_name FROM billing_payments p JOIN users u ON u.id=p.recorded_by
        WHERE p.invoice_id=$1 ORDER BY p.recorded_at DESC,p.id DESC`,[invoice.id])
    ]);
    await db.query('COMMIT');
    res.set('Cache-Control','private, no-store');
    res.json({invoice,entries:entries.rows,payments:payments.rows});
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  });
  app.get('/api/business/billing/invoices/:id',auth,role('business'),invoiceDetail);
  app.get('/api/admin/billing/invoices/:id',auth,role('admin'),invoiceDetail);

  app.post('/api/admin/billing/invoices/:id/payments',auth,role('admin'),wrap(async(req,res)=>{
    const amount=amountInCents(req.body.amount), kind=req.body.kind, method=req.body.method;
    const reference=text(req.body.reference,120), note=text(req.body.note,500);
    const receivedAt=typeof req.body.received_at==='string' ? new Date(req.body.received_at) : null;
    const dated=typeof req.body.received_at==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(req.body.received_at);
    if(!validId(req.params.id)||!amount||amount>999999999999||!['real','demo'].includes(kind)||!METHODS.includes(method)||!reference||req.body.reference.trim().length>120||
      !dated||!receivedAt||!Number.isFinite(receivedAt.getTime())||receivedAt.getTime()>Date.now()||
      (kind==='real'&&req.body.verified!==true)) throw fail(400,'Enter a positive amount (up to two decimal places), payment type, method, reference and past receipt date. Confirm real receipts were verified.');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const invoice=(await db.query('SELECT * FROM billing_invoices WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!invoice) throw fail(404,'Invoice not found.');
      if(receivedAt<invoice.created_at) throw fail(400,'The receipt cannot predate this statement.');
      const balance=(await db.query(`SELECT COALESCE((SELECT SUM(fee_amount) FROM platform_commissions WHERE invoice_id=$1),0)
        -COALESCE((SELECT SUM(amount) FROM billing_payments WHERE invoice_id=$1 AND kind=$2 AND voided_at IS NULL),0) AS remaining`,[invoice.id,kind])).rows[0];
      if(amount>amountInCents(balance.remaining)) throw fail(409,'This payment exceeds the remaining balance for its payment type.');
      const payment=(await db.query(`INSERT INTO billing_payments(invoice_id,amount,kind,method,reference,note,received_at,recorded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [invoice.id,(amount/100).toFixed(2),kind,method,reference,note,receivedAt,req.user.userId])).rows[0];
      await db.query('COMMIT'); res.status(201).json({payment});
    } catch(error) {
      await db.query('ROLLBACK');
      if(error.code==='23505') throw fail(409,'That payment reference has already been recorded.');
      throw error;
    } finally { db.release(); }
  }));
  app.post('/api/admin/billing/payments/:id/void',auth,role('admin'),wrap(async(req,res)=>{
    const reason=text(req.body.reason,500);
    if(!validId(req.params.id)||!reason) throw fail(400,'Enter a reason for voiding this payment.');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const found=(await db.query('SELECT invoice_id FROM billing_payments WHERE id=$1',[req.params.id])).rows[0];
      if(!found) throw fail(404,'Payment not found.');
      await db.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE',[found.invoice_id]);
      const payment=(await db.query(`UPDATE billing_payments SET voided_at=NOW(),voided_by=$2,void_reason=$3
        WHERE id=$1 AND voided_at IS NULL RETURNING id`,[req.params.id,req.user.userId,reason])).rows[0];
      if(!payment) throw fail(409,'This payment is already voided.');
      await db.query('COMMIT');res.json({message:'Payment voided. Its audit record is retained.'});
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  }));
}
module.exports={registerBilling,recordCommission,COMMISSION_RATE_BPS,amountInCents};
