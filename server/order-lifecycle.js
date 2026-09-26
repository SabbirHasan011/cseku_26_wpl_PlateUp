const pool = require('./db');

async function expireLockedOrder(db,order) {
  await db.query("UPDATE orders SET status='expired',status_reason='Pickup deadline passed',updated_at=NOW() WHERE id=$1",[order.id]);
  if (order.daily_availability_id) await db.query(`UPDATE daily_availability
    SET remaining_quantity=remaining_quantity+$1,updated_at=NOW() WHERE id=$2`,[order.quantity,order.daily_availability_id]);
  for (const userId of [order.customer_id,order.business_id]) await db.query(`INSERT INTO notifications(user_id,order_id,event,message)
    VALUES ($1,$2,'expired',$3) ON CONFLICT(user_id,order_id,event) DO NOTHING`,
    [userId,order.id,'Reservation #'+order.id+' expired because its pickup deadline passed.']);
}

// No scheduler is required: reads and order actions reconcile overdue reservations.
async function expireOrders(user) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const overdue = await db.query(`SELECT o.*,l.business_id FROM orders o JOIN listings l ON l.id=o.listing_id
      WHERE o.status IN ('pending','confirmed','ready') AND o.pickup_deadline<=NOW()
      AND ${user.role==='customer'?'o.customer_id':'l.business_id'}=$1
      ORDER BY o.daily_availability_id,o.id FOR UPDATE OF o`,[user.userId]);
    for (const order of overdue.rows) await expireLockedOrder(db,order);
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
module.exports = { expireOrders,expireLockedOrder };
