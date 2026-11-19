// Builds the IEEE-format design documents (SRS, SAD, Test Plan v2.0).
//
//   node scripts/build-docs.js          -> docs/ieee/*.html
//   node scripts/build-docs.js --pdf    -> also docs/ieee/*.pdf (needs Edge or Chrome)
//
// Sources are docs/ieee/src/*.html. A placeholder such as <!--DIAGRAM:usecase-customer-->
// is replaced by an inline SVG generated below, so diagrams stay editable as data.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'ieee', 'src');
const OUT = path.join(ROOT, 'docs', 'ieee');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- use-case diagrams
function stickFigure(x, y, label) {
  return `<g class="actor"><circle cx="${x}" cy="${y}" r="9"/><line x1="${x}" y1="${y + 9}" x2="${x}" y2="${y + 34}"/>`
    + `<line x1="${x - 14}" y1="${y + 18}" x2="${x + 14}" y2="${y + 18}"/><line x1="${x}" y1="${y + 34}" x2="${x - 11}" y2="${y + 52}"/>`
    + `<line x1="${x}" y1="${y + 34}" x2="${x + 11}" y2="${y + 52}"/><text x="${x}" y="${y + 68}" text-anchor="middle">${esc(label)}</text></g>`;
}

// spec: { title, width, actorsLeft:[{id,label}], actorsRight:[...], cases:[{id,label}], links:[[actorId, caseId]] }
function useCase(spec) {
  const rowH = 46;
  const height = Math.max(spec.cases.length * rowH + 70, 100 * Math.max(spec.actorsLeft.length, spec.actorsRight.length) + 40);
  const boxX = 170;
  const boxW = spec.width - 340;
  const cx = boxX + boxW / 2;
  const pos = {};
  spec.cases.forEach((c, i) => { pos[c.id] = { x: cx, y: 60 + i * rowH }; });
  const place = (actors, x) => {
    const gap = (height - 40) / actors.length;
    actors.forEach((a, i) => { pos[a.id] = { x, y: 20 + gap * i + gap / 2 - 34, actor: true }; });
  };
  place(spec.actorsLeft, 70);
  place(spec.actorsRight, spec.width - 70);
  const lines = spec.links.map(([a, c]) => {
    const A = pos[a];
    const C = pos[c];
    const ax = A.x < cx ? A.x + 16 : A.x - 16;
    const caseEdge = A.x < cx ? C.x - 120 : C.x + 120;
    return `<line class="assoc" x1="${ax}" y1="${A.y + 18}" x2="${caseEdge}" y2="${C.y}"/>`;
  }).join('');
  const cases = spec.cases.map((c) => `<g class="usecase"><ellipse cx="${pos[c.id].x}" cy="${pos[c.id].y}" rx="120" ry="18"/>`
    + `<text x="${pos[c.id].x}" y="${pos[c.id].y + 4}" text-anchor="middle">${esc(c.label)}</text></g>`).join('');
  const actors = [...spec.actorsLeft, ...spec.actorsRight].map((a) => stickFigure(pos[a.id].x, pos[a.id].y, a.label)).join('');
  return `<figure><svg class="uml" viewBox="0 0 ${spec.width} ${height}" role="img" aria-label="${esc(spec.title)}">`
    + `<rect class="boundary" x="${boxX}" y="20" width="${boxW}" height="${height - 30}" rx="6"/>`
    + `<text class="boundary-label" x="${boxX + 10}" y="38">IWAS</text>${lines}${cases}${actors}</svg>`
    + `<figcaption>${esc(spec.title)}</figcaption></figure>`;
}

