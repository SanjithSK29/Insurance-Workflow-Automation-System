// Identity: registration, login with MFA for privileged roles (IWA-SR-002),
// and admin user management.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { newId, nowIso } = require('../core/db');
const { hashPassword, verifyPassword, signJwt, generateTotpSecret, matchTotpStep } = require('../security/auth');
const { authenticate, requireRole, ROLES } = require('../security/middleware');
const { badRequest, unauthorized, conflict, notFound, ApiError } = require('../core/errors');

const MFA_ROLES = new Set(['ADMIN', 'UNDERWRITER']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function usersModule(ctx) {
  const { db, config, audit } = ctx;

  function createUser({ email, name, role, password, mfaSecret }) {
    if (!EMAIL_RE.test(email || '')) throw badRequest('A valid email is required');
    if (!name || String(name).trim().length < 2) throw badRequest('Name is required');
    if (!ROLES.includes(role)) throw badRequest(`role must be one of ${ROLES.join(', ')}`);
    if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (db.get('SELECT id FROM users WHERE email = ?', email.toLowerCase())) throw conflict('EMAIL_TAKEN', 'Email already registered');
    const user = {
      id: newId('U'),
      email: email.toLowerCase(),
      name: String(name).trim(),
      role,
      mfaSecret: MFA_ROLES.has(role) ? mfaSecret || generateTotpSecret() : null,
    };
    db.run(
      'INSERT INTO users (id, email, name, role, password_hash, mfa_secret, created_at) VALUES (?,?,?,?,?,?,?)',
      user.id, user.email, user.name, user.role, hashPassword(password), user.mfaSecret, nowIso(),
    );
    return user;
  }

  const publicUser = (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, mfaEnabled: !!u.mfa_secret, active: !!u.active,
    locked: !!u.locked_until && Date.parse(u.locked_until) > Date.now(),
  });

  const router = express.Router();

  router.post('/register', (req, res) => {
    const { email, name, password } = req.body || {};
    const user = createUser({ email, name, password, role: 'CUSTOMER' });
    audit.record(user.id, 'USER_REGISTERED', 'user', user.id, { role: 'CUSTOMER' });
    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  // A bad value (LOCKOUT_MAX_ATTEMPTS=abc gives NaN, or 0/negative) would
  // silently switch lockout off, so fall back to the defaults instead.
  const positiveOr = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
  const lockout = {
    maxAttempts: positiveOr(config.lockout?.maxAttempts, 5),
    minutes: positiveOr(config.lockout?.minutes, 15),
  };

  // Checked when the email is unknown or the account is disabled, so those
  // logins cost the same scrypt work as a wrong password and response time
  // does not reveal which emails are registered.
  const DUMMY_PASSWORD_HASH = hashPassword('timing-equaliser-never-matches');

  // Count a failed password or MFA attempt; lock the account once the
  // threshold is reached so the password and the 6-digit OTP cannot be
  // brute-forced from many IPs (the rate limiter is per IP only).
  function registerFailure(user) {
    const attempts = (user.failed_logins || 0) + 1;
    if (attempts >= lockout.maxAttempts) {
      const until = new Date(Date.now() + lockout.minutes * 60_000).toISOString();
      db.run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', until, user.id);
      audit.record(user.id, 'ACCOUNT_LOCKED', 'user', user.id, { attempts, until });
    } else {
      db.run('UPDATE users SET failed_logins = ? WHERE id = ?', attempts, user.id);
    }
  }

  // Login and logout each get their own per-IP limiter on the route itself
  // (on top of the /auth mount limit): every login runs scrypt, and every
  // logout does a token lookup and a DB write.
  const authRouteLimit = () => rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.publicMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, slow down')),
  });

  router.post('/login', authRouteLimit(), (req, res) => {
    const { email, password, otp } = req.body || {};
    const user = db.get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());

    // A locked account is refused before the password is checked, so a
    // locked account gives an attacker no oracle.
    const lockedMs = user?.locked_until ? Date.parse(user.locked_until) - Date.now() : 0;
    if (lockedMs > 0) {
      audit.record(user.id, 'LOGIN_LOCKED', 'user', user.id, {});
      res.set('Retry-After', String(Math.ceil(lockedMs / 1000)));
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or contact an administrator');
    }

    const passwordOk = verifyPassword(String(password || ''), user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !user.active || !passwordOk) {
      audit.record(email ? String(email).toLowerCase() : 'unknown', 'LOGIN_FAILED', 'user', user?.id ?? null, {});
      if (user) registerFailure(user);
      throw unauthorized('Invalid email or password');
    }

    let totpStep = user.last_totp_step;
    if (MFA_ROLES.has(user.role)) {
      if (!otp) throw new ApiError(401, 'MFA_REQUIRED', 'A one-time code from your authenticator app is required');
      const step = matchTotpStep(user.mfa_secret, otp, Date.now(), { notAfter: user.last_totp_step ?? null });
      if (step === null) {
        const replay = matchTotpStep(user.mfa_secret, otp) !== null;
        audit.record(user.id, 'MFA_FAILED', 'user', user.id, { replay });
        registerFailure(user);
        throw new ApiError(401, 'MFA_INVALID', 'Invalid one-time code');
      }
      totpStep = step;
    }

    db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_totp_step = ? WHERE id = ?', totpStep ?? null, user.id);
    audit.record(user.id, 'LOGIN', 'user', user.id, { mfa: MFA_ROLES.has(user.role) });
    const token = signJwt({ sub: user.id, role: user.role }, config.jwtSecret, config.jwtTtlSeconds);
    res.json({ token, expiresIn: config.jwtTtlSeconds, user: publicUser(user) });
  });

  // Logout revokes the presented token server-side, so a stolen or shared
  // token stops working immediately instead of at expiry.
  router.post('/logout', authRouteLimit(), authenticate(ctx), (req, res) => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (req.auth.jti) {
      db.run('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at, revoked_at) VALUES (?,?,?,?)',
        req.auth.jti, req.user.id, req.auth.exp ?? nowSec, nowIso());
    }
    db.run('DELETE FROM revoked_tokens WHERE expires_at < ?', nowSec);
    audit.record(req.user.id, 'LOGOUT', 'user', req.user.id, {});
    res.status(204).end();
  });

  const meRouter = express.Router();
  meRouter.get('/', (req, res) => {
    const customer = db.get('SELECT id FROM customers WHERE user_id = ?', req.user.id);
    res.json({ ...req.user, customerId: customer?.id || null });
  });

  const adminRouter = express.Router();
  adminRouter.use(requireRole('ADMIN'));
  adminRouter.get('/', (req, res) => res.json(db.all('SELECT * FROM users ORDER BY created_at').map(publicUser)));
  adminRouter.post('/', (req, res) => {
    const user = createUser(req.body || {});
    audit.record(req.user.id, 'USER_CREATED', 'user', user.id, { role: user.role });
    // The MFA secret is shown once so the new user can enrol an authenticator.
    res.status(201).json({ id: user.id, email: user.email, role: user.role, mfaSecret: user.mfaSecret });
  });
  adminRouter.patch('/:id', (req, res) => {
    const target = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!target) throw notFound('User');
    const { active, role, unlock } = req.body || {};
    if (role !== undefined && !ROLES.includes(role)) throw badRequest('Invalid role');
    if (target.id === req.user.id && (active === false || (role && role !== 'ADMIN'))) throw badRequest('You cannot demote or disable yourself');
    const newRole = role ?? target.role;
    const mfa = MFA_ROLES.has(newRole) ? target.mfa_secret || generateTotpSecret() : target.mfa_secret;
    db.run('UPDATE users SET active = ?, role = ?, mfa_secret = ? WHERE id = ?', active === undefined ? target.active : active ? 1 : 0, newRole, mfa, target.id);
    if (unlock === true) db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', target.id);
    audit.record(req.user.id, 'USER_UPDATED', 'user', target.id, { active, role, unlock: unlock === true || undefined });
    res.json(publicUser(db.get('SELECT * FROM users WHERE id = ?', target.id)));
  });

  return { createUser, router, meRouter, adminRouter, MFA_ROLES };
};
