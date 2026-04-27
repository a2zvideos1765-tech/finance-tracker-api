const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.sync');

// POST /api/sync/push - Push data from mobile to VPS
router.post('/push', async (req, res) => {
  try {
    const { device_id, data } = req.body;

    if (!device_id || !data) {
      return res.status(400).json({ error: 'device_id and data required' });
    }

    const results = {
      transactions: { created: 0, updated: 0, errors: 0 },
      contacts: { created: 0, updated: 0, errors: 0 },
      classification_rules: { created: 0, updated: 0, errors: 0 },
      categories: { created: 0, updated: 0, errors: 0 }
    };

    // Sync transactions
    if (data.transactions?.length > 0) {
      for (const tx of data.transactions) {
        try {
          const result = await query(`
            INSERT INTO transactions (
              external_id, account_id, type, amount, transaction_date, description,
              merchant_name, upi_ref, contact_id, category_id, subcategory_id,
              is_classified, classification_method, classification_confidence,
              is_split, is_loan, loan_type, is_credit_card_repayment,
              special_flag, special_flag_note, notes, raw_sms, source,
              available_balance, available_credit_limit, synced_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW()
            )
            ON CONFLICT (external_id) DO UPDATE SET
              category_id = COALESCE(EXCLUDED.category_id, transactions.category_id),
              subcategory_id = COALESCE(EXCLUDED.subcategory_id, transactions.subcategory_id),
              is_classified = COALESCE(EXCLUDED.is_classified, transactions.is_classified),
              contact_id = COALESCE(EXCLUDED.contact_id, transactions.contact_id),
              is_split = COALESCE(EXCLUDED.is_split, transactions.is_split),
              is_loan = COALESCE(EXCLUDED.is_loan, transactions.is_loan),
              is_credit_card_repayment = COALESCE(EXCLUDED.is_credit_card_repayment, transactions.is_credit_card_repayment),
              notes = COALESCE(EXCLUDED.notes, transactions.notes),
              special_flag = COALESCE(EXCLUDED.special_flag, transactions.special_flag),
              special_flag_note = COALESCE(EXCLUDED.special_flag_note, transactions.special_flag_note),
              synced_at = NOW(),
              updated_at = NOW()
            RETURNING id, (xmax = 0) as is_new
          `, [
            tx.external_id, tx.account_id, tx.type, tx.amount, tx.transaction_date,
            tx.description, tx.merchant_name, tx.upi_ref, tx.contact_id,
            tx.category_id, tx.subcategory_id, tx.is_classified || false,
            tx.classification_method, tx.classification_confidence,
            tx.is_split || false, tx.is_loan || false, tx.loan_type,
            tx.is_credit_card_repayment || false, tx.special_flag, tx.special_flag_note,
            tx.notes, tx.raw_sms, tx.source || 'sms',
            tx.available_balance, tx.available_credit_limit
          ]);

          if (result.rows[0].is_new) results.transactions.created++;
          else results.transactions.updated++;
        } catch (err) {
          results.transactions.errors++;
          log.warn('sync_tx_error', 'Failed to sync transaction', {
            externalId: tx.external_id,
            error: err.message
          });
        }
      }
    }

    // Sync contacts
    if (data.contacts?.length > 0) {
      for (const contact of data.contacts) {
        try {
          const result = await query(`
            INSERT INTO contacts (name, type, relationship, upi_ids, account_numbers, default_category_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
            RETURNING id
          `, [
            contact.name, contact.type || 'merchant', contact.relationship,
            contact.upi_ids || '{}', contact.account_numbers || '{}',
            contact.default_category_id, contact.notes
          ]);

          if (result.rowCount > 0) results.contacts.created++;
          else results.contacts.updated++;
        } catch (err) {
          results.contacts.errors++;
        }
      }
    }

    // Sync classification rules
    if (data.classification_rules?.length > 0) {
      for (const rule of data.classification_rules) {
        try {
          await query(`
            INSERT INTO classification_rules (match_type, match_value, category_id, subcategory_id, confidence, hit_count)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (match_type, match_value) DO UPDATE SET
              category_id = EXCLUDED.category_id,
              subcategory_id = EXCLUDED.subcategory_id,
              confidence = GREATEST(classification_rules.confidence, EXCLUDED.confidence),
              hit_count = GREATEST(classification_rules.hit_count, EXCLUDED.hit_count),
              updated_at = NOW()
          `, [rule.match_type, rule.match_value, rule.category_id, rule.subcategory_id, rule.confidence, rule.hit_count]);

          results.classification_rules.created++;
        } catch (err) {
          results.classification_rules.errors++;
        }
      }
    }

    // Sync categories (preserve user customizations across reinstalls)
    if (data.categories?.length > 0) {
      for (const cat of data.categories) {
        try {
          // Upsert by name + parent_id to avoid duplicates
          const result = await query(`
            INSERT INTO categories (name, icon, parent_id, is_active, sort_order)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (name, COALESCE(parent_id, 0)) DO UPDATE SET
              icon = EXCLUDED.icon,
              is_active = EXCLUDED.is_active,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()
            RETURNING id, (xmax = 0) as is_new
          `, [cat.name, cat.icon, cat.parent_id, cat.is_active ? true : false, cat.sort_order]);

          if (result.rows[0]?.is_new) results.categories.created++;
          else results.categories.updated++;
        } catch (err) {
          // If the unique constraint doesn't exist, fall back to simple upsert by name
          try {
            const existing = await query(
              'SELECT id FROM categories WHERE name = $1 AND COALESCE(parent_id, 0) = COALESCE($2, 0)',
              [cat.name, cat.parent_id]
            );
            if (existing.rows.length > 0) {
              await query(
                'UPDATE categories SET icon = $1, is_active = $2, sort_order = $3, updated_at = NOW() WHERE id = $4',
                [cat.icon, cat.is_active ? true : false, cat.sort_order, existing.rows[0].id]
              );
              results.categories.updated++;
            } else {
              await query(
                'INSERT INTO categories (name, icon, parent_id, is_active, sort_order) VALUES ($1, $2, $3, $4, $5)',
                [cat.name, cat.icon, cat.parent_id, cat.is_active ? true : false, cat.sort_order]
              );
              results.categories.created++;
            }
          } catch (innerErr) {
            results.categories.errors++;
            log.warn('sync_cat_error', 'Failed to sync category', { name: cat.name, error: innerErr.message });
          }
        }
      }
    }

    // Log sync
    await query(`
      INSERT INTO sync_log (device_id, table_name, last_sync_at, records_synced, direction, status)
      VALUES ($1, 'all', NOW(), $2, 'push', 'success')
    `, [device_id, (data.transactions?.length || 0) + (data.contacts?.length || 0) + (data.categories?.length || 0)]);

    log.info('push_complete', 'Sync push completed', { device_id, results });
    res.json({ message: 'Sync complete', results });
  } catch (err) {
    log.error('push_error', 'Sync push failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sync/pull - Pull data from VPS to mobile
router.post('/pull', async (req, res) => {
  try {
    const { device_id, last_sync_at } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }

    const since = last_sync_at || '1970-01-01';

    // Get updated records since last sync
    const transactions = await query(
      'SELECT * FROM transactions WHERE updated_at > $1 ORDER BY updated_at LIMIT 500',
      [since]
    );

    const categories = await query(
      'SELECT * FROM categories WHERE updated_at > $1 ORDER BY updated_at',
      [since]
    );

    const contacts = await query(
      'SELECT * FROM contacts WHERE updated_at > $1 ORDER BY updated_at',
      [since]
    );

    const rules = await query(
      'SELECT * FROM classification_rules WHERE updated_at > $1 ORDER BY updated_at',
      [since]
    );

    const accounts = await query(
      'SELECT * FROM accounts WHERE updated_at > $1 ORDER BY updated_at',
      [since]
    );

    // Log sync
    await query(`
      INSERT INTO sync_log (device_id, table_name, last_sync_at, records_synced, direction, status)
      VALUES ($1, 'all', NOW(), $2, 'pull', 'success')
    `, [device_id, transactions.rowCount + categories.rowCount + contacts.rowCount]);

    log.info('pull_complete', 'Sync pull completed', {
      device_id,
      transactions: transactions.rowCount,
      categories: categories.rowCount,
      contacts: contacts.rowCount,
      rules: rules.rowCount
    });

    res.json({
      transactions: transactions.rows,
      categories: categories.rows,
      contacts: contacts.rows,
      classification_rules: rules.rows,
      accounts: accounts.rows,
      synced_at: new Date().toISOString()
    });
  } catch (err) {
    log.error('pull_error', 'Sync pull failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sync/status - Get sync status
router.get('/status', async (req, res) => {
  try {
    const { device_id } = req.query;

    const result = await query(`
      SELECT * FROM sync_log
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [device_id || 'unknown']);

    res.json(result.rows);
  } catch (err) {
    log.error('status_error', 'Failed to get sync status', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