// ---------------------------------------------------------------- sequence diagrams
// spec: { title, participants:[label], messages:[[from, to, text, kind?]] } kind: 'reply' | 'self'
function sequence(spec) {
  const colW = 118;
  const width = spec.participants.length * colW + 20;
  const top = 50;
  const stepH = 30;
  const height = top + spec.messages.length * stepH + 50;
  const x = (i) => 10 + colW * i + colW / 2;
  const idx = (name) => {
    const i = spec.participants.indexOf(name);
    if (i < 0) throw new Error(`unknown participant ${name} in ${spec.title}`);
    return i;
  };
  const heads = spec.participants.map((p, i) => `<rect class="lifeline-head" x="${x(i) - 54}" y="8" width="108" height="30" rx="4"/>`
    + `<text x="${x(i)}" y="27" text-anchor="middle" class="small">${esc(p)}</text>`
    + `<line class="lifeline" x1="${x(i)}" y1="38" x2="${x(i)}" y2="${height - 10}"/>`).join('');
  const msgs = spec.messages.map(([from, to, text, kind], n) => {
    const y = top + n * stepH + 14;
    const a = x(idx(from));
    const b = x(idx(to));
    if (kind === 'self' || a === b) {
      return `<path class="msg" d="M${a} ${y - 6} h26 v12 h-24" marker-end="url(#arrow)"/><text x="${a + 30}" y="${y - 2}" class="small">${esc(text)}</text>`;
    }
    const mid = (a + b) / 2;
    return `<line class="msg${kind === 'reply' ? ' reply' : ''}" x1="${a}" y1="${y}" x2="${b + (b > a ? -3 : 3)}" y2="${y}" marker-end="url(#arrow)"/>`
      + `<text x="${mid}" y="${y - 5}" text-anchor="middle" class="small">${esc(text)}</text>`;
  }).join('');
  return `<figure><svg class="uml" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(spec.title)}">`
    + '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>'
    + `${heads}${msgs}</svg><figcaption>${esc(spec.title)}</figcaption></figure>`;
}

// ---------------------------------------------------------------- component diagram
function components() {
  const box = (x, y, w, h, title, sub, cls = '') => `<g class="comp ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>`
    + `<text x="${x + w / 2}" y="${y + (sub ? 20 : h / 2 + 4)}" text-anchor="middle" class="bold">${esc(title)}</text>`
    + (sub ? `<text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" class="small">${esc(sub)}</text>` : '') + '</g>';
  const layer = (y, h, label) => `<rect class="layer" x="10" y="${y}" width="880" height="${h}" rx="8"/><text class="layer-label" x="22" y="${y + 18}">${esc(label)}</text>`;
  const arrow = (x1, y1, x2, y2) => `<line class="dep" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#carrow)"/>`;
  const mods = [
    ['Quote Service', 'quotes.js'], ['Underwriting', 'underwriting.js'], ['Customers & KYC', 'customers.js'], ['Policy Service', 'policies.js'],
    ['Payment Service', 'payments.js'], ['Document Service', 'documents.js, pdf.js'], ['Claims Service', 'claims.js, fraud.js'], ['Workflow Engine', 'workflow/*.js (BPMN)'],
    ['Notifications', 'notifications.js'], ['Admin & Reports', 'admin.js'], ['Users & Auth', 'users.js'], ['Settlement', 'settlement.js'],
  ];
  const modBoxes = mods.map(([t, s], i) => box(30 + (i % 4) * 215, 230 + Math.floor(i / 4) * 54, 200, 46, t, s)).join('');
  return '<figure><svg class="uml" viewBox="0 0 900 640" role="img" aria-label="Component diagram">'
    + '<defs><marker id="carrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>'
    + layer(10, 70, 'Client layer') + box(300, 30, 300, 42, 'Web UI (public/app.js)', 'role-based single-page app, EN/HI')
    + layer(100, 90, 'API gateway layer (src/app.js, src/security/*)')
    + box(30, 126, 830, 50, 'Express gateway: routing · JWT auth · RBAC · rate limits · trace ids · security headers', 'audit log (hash-chained) · PII masking · AES-256-GCM')
    + layer(205, 190, 'Service modules (one bounded context each; call through ctx.services)') + modBoxes
    + layer(410, 90, 'Messaging') + box(30, 438, 830, 46, 'In-process event bus (Kafka stand-in): workflow.task.created, workflow.completed, policy.issued, claim.status_changed …', '')
    + layer(515, 115, 'Data layer and external adapters')
    + box(30, 545, 250, 70, 'SQLite (node:sqlite)', 'schema per bounded context')
    + box(300, 545, 270, 70, 'Sandbox adapters', 'KYC · payment gateway · email · SMS')
    + box(590, 545, 270, 70, 'Document store', 'signed PDFs, claim evidence')
    + arrow(450, 72, 450, 124) + arrow(450, 176, 450, 228) + arrow(450, 392, 450, 436) + arrow(250, 486, 250, 543) + arrow(435, 486, 435, 543) + arrow(725, 486, 725, 543)
    + '</svg><figcaption>Figure: Component diagram (as built)</figcaption></figure>';
}

