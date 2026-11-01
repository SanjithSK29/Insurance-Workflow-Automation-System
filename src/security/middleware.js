// Gateway concerns: authentication, RBAC (IWA-F-031), rate limiting
// (IWA-SR-004), trace ids and secure headers.
const crypto = require('node:crypto');
const { verifyJwt } = require('./auth');
const { unauthorized, forbidden, ApiError } = require('../core/errors');

const ROLES = ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADJUSTER', 'ADMIN'];

function traceAndHeaders(req, res, next) {
  req.traceId = req.get('x-trace-id') || crypto.randomUUID();
  res.set({
    'X-Trace-Id': req.traceId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  next();
}

function authenticate(ctx) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(unauthorized());
    const payload = verifyJwt(token, ctx.config.jwtSecret);
    if (!payload) return next(unauthorized('Invalid or expired token'));
    const user = ctx.db.get('SELECT id, email, name, role, active FROM users WHERE id = ?', payload.sub);
    if (!user || !user.active) return next(unauthorized('Account disabled'));
    req.user = user;
    next();
  };
}

// Deny by default: every protected route declares the roles allowed to use it.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      req.ctx?.audit.record(req.user.id, 'ACCESS_DENIED', 'route', `${req.method} ${req.baseUrl}${req.path}`, { role: req.user.role });
      return next(forbidden(`Role ${req.user.role} may not perform this action`));
    }
    next();
  };
}

// Fixed-window limiter keyed by client IP + bucket name.
function rateLimit({ windowMs, max, name = 'default' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, slow down'));
    }
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }
    next();
  };
}

module.exports = { ROLES, traceAndHeaders, authenticate, requireRole, rateLimit };
