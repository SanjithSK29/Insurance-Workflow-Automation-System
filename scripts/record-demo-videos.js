// Records the Sprint 1 / Sprint 2 outcome videos (docs/videos) from the real
// running app: starts the server with demo data, drives Edge through each flow
// and captions every step with the requirement it shows.
//
// Not part of the test suite. One-off setup (outside package.json):
//   npm install --no-save playwright-core@1.48.2   (uses the installed Microsoft Edge)
//   an ffmpeg executable (e.g. from the imageio-ffmpeg Python package)
// Usage:
//   PACE=2.45 node scripts/record-demo-videos.js . docs/videos sprint1 <ffmpeg>   (about 1 min)
//   PACE=1.78 node scripts/record-demo-videos.js . docs/videos sprint2 <ffmpeg>   (about 2 min)
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [repo, outDir, which, ffmpeg] = process.argv.slice(2);
const { totp } = require(path.join(repo, 'src', 'security', 'auth.js'));
const PORT = which === 'sprint1' ? 3151 : 3152;
const BASE = `http://127.0.0.1:${PORT}`;
const today = new Date().toISOString().slice(0, 10);
// Pauses inside the demo are stretched by PACE so captions can be read.
let pace = 1;
const PACE = Number(process.env.PACE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * pace));

const OVERLAY_CSS = `
  #demo-caption { position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 99999;
    background: rgba(17,24,39,.92); color: #fff; padding: 12px 22px; border-radius: 10px; max-width: 86%;
    font: 600 21px/1.35 "Segoe UI", Arial, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35); text-align: center; }
  #demo-caption small { display: block; font-weight: 400; font-size: 15px; opacity: .85; margin-top: 3px; }
  #demo-card { position: fixed; inset: 0; z-index: 100000; background: #0f172a; color: #fff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; font-family: "Segoe UI", Arial, sans-serif; padding: 40px; }
  #demo-card h1 { font-size: 46px; margin: 0 0 10px; color: #93b4ff; }
  #demo-card h2 { font-size: 28px; margin: 0 0 22px; font-weight: 600; }
  #demo-card p { font-size: 20px; margin: 6px 0; opacity: .9; max-width: 1000px; }
  #toast { bottom: 96px !important; }
  .demo-focus { outline: 4px solid #f59e0b !important; outline-offset: 2px; transition: outline .1s; }
`;

