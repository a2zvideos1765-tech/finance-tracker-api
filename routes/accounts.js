const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.accounts');

// GET /api/accounts - List all accounts
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT a.*,
             (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) as transaction_count,
             (SELECT MAX(t.transaction_date) FROM transactions t WHERE t.account_id = a.id) as last_transaction
      FROM accounts a
      WHERE a.is_active = true
      ORDER BY a.created_at
    `);
    res.json(result.rows);
  } catch (err) {
    log.error('list_error', 'Failed to list accounts', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/accounts - Add a new account
router.post('/', async (req, res) => {
  try {
    const { name, type, last_four, bank_name, sms_sender_id } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'name and type required' });
    }

    const result = await query(`
      INSERT INTO accounts (name, type, last_four, bank_name, sms_sender_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, type, last_four, bank_name, sms_sender_id]);

    log.info('created', 'Account created', {
      id: result.rows[0].id,
      name,
      type,
      sms_sender_id
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error('create_error', 'Failed to create account', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/accounts/:id - Update account
router.put('/:id', async (req, res) => {
  try {
    const { name, type, last_four, bank_name, sms_sender_id, is_active } = req.body;

    const result = await query(`
      UPDATE accounts SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        last_four = COALESCE($3, last_four),
        bank_name = COALESCE($4, bank_name),
        sms_sender_id = COALESCE($5, sms_sender_id),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [name, type, last_four, bank_name, sms_sender_id, is_active, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    log.info('updated', 'Account updated', { id: req.params.id });
    res.json(result.rows[0]);
  } catch (err) {
    log.error('update_error', 'Failed to update account', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
