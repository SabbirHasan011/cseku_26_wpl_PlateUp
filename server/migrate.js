const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pool = require('./db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query("SELECT to_regclass('public.users') AS users");
    if (!existing.rows[0].users) {
      await client.query(fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8'));
    }
    await client.query(fs.readFileSync(path.join(__dirname, 'migrate.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '002-city-pickup-notifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '003-food-categories.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '004-customer-experience.sql'), 'utf8'));
    const pending = await client.query("SELECT id FROM orders WHERE pickup_code IS NULL AND status IN ('pending','confirmed','ready') FOR UPDATE");
    for (const order of pending.rows) {
      await client.query('UPDATE orders SET pickup_code=$1 WHERE id=$2',
        [order.id + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),order.id]);
    }
    await client.query('COMMIT');
    console.log('PlateUp database migration complete.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
