// Notification Service (IWA-F-011, IWA-F-024): in-app, email and SMS.
// Email/SMS go through provider adapters (SendGrid/Twilio in production);
// the built-in adapters record the message in an outbox with retry/backoff.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { retry } = require('../core/resilience');
const { notFound } = require('../core/errors');

module.exports = function notificationsModule(ctx) {
  const { db, logger } = ctx;

  // Swappable provider adapters. Tests can replace these to simulate outages.
  const providers = {
    email: async (to, subject) => logger.debug('email_sent', { to, subject }),
    sms: async (to, text) => logger.debug('sms_sent', { to, length: text.length }),
  };

  function insert({ userId, customerId, channel, type, message, status }) {
    db.run(
      'INSERT INTO notifications (id, user_id, customer_id, channel, type, message, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
      newId('N'), userId || null, customerId || null, channel, type, message, status, nowIso(),
    );
  }

  // Notify a customer on every channel we have contact details for.
  async function notifyCustomer(customerId, type, message) {
    const c = db.get('SELECT id, user_id, email_enc, phone_enc FROM customers WHERE id = ?', customerId);
    if (!c) return;
    const agentId = db.get('SELECT agent_id FROM customers WHERE id = ?', customerId)?.agent_id;
    insert({ userId: c.user_id, customerId, channel: 'IN_APP', type, message, status: 'DELIVERED' });
    if (agentId) insert({ userId: agentId, customerId, channel: 'IN_APP', type, message, status: 'DELIVERED' });

    const email = ctx.crypto.decrypt(c.email_enc);
    const phone = ctx.crypto.decrypt(c.phone_enc);
    const sends = [];
    if (email) sends.push(['EMAIL', () => providers.email(email, type, message)]);
    if (phone) sends.push(['SMS', () => providers.sms(phone, message)]);
    for (const [channel, send] of sends) {
      try {
        await retry(send, { attempts: 3, baseMs: 20 });
        insert({ customerId, userId: c.user_id, channel, type, message, status: 'SENT' });
      } catch (err) {
        insert({ customerId, userId: c.user_id, channel, type, message, status: 'FAILED' });
        logger.warn('notification_failed', { channel, type, error: err.message });
      }
    }
  }

  function notifyUser(userId, type, message) {
    insert({ userId, channel: 'IN_APP', type, message, status: 'DELIVERED' });
  }

  function notifyRole(role, type, message) {
    for (const u of db.all('SELECT id FROM users WHERE role = ? AND active = 1', role)) notifyUser(u.id, type, message);
  }

  const router = express.Router();
  router.get('/', (req, res) => {
    res.json(db.all(
      "SELECT id, channel, type, message, status, read, created_at FROM notifications WHERE user_id = ? AND channel = 'IN_APP' ORDER BY created_at DESC LIMIT 100",
      req.user.id,
    ));
  });
  router.post('/:id/read', (req, res) => {
    const r = db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!r.changes) throw notFound('Notification');
    res.json({ ok: true });
  });

  return { notifyCustomer, notifyUser, notifyRole, providers, router };
};
