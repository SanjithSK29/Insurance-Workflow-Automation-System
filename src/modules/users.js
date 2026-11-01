// Identity: registration, login with MFA for privileged roles (IWA-SR-002),
// and admin user management.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { hashPassword, verifyPassword, signJwt, generateTotpSecret, matchTotpStep } = require('../security/auth');
const { requireRole, ROLES } = require('../security/middleware');
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

  const lockout = config.lockout || { maxAttempts: 5, minutes: 15 };

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

  router.post('/login', (req, res) => {
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

    if (!user || !user.active || !verifyPassword(String(password || ''), user.password_hash)) {
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
