const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.contacts');

// GET /api/contacts - List all contacts
router.get('/', async (req, res) => {
  try {
    const { type, relationship, search } = req.query;

    let sql = `
      SELECT co.*,
             c.name as default_category_name, c.icon as default_category_icon,
             (SELECT COUNT(*) FROM transactions t WHERE t.contact_id = co.id) as transaction_count,
             (SELECT SUM(CASE WHEN t.type IN ('debit','cc_spend') THEN t.amount ELSE 0 END)
              FROM transactions t WHERE t.contact_id = co.id) as total_sent,
             (SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END)
              FROM transactions t WHERE t.contact_id = co.id) as total_received
      FROM contacts co
      LEFT JOIN categories c ON co.default_category_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (type) { sql += ` AND co.type = $${paramIdx++}`; params.push(type); }
    if (relationship) { sql += ` AND co.relationship = $${paramIdx++}`; params.push(relationship); }
    if (search) { sql += ` AND co.name ILIKE $${paramIdx++}`; params.push(`%${search}%`); }

    sql += ' ORDER BY transaction_count DESC NULLS LAST, co.name';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    log.error('list_error', 'Failed to list contacts', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contacts - Create or find contact
router.post('/', async (req, res) => {
  try {
    const { name, type, relationship, upi_ids, account_numbers, default_category_id, default_subcategory_id, notes } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const result = await query(`
      INSERT INTO contacts (name, type, relationship, upi_ids, account_numbers, default_category_id, default_subcategory_id, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, type || 'merchant', relationship, upi_ids || '{}', account_numbers || '{}', default_category_id, default_subcategory_id, notes]);

    log.info('created', 'Contact created', { id: result.rows[0].id, name, type });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error('create_error', 'Failed to create contact', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/contacts/:id - Update contact
router.put('/:id', async (req, res) => {
  try {
    const { name, type, relationship, upi_ids, account_numbers, default_category_id, default_subcategory_id, notes } = req.body;

    const result = await query(`
      UPDATE contacts SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        relationship = COALESCE($3, relationship),
        upi_ids = COALESCE($4, upi_ids),
        account_numbers = COALESCE($5, account_numbers),
        default_category_id = COALESCE($6, default_category_id),
        default_subcategory_id = COALESCE($7, default_subcategory_id),
        notes = COALESCE($8, notes),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `, [name, type, relationship, upi_ids, account_numbers, default_category_id, default_subcategory_id, notes, req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    log.info('updated', 'Contact updated', { id: req.params.id });
    res.json(result.rows[0]);
  } catch (err) {
    log.error('update_error', 'Failed to update contact', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contacts/find-or-create - Find by name/UPI or create new
router.post('/find-or-create', async (req, res) => {
  try {
    const { name, upi_id } = req.body;

    // Try to find by UPI ID first
    if (upi_id) {
      const byUpi = await query(
        "SELECT * FROM contacts WHERE $1 = ANY(upi_ids)",
        [upi_id]
      );
      if (byUpi.rows.length > 0) {
        return res.json({ contact: byUpi.rows[0], found_by: 'upi_id' });
      }
    }

    // Try to find by name (case-insensitive)
    if (name) {
      const byName = await query(
        "SELECT * FROM contacts WHERE UPPER(name) = UPPER($1)",
        [name]
      );
      if (byName.rows.length > 0) {
        // If UPI ID provided, add it to existing contact
        if (upi_id) {
          await query(
            "UPDATE contacts SET upi_ids = array_append(upi_ids, $1), updated_at = NOW() WHERE id = $2",
            [upi_id, byName.rows[0].id]
          );
          log.info('upi_linked', 'Linked UPI ID to existing contact', {
            contactId: byName.rows[0].id,
            upiId: upi_id
          });
        }
        return res.json({ contact: byName.rows[0], found_by: 'name' });
      }
    }

    // Create new
    const newContact = await query(`
      INSERT INTO contacts (name, upi_ids) VALUES ($1, $2) RETURNING *
    `, [name || 'Unknown', upi_id ? `{${upi_id}}` : '{}']);

    log.info('auto_created', 'Auto-created contact', {
      id: newContact.rows[0].id,
      name,
      upiId: upi_id
    });

    res.status(201).json({ contact: newContact.rows[0], found_by: 'created' });
  } catch (err) {
    log.error('find_or_create_error', 'Failed to find or create contact', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
