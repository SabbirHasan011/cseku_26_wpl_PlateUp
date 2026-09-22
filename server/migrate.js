const fs = require('node:fs');
const path = require('node:path');
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
