const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOG_DIR = process.env.LOG_DIR || './logs';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, module, action, message, ...meta }) => {
    const mod = module ? `[${module}]` : '';
    const act = action ? `(${action})` : '';
    const details = Object.keys(meta).length > 2 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level} ${mod}${act} ${message}${details}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'finance-tracker-api' },
  transports: [
    // Console output
    new winston.transports.Console({ format: consoleFormat }),

    // All logs to combined file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 30,
      tailable: true
    }),

    // Error logs separate
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 30,
      tailable: true
    })
  ]
});

/**
 * Create a child logger for a specific module
 * @param {string} moduleName - e.g. 'parser.icici', 'sync', 'classify'
 */
function createModuleLogger(moduleName) {
  return {
    error: (action, message, details = {}) =>
      logger.error({ module: moduleName, action, message, ...details }),
    warn: (action, message, details = {}) =>
      logger.warn({ module: moduleName, action, message, ...details }),
    info: (action, message, details = {}) =>
      logger.info({ module: moduleName, action, message, ...details }),
    debug: (action, message, details = {}) =>
      logger.debug({ module: moduleName, action, message, ...details }),
  };
}

module.exports = { logger, createModuleLogger };