// ---------------------------------------------------------------- diagram registry
const DIAGRAMS = {
  'usecase-customer': () => useCase({
    title: 'Figure: Use cases for customers, agents, underwriters and claims adjusters',
    width: 900,
    actorsLeft: [{ id: 'cust', label: 'Customer' }, { id: 'agent', label: 'Agent / Broker' }],
    actorsRight: [{ id: 'uw', label: 'Underwriter' }, { id: 'adj', label: 'Claims Adjuster' }],
    cases: [
      { id: 'quote', label: 'Get quote' }, { id: 'buy', label: 'Apply and pay for a policy' }, { id: 'kyc', label: 'Verify KYC' },
      { id: 'manage', label: 'Renew / endorse / cancel / reinstate' }, { id: 'doc', label: 'Download signed documents' },
      { id: 'claim', label: 'File claim with documents' }, { id: 'track', label: 'Track claim status' }, { id: 'onboard', label: 'Onboard customers (bulk)' },
      { id: 'review', label: 'Review application / manual KYC' }, { id: 'approve', label: 'Review and approve claim' }, { id: 'settle', label: 'Settle claim' },
      { id: 'export', label: 'Export claims register' },
    ],
    links: [['cust', 'quote'], ['cust', 'buy'], ['cust', 'manage'], ['cust', 'doc'], ['cust', 'claim'], ['cust', 'track'],
      ['agent', 'quote'], ['agent', 'buy'], ['agent', 'kyc'], ['agent', 'onboard'], ['agent', 'claim'],
      ['uw', 'review'], ['uw', 'kyc'], ['adj', 'approve'], ['adj', 'settle'], ['adj', 'export']],
  }),
  'usecase-admin': () => useCase({
    title: 'Figure: Use cases for administrators and external systems',
    width: 900,
    actorsLeft: [{ id: 'admin', label: 'Admin / Ops' }],
    actorsRight: [{ id: 'kycp', label: 'KYC Provider' }, { id: 'pay', label: 'Payment Gateway' }, { id: 'notify', label: 'Email / SMS' }],
    cases: [
      { id: 'wf', label: 'Design and deploy BPMN workflow' }, { id: 'users', label: 'Manage users and roles' }, { id: 'dash', label: 'View dashboards (SLA, backlog)' },
      { id: 'reports', label: 'Export reports (CSV / PDF)' }, { id: 'audit', label: 'View and verify audit log' }, { id: 'senior', label: 'Senior claim approval' },
      { id: 'kyc', label: 'Verify KYC' }, { id: 'premium', label: 'Collect premium / pay out / refund' }, { id: 'send', label: 'Send notifications' },
    ],
    links: [['admin', 'wf'], ['admin', 'users'], ['admin', 'dash'], ['admin', 'reports'], ['admin', 'audit'], ['admin', 'senior'],
      ['kycp', 'kyc'], ['pay', 'premium'], ['notify', 'send']],
  }),
  components,
  'seq-policy': () => sequence({
    title: 'Figure: Sequence diagram — policy purchase (as built)',
    participants: ['Customer (Web UI)', 'API Gateway', 'Quote Service', 'Underwriting', 'KYC Adapter', 'Payment Service', 'Policy Service', 'Document Service'],
    messages: [
      ['Customer (Web UI)', 'API Gateway', 'POST /quote'], ['API Gateway', 'Quote Service', 'createQuote()'], ['Quote Service', 'Customer (Web UI)', 'premium + breakdown', 'reply'],
      ['Customer (Web UI)', 'API Gateway', 'POST /applications'], ['API Gateway', 'Underwriting', 'apply()'], ['Underwriting', 'KYC Adapter', 'verify (breaker+retry)'],
      ['KYC Adapter', 'Underwriting', 'VERIFIED', 'reply'], ['Underwriting', 'Underwriting', 'risk score 0-100', 'self'], ['Underwriting', 'Customer (Web UI)', 'APPROVED / MANUAL_REVIEW', 'reply'],
      ['Customer (Web UI)', 'API Gateway', 'POST /payments (token)'], ['API Gateway', 'Payment Service', 'charge (payment lock)'], ['Payment Service', 'Policy Service', 'issue()'],
      ['Policy Service', 'Document Service', 'signed policy PDF'], ['Payment Service', 'Document Service', 'GST invoice PDF'], ['Payment Service', 'Customer (Web UI)', '201 policy + invoice', 'reply'],
    ],
  }),
  'seq-claim': () => sequence({
    title: 'Figure: Sequence diagram — claim processing (as built)',
    participants: ['Customer (Web UI)', 'API Gateway', 'Claims Service', 'Fraud Rules', 'Workflow Engine', 'Claims Adjuster', 'Payment Service', 'Notifications'],
    messages: [
      ['Customer (Web UI)', 'API Gateway', 'POST /claims + documents'], ['API Gateway', 'Claims Service', 'register()'], ['Claims Service', 'Fraud Rules', 'detectFraud()'],
      ['Fraud Rules', 'Claims Service', 'score, flags', 'reply'], ['Claims Service', 'Workflow Engine', 'start(claim-approval)'], ['Claims Service', 'Notifications', 'CLAIM_REGISTERED'],
      ['Claims Service', 'Customer (Web UI)', '201 claimId, eta', 'reply'], ['Workflow Engine', 'Claims Adjuster', 'task: review (or fraud check)'],
      ['Claims Adjuster', 'API Gateway', 'POST /claims/:id/decision'], ['API Gateway', 'Workflow Engine', 'completeTask()'], ['Workflow Engine', 'Claims Service', 'workflow.completed'],
      ['Claims Service', 'Claims Service', 'computeSettlement()', 'self'], ['Claims Adjuster', 'API Gateway', 'POST /claims/:id/settle'], ['API Gateway', 'Payment Service', 'payout()'],
      ['Claims Service', 'Notifications', 'CLAIM_SETTLED + signed letter'],
    ],
  }),
};

