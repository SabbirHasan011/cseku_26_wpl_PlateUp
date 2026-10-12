const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pool=require('../server/db');

test('10% migration backfills historical months once and preserves sales, existing charges and paid receipts',async()=>{
  const db=await pool.connect();
  const schema='billing_migration_'+Date.now();
  const migration=name=>fs.readFileSync(path.join(__dirname,'../server/migrations',name),'utf8');
  try {
    await db.query('BEGIN');
    // An isolated, rolled-back schema keeps this migration test away from real
    // accounts, orders and financial records.
    await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},pg_catalog;
      SET LOCAL TIME ZONE 'UTC';
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE businesses(user_id INTEGER PRIMARY KEY REFERENCES users(id));
      CREATE TABLE listings(id INTEGER PRIMARY KEY,business_id INTEGER REFERENCES businesses(user_id),title TEXT);
      CREATE TABLE orders(id INTEGER PRIMARY KEY,listing_id INTEGER REFERENCES listings(id),total_price NUMERIC(10,2),
        status TEXT,pickup_time TIMESTAMP,order_time TIMESTAMP,updated_at TIMESTAMP,created_at TIMESTAMP);
      CREATE TABLE sales_data(id INTEGER PRIMARY KEY,order_id INTEGER UNIQUE REFERENCES orders(id),price NUMERIC(10,2),sale_time TIMESTAMP);
      INSERT INTO users VALUES(1); INSERT INTO businesses VALUES(1);
      INSERT INTO listings VALUES(1,1,'Current meal name');
      INSERT INTO orders VALUES
        (1,1,200,'completed','2026-01-31 23:55','2026-01-31 23:00','2026-01-31 23:55','2026-01-31 23:00'),
        (2,1,400,'completed',NULL,'2026-01-31 23:50','2026-02-02 00:00','2026-01-31 23:50'),
        (3,1,100,'completed',NULL,'2026-02-28 23:50','2026-03-01 00:10','2026-02-28 23:50'),
        (4,1,500,'pending',NULL,'2026-03-01 10:00','2026-03-01 10:00','2026-03-01 10:00'),
        (5,1,90,'cancelled',NULL,'2026-03-01 10:00','2026-03-01 10:00','2026-03-01 10:00');
      INSERT INTO sales_data VALUES(1,1,200,'2026-01-31 23:55'),(2,2,400,'2026-02-01 00:05');`);
    await db.query(migration('008-platform-billing.sql'));
    await db.query(`UPDATE orders SET commission_rate_bps=500 WHERE id IN (1,4);
      INSERT INTO billing_invoices(business_id,period_start) VALUES(1,'2026-01-01');
      INSERT INTO platform_commissions(invoice_id,order_id,item_title,gross_amount,rate_bps,fee_amount,completed_at)
        VALUES(1,1,'Historical meal name',200,500,10,'2026-01-31T17:55:00Z');
      INSERT INTO billing_payments(invoice_id,amount,kind,method,reference,received_at,recorded_by)
        VALUES(1,10,'real','cash','Original receipt','2026-02-01T10:00:00Z',1);`);
    const oldOrders=(await db.query('SELECT id,total_price,status,pickup_time,updated_at FROM orders ORDER BY id')).rows;
    const sales=(await db.query('SELECT * FROM sales_data ORDER BY id')).rows;
    const receipts=(await db.query('SELECT * FROM billing_payments ORDER BY id')).rows;
    await db.query(migration('009-ten-percent-commission.sql'));
    const entries=(await db.query(`SELECT c.id,c.order_id,c.invoice_id,c.item_title,c.gross_amount,c.rate_bps,c.fee_amount,
      c.completed_at,i.period_start::text FROM platform_commissions c JOIN billing_invoices i ON i.id=c.invoice_id ORDER BY c.order_id`)).rows;
    assert.equal(entries.length,3,'only completed orders produce commission');
    assert.deepEqual(entries.map(e=>e.fee_amount),['20.00','40.00','10.00']);
    assert.deepEqual(entries.map(e=>e.period_start),['2026-01-01','2026-02-01','2026-03-01']);
    assert.equal(entries[0].id,1);assert.equal(entries[0].invoice_id,1);
    assert.equal(entries[0].item_title,'Historical meal name');
    assert.equal(entries[0].completed_at.toISOString(),'2026-01-31T17:55:00.000Z');
    assert.equal(entries[1].completed_at.toISOString(),'2026-01-31T18:05:00.000Z','a Bangladesh February sale remains in February with a UTC connection');
    assert.ok((await db.query('SELECT commission_rate_bps FROM orders')).rows.every(o=>o.commission_rate_bps===1000));
    assert.deepEqual((await db.query('SELECT id,total_price,status,pickup_time,updated_at FROM orders ORDER BY id')).rows,oldOrders);
    assert.deepEqual((await db.query('SELECT * FROM sales_data ORDER BY id')).rows,sales);
    assert.deepEqual((await db.query('SELECT * FROM billing_payments ORDER BY id')).rows,receipts);
    const total=(await db.query(`SELECT (SELECT SUM(gross_amount) FROM platform_commissions)::text AS sales,
      (SELECT SUM(fee_amount) FROM platform_commissions)::text AS fees,
      (SELECT SUM(amount) FROM billing_payments WHERE kind='real' AND voided_at IS NULL)::text AS received`)).rows[0];
    assert.deepEqual(total,{sales:'700.00',fees:'70.00',received:'10.00'});
    await db.query(migration('009-ten-percent-commission.sql'));
    assert.deepEqual((await db.query(`SELECT c.id,c.order_id,c.invoice_id,c.item_title,c.gross_amount,c.rate_bps,c.fee_amount,
      c.completed_at,i.period_start::text FROM platform_commissions c JOIN billing_invoices i ON i.id=c.invoice_id ORDER BY c.order_id`)).rows,entries);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_invoices')).rows[0].n,3);
    assert.deepEqual((await db.query('SELECT * FROM billing_payments ORDER BY id')).rows,receipts);
    const future=(await db.query("INSERT INTO orders(id,listing_id,total_price,status) VALUES(6,1,100,'pending') RETURNING commission_rate_bps")).rows[0];
    assert.equal(future.commission_rate_bps,1000,'future orders receive the database default');
  } finally {await db.query('ROLLBACK');db.release();}
});
