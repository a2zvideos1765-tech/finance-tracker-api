const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('middleware.request');

/**
 * Request/response logging middleware
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Log request
  log.info('request', `${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip
  });

  // Log response on finish
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    log.info('response', `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
    originalEnd.apply(res, args);
  };

  next();
}

module.exports = { requestLogger };
