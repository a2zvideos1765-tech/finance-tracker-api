require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { testConnection } = require('./db/connection');
const { createModuleLogger } = require('./utils/logger');
const { authenticate } = require('./middleware/auth');
const { requestLogger } = require('./middleware/requestLogger');

// Routes
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const classifyRoutes = require('./routes/classify');
const contactRoutes = require('./routes/contacts');
const splitRoutes = require('./routes/splits');
const accountRoutes = require('./routes/accounts');
const syncRoutes = require('./routes/sync');

const log = createModuleLogger('server');
const app = express();
const PORT = process.env.PORT || 3500;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// All API routes require authentication
app.use('/api', authenticate);

// Mount routes
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/classify', classifyRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/splits', splitRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/sync', syncRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  log.error('unhandled_error', err.message, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    log.error('startup', 'Cannot connect to database. Exiting.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    log.info('startup', `Finance Tracker API running on port ${PORT}`, { port: PORT });
  });
}

start().catch(err => {
  log.error('startup', 'Failed to start server', { error: err.message });
  process.exit(1);
});
