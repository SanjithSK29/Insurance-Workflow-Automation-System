// IWAS web client: role-based dashboards on top of the REST API.
// Plain DOM (no framework/build step); every value is inserted as text, never
// as HTML, so API data cannot inject markup.
(() => {
  'use strict';

  // ---------- i18n (English + Hindi for navigation and headings) ----------
  const I18N = {
    hi: {
      Dashboard: 'डैशबोर्ड', Profile: 'प्रोफ़ाइल', 'Get a quote': 'कोटेशन लें', Applications: 'आवेदन', Policies: 'पॉलिसियाँ',
      Claims: 'दावे', Notifications: 'सूचनाएँ', Customers: 'ग्राहक', 'Review queue': 'समीक्षा कतार', 'Manual KYC': 'मैनुअल केवाईसी',
      'My tasks': 'मेरे कार्य', 'To settle': 'निपटान हेतु', Approvals: 'अनुमोदन', Workflows: 'वर्कफ़्लो', Users: 'उपयोगकर्ता',
      Audit: 'ऑडिट', Reports: 'रिपोर्ट', Settings: 'सेटिंग्स', 'Log in': 'लॉग इन', 'Log out': 'लॉग आउट',
    },
  };
  let lang = safeGet('iwas.lang') || 'en';
  const t = (s) => (I18N[lang] && I18N[lang][s]) || s;

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

  // ---------- state + API ----------
  const state = { token: sessionStorage.getItem('iwas.token'), me: null, view: null };

  async function api(method, path, body) {
    const res = await fetch('/api/v1' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const data = isJson ? await res.json() : await res.blob();
    if (res.status === 401 && state.token && !path.startsWith('/auth')) { logout(); throw new Error('Session expired, please log in again'); }
    if (!res.ok) { const e = new Error(data.message || res.statusText); e.code = data.code; e.status = res.status; throw e; }
    return data;
  }

  async function openDocument(id) {
    try {
      const blob = await api('GET', '/documents/' + id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast(e.message, true); }
  }

  async function download(path, filename) {
    try {
      const blob = await api('GET', path);
      const a = h('a', { href: URL.createObjectURL(blob), download: filename });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- DOM helpers ----------
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const $main = document.getElementById('main');
  const inr = (n) => n == null ? '–' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const date = (s) => s ? String(s).slice(0, 10) : '–';
  const STATUS_TONE = { ACTIVE: 'ok', APPROVED: 'ok', VERIFIED: 'ok', SETTLED: 'ok', CAPTURED: 'ok', ISSUED: 'ok', COMPLETED: 'ok',
    MANUAL_REVIEW: 'warn', UNDER_REVIEW: 'warn', PENDING_KYC: 'warn', PENDING_MANUAL: 'warn', REGISTERED: 'warn', OPEN: 'warn', NOT_STARTED: 'warn',
    REJECTED: 'bad', KYC_FAILED: 'bad', FAILED: 'bad', EXPIRED: 'bad' };
  const badge = (s) => h('span', { class: 'badge ' + (STATUS_TONE[s] || '') }, String(s || '–').replace(/_/g, ' '));

  function toast(msg, err = false) {
    const el = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    document.getElementById('toast').append(el);
    setTimeout(() => el.remove(), 4500);
  }

  function table(columns, rows, empty = 'Nothing here yet.') {
    if (!rows.length) return h('p', { class: 'muted' }, empty);
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col' }, c[0])))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', {}, c[1](r))))))));
  }

  function field(label, name, opts = {}) {
    const { type = 'text', value, options, required, ...rest } = opts;
    const input = options
      ? h('select', { name, required, ...rest }, options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: String(v) === String(value ?? '') }, l);
      }))
      : type === 'textarea'
        ? h('textarea', { name, required, ...rest }, value ?? '')
        : h('input', { name, type, value: value ?? '', required, ...rest });
    if (type === 'checkbox') { input.checked = !!value; return h('label', { class: 'check' }, input, label); }
    return h('label', {}, label, input);
  }

  const formData = (form) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

  // Wrap a submit handler with busy state + error toast.
  function onSubmit(handler) {
    return async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try { await handler(formData(e.target), e.target); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
    };
  }
  const act = (fn) => async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  };

  function page(title, ...content) {
    $main.replaceChildren(h('h1', {}, t(title)), ...content);
    $main.focus({ preventScroll: true });
  }
  const card = (title, ...content) => h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...content);

  // ---------- auth ----------
  function logout() {
    state.token = null; state.me = null;
    sessionStorage.removeItem('iwas.token');
    render();
  }

  function loginView() {
    let needOtp = false;
    const otp = field('One-time code (authenticator app)', 'otp', { inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '\\d{6}' });
    otp.classList.add('hidden');
    const form = h('form', { onsubmit: onSubmit(async (d) => {
      try {
        const res = await api('POST', '/auth/login', { email: d.email, password: d.password, otp: needOtp ? d.otp : undefined });
        state.token = res.token;
        sessionStorage.setItem('iwas.token', res.token);
        await render();
      } catch (e) {
        if (e.code === 'MFA_REQUIRED') { needOtp = true; otp.classList.remove('hidden'); otp.querySelector('input').focus(); toast('Enter the 6-digit code from your authenticator'); return; }
        throw e;
      }
    }) },
    field('Email', 'email', { type: 'email', required: true, autocomplete: 'username' }),
    field('Password', 'password', { type: 'password', required: true, autocomplete: 'current-password' }),
    otp,
    h('button', { type: 'submit' }, t('Log in')));

    const demo = [['Customer', 'customer@iwas.test'], ['Agent', 'agent@iwas.test'], ['Underwriter (MFA)', 'underwriter@iwas.test'], ['Claims adjuster', 'adjuster@iwas.test'], ['Admin (MFA)', 'admin@iwas.test']];
    const reg = h('form', { class: 'hidden', onsubmit: onSubmit(async (d) => {
      await api('POST', '/auth/register', d);
      toast('Account created. Log in to continue.');
      reg.classList.add('hidden');
      form.querySelector('[name=email]').value = d.email;
    }) },
    h('h3', {}, 'Create a customer account'),
    field('Full name', 'name', { required: true }), field('Email', 'email', { type: 'email', required: true }),
    field('Password (min 8 characters)', 'password', { type: 'password', required: true, minlength: 8 }),
    h('button', { type: 'submit' }, 'Register'));

    $main.replaceChildren(h('div', { class: 'login' }, card('Sign in to IWAS', form,
      h('div', { class: 'actions' }, h('button', { class: 'ghost', type: 'button', onclick: () => reg.classList.toggle('hidden') }, 'New customer? Register')),
      reg,
      h('h3', {}, 'Demo accounts'),
      h('p', { class: 'muted' }, 'Password: Passw0rd! — MFA codes: run "npm run otp -- <secret>" with the secret printed at server start.'),
      h('div', { class: 'demo' }, demo.map(([label, email]) => h('button', { class: 'ghost', type: 'button', onclick: () => {
        form.querySelector('[name=email]').value = email; form.querySelector('[name=password]').value = 'Passw0rd!';
      } }, `${label} – ${email}`))))));
  }

  // ---------- shared views ----------
  async function notificationsView() {
    const rows = await api('GET', '/notifications');
    page('Notifications', card(null, table([
      ['When', (r) => new Date(r.created_at).toLocaleString()],
      ['Type', (r) => badge(r.type)],
      ['Message', (r) => r.message],
      ['', (r) => r.read ? h('span', { class: 'muted' }, 'read') : h('button', { class: 'ghost', onclick: act(async () => { await api('POST', `/notifications/${r.id}/read`); notificationsView(); }) }, 'Mark read')],
    ], rows, 'No notifications.')));
  }

  async function dashboardView() {
    const d = await api('GET', '/admin/dashboard');
    const stat = (v, l) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const kv = (obj) => h('dl', { class: 'kv' }, Object.entries(obj).flatMap(([k, v]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, v)]));
    page('Dashboard',
      h('div', { class: 'stats' },
        stat(d.policies.active, 'Active policies'), stat(d.claims.backlog, 'Claim backlog'),
        stat(d.sla.openTasks, 'Open workflow tasks'), stat(d.sla.breachedTasks, `SLA breaches (>${d.sla.targetHours}h)`),
        stat(d.applications.pendingManualReview, 'Applications in review'), stat(d.claims.fraudFlagged, 'Fraud-flagged claims'),
        stat(inr(d.finance.premiumCollected), 'Premium collected'), stat(inr(d.claims.totalPaidOut), 'Claims paid out')),
      h('div', { class: 'grid' },
        card('Policies by status', kv(d.policies.byStatus)),
        card('Claims by status', kv(d.claims.byStatus)),
        card('Applications by status', kv(d.applications.byStatus)),
        card('Open tasks by group', kv(d.sla.openTasksByGroup))),
      h('p', { class: 'muted' }, `Generated ${new Date(d.generatedAt).toLocaleString()} · Avg claim cycle: ${d.claims.avgCycleHours ?? '–'} h · Expiring in 30 days: ${d.policies.expiringIn30Days}`));
  }

  // ---------- customer / agent ----------
  async function profileView() {
    const list = await api('GET', '/customers');
    const c = list[0];
    const save = onSubmit(async (d) => {
      const body = { ...d, income: Number(d.income) };
      for (const k of ['aadhaar', 'pan', 'phone', 'email']) if (!body[k] || body[k].includes('X') || body[k].includes('*')) delete body[k];
      if (c) await api('PATCH', `/customers/${c.id}`, body); else await api('POST', '/customers', body);
      toast('Profile saved'); profileView();
    });
    page('Profile',
      c ? card('KYC status', h('p', {}, badge(c.kycStatus), ' ', c.kycRef ? `Reference ${c.kycRef}` : ''),
        c.kycStatus !== 'VERIFIED' ? h('button', { onclick: act(async () => { const r = await api('POST', `/customers/${c.id}/kyc`); toast(`KYC: ${r.status}${r.reason ? ' – ' + r.reason : ''}`, r.status === 'FAILED'); profileView(); }) }, 'Verify KYC now') : null)
        : card(null, h('p', {}, 'Complete your profile to get personalised quotes and buy policies.')),
      card(c ? 'Your details' : 'Create profile', profileForm(c, save)));
  }

  function profileForm(c = {}, onsubmit) {
    return h('form', { onsubmit },
      h('div', { class: 'row' }, field('Full name', 'name', { value: c.name, required: true }), field('Date of birth', 'dob', { type: 'date', value: c.dob, required: true }),
        field('Annual income (₹)', 'income', { type: 'number', min: 0, value: c.income, required: true })),
      h('div', { class: 'row' }, field('Email', 'email', { type: 'email', value: c.email }), field('Mobile', 'phone', { value: c.phone, placeholder: '98XXXXXXXX' })),
      h('div', { class: 'row' }, field('Aadhaar number', 'aadhaar', { value: c.aadhaar, placeholder: '12 digits', required: !c.id }),
        field('PAN', 'pan', { value: c.pan, placeholder: 'ABCPE1234F', required: !c.id })),
      c.piiMasked ? h('p', { class: 'muted' }, 'Identity numbers are masked for your privacy. Leave them unchanged to keep the stored values.') : null,
      h('button', { type: 'submit' }, 'Save'));
  }

  async function customersView() {
    const rows = await api('GET', '/customers');
    page('Customers',
      card('Onboard a customer', profileForm({}, onSubmit(async (d, form) => {
        await api('POST', '/customers', { ...d, income: Number(d.income) }); toast('Customer onboarded'); form.reset(); customersView();
      }))),
      card('Your portfolio', table([
        ['Name', (r) => r.name], ['Age', (r) => r.age], ['Income', (r) => inr(r.income)], ['Phone', (r) => r.phone || '–'],
        ['KYC', (r) => badge(r.kycStatus)],
        ['', (r) => h('div', { class: 'actions' },
          r.kycStatus !== 'VERIFIED' ? h('button', { class: 'ghost', onclick: act(async () => { const k = await api('POST', `/customers/${r.id}/kyc`); toast(`KYC: ${k.status}`); customersView(); }) }, 'Run KYC') : null,
          h('button', { class: 'ghost', onclick: () => quoteView(r.id) }, 'Quote'))],
      ], rows, 'No customers onboarded yet.')));
  }

  async function quoteView(preselect) {
    const isAgent = state.me.role === 'AGENT';
    const customers = await api('GET', '/customers');
    if (!customers.length) return page('Get a quote', card(null, h('p', {}, isAgent ? 'Onboard a customer first.' : 'Create your profile first.'), h('button', { onclick: () => go(isAgent ? 'customers' : 'profile') }, isAgent ? 'Onboard customer' : 'Create profile')));
    const result = h('div');
    const form = h('form', { onsubmit: onSubmit(async (d) => {
      const q = await api('POST', '/quote', { customerId: d.customerId, coverageType: d.coverageType, term: Number(d.term), sumInsured: d.sumInsured ? Number(d.sumInsured) : undefined, smoker: d.smoker === 'on' });
      showQuote(q, result);
    }) },
    h('div', { class: 'row' },
      isAgent ? field('Customer', 'customerId', { options: customers.map((c) => [c.id, c.name]), value: preselect }) : h('input', { type: 'hidden', name: 'customerId', value: customers[0].id }),
      field('Coverage', 'coverageType', { options: [['health', 'Health'], ['life', 'Term life'], ['motor', 'Motor'], ['home', 'Home']] }),
      field('Term (years)', 'term', { type: 'number', min: 1, max: 30, value: 1 }),
      field('Sum insured (₹, optional)', 'sumInsured', { type: 'number', min: 50000, step: 1000 })),
    field('Tobacco user', 'smoker', { type: 'checkbox' }),
    h('button', { type: 'submit' }, 'Calculate premium'));
    page('Get a quote', card(null, form), result);
  }

  function showQuote(q, target) {
    const b = q.breakdown;
    const decl = h('form', { onsubmit: onSubmit(async (d) => {
      const res = await api('POST', '/applications', { quoteId: q.quoteId, declarations: {
        smoker: q.smoker, occupation: d.occupation, previousClaims: Number(d.previousClaims || 0),
        conditions: d.conditions ? d.conditions.split(',').map((s) => s.trim()).filter(Boolean) : [],
      } });
      toast(`Application ${res.applicationId}: ${res.status.replace(/_/g, ' ')}`, res.status === 'KYC_FAILED');
      go('applications');
    }) },
    h('h3', {}, 'Apply for this policy'),
    h('div', { class: 'row' }, field('Occupation', 'occupation', { required: true }), field('Pre-existing conditions (comma separated)', 'conditions'),
      field('Claims in last 3 years', 'previousClaims', { type: 'number', min: 0, value: 0 })),
    h('button', { type: 'submit' }, 'Submit application'));
    target.replaceChildren(card(`Quote ${q.quoteId}`,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Coverage'), h('dd', {}, `${q.coverageType} · ${q.term} year(s) · sum insured ${inr(q.sumInsured)}`),
        h('dt', {}, 'Base premium'), h('dd', {}, inr(b.basePremium)),
        h('dt', {}, 'Age loading'), h('dd', {}, inr(b.ageLoading)),
        h('dt', {}, 'Tobacco loading'), h('dd', {}, inr(b.smokerLoading)),
        h('dt', {}, 'Multi-year discount'), h('dd', {}, inr(b.termDiscount)),
        h('dt', {}, 'GST (18%)'), h('dd', {}, inr(b.gst)),
        h('dt', {}, h('strong', {}, 'Total premium')), h('dd', {}, h('strong', {}, inr(q.premium))),
        h('dt', {}, 'Valid until'), h('dd', {}, q.validUntil)),
      decl));
  }

  async function applicationsView() {
    const rows = await api('GET', '/applications');
    page('Applications', card(null, table([
      ['ID', (r) => r.applicationId], ['Customer', (r) => r.customerName], ['Coverage', (r) => `${r.coverageType} · ${inr(r.sumInsured)}`],
      ['Premium', (r) => inr(r.premium)], ['Risk', (r) => r.riskScore ?? '–'], ['Status', (r) => badge(r.status)],
      ['', (r) => r.status === 'APPROVED' ? payForm(r) : r.decisionNote ? h('span', { class: 'muted' }, r.decisionNote) : null],
    ], rows, 'No applications yet.')),
    h('p', { class: 'muted' }, 'Payments use sandbox tokens: “Card – success”, “Card – declined”, “Card – gateway timeout (retried)”. No real card data is collected.'));
  }

  function payForm(app) {
    return h('form', { class: 'actions', onsubmit: onSubmit(async (d) => {
      const res = await api('POST', '/payments', { applicationId: app.applicationId, paymentToken: d.token });
      toast(`Policy ${res.policy.policyNumber} issued`); go('policies');
    }) },
    h('label', { class: 'sr-only', for: 'tok-' + app.applicationId }, 'Payment method'),
    h('select', { name: 'token', id: 'tok-' + app.applicationId }, h('option', { value: 'tok_success' }, 'Card – success'), h('option', { value: 'tok_decline' }, 'Card – declined'), h('option', { value: 'tok_flaky' }, 'Card – gateway timeout')),
    h('button', { type: 'submit' }, `Pay ${inr(app.premium)}`));
  }

  async function policiesView() {
    const rows = await api('GET', '/policies');
    const detail = h('div');
    page('Policies', card(null, table([
      ['Policy', (r) => r.policyNumber], ['Holder', (r) => r.customerName], ['Coverage', (r) => r.coverageType], ['Sum insured', (r) => inr(r.sumInsured)],
      ['Period', (r) => `${r.startDate} → ${r.endDate}`], ['Status', (r) => badge(r.status)], ['v', (r) => r.version],
      ['', (r) => h('div', { class: 'actions' },
        h('button', { class: 'ghost', onclick: () => openDocument(r.documentId) }, 'PDF'),
        h('button', { class: 'ghost', onclick: () => policyDetail(r.policyId, detail) }, 'Manage'))],
    ], rows, 'No policies yet.')), detail);
  }

  async function policyDetail(id, target) {
    const p = await api('GET', `/policies/${id}`);
    const canChange = ['CUSTOMER', 'AGENT', 'ADMIN'].includes(state.me.role);
    const endorse = h('form', { onsubmit: onSubmit(async (d) => {
      const body = {}; if (d.nominee) body.nominee = d.nominee; if (d.address) body.address = d.address; if (d.sumInsured) body.sumInsured = Number(d.sumInsured);
      const res = await api('POST', `/policies/${id}/endorse`, body);
      toast(`Endorsed. Premium adjustment ${inr(res.premiumAdjustment)}`); policyDetail(id, target);
    }) },
    h('div', { class: 'row' }, field('Nominee', 'nominee', { value: p.nominee }), field('Address', 'address', { value: p.address }), field('Sum insured (₹)', 'sumInsured', { type: 'number', placeholder: String(p.sumInsured) })),
    h('button', { type: 'submit' }, 'Submit endorsement'));
    const renew = h('div', { class: 'actions' }, h('button', { class: 'ghost', onclick: act(async () => {
      const rq = await api('GET', `/policies/${id}/renewal-quote`);
      if (!confirm(`Renew until ${rq.newEndDate} for ${inr(rq.premium)}? (sandbox card)`)) return;
      await api('POST', `/policies/${id}/renew`, { paymentToken: 'tok_success' });
      toast('Policy renewed'); policyDetail(id, target);
    }) }, 'Renew policy'));
    target.replaceChildren(card(`Policy ${p.policyNumber}`,
      h('h3', {}, 'Documents'),
      table([['Kind', (d) => d.kind], ['File', (d) => d.filename], ['Created', (d) => date(d.created_at)],
        ['', (d) => h('div', { class: 'actions' }, h('button', { class: 'ghost', onclick: () => openDocument(d.id) }, 'Open'),
          h('button', { class: 'ghost', onclick: act(async () => { const v = await api('GET', `/documents/${d.id}/verify`); toast(v.signatureValid ? 'Signature valid ✓' : 'Signature INVALID', !v.signatureValid); }) }, 'Verify signature'))]], p.documents),
      h('h3', {}, 'Endorsement history'),
      table([['When', (e) => date(e.created_at)], ['Changes', (e) => JSON.stringify(e.changes)], ['Previous', (e) => JSON.stringify(e.previous)], ['Premium adj.', (e) => inr(e.premium_adjustment)]], p.endorsements, 'No endorsements.'),
      canChange && p.status === 'ACTIVE' ? [h('h3', {}, 'Change policy details'), endorse] : null,
      ['CUSTOMER', 'AGENT'].includes(state.me.role) ? [h('h3', {}, 'Renewal'), h('p', { class: 'muted' }, 'Renewal opens 60 days before expiry.'), renew] : null));
    target.scrollIntoView({ behavior: 'smooth' });
  }

  const TRACK = ['REGISTERED', 'UNDER_REVIEW', 'APPROVED', 'SETTLED'];
  function tracker(status) {
    const idx = status === 'REJECTED' ? 2 : TRACK.indexOf(status);
    return h('ol', { class: 'tracker', 'aria-label': `Claim progress: ${status}` }, TRACK.map((s, i) => {
      const label = status === 'REJECTED' && i === 2 ? 'REJECTED' : s;
      const cls = status === 'REJECTED' && i === 2 ? 'bad' : i <= idx ? 'done' : '';
      return h('li', { class: cls }, label.replace(/_/g, ' '));
    }));
  }

  const readFile = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ filename: file.name, mime: file.type, contentBase64: String(r.result).split(',')[1] });
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });

  async function claimsView() {
    const [claims, policies] = await Promise.all([api('GET', '/claims'), api('GET', '/policies')]);
    const active = policies.filter((p) => p.status === 'ACTIVE');
    const TYPES = { health: ['hospitalization', 'day-care', 'accident'], life: ['death', 'critical-illness'], motor: ['accident', 'theft', 'damage'], home: ['fire', 'theft', 'flood', 'damage'] };
    const typeSel = h('select', { name: 'claimType', id: 'claimType' });
    const fillTypes = (pid) => { const p = active.find((x) => x.policyId === pid); typeSel.replaceChildren(...(p ? TYPES[p.coverageType] : []).map((x) => h('option', { value: x }, x))); };
    const policySel = h('select', { name: 'policyId', id: 'policyId', onchange: (e) => fillTypes(e.target.value) }, active.map((p) => h('option', { value: p.policyId }, `${p.policyNumber} (${p.coverageType})`)));
    if (active[0]) fillTypes(active[0].policyId);
    const files = h('input', { type: 'file', name: 'files', multiple: true, accept: '.pdf,.png,.jpg,.jpeg' });

    const form = h('form', { onsubmit: onSubmit(async (d, f) => {
      const docs = [];
      for (const file of files.files) {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB`);
        docs.push(await readFile(file));
      }
      const res = await api('POST', '/claims', { policyId: d.policyId, claimType: d.claimType, amount: Number(d.amount), incidentDate: d.incidentDate, description: d.description, documents: docs });
      toast(`Claim ${res.claimId} registered – ETA ${res.eta}`); f.reset(); claimsView();
    }) },
    h('p', { class: 'muted' }, 'Step 1: choose the policy and what happened. Step 2: amount and date. Step 3: attach bills or reports (PDF/JPG/PNG, max 10 MB each).'),
    h('div', { class: 'row' }, h('label', { for: 'policyId' }, 'Policy', policySel), h('label', { for: 'claimType' }, 'Claim type', typeSel),
      field('Amount claimed (₹)', 'amount', { type: 'number', min: 1, required: true }), field('Incident date', 'incidentDate', { type: 'date', required: true })),
    field('What happened?', 'description', { type: 'textarea', maxlength: 2000 }),
    h('label', {}, 'Supporting documents', files),
    h('button', { type: 'submit' }, 'Submit claim'));

    page('Claims',
      ['CUSTOMER', 'AGENT'].includes(state.me.role) ? card('File a claim', active.length ? form : h('p', { class: 'muted' }, 'You need an active policy to file a claim.')) : null,
      ...claims.map((c) => card(`Claim ${c.claimId} · ${c.policyNumber}`,
        tracker(c.status),
        h('dl', { class: 'kv' }, h('dt', {}, 'Type'), h('dd', {}, c.claimType), h('dt', {}, 'Claimed'), h('dd', {}, inr(c.amount)),
          h('dt', {}, 'Incident'), h('dd', {}, c.incidentDate), h('dt', {}, 'Status'), h('dd', {}, badge(c.status)),
          c.settlement ? [h('dt', {}, 'Payable'), h('dd', {}, inr(c.settlement.payableAmount))] : null),
        c.settlement?.documentId ? h('button', { class: 'ghost', onclick: () => openDocument(c.settlement.documentId) }, 'Settlement letter') : null)),
      !claims.length ? card(null, h('p', { class: 'muted' }, 'No claims filed.')) : null);
  }

  // ---------- underwriter ----------
  async function reviewView() {
    const rows = await api('GET', '/applications?status=MANUAL_REVIEW');
    page('Review queue', ...(!rows.length ? [card(null, h('p', { class: 'muted' }, 'No applications waiting for review.'))] : rows.map((a) => card(`Application ${a.applicationId} – ${a.customerName}`,
      h('dl', { class: 'kv' }, h('dt', {}, 'Coverage'), h('dd', {}, `${a.coverageType}, ${a.term} yr, ${inr(a.sumInsured)}`), h('dt', {}, 'Premium'), h('dd', {}, inr(a.premium)),
        h('dt', {}, 'Risk score'), h('dd', {}, h('strong', {}, `${a.riskScore} / 100`)), h('dt', {}, 'Declarations'), h('dd', {}, JSON.stringify(a.declarations))),
      h('h3', {}, 'Rule flags'), a.riskFlags.map((f) => h('div', { class: 'flag' }, `${f.code} (+${f.points}) – ${f.message}`)),
      h('form', { class: 'actions', onsubmit: (e) => e.preventDefault() },
        h('label', { class: 'sr-only', for: 'note-' + a.applicationId }, 'Decision note'),
        h('input', { id: 'note-' + a.applicationId, placeholder: 'Decision note' }),
        ...['APPROVE', 'REJECT'].map((decision) => h('button', { type: 'button', class: decision === 'REJECT' ? 'danger' : '', onclick: act(async () => {
          await api('POST', `/applications/${a.applicationId}/decision`, { decision, note: document.getElementById('note-' + a.applicationId).value });
          toast(`Application ${decision === 'APPROVE' ? 'approved' : 'rejected'}`); reviewView();
        }) }, decision === 'APPROVE' ? 'Approve' : 'Reject')))))));
  }

  async function manualKycView() {
    const rows = await api('GET', '/customers?kycStatus=PENDING_MANUAL');
    page('Manual KYC', card('Customers awaiting manual verification (provider unavailable)', table([
      ['Name', (r) => r.name], ['DOB', (r) => r.dob], ['Aadhaar', (r) => r.aadhaar], ['PAN', (r) => r.pan],
      ['', (r) => h('div', { class: 'actions' }, ...['VERIFIED', 'FAILED'].map((decision) => h('button', { class: decision === 'FAILED' ? 'danger' : '', onclick: act(async () => {
        await api('POST', `/customers/${r.id}/kyc/manual`, { decision }); toast(`KYC ${decision.toLowerCase()}`); manualKycView();
      }) }, decision === 'VERIFIED' ? 'Verify' : 'Fail')))],
    ], rows, 'Queue is empty.')));
  }

  // ---------- adjuster / admin tasks ----------
  async function tasksView() {
    const tasks = await api('GET', '/workflow/tasks');
    const title = state.me.role === 'ADMIN' ? 'Approvals' : 'My tasks';
    if (!tasks.length) return page(title, card(null, h('p', { class: 'muted' }, 'No open tasks for your role.')));
    const cards = await Promise.all(tasks.map(async (task) => {
      const c = await api('GET', `/claims/${task.business_key}`);
      return card(`${task.name} – claim ${c.claimId}`,
        h('dl', { class: 'kv' }, h('dt', {}, 'Claimant'), h('dd', {}, c.customerName), h('dt', {}, 'Policy'), h('dd', {}, `${c.policyNumber} (${c.coverageType})`),
          h('dt', {}, 'Type'), h('dd', {}, c.claimType), h('dt', {}, 'Claimed'), h('dd', {}, inr(c.amount)), h('dt', {}, 'Incident'), h('dd', {}, c.incidentDate),
          h('dt', {}, 'Description'), h('dd', {}, c.description || '–'), h('dt', {}, 'Fraud score'), h('dd', {}, c.fraudScore), h('dt', {}, 'Waiting since'), h('dd', {}, new Date(task.created_at).toLocaleString())),
        c.fraudFlags.length ? [h('h3', {}, 'Fraud indicators'), c.fraudFlags.map((f) => h('div', { class: 'flag' }, `${f.code} (+${f.points}) – ${f.message}`))] : null,
        h('h3', {}, 'Documents'),
        c.documents.length ? h('div', { class: 'actions' }, c.documents.map((d) => h('button', { class: 'ghost', onclick: () => openDocument(d.id) }, d.filename))) : h('p', { class: 'muted' }, 'None uploaded'),
        decisionForm(c));
    }));
    page(title, ...cards);
  }

  function decisionForm(c) {
    const form = h('form', { onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'row' }, field('Approved amount (₹)', 'approvedAmount', { type: 'number', min: 0, max: c.amount, value: c.approvedAmount ?? c.amount }), field('Comment', 'comment')));
    form.append(h('div', { class: 'actions' }, ...['approve', 'reject'].map((outcome) => h('button', { type: 'button', class: outcome === 'reject' ? 'danger' : '', onclick: act(async () => {
      const f = formData(form);
      const res = await api('POST', `/claims/${c.claimId}/decision`, { outcome, approvedAmount: f.approvedAmount, comment: f.comment });
      toast(`Claim ${res.claim.status.replace(/_/g, ' ').toLowerCase()}`); tasksView();
    }) }, outcome === 'approve' ? 'Approve' : 'Reject'))));
    return form;
  }

  async function settleView() {
    const rows = await api('GET', '/claims?status=APPROVED');
    page('To settle', card('Approved claims awaiting payout', table([
      ['Claim', (r) => r.claimId], ['Claimant', (r) => r.customerName], ['Claimed', (r) => inr(r.amount)], ['Approved', (r) => inr(r.settlement?.approvedAmount)],
      ['Deductible', (r) => inr(r.settlement?.deductible)], ['Co-pay', (r) => inr(r.settlement?.copayAmount)], ['Payable', (r) => h('strong', {}, inr(r.settlement?.payableAmount))],
      ['', (r) => h('button', { onclick: act(async () => { await api('POST', `/claims/${r.claimId}/settle`); toast(`Claim ${r.claimId} settled`); settleView(); }) }, 'Settle & pay')],
    ], rows, 'No approved claims waiting.')));
  }

  // ---------- admin ----------
  async function workflowsView() {
    const [defs, latest] = await Promise.all([api('GET', '/admin/workflows'), api('GET', '/admin/workflows/claim-approval/latest')]);
    const xml = h('textarea', { class: 'code', name: 'xml', spellcheck: 'false', 'aria-label': 'BPMN XML' }, latest.xml);
    const model = h('div');
    const showModel = (m) => model.replaceChildren(
      h('h3', {}, 'Nodes'), table([['Id', (n) => n.id], ['Type', (n) => n.type], ['Name', (n) => n.name], ['Group', (n) => n.candidateGroup || n.result || '']], m.nodes),
      h('h3', {}, 'Flows'), table([['From', (f) => f.source], ['To', (f) => f.target], ['Condition', (f) => f.condition || '(default)']], m.flows));
    showModel(latest.model);
    page('Workflows',
      card('Claim approval workflow (BPMN 2.0)',
        h('p', { class: 'muted' }, 'Edit the BPMN XML (or paste from Camunda Modeler), validate, then deploy. New claims use the latest version; running claims keep their version.'),
        xml,
        h('div', { class: 'actions' },
          h('button', { class: 'ghost', onclick: act(async () => { try { const r = await api('POST', '/admin/workflows/validate', { xml: xml.value }); showModel(r); toast(`Valid: ${r.nodes.length} nodes, ${r.flows.length} flows`); } catch (e) { toast(e.message, true); } }) }, 'Validate'),
          h('button', { onclick: act(async () => { const r = await api('POST', '/admin/workflows', { xml: xml.value }); toast(`Deployed ${r.key} v${r.version}`); workflowsView(); }) }, 'Deploy')),
        model),
      card('Deployed versions', table([['Key', (d) => d.key], ['Version', (d) => d.version], ['Name', (d) => d.name], ['By', (d) => d.deployed_by], ['When', (d) => new Date(d.created_at).toLocaleString()]], defs)));
  }

  async function usersView() {
    const rows = await api('GET', '/admin/users');
    const out = h('div');
    page('Users',
      card('Create staff user', h('form', { onsubmit: onSubmit(async (d, f) => {
        const u = await api('POST', '/admin/users', d);
        out.replaceChildren(u.mfaSecret ? h('p', { class: 'flag' }, `MFA secret for ${u.email}: ${u.mfaSecret} – share it securely; it is shown once.`) : h('p', {}, `Created ${u.email}`));
        f.reset(); usersView().then(() => $main.append(out));
      }) },
      h('div', { class: 'row' }, field('Name', 'name', { required: true }), field('Email', 'email', { type: 'email', required: true }),
        field('Role', 'role', { options: ['AGENT', 'UNDERWRITER', 'ADJUSTER', 'ADMIN', 'CUSTOMER'] }), field('Temporary password', 'password', { type: 'password', minlength: 8, required: true })),
      h('button', { type: 'submit' }, 'Create user'))),
      card('All users', table([['Name', (u) => u.name], ['Email', (u) => u.email], ['Role', (u) => badge(u.role)], ['MFA', (u) => u.mfaEnabled ? 'Yes' : 'No'],
        ['Active', (u) => u.active ? badge('ACTIVE') : badge('DISABLED')],
        ['', (u) => u.id === state.me.id ? null : h('button', { class: 'ghost', onclick: act(async () => { await api('PATCH', `/admin/users/${u.id}`, { active: !u.active }); usersView(); }) }, u.active ? 'Disable' : 'Enable')]], rows)), out);
  }

  async function auditView() {
    const rows = await api('GET', '/admin/audit?limit=300');
    const status = h('div');
    page('Audit',
      card('Integrity', h('p', { class: 'muted' }, 'Entries are append-only and SHA-256 hash-chained; any edit or deletion breaks the chain.'), status,
        h('button', { onclick: act(async () => { const v = await api('GET', '/admin/audit/verify'); status.replaceChildren(h('p', {}, v.valid ? badge('VERIFIED') : badge('FAILED'), ' ', v.valid ? `${v.entries} entries, chain intact` : `Broken at entry ${v.brokenAt}: ${v.reason}`)); }) }, 'Verify chain')),
      card('Recent entries', table([['#', (r) => r.seq], ['Time', (r) => new Date(r.ts).toLocaleString()], ['Actor', (r) => r.actor], ['Action', (r) => r.action],
        ['Entity', (r) => `${r.entity} ${r.entity_id || ''}`], ['Details', (r) => r.details], ['Hash', (r) => h('code', {}, r.hash.slice(0, 12) + '…')]], rows)));
  }

  function reportsView() {
    page('Reports', card('Export', h('div', { class: 'table-wrap' }, table([['Report', (r) => r[1]], ['', (r) => h('div', { class: 'actions' },
      h('button', { class: 'ghost', onclick: () => download(`/admin/reports/${r[0]}?format=csv`, `${r[0]}.csv`) }, 'CSV'),
      h('button', { class: 'ghost', onclick: () => download(`/admin/reports/${r[0]}?format=pdf`, `${r[0]}.pdf`) }, 'PDF'))]],
    [['policies', 'Policy register'], ['claims', 'Claims register'], ['payments', 'Premium collections']]))));
  }

  async function settingsView() {
    const s = await api('GET', '/admin/settings');
    const out = h('div');
    page('Settings',
      card('Underwriting', h('form', { onsubmit: onSubmit(async (d) => { await api('PUT', '/admin/settings/risk-threshold', { value: Number(d.value) }); toast('Threshold updated'); }) },
        field('Manual review threshold (risk score 0–100)', 'value', { type: 'number', min: 0, max: 100, value: s.riskThreshold }),
        h('button', { type: 'submit' }, 'Save'))),
      card('Renewal reminders', h('p', { class: 'muted' }, `Reminders go out ${s.reminderDays.join(', ')} days before expiry. The job runs every 6 hours; run it now for a given date:`),
        h('form', { onsubmit: onSubmit(async (d) => { const r = await api('POST', '/admin/jobs/renewal-reminders', d.asOf ? { asOf: d.asOf } : {}); out.replaceChildren(h('p', {}, `${r.sent.length} reminder(s) sent`), r.sent.length ? h('div', { class: 'pre' }, JSON.stringify(r.sent, null, 2)) : null); }) },
          field('As of date (optional)', 'asOf', { type: 'date' }), h('button', { type: 'submit' }, 'Run reminder job')), out));
  }

  // ---------- routing ----------
  const VIEWS = {
    CUSTOMER: [['profile', 'Profile', profileView], ['quote', 'Get a quote', () => quoteView()], ['applications', 'Applications', applicationsView], ['policies', 'Policies', policiesView], ['claims', 'Claims', claimsView], ['notifications', 'Notifications', notificationsView]],
    AGENT: [['customers', 'Customers', customersView], ['quote', 'Get a quote', () => quoteView()], ['applications', 'Applications', applicationsView], ['policies', 'Policies', policiesView], ['claims', 'Claims', claimsView], ['notifications', 'Notifications', notificationsView]],
    UNDERWRITER: [['review', 'Review queue', reviewView], ['kyc', 'Manual KYC', manualKycView], ['applications', 'Applications', applicationsView], ['dashboard', 'Dashboard', dashboardView], ['notifications', 'Notifications', notificationsView]],
    ADJUSTER: [['tasks', 'My tasks', tasksView], ['settle', 'To settle', settleView], ['claims', 'Claims', claimsView], ['dashboard', 'Dashboard', dashboardView], ['notifications', 'Notifications', notificationsView]],
    ADMIN: [['dashboard', 'Dashboard', dashboardView], ['tasks', 'Approvals', tasksView], ['workflows', 'Workflows', workflowsView], ['users', 'Users', usersView], ['audit', 'Audit', auditView], ['reports', 'Reports', reportsView], ['settings', 'Settings', settingsView], ['policies', 'Policies', policiesView], ['claims', 'Claims', claimsView]],
  };

  async function go(id) {
    const views = VIEWS[state.me.role];
    const view = views.find((v) => v[0] === id) || views[0];
    state.view = view[0];
    location.hash = view[0];
    for (const b of document.querySelectorAll('#nav button')) {
      if (b.dataset.view === view[0]) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    try { await view[2](); } catch (e) { toast(e.message, true); }
  }

  async function render() {
    const nav = document.getElementById('nav');
    const logoutBtn = document.getElementById('logout');
    logoutBtn.textContent = t('Log out');
    if (!state.token) {
      nav.replaceChildren(); logoutBtn.hidden = true; document.getElementById('whoami').textContent = '';
      return loginView();
    }
    try { state.me = await api('GET', '/me'); } catch { return logout(); }
    document.getElementById('whoami').textContent = `${state.me.name} · ${state.me.role.toLowerCase()}`;
    logoutBtn.hidden = false;
    nav.replaceChildren(...VIEWS[state.me.role].map(([id, label]) => h('button', { 'data-view': id, onclick: () => go(id) }, t(label))));
    go(location.hash.slice(1));
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (state.me && id && id !== state.view) go(id);
  });
  document.getElementById('logout').addEventListener('click', logout);
  const langSel = document.getElementById('lang');
  langSel.value = lang;
  langSel.addEventListener('change', () => { lang = langSel.value; safeSet('iwas.lang', lang); document.documentElement.lang = lang; render(); });
  render();
})();
