const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.splits');

// GET /api/splits - List all splits
router.get('/', async (req, res) => {
  try {
    const { is_settled } = req.query;

    let sql = `
      SELECT s.*,
             t.amount as transaction_amount, t.merchant_name, t.transaction_date, t.description,
             json_agg(json_build_object(
               'id', sp.id,
               'contact_id', sp.contact_id,
               'contact_name', COALESCE(sp.contact_name, co.name),
               'amount', sp.amount,
               'is_settled', sp.is_settled,
               'settled_at', sp.settled_at
             )) as participants
      FROM splits s
      JOIN transactions t ON s.transaction_id = t.id
      LEFT JOIN split_participants sp ON sp.split_id = s.id
      LEFT JOIN contacts co ON sp.contact_id = co.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (is_settled !== undefined) {
      sql += ` AND s.is_fully_settled = $${paramIdx++}`;
      params.push(is_settled === 'true');
    }

    sql += ' GROUP BY s.id, t.id ORDER BY t.transaction_date DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    log.error('list_error', 'Failed to list splits', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/splits - Create a split
router.post('/', async (req, res) => {
  try {
    const { transaction_id, total_amount, my_share, participants, notes } = req.body;

    if (!transaction_id || !total_amount || !my_share || !participants?.length) {
      return res.status(400).json({ error: 'transaction_id, total_amount, my_share, and participants required' });
    }

    // Create split
    const splitResult = await query(`
      INSERT INTO splits (transaction_id, total_amount, my_share, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [transaction_id, total_amount, my_share, notes]);

    const splitId = splitResult.rows[0].id;

    // Add participants
    for (const p of participants) {
      await query(`
        INSERT INTO split_participants (split_id, contact_id, contact_name, amount)
        VALUES ($1, $2, $3, $4)
      `, [splitId, p.contact_id || null, p.contact_name, p.amount]);
    }

    // Mark transaction as split
    await query(`
      UPDATE transactions SET is_split = true, updated_at = NOW() WHERE id = $1
    `, [transaction_id]);

    log.info('created', 'Split created', {
      splitId,
      transactionId: transaction_id,
      totalAmount: total_amount,
      myShare: my_share,
      participants: participants.length
    });

    res.status(201).json(splitResult.rows[0]);
  } catch (err) {
    log.error('create_error', 'Failed to create split', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/splits/:id/settle - Settle a participant
router.post('/:id/settle', async (req, res) => {
  try {
    const { participant_id, settled_transaction_id } = req.body;

    await query(`
      UPDATE split_participants SET
        is_settled = true,
        settled_transaction_id = $1,
        settled_at = NOW()
      WHERE id = $2 AND split_id = $3
    `, [settled_transaction_id, participant_id, req.params.id]);

    // Check if all participants are settled
    const remaining = await query(`
      SELECT COUNT(*) as unsettled FROM split_participants
      WHERE split_id = $1 AND is_settled = false
    `, [req.params.id]);

    if (parseInt(remaining.rows[0].unsettled) === 0) {
      await query('UPDATE splits SET is_fully_settled = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
      log.info('fully_settled', 'Split fully settled', { splitId: req.params.id });
    }

    log.info('participant_settled', 'Split participant settled', {
      splitId: req.params.id,
      participantId: participant_id
    });

    res.json({ message: 'Participant settled' });
  } catch (err) {
    log.error('settle_error', 'Failed to settle split', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
