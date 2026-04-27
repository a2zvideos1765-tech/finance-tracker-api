const express = require('express');
const router = express.Router();
const { query } = require('../db/connection');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('routes.classify');

// GET /api/classify/rules - List all classification rules
router.get('/rules', async (req, res) => {
  try {
    const result = await query(`
      SELECT cr.*,
             c.name as category_name, c.icon as category_icon,
             sc.name as subcategory_name
      FROM classification_rules cr
      LEFT JOIN categories c ON cr.category_id = c.id
      LEFT JOIN categories sc ON cr.subcategory_id = sc.id
      ORDER BY cr.hit_count DESC, cr.last_used DESC
    `);
    res.json(result.rows);
  } catch (err) {
    log.error('list_rules_error', 'Failed to list rules', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/classify/learn - Learn from a user classification
router.post('/learn', async (req, res) => {
  try {
    const {
      transaction_id, category_id, subcategory_id,
      is_one_off, notes
    } = req.body;

    // Get the transaction
    const txResult = await query('SELECT * FROM transactions WHERE id = $1', [transaction_id]);
    if (txResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const tx = txResult.rows[0];

    // Update the transaction
    await query(`
      UPDATE transactions SET
        category_id = $1,
        subcategory_id = $2,
        is_classified = true,
        classification_method = 'manual',
        classification_confidence = 1.0,
        special_flag = $3,
        special_flag_note = $4,
        notes = COALESCE($5, notes),
        updated_at = NOW()
      WHERE id = $6
    `, [
      category_id, subcategory_id,
      is_one_off ? 'one_off' : null,
      is_one_off ? (notes || 'One-off classification') : null,
      notes, transaction_id
    ]);

    // If NOT a one-off, learn the rule
    if (!is_one_off) {
      const rulesCreated = [];

      // Learn from merchant name
      if (tx.merchant_name) {
        await upsertRule('exact_merchant', tx.merchant_name.toUpperCase(), category_id, subcategory_id);
        rulesCreated.push({ type: 'exact_merchant', value: tx.merchant_name });
      }

      // Learn from UPI ref (less useful as they change, but track the pattern)
      if (tx.upi_ref) {
        // Don't learn UPI refs — they're unique per transaction
        // But log it for debugging
        log.debug('learn_skip_upi', 'Skipping UPI ref learning (unique per tx)', { upiRef: tx.upi_ref });
      }

      // Learn from contact
      if (tx.contact_id) {
        const contactResult = await query('SELECT name FROM contacts WHERE id = $1', [tx.contact_id]);
        if (contactResult.rows.length > 0) {
          await upsertRule('contact', contactResult.rows[0].name.toUpperCase(), category_id, subcategory_id);
          rulesCreated.push({ type: 'contact', value: contactResult.rows[0].name });
        }
      }

      log.info('learned', 'Classification rules learned', {
        transactionId: transaction_id,
        merchant: tx.merchant_name,
        categoryId: category_id,
        rulesCreated
      });

      res.json({ message: 'Classification learned', rules_created: rulesCreated.length });
    } else {
      log.info('one_off', 'One-off classification (no rule created)', {
        transactionId: transaction_id,
        merchant: tx.merchant_name,
        categoryId: category_id
      });

      res.json({ message: 'One-off classification applied', rules_created: 0 });
    }
  } catch (err) {
    log.error('learn_error', 'Failed to learn classification', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/classify/suggest - Get classification suggestion for a transaction
router.post('/suggest', async (req, res) => {
  try {
    const { merchant_name, contact_name, upi_ref } = req.body;
    const suggestions = [];

    // 1. Exact merchant match
    if (merchant_name) {
      const result = await query(`
        SELECT cr.*, c.name as category_name, c.icon as category_icon, sc.name as subcategory_name
        FROM classification_rules cr
        LEFT JOIN categories c ON cr.category_id = c.id
        LEFT JOIN categories sc ON cr.subcategory_id = sc.id
        WHERE cr.match_type = 'exact_merchant' AND cr.match_value = $1
      `, [merchant_name.toUpperCase()]);

      if (result.rows.length > 0) {
        const rule = result.rows[0];
        suggestions.push({
          method: 'exact_merchant',
          confidence: parseFloat(rule.confidence),
          category_id: rule.category_id,
          subcategory_id: rule.subcategory_id,
          category_name: rule.category_name,
          category_icon: rule.category_icon,
          subcategory_name: rule.subcategory_name,
          hit_count: rule.hit_count,
          rule_id: rule.id
        });
      }

      // 2. Fuzzy merchant match (if no exact match)
      if (suggestions.length === 0) {
        const fuzzyResult = await query(`
          SELECT cr.*, c.name as category_name, c.icon as category_icon, sc.name as subcategory_name,
                 similarity(cr.match_value, $1) as sim_score
          FROM classification_rules cr
          LEFT JOIN categories c ON cr.category_id = c.id
          LEFT JOIN categories sc ON cr.subcategory_id = sc.id
          WHERE cr.match_type = 'exact_merchant'
            AND similarity(cr.match_value, $1) > 0.4
          ORDER BY sim_score DESC
          LIMIT 3
        `, [merchant_name.toUpperCase()]).catch(() => ({ rows: [] }));
        // similarity() requires pg_trgm extension - fail gracefully if not available

        for (const rule of fuzzyResult.rows) {
          suggestions.push({
            method: 'fuzzy_merchant',
            confidence: parseFloat(rule.sim_score) * parseFloat(rule.confidence),
            category_id: rule.category_id,
            subcategory_id: rule.subcategory_id,
            category_name: rule.category_name,
            category_icon: rule.category_icon,
            subcategory_name: rule.subcategory_name,
            hit_count: rule.hit_count,
            matched_value: rule.match_value,
            rule_id: rule.id
          });
        }
      }
    }

    // 3. Contact match
    if (contact_name && suggestions.length === 0) {
      const result = await query(`
        SELECT cr.*, c.name as category_name, c.icon as category_icon, sc.name as subcategory_name
        FROM classification_rules cr
        LEFT JOIN categories c ON cr.category_id = c.id
        LEFT JOIN categories sc ON cr.subcategory_id = sc.id
        WHERE cr.match_type = 'contact' AND cr.match_value = $1
      `, [contact_name.toUpperCase()]);

      if (result.rows.length > 0) {
        const rule = result.rows[0];
        suggestions.push({
          method: 'contact',
          confidence: parseFloat(rule.confidence),
          category_id: rule.category_id,
          subcategory_id: rule.subcategory_id,
          category_name: rule.category_name,
          category_icon: rule.category_icon,
          subcategory_name: rule.subcategory_name,
          hit_count: rule.hit_count,
          rule_id: rule.id
        });
      }
    }

    // Log the suggestion decision
    const bestSuggestion = suggestions.length > 0 ? suggestions[0] : null;
    log.info('suggest', 'Classification suggestion', {
      merchant: merchant_name,
      contact: contact_name,
      suggestionsFound: suggestions.length,
      bestMethod: bestSuggestion?.method,
      bestConfidence: bestSuggestion?.confidence
    });

    res.json({
      suggestions,
      auto_classify: bestSuggestion && bestSuggestion.confidence >= 0.8 && bestSuggestion.hit_count >= 5
    });
  } catch (err) {
    log.error('suggest_error', 'Failed to suggest classification', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/classify/rules/:id - Delete a rule
router.delete('/rules/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM classification_rules WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    log.info('rule_deleted', 'Classification rule deleted', { id: req.params.id });
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    log.error('delete_rule_error', 'Failed to delete rule', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Upsert a classification rule with confidence tracking
 */
async function upsertRule(matchType, matchValue, categoryId, subcategoryId) {
  const existing = await query(
    'SELECT * FROM classification_rules WHERE match_type = $1 AND match_value = $2',
    [matchType, matchValue]
  );

  if (existing.rows.length > 0) {
    const rule = existing.rows[0];
    const isSameCategory = rule.category_id === categoryId;

    await query(`
      UPDATE classification_rules SET
        category_id = $1,
        subcategory_id = $2,
        hit_count = hit_count + 1,
        total_classifications = total_classifications + 1,
        consistent_classifications = $3,
        confidence = ROUND(($3::decimal / (total_classifications + 1)), 2),
        last_used = NOW(),
        updated_at = NOW()
      WHERE id = $4
    `, [
      categoryId,
      subcategoryId,
      isSameCategory ? rule.consistent_classifications + 1 : 1,
      rule.id
    ]);

    log.debug('rule_updated', `Updated rule: ${matchType}=${matchValue}`, {
      hitCount: rule.hit_count + 1,
      sameCategory: isSameCategory,
      ruleId: rule.id
    });
  } else {
    await query(`
      INSERT INTO classification_rules (match_type, match_value, category_id, subcategory_id, confidence)
      VALUES ($1, $2, $3, $4, 0.50)
    `, [matchType, matchValue, categoryId, subcategoryId]);

    log.debug('rule_created', `New rule: ${matchType}=${matchValue}`, { categoryId, subcategoryId });
  }
}

module.exports = router;
