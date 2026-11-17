// IWA-NF-005 (WCAG 2.1 AA) for the web UI (owner: Samarth).
// Renders every screen of every role from the real app in jsdom and runs the
// axe-core WCAG 2.0/2.1 A and AA rules on it. Colour contrast cannot be
// measured in jsdom, so it is checked separately from the CSS tokens.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createApp } = require('../src/app');
const { seedDemo, DEMO_USERS, DEMO_PASSWORD } = require('../src/seed');
const { totp } = require('../src/security/auth');

const PUBLIC = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const AXE_JS = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Web UI accessibility (IWA-NF-005)', () => {
  let app;
  let server;
  let origin;
  const tokens = {};

  before(async () => {
    app = createApp({ logLevel: 'silent', seedDemoData: false });
    await seedDemo(app.ctx);
    server = await new Promise((resolve) => { const s = app.app.listen(0, '127.0.0.1', () => resolve(s)); });
    origin = `http://127.0.0.1:${server.address().port}`;
    for (const u of DEMO_USERS) {
      const res = await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: DEMO_PASSWORD, ...(u.mfaSecret ? { otp: totp(u.mfaSecret) } : {}) }),
      });
      tokens[u.role] = (await res.json()).token;
    }
  });
  after(() => new Promise((resolve) => server.close(() => { app.close(); resolve(); })));

  // Load the single-page app in jsdom, signed in as `role` (or signed out).
  async function openUi(role) {
    const dom = new JSDOM(HTML, { url: `${origin}/`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    let inFlight = 0;
    window.fetch = async (input, init) => {
      inFlight++;
      try { return await fetch(new URL(input, origin), init); } finally { inFlight--; }
    };
    window.Element.prototype.scrollIntoView = () => {};
    window.confirm = () => false;
    if (role) window.sessionStorage.setItem('iwas.token', tokens[role]);
    window.eval(APP_JS);
    window.eval(AXE_JS);
    const settle = async () => {
      // Wait until the screen has rendered and no API call is outstanding.
      for (let quiet = 0; quiet < 3;) { await wait(20); quiet = inFlight === 0 ? quiet + 1 : 0; }
    };
    await settle();
    return { window, settle };
  }

  async function axeViolations(window, screen) {
    const result = await window.axe.run(window.document, { runOnly: { type: 'tag', values: WCAG_AA }, rules: { 'color-contrast': { enabled: false } } });
    // Copy into a Node array: the result comes from jsdom's realm, which strict deepEqual treats as different.
    return Array.from(result.violations, (v) => `${screen}: ${v.id} (${v.impact}) – ${v.help} – ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  }

  test('TC-UX-01: the sign-in screen has no WCAG A/AA violations', async () => {
    const { window } = await openUi(null);
    assert.ok(window.document.querySelector('input[name=email]'), 'login form rendered');
    assert.deepEqual(await axeViolations(window, 'login'), []);
    window.close();
  });

  for (const role of ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADJUSTER', 'ADMIN']) {
    test(`TC-UX-02: every ${role.toLowerCase()} screen has no WCAG A/AA violations`, async () => {
      const { window, settle } = await openUi(role);
      const nav = [...window.document.querySelectorAll('#nav button')];
      assert.ok(nav.length >= 5, 'role navigation rendered');
      const problems = [];
      for (const button of nav) {
        button.click();
        await settle();
        problems.push(...await axeViolations(window, `${role}/${button.dataset.view}`));
        // Policy details (forms for endorsement, renewal, cancellation) open from the list.
        const manage = [...window.document.querySelectorAll('main button')].find((b) => b.textContent === 'Manage');
        if (manage) {
          manage.click();
          await settle();
          problems.push(...await axeViolations(window, `${role}/${button.dataset.view}/details`));
        }
      }
      assert.deepEqual(problems, []);
      window.close();
    });
  }

  test('TC-UX-03: keyboard users get a skip link, a labelled language switch and a polite live region', async () => {
    const { window } = await openUi('CUSTOMER');
    const doc = window.document;
    assert.equal(doc.documentElement.lang, 'en');
    assert.equal(doc.querySelector('a.skip').getAttribute('href'), '#main');
    assert.equal(doc.querySelector('main').getAttribute('tabindex'), '-1', 'skip target can take focus');
    assert.equal(doc.querySelector('label[for=lang]').textContent, 'Language');
    assert.equal(doc.getElementById('toast').getAttribute('aria-live'), 'polite');
    assert.equal(doc.querySelector('#nav [aria-current=page]').textContent, 'Profile');
    window.close();
  });
});

// ---- colour contrast from the CSS custom properties -------------------------

const CSS = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');

function tokensFrom(block) {
  const expand = (hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
  // Takes the first colour in each custom property, so `--focus: 3px solid #abc` gives the ring colour.
  return Object.fromEntries([...block.matchAll(/--([\w-]+):[^;#]*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g)].map((m) => [m[1], expand(m[2])]));
}
// Text on red (danger buttons, error toasts) is white unless the theme defines --on-bad.
const light = { 'on-bad': '#ffffff', ...tokensFrom(/:root\s*\{([^}]*)\}/.exec(CSS)[1]) };
const dark = { ...light, ...tokensFrom(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(CSS)[1]) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text/background pairs the stylesheet actually uses (foreground, background, where).
const TEXT_PAIRS = [
  ['ink', 'bg', 'body text'], ['ink', 'panel', 'card text'], ['muted', 'panel', 'labels, hints'], ['muted', 'bg', 'page notes'],
  ['brand', 'panel', 'ghost buttons, links'], ['brand-ink', 'brand', 'primary buttons'], ['brand', 'info-bg', 'default badge, current nav item'],
  ['ok', 'ok-bg', 'OK badge'], ['warn', 'warn-bg', 'warning badge, rule flags'], ['bad', 'bad-bg', 'error badge'],
  ['on-bad', 'bad', 'danger buttons, error toast'], ['bg', 'ink', 'toast'],
];
// Non-text: the keyboard focus ring must stand out from the page (WCAG 1.4.11).
const FOCUS_PAIRS = [['focus', 'bg'], ['focus', 'panel']];

describe('Colour contrast (WCAG 1.4.3 / 1.4.11)', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    test(`TC-UX-04: ${name} theme text meets 4.5:1 and the focus ring meets 3:1`, () => {
      const failures = [];
      for (const [fg, bg, where] of TEXT_PAIRS) {
        assert.ok(theme[fg] && theme[bg], `token --${fg} / --${bg} defined`);
        const ratio = contrast(theme[fg], theme[bg]);
        if (ratio < 4.5) failures.push(`--${fg} on --${bg} (${where}): ${ratio.toFixed(2)}:1`);
      }
      for (const [fg, bg] of FOCUS_PAIRS) {
        const ratio = contrast(theme[fg], theme[bg]);
        if (ratio < 3) failures.push(`focus ring --${fg} on --${bg}: ${ratio.toFixed(2)}:1`);
      }
      assert.deepEqual(failures, []);
    });
  }
});
