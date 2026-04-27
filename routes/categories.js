const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.categories');

// GET /api/categories - All categories with sub-categories
router.get('/', async (req, res) => {
  try {
    // Get all top-level categories
    const parents = await query(`
      SELECT * FROM categories
      WHERE parent_id IS NULL AND is_active = true
      ORDER BY sort_order, name
    `);

    // Get all sub-categories
    const children = await query(`
      SELECT * FROM categories
      WHERE parent_id IS NOT NULL AND is_active = true
      ORDER BY sort_order, name
    `);

    // Build tree
    const tree = parents.rows.map(parent => ({
      ...parent,
      subcategories: children.rows.filter(c => c.parent_id === parent.id)
    }));

    res.json(tree);
  } catch (err) {
    log.error('list_error', 'Failed to list categories', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/categories - Create category or sub-category
router.post('/', async (req, res) => {
  try {
    const { name, icon, parent_id, sort_order } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await query(`
      INSERT INTO categories (name, icon, parent_id, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, icon || '📁', parent_id || null, sort_order || 0]);

    log.info('created', 'Category created', {
      id: result.rows[0].id,
      name,
      parent_id
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error('create_error', 'Failed to create category', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/categories/:id - Update category
router.put('/:id', async (req, res) => {
  try {
    const { name, icon, sort_order, is_active } = req.body;
    const result = await query(`
      UPDATE categories
      SET name = COALESCE($1, name),
          icon = COALESCE($2, icon),
          sort_order = COALESCE($3, sort_order),
          is_active = COALESCE($4, is_active),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [name, icon, sort_order, is_active, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    log.info('updated', 'Category updated', { id: req.params.id, name });
    res.json(result.rows[0]);
  } catch (err) {
    log.error('update_error', 'Failed to update category', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/categories/:id - Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(`
      UPDATE categories SET is_active = false, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    log.info('deleted', 'Category deactivated', { id: req.params.id });
    res.json({ message: 'Category deactivated', category: result.rows[0] });
  } catch (err) {
    log.error('delete_error', 'Failed to delete category', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
