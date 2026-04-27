/**
 * Database initialization script
 * Run: node db/init.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('db.init');

async function initDatabase() {
  log.info('start', 'Initializing database...');

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    // Verify tables
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = result.rows.map(r => r.table_name);
    log.info('tables_created', `Created ${tables.length} tables`, { tables });

    // Verify categories
    const catResult = await pool.query(`
      SELECT c.name, c.icon, p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ORDER BY c.parent_id NULLS FIRST, c.sort_order
    `);
    log.info('categories_seeded', `Seeded ${catResult.rowCount} categories`);

    // Verify accounts
    const accResult = await pool.query('SELECT name, type, last_four, sms_sender_id FROM accounts');
    log.info('accounts_seeded', `Seeded ${accResult.rowCount} accounts`, {
      accounts: accResult.rows
    });

    log.info('complete', 'Database initialization complete!');
  } catch (err) {
    log.error('failed', 'Database initialization failed', { error: err.message, stack: err.stack });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