// ---------------------------------------------------------------- build
function build() {
  const css = fs.readFileSync(path.join(SRC, 'ieee.css'), 'utf8');
  const docs = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
  const outputs = [];
  for (const file of docs) {
    let html = fs.readFileSync(path.join(SRC, file), 'utf8');
    html = html.replace('<!--STYLE-->', `<style>${css}</style>`);
    html = html.replace(/<!--DIAGRAM:([\w-]+)-->/g, (m, name) => {
      if (!DIAGRAMS[name]) throw new Error(`${file}: unknown diagram ${name}`);
      return DIAGRAMS[name]();
    });
    const leftover = html.match(/<!--[A-Z]+:/);
    if (leftover) throw new Error(`${file}: unreplaced placeholder near ${leftover[0]}`);
    const out = path.join(OUT, file);
    fs.writeFileSync(out, html);
    outputs.push(out);
    console.log('built', path.relative(ROOT, out));
  }
  if (process.argv.includes('--pdf')) {
    const browsers = [
      process.env.BROWSER_PATH,
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/usr/bin/chromium', '/usr/bin/google-chrome',
    ].filter(Boolean);
    const browser = browsers.find((b) => fs.existsSync(b));
    if (!browser) throw new Error('No Edge/Chrome found; set BROWSER_PATH');
    for (const out of outputs) {
      const pdf = out.replace(/\.html$/, '.pdf');
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file:///${out.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 120000 });
      console.log('pdf  ', path.relative(ROOT, pdf), `${fs.statSync(pdf).size} bytes`);
    }
  }
}

build();