async function startServer() {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: repo, env: { ...process.env, PORT: String(PORT), SEED_DEMO: 'true', IWAS_DB: ':memory:', LOG_LEVEL: 'warn' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/v1/health`)).ok) return srv; } catch { /* starting */ }
    await sleep(250);
  }
  srv.kill();
  throw new Error('server did not start');
}

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // bypassCSP only for this recording browser: the app's CSP blocks the caption overlay's <style>.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'light', bypassCSP: true });
  await context.addInitScript((css) => {
    const add = () => { if (!document.getElementById('demo-style')) { const s = document.createElement('style'); s.id = 'demo-style'; s.textContent = css; document.head.append(s); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }, OVERLAY_CSS);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());

  // ---- screencast capture (real frames from the browser) ----
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* closing */ }
  });

  // ---- helpers ----
  const caption = (title, sub = '') => page.evaluate(([t, s]) => {
    let el = document.getElementById('demo-caption');
    if (!el) { el = document.createElement('div'); el.id = 'demo-caption'; document.body.append(el); }
    el.innerHTML = '';
    el.append(t);
    if (s) { const small = document.createElement('small'); small.textContent = s; el.append(small); }
  }, [title, sub]);
  const card = (h1, h2, lines, ms, keep = false) => page.evaluate(([a, b, ls]) => {
    let el = document.getElementById('demo-card');
    if (!el) { el = document.createElement('div'); el.id = 'demo-card'; document.body.append(el); }
    el.innerHTML = '';
    const H1 = document.createElement('h1'); H1.textContent = a;
    const H2 = document.createElement('h2'); H2.textContent = b;
    el.append(H1, H2, ...ls.map((l) => { const p = document.createElement('p'); p.textContent = l; return p; }));
  }, [h1, h2, lines]).then(() => sleep(ms)).then(() => (keep ? null : page.evaluate(() => document.getElementById('demo-card')?.remove())));
  const focusClick = async (locator, pause = 450) => {
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate((el) => el.classList.add('demo-focus'));
    await sleep(pause);
    await locator.evaluate((el) => el.classList.remove('demo-focus'));
    await locator.click();
  };
  const type = async (locator, text) => { await locator.click(); await locator.fill(''); await locator.pressSequentially(String(text), { delay: 35 }); };
  const nav = (view) => focusClick(page.locator(`#nav button[data-view=${view}]`));
  const settle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => sleep(400));

  async function login(email, mfaSecret) {
    if (await page.locator('#logout').isVisible()) { await focusClick(page.locator('#logout'), 250); await settle(); }
    await focusClick(page.getByRole('button', { name: new RegExp(email.replace('.', '\\.')) }), 300);
    await focusClick(page.getByRole('button', { name: 'Log in' }), 300);
    if (mfaSecret) {
      const otp = page.locator('input[name=otp]');
      await otp.waitFor({ state: 'visible' });
      await type(otp, totp(mfaSecret));
      await focusClick(page.getByRole('button', { name: 'Log in' }), 250);
    }
    await page.locator('#nav button').first().waitFor();
    await settle();
  }

  await page.goto(BASE);
  await page.locator('input[name=email]').first().waitFor();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const t0 = Date.now();
  pace = PACE;

  if (which === 'sprint1') await sprint1(); else await sprint2();

  pace = 1;
  await sleep(300);
  await cdp.send('Page.stopScreencast');
  const tEnd = frames.length ? frames[frames.length - 1].t + 2.5 : 0;
  await browser.close();
  srv.kill();
  console.log(`captured ${frames.length} frames over ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  encode(tEnd);

  // ---------------------------------------------------------------- scripts
  async function sprint1() {
    await card('IWAS: Sprint 1 outcome', 'Buy a policy end to end, then file a claim', [
      'Sprint 1 scope (19–23 Oct 2026): quote, KYC, underwriting, payment, signed policy, claim registration',
      `Recorded ${today} from the running application (npm start, demo data)`,
    ], 3200);

    await caption('A customer signs in', 'Role-based web UI (customer@iwas.test)');
    await login('customer@iwas.test');
    await sleep(900);

    await caption('Get a personalised quote', 'IWA-F-001: premium from age, income, cover, term (incl. 18 % GST)');
    await nav('quote'); await settle();
    await page.locator('select[name=coverageType]').selectOption('health');
    await type(page.locator('input[name=sumInsured]'), 500000);
    await focusClick(page.getByRole('button', { name: 'Calculate premium' }));
    await settle(); await sleep(1800);

    await caption('Apply: KYC check and automated risk scoring', 'IWA-F-002, F-003: low risk is approved automatically');
    await page.locator('input[name=occupation]').scrollIntoViewIfNeeded();
    await type(page.locator('input[name=occupation]'), 'School teacher');
    await focusClick(page.getByRole('button', { name: 'Submit application' }));
    await settle(); await sleep(1500);

    await caption('Pay the premium with a sandbox card token', 'IWA-F-010: payment issues the policy (no card data reaches IWAS)');
    await focusClick(page.getByRole('button', { name: /^Pay / }).first());
    await settle(); await sleep(1600);

    await caption('Signed policy document and GST invoice', 'IWA-F-010, F-013, SR-005: Ed25519 signature verified');
    await focusClick(page.getByRole('button', { name: 'Manage' }).first());
    await settle(); await sleep(700);
    await focusClick(page.getByRole('button', { name: 'Verify signature' }).first());
    await sleep(2000);

    await caption('File a claim with a supporting document', 'IWA-F-020: PDF/JPG/PNG up to 10 MB, checked on upload');
    await nav('claims'); await settle();
    await type(page.locator('input[name=amount]'), 25000);
    await page.locator('input[name=incidentDate]').fill(today);
    await type(page.locator('textarea[name=description]'), 'Day-care treatment after a sports injury');
    await page.locator('input[type=file]').setInputFiles({ name: 'hospital-bill.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% demo bill\n%%EOF\n') });
    await focusClick(page.getByRole('button', { name: 'Submit claim' }));
    await settle(); await sleep(1200);
    await page.locator('main section.card').nth(1).scrollIntoViewIfNeeded();
    await caption('Claim registered and routed for review', 'Progress tracker: registered → under review → approved → settled');
    await sleep(2600);

    await card('Sprint 1: working product', 'Quote → KYC → underwriting → payment → signed policy → claim', [
      'All Sprint 1 flows run on the real application with automated tests in CI',
    ], 2600, true);
  }

  async function sprint2() {
    await card('IWAS: Sprint 2 outcome', 'Claim approval, settlement, underwriting review and administration', [
      'Sprint 2 scope (26–30 Oct 2026): BPMN multi-level approval, fraud checks, settlement, notifications, MFA, dashboards, workflow designer, audit',
      `Recorded ${today} from the running application (npm start, demo data)`,
    ], 3600);

    // Customer files a high-value claim that needs two approval levels.
    await caption('Customer files a high-value claim (₹1,50,000)', 'IWA-F-020: above ₹1,00,000 the BPMN workflow adds a senior approval');
    await login('customer@iwas.test');
    await nav('claims'); await settle();
    await page.locator('select#claimType').selectOption('accident');
    await type(page.locator('input[name=amount]'), 150000);
    const start = await page.evaluate(async () => {
      const r = await fetch('/api/v1/policies', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('iwas.token') } });
      return (await r.json())[0].startDate;
    });
    await page.locator('input[name=incidentDate]').fill(start);
    await type(page.locator('textarea[name=description]'), 'Road accident, two nights in hospital');
    await page.locator('input[type=file]').setInputFiles({ name: 'discharge.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% discharge\n%%EOF\n') });
    await focusClick(page.getByRole('button', { name: 'Submit claim' }));
    await settle(); await sleep(1400);

    await caption('Claims adjuster reviews the task queue', 'IWA-F-021, F-022: fraud indicators, documents, approved amount');
    await login('adjuster@iwas.test');
    await nav('tasks'); await settle();
    await sleep(1600);
    await page.locator('main section.card').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await sleep(1200);
    await caption('Adjuster approves the high-value claim', 'Next BPMN step: senior claims approval by an admin');
    const highCard = page.locator('main section.card', { hasText: '1,50,000' }).first();
    await focusClick(highCard.getByRole('button', { name: 'Approve' }));
    await settle(); await sleep(1300);
    await caption('Adjuster approves the smaller claim', 'Below ₹1,00,000 the adjuster\'s approval completes the workflow');
    await focusClick(page.getByRole('button', { name: 'Approve' }).first());
    await settle(); await sleep(1300);

    await caption('Admin signs in with MFA and gives senior approval', 'IWA-SR-002: TOTP one-time code · IWA-F-021: multi-level approval');
    await login('admin@iwas.test', 'JBSWY3DPEHPK3PXP');
    await nav('dashboard'); await settle();
    await sleep(1600);
    await caption('Live dashboard: SLA, backlog, premiums, renewals', 'IWA-F-032');
    await sleep(2000);
    await nav('tasks'); await settle(); await sleep(900);
    await focusClick(page.getByRole('button', { name: 'Approve' }).first());
    await settle(); await sleep(1300);

    await caption('Settlement per policy terms, paid out with a signed letter', 'IWA-F-023: deductible, co-pay and remaining cover · SR-005');
    await login('adjuster@iwas.test');
    await nav('settle'); await settle(); await sleep(1500);
    await focusClick(page.getByRole('button', { name: 'Settle & pay' }).first());
    await settle(); await sleep(1500);

    await caption('The claimant is notified at every status change', 'IWA-F-024: registered, under review, approved, settled');
    await login('customer@iwas.test');
    await nav('notifications'); await settle(); await sleep(2400);
    await nav('claims'); await settle();
    await page.locator('main section.card').nth(1).scrollIntoViewIfNeeded();
    await sleep(2000);

    await caption('Underwriter (MFA) reviews a high-risk application', 'IWA-F-002: risk score and the rules that fired');
    await login('underwriter@iwas.test', 'KRSXG5CTMVRXEZLU');
    await nav('review'); await settle();
    await sleep(2400);
    await focusClick(page.getByRole('button', { name: 'Approve' }).first());
    await settle(); await sleep(1300);

    await caption('Admin: BPMN workflow designer, validate before deploy', 'IWA-F-030');
    await login('admin@iwas.test', 'JBSWY3DPEHPK3PXP');
    await nav('workflows'); await settle(); await sleep(1000);
    await focusClick(page.getByRole('button', { name: 'Validate' }));
    await sleep(2200);

    await caption('Tamper-evident audit log: verify the hash chain', 'IWA-F-034, NF-004');
    await nav('audit'); await settle(); await sleep(700);
    await focusClick(page.getByRole('button', { name: 'Verify chain' }));
    await sleep(2200);

    await caption('Reports export as CSV or PDF', 'IWA-F-033');
    await nav('reports'); await settle(); await sleep(1600);

    await card('Sprint 2: working product', 'Fraud checks → multi-level BPMN approval → settlement → notifications', [
      'Plus MFA, underwriting review, dashboards, workflow designer, audit log and reports',
      '170 automated tests pass in CI on the same code',
    ], 3000, true);
  }

  // ---------------------------------------------------------------- encode
  function encode(endT) {
    const work = path.join(outDir, `.${which}-frames`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const lines = [];
    frames.forEach((f, i) => {
      const file = path.join(work, `f${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      const next = i + 1 < frames.length ? frames[i + 1].t : endT;
      lines.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    lines.push(`file '${path.join(work, `f${String(frames.length - 1).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`);
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, lines.join('\n'));
    const out = path.join(outDir, `${which}.mp4`);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', out]);
    fs.rmSync(work, { recursive: true, force: true });
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
