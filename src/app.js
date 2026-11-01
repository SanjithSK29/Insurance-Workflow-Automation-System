// Application assembly. The Express app plays the API Gateway role from the
// SAD (routing, auth, rate limiting, secure headers) in front of the service
// modules, which talk to each other through ctx.services and the event bus.
const path = require('node:path');
const express = require('express');
const { loadConfig } = require('./core/config');
const { createLogger } = require('./core/logger');
const { openDatabase } = require('./core/db');
const { createEventBus } = require('./core/events');
const { errorHandler, notFound } = require('./core/errors');
const { createCrypto } = require('./security/crypto');
const { createAudit } = require('./security/audit');
const { verifyJwt } = require('./security/auth');
const { traceAndHeaders, authenticate, rateLimit } = require('./security/middleware');

const usersModule = require('./modules/users');
const customersModule = require('./modules/customers');
const quotesModule = require('./modules/quotes');
const underwritingModule = require('./modules/underwriting');
const paymentsModule = require('./modules/payments');
const policiesModule = require('./modules/policies');
const documentsModule = require('./modules/documents');
const claimsModule = require('./modules/claims');
const notificationsModule = require('./modules/notifications');
const adminModule = require('./modules/admin');
const workflowModule = require('./workflow/engine');

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const logger = overrides.logger || createLogger(config.logLevel);
  const db = openDatabase(config.dbFile);
  const ctx = { config, logger, db, bus: createEventBus(logger), crypto: createCrypto(config), audit: createAudit(db), services: {} };

  const s = ctx.services;
  s.notifications = notificationsModule(ctx);
  s.documents = documentsModule(ctx);
  s.workflow = workflowModule(ctx);
  s.users = usersModule(ctx);
  s.customers = customersModule(ctx);
  s.quotes = quotesModule(ctx);
  s.underwriting = underwritingModule(ctx);
  s.payments = paymentsModule(ctx);
  s.policies = policiesModule(ctx);
  s.claims = claimsModule(ctx);
  s.admin = adminModule(ctx);
  s.workflow.ensureDefaults();

  const app = express();
  app.disable('x-powered-by');
  app.use(traceAndHeaders);
  app.use((req, res, next) => {
    req.ctx = ctx;
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) {
        logger.info('http', { method: req.method, path: req.path, status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6, traceId: req.traceId });
      }
    });
    next();
  });

  // Claims carry base64 documents and use their own larger body limit.
  const json = express.json({ limit: '1mb' });
  app.use((req, res, next) => (/^\/api\/v1\/claims?(\/|$)/.test(req.path) ? next() : json(req, res, next)));

  const optionalAuth = (req, res, next) => {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) {
      const payload = verifyJwt(header.slice(7), config.jwtSecret);
      if (payload) req.user = db.get('SELECT id, email, name, role, active FROM users WHERE id = ? AND active = 1', payload.sub);
    }
    next();
  };

  const publicLimit = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.publicMax, name: 'public' });
  const apiLimit = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, name: 'api' });

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ status: 'UP', time: new Date().toISOString() }));

  // Public endpoints (stricter rate limit).
  api.use('/auth', publicLimit, s.users.router);
  api.use('/quote', publicLimit, optionalAuth, s.quotes.router);

  // Everything below requires a valid JWT.
  api.use(authenticate(ctx), apiLimit);
  api.use('/me', s.users.meRouter);
  api.use('/customers', s.customers.router);
  api.use('/applications', s.underwriting.router);
  api.use('/payments', s.payments.router);
  api.use('/policies', s.policies.router);
  api.use(['/claims', '/claim'], s.claims.router);
  api.use('/documents', s.documents.router);
  api.use('/notifications', s.notifications.router);
  api.use('/workflow', s.workflow.router);
  api.use('/admin/users', s.users.adminRouter);
  api.use('/admin/workflows', s.workflow.adminRouter);
  api.use('/admin', s.admin.router);
  api.use((req, res, next) => next(notFound('Endpoint')));

  app.use('/api/v1', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
  app.use(errorHandler(logger));

  return { app, ctx, close: () => db.close() };
}

module.exports = { createApp };
