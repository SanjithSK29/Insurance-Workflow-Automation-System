// Notification Service (IWA-F-024): channel selection from the customer's
// contact details, provider outage and retry, role broadcast, and the in-app
// inbox with mark-as-read.
const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

describe('Notification service', () => {
  let t;
  let notifications;
  let original;
  before(async () => {
    t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } });
    notifications = t.ctx.services.notifications;
    original = { ...notifications.providers };
  });
  afterEach(() => Object.assign(notifications.providers, original));
  after(() => t.close());

  const rows = (customerId) => t.ctx.db.all(
    'SELECT user_id, channel, status FROM notifications WHERE customer_id = ? AND type = ? ORDER BY channel', customerId, 'TEST_EVENT',
  ).map((r) => ({ ...r }));
  const channels = (customerId) => rows(customerId).map((r) => `${r.channel}:${r.status}`);
  const userOf = (customerId) => t.ctx.db.get('SELECT user_id FROM customers WHERE id = ?', customerId).user_id;

  test('TC-Notify-02: a customer with email and phone gets in-app, email and SMS', async () => {
    const c = await t.newCustomer('nf1', { email: 'nf1@test.local' });
    const sent = [];
    notifications.providers.email = async (to, subject, body) => { sent.push(['email', to, subject, body]); };
    notifications.providers.sms = async (to, text) => { sent.push(['sms', to, text]); };

    await notifications.notifyCustomer(c.customerId, 'TEST_EVENT', 'Hello');
    assert.deepEqual(channels(c.customerId), ['EMAIL:SENT', 'IN_APP:DELIVERED', 'SMS:SENT']);
    assert.deepEqual(sent, [['email', 'nf1@test.local', 'TEST_EVENT', 'Hello'], ['sms', '9876501234', 'Hello']], 'providers get the decrypted contact details');
    for (const r of rows(c.customerId)) assert.equal(r.user_id, userOf(c.customerId));
  });

  test('TC-Notify-03: channels follow the contact details on file', async () => {
    const emailOnly = await t.newCustomer('nf2', { email: 'nf2@test.local', phone: '' });
    await notifications.notifyCustomer(emailOnly.customerId, 'TEST_EVENT', 'x');
    assert.deepEqual(channels(emailOnly.customerId), ['EMAIL:SENT', 'IN_APP:DELIVERED']);

    const neither = await t.newCustomer('nf3', { phone: '' });
    await notifications.notifyCustomer(neither.customerId, 'TEST_EVENT', 'x');
    assert.deepEqual(channels(neither.customerId), ['IN_APP:DELIVERED']);
  });

  test('TC-Notify-04: an unknown customer is ignored without error', async () => {
    const before = t.ctx.db.get('SELECT COUNT(*) AS n FROM notifications').n;
    await notifications.notifyCustomer('CU-DOES-NOT-EXIST', 'TEST_EVENT', 'x');
    assert.equal(t.ctx.db.get('SELECT COUNT(*) AS n FROM notifications').n, before);
  });

  test('TC-Notify-05: the agent of an agent-managed customer gets an in-app copy', async () => {
    const res = await t.call('POST', '/customers', {
      token: t.tokens.AGENT,
      body: { name: 'Managed Client', dob: '1980-06-01', income: 800000, phone: '9876507777', aadhaar: '234512347777', pan: 'ABCPM7777Z' },
    });
    assert.equal(res.status, 201);
    await notifications.notifyCustomer(res.body.id, 'TEST_EVENT', 'Policy issued');
    const inApp = rows(res.body.id).filter((r) => r.channel === 'IN_APP');
    assert.deepEqual(inApp.map((r) => r.user_id).sort(), [null, t.users.AGENT.id].sort(), 'one row for the (user-less) customer, one for the agent');
    const inbox = await t.call('GET', '/notifications', { token: t.tokens.AGENT });
    assert.ok(inbox.body.some((n) => n.type === 'TEST_EVENT' && n.message === 'Policy issued'));
  });

  test('TC-Notify-06: a provider outage is retried, then recorded as FAILED without blocking other channels', async () => {
    const c = await t.newCustomer('nf4', { email: 'nf4@test.local' });
    let emailCalls = 0;
    notifications.providers.email = async () => { emailCalls++; throw new Error('SMTP down'); };
    await notifications.notifyCustomer(c.customerId, 'TEST_EVENT', 'x');
    assert.equal(emailCalls, 3, 'three attempts with backoff');
    assert.deepEqual(channels(c.customerId), ['EMAIL:FAILED', 'IN_APP:DELIVERED', 'SMS:SENT']);
  });

  test('TC-Notify-07: a transient provider error succeeds on retry', async () => {
    const c = await t.newCustomer('nf5', { phone: '9876505555' });
    let smsCalls = 0;
    notifications.providers.sms = async () => { smsCalls++; if (smsCalls === 1) throw new Error('timeout'); };
    await notifications.notifyCustomer(c.customerId, 'TEST_EVENT', 'x');
    assert.equal(smsCalls, 2);
    assert.deepEqual(channels(c.customerId), ['IN_APP:DELIVERED', 'SMS:SENT']);
  });

  test('TC-Notify-08: role broadcast reaches only active users with that role', async () => {
    const extra = t.ctx.services.users.createUser({ email: 'adj2@test.local', name: 'Adjuster Two', role: 'ADJUSTER', password: 'Test@12345' });
    const gone = t.ctx.services.users.createUser({ email: 'adj3@test.local', name: 'Adjuster Three', role: 'ADJUSTER', password: 'Test@12345' });
    t.ctx.db.run('UPDATE users SET active = 0 WHERE id = ?', gone.id);

    notifications.notifyRole('ADJUSTER', 'ROLE_TEST', 'New task');
    const got = t.ctx.db.all("SELECT user_id FROM notifications WHERE type = 'ROLE_TEST'").map((r) => r.user_id).sort();
    assert.deepEqual(got, [t.users.ADJUSTER.id, extra.id].sort());

    notifications.notifyUser(t.users.ADMIN.id, 'USER_TEST', 'Just you');
    const admin = t.ctx.db.all("SELECT channel, status FROM notifications WHERE type = 'USER_TEST'").map((r) => ({ ...r }));
    assert.deepEqual(admin, [{ channel: 'IN_APP', status: 'DELIVERED' }]);
  });

  test('TC-Notify-09: the inbox shows only your in-app messages and you can mark them read', async () => {
    const c = await t.newCustomer('nf6', { email: 'nf6@test.local' });
    const other = await t.newCustomer('nf7');
    await notifications.notifyCustomer(c.customerId, 'TEST_EVENT', 'Read me');

    const inbox = await t.call('GET', '/notifications', { token: c.token });
    assert.equal(inbox.status, 200);
    assert.ok(inbox.body.length >= 1);
    assert.ok(inbox.body.every((n) => n.channel === 'IN_APP'), 'email/SMS rows are not in the inbox');
    const msg = inbox.body.find((n) => n.message === 'Read me');
    assert.equal(msg.read, 0);

    assert.equal((await t.call('POST', `/notifications/${msg.id}/read`, { token: other.token })).status, 404, 'cannot mark someone else\'s message');
    assert.equal((await t.call('POST', '/notifications/N-NOPE/read', { token: c.token })).status, 404);
    const ok = await t.call('POST', `/notifications/${msg.id}/read`, { token: c.token });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true });
    const after = await t.call('GET', '/notifications', { token: c.token });
    assert.equal(after.body.find((n) => n.id === msg.id).read, 1);

    assert.equal((await t.call('GET', '/notifications')).status, 401, 'login required');
  });
});
