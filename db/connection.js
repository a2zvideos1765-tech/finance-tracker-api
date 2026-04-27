const { Pool } = require('pg');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('database');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'finance_tracker',
  user: process.env.DB_USER || 'finance_user',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  log.error('pool_error', 'Unexpected pool error', { error: err.message });
});

pool.on('connect', () => {
  log.debug('pool_connect', 'New database connection established');
});

/**
 * Execute a query with logging
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    log.debug('query', 'Query executed', {
      text: text.substring(0, 80),
      duration: `${duration}ms`,
      rows: result.rowCount
    });
    return result;
  } catch (err) {
    log.error('query_error', 'Query failed', {
      text: text.substring(0, 80),
      error: err.message
    });
    throw err;
  }
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
  return pool.connect();
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    log.info('connection_test', 'Database connected successfully', {
      serverTime: res.rows[0].now
    });
    return true;
  } catch (err) {
    log.error('connection_test', 'Database connection failed', {
      error: err.message
    });
    return false;
  }
}

module.exports = { pool, query, getClient, testConnection };
