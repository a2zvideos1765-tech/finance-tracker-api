const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('middleware.auth');

/**
 * Simple API key authentication middleware
 */
function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    log.warn('missing_key', 'Request without API key', {
      ip: req.ip,
      path: req.path
    });
    return res.status(401).json({ error: 'API key required' });
  }

  if (apiKey !== process.env.API_KEY) {
    log.warn('invalid_key', 'Invalid API key attempt', {
      ip: req.ip,
      path: req.path
    });
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

module.exports = { authenticate };
