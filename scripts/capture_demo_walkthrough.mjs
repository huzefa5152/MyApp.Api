/**
 * Drive the LOCAL app as the Demo Administrator, screenshot every screen of the
 * demo story, and write a presenter runbook around the shots.
 *
 *   cd myapp-frontend && npm install --no-save playwright && npx playwright install chromium
 *   node scripts/capture_demo_walkthrough.mjs --password "<demo password>"
 *
 * Output (both gitignored -- regenerate rather than commit):
 *   docs/demo/runbook.html
 *   docs/demo/shots/NN-slug.png
 *
 * WHY PLAYWRIGHT AND NOT THE BROWSER PANE
 * ---------------------------------------
 * A demo runbook is only worth having if it can be regenerated after the UI
 * moves. Driving a browser by hand produces screenshots that live in a chat
 * transcript; this produces the same 25 shots on demand, in one command.
 *
 * Playwright is deliberately NOT in myapp-frontend/package.json. Its postinstall
 * downloads browser binaries, and every CI deploy runs an install -- paying that
 * on all four production pipelines to support a local demo tool is the wrong
 * trade. Installed with --no-save, resolved from the frontend's node_modules.
 *
 * WHAT IT ASSUMES
 * ---------------
 * The demo environment exists (scripts/setup_demo_environment.py) and the dev
 * server is up. It signs in through the real login endpoint and then seeds the
 * two things the SPA keeps in localStorage -- the token and the selected company
 * -- so switching company between acts is one navigation rather than a click
 * hunt through a dropdown that may be re-styled tomorrow.
 *
 * It only ever READS. No step creates, edits or deletes anything, so it can be
 * run against a demo environment you are about to present without disturbing it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'demo');
const SHOTS = path.join(OUT, 'shots');

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(require.resolve('playwright', {
    paths: [path.join(ROOT, 'myapp-frontend')],
  })));
} catch {
  console.error(
    'Playwright is not installed. From the repo root:\n' +
    '  cd myapp-frontend && npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

// ── Arguments ─────────────────────────────────────────────────────────────
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = (arg('base', 'http://localhost:5134')).replace(/\/$/, '');
const USER = arg('user', 'demo.admin');
const PASS = arg('password', process.env.DEMO_PASSWORD || '');
if (!PASS) {
  console.error('Pass --password "<demo password>" (or set DEMO_PASSWORD).');
  process.exit(2);
}

// ── The story ─────────────────────────────────────────────────────────────
// Three acts, one per company, because that is also how the product is sold:
// the importer's problem, the everyday trader, and the books that prove it.
// `say` is what the presenter says while the screen is up -- written to be read
// aloud, not to describe the screenshot.
const ACTS = [
  {
    act: 'Act 1 — Nova Industrial Supplies: goods arrive on a customs GD',
    company: 'Nova Industrial Supplies (Pvt.) Ltd.',
    intro:
      'An importer. Everything they sell arrives on a Goods Declaration, and the ' +
      'question that decides their margin is what a consignment actually landed at ' +
      'once duty, sales tax and clearing are in. Today that lives in a spreadsheet ' +
      'nobody else can read.',
    steps: [
      { route: '/dashboard', title: 'The position, at a glance',
        say: 'Sales, purchases, what is owed, and stock — for this company only. ' +
             'Every figure here is derived from documents; nothing is typed twice.' },
      { route: '/imports/costing', title: 'Import Costing — the GD prices itself',
        say: 'This is the screen that replaces the spreadsheet. Upload the GD costing ' +
             'sheet — there is a sample to download right here — and the system reads ' +
             'assessed value, duty, ACD, RD and the rates, and works out the landed cost ' +
             'and the selling value the tax arithmetic demands. The operator reviews; ' +
             'they do not retype.' },
      { route: '/imports/consignments', title: 'The consignment is now a record',
        say: 'The GD is a first-class object: its lines, its landed costs, and what it ' +
             'still owes in clearing. You can trace any stock figure back to the ' +
             'declaration behind it.' },
      { route: '/accounting/spreadsheet-import', title: 'Opening stock, imported and reconciled',
        say: 'Bringing a business onto the system is the moment most implementations die. ' +
             'This reads their own sheet, matched by its headings, and tells them what it ' +
             'is about to do before it does it. On the sample, eight rows become seven ' +
             'items — two bearings share an HS code, so they merge, and it says so rather ' +
             'than quietly losing one.' },
      { route: '/stock', title: 'Stock carries a VALUE, not just a count',
        say: 'Quantity, value excluding tax, the tax rate, the tax, and the inclusive ' +
             'total — on one line. Weighted average, walked in date order. Sell at a ' +
             'margin and the value comes out at cost, not at the sale price, so stock ' +
             'value can never go negative while you still hold goods.' },
      { route: '/item-types', title: 'The item catalogue and the HS tariff',
        say: 'Every product carries its HS code, unit and sale type. The whole Pakistan ' +
             'Customs Tariff is loaded — about 7,800 lines — so classification never ' +
             'depends on FBR being reachable.' },
      { route: '/bills', title: 'A bill priced from stock',
        say: 'On a standalone bill the operator types the AMOUNT and the quantity and ' +
             'rate follow, at what the stock actually cost. That is the number they ' +
             'negotiate in; the system does the arithmetic that makes it a valid line.' },
      { route: '/fbr-sandbox', title: 'FBR Digital Invoicing, proven before it matters',
        say: 'Every scenario FBR assigns to this business activity and sector, run against ' +
             'their sandbox, with FBR’s own verdict per scenario. This is what earns the ' +
             'production token — and we have all eleven passing for a real importer.' },
      { route: '/fbr-monitor', title: 'And what happened to every filing',
        say: 'Submitted, validated, failed, or uncertain — with the IRN. A filing that ' +
             'left the building is never hidden, even if FBR is switched off afterwards.' },
    ],
  },
  {
    act: 'Act 2 — Vertex Engineering: the everyday trading business',
    company: 'Vertex Engineering & Trading (Pvt.) Ltd.',
    intro:
      'A different company, on the same installation. Notice the figures change ' +
      'completely — and that this operator can only reach the companies they have ' +
      'been given.',
    steps: [
      { route: '/dashboard', title: 'A different business entirely',
        say: 'Same screen, different company, different numbers. Tenant separation is ' +
             'enforced on the server, not by hiding menu items — changing the company id ' +
             'in the address bar is refused.' },
      { route: '/Clients', title: 'Customers',
        say: 'Registered and unregistered buyers, with the NTN or CNIC FBR needs. The ' +
             'same legal entity kept under two records can be grouped, so reports read ' +
             'as one customer.' },
      { route: '/Suppliers', title: 'Suppliers' },
      { route: '/purchase-bills', title: 'Purchases in',
        say: 'A purchase bill records the cost and the input tax and puts the goods into ' +
             'stock at what they cost — which is what makes the margin answerable later.' },
      { route: '/goods-receipts', title: 'Goods receipts' },
      { route: '/sales-quotes', title: 'Quote',
        say: 'The sales chain starts here and every step carries forward: quote to order, ' +
             'order to challan, challan to bill. Nothing is re-keyed, and each document ' +
             'knows what it came from.' },
      { route: '/sales-orders', title: 'Order, and what it commits' },
      { route: '/challans', title: 'Delivery challan',
        say: 'Deliveries can run either way round — challan first and bill what went out, ' +
             'or bill first and deliver against it in instalments. Both are real ways ' +
             'businesses work here.' },
      { route: '/invoices', title: 'The tax invoice' },
      { route: '/receipts', title: 'Receipts, spread oldest first',
        say: 'Money usually arrives on account, not against an invoice. One button spreads ' +
             'a receipt across the outstanding invoices oldest first — it proposes the ' +
             'split, the operator can change every line, and the server still applies ' +
             'every guard.' },
      { route: '/customer-ledger', title: 'The customer ledger',
        say: 'Every document and every receipt for a customer, in order, with a running ' +
             'balance that ties to the Chart of Accounts.' },
    ],
  },
  {
    act: 'Act 3 — Prime Wholesale: the books, and the proof',
    company: 'Prime Wholesale Solutions (Pvt.) Ltd.',
    intro:
      'The part that decides whether an accountant trusts the system: does the ' +
      'ledger agree with the screens?',
    steps: [
      { route: '/accounting/dashboard', title: 'Accounting overview',
        say: 'Every document posts a journal entry as it is written. There is no month-end ' +
             'batch to forget.' },
      { route: '/chart-of-accounts', title: 'Chart of accounts',
        say: 'Seeded for a wholesale business, and extendable. Sales tax, further tax and ' +
             'withholding each have their own control account — further tax is inside the ' +
             'invoice total but it is a liability, not revenue, and it posts as one.' },
      { route: '/journal-entries', title: 'Journal entries',
        // Opens filtered to hand-typed journals, and this business has none --
        // every entry it has was posted by a document, which is the point.
        before: [{ uncheck: 'input[type=checkbox]' }],
        say: 'And these are not journals anybody typed. Every one was posted by a ' +
             'document as it was written — the sale, the purchase, the receipt.' },
      { route: '/accounting/reports', title: 'Accounting reports',
        say: 'Trial balance, outstanding receivables and payables, cash book, registers. ' +
             'Each one reads the journal lines — no report grows its own arithmetic, which ' +
             'is why they cross-check against each other.' },
      { route: '/accounting/reports/trial-balance', title: 'Trial balance — the books, actually balanced',
        // Opens on "This Month", and the demo's transactions are spread over the
        // half-year before it, so the default period shows a page of zeros.
        // nth=1, not the first select on the page -- that one is the company
        // picker, and switching THAT mid-capture would be a different bug.
        before: [{ select: 'select >> nth=1', label: 'This Year' },
                 { click: 'button:has-text("Apply")' }],
        say: 'And here is the test an accountant applies in ten seconds. Opening, debit, ' +
             'credit and closing for every account, and it balances — because these ' +
             'entries were posted by the documents you just watched being written, not ' +
             'entered again by hand.' },
      { route: '/reports/sales', title: 'Sales report' },
      { route: '/reports/tax-sheet', title: 'The tax sheet' },
      { route: '/reports/client-ledger', title: 'Client ledger, company-wide' },
      { route: '/templates', title: 'Print templates',
        say: 'Every document prints through a template the client owns — their letterhead, ' +
             'their stamp, their layout. The FBR block and QR drop into the same design.' },
      { route: '/customer-portals', title: 'The customer portal',
        say: 'A customer gets a link, sees their own documents, and downloads them — with ' +
             'no login and no access to anything else. It is the only anonymous surface in ' +
             'the product and it is scoped by a single token.' },
      { route: '/companies', title: 'Companies on this installation',
        say: 'And here is the whole point of the security work: this operator sees three ' +
             'companies. There are eight on this installation. The other five are not ' +
             'hidden from the menu — they are refused by the server.' },
    ],
  },
];

// ── Capture ───────────────────────────────────────────────────────────────
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  for (const f of await fs.readdir(SHOTS).catch(() => [])) {
    if (f.endsWith('.png')) await fs.unlink(path.join(SHOTS, f));
  }

  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!login.ok) {
    console.error(`Login as ${USER} failed (${login.status}). Is the demo environment built?`);
    process.exit(1);
  }
  const { token } = await login.json();

  const companies = await (await fetch(BASE + '/api/companies', {
    headers: { Authorization: 'Bearer ' + token },
  })).json();
  const idOf = (name) => (companies.find((c) => c.name === name) || {}).id;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  // The login screen first, before the token is planted -- a demo that never
  // shows the front door looks like a mockup.
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const shots = [];
  let n = 0;
  const shoot = async (title) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${slug(title)}.png`;
    await page.screenshot({ path: path.join(SHOTS, file) });
    return file;
  };
  const loginShot = await shoot('login');

  await page.addInitScript((t) => localStorage.setItem('token', t), token);

  const captured = [];
  for (const act of ACTS) {
    const cid = idOf(act.company);
    if (!cid) {
      console.error(`  ! ${act.company} not found — run scripts/setup_demo_environment.py first`);
      continue;
    }
    await page.addInitScript((id) => localStorage.setItem('selectedCompanyId', String(id)), cid);
    console.log(`\n${act.act}  (company ${cid})`);
    const steps = [];
    for (const step of act.steps) {
      await page.goto(BASE + step.route, { waitUntil: 'networkidle' }).catch(() => {});
      // networkidle fires before React has painted the answer; the tables on
      // these screens fetch again once the company context resolves.
      await page.waitForTimeout(1600);

      // Some screens open on a filter that hides the demo's own data -- Journal
      // Entries defaults to "manual journals only", and every entry here is
      // system-posted, so it opens empty. `before` is how a step says which
      // control to touch first.
      for (const act2 of step.before || []) {
        try {
          const el = page.locator(act2.click || act2.uncheck || act2.select).first();
          await el.waitFor({ state: 'visible', timeout: 4000 });
          if (act2.uncheck) await el.uncheck();
          else if (act2.select) await el.selectOption({ label: act2.label });
          else await el.click();
          await page.waitForTimeout(1400);
        } catch { console.log(`     ! could not apply ${JSON.stringify(act2)}`); }
      }

      const file = await shoot(step.title);
      // A screenshot of an empty table is worse than no screenshot: it gets
      // presented. Flag it here rather than discovering it on the day.
      const text = (await page.locator('body').innerText().catch(() => '')) || '';
      const empty = /\bNo [a-z][\w ,'-]{0,40}(yet|found)\b|nothing to show|no records|no data/i.exec(text);
      if (empty) console.log(`     ! looks EMPTY: "${empty[0].trim()}"`);
      steps.push({ ...step, file, empty: empty ? empty[0].trim() : null });
      console.log(`  ${step.route.padEnd(32)} -> ${file}`);
    }
    captured.push({ ...act, companyId: cid, steps });
  }

  await browser.close();
  await writeRunbook(loginShot, captured);
  await writeDeck(captured);
  console.log(`\nRunbook: ${path.join(OUT, 'runbook.html')}`);
  console.log(`Deck:    ${path.join(OUT, 'deck.html')}   (open, then print to PDF to send)`);
  console.log(`Shots:   ${SHOTS}  (${n} images)`);
}

// ── Runbook ───────────────────────────────────────────────────────────────
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function writeRunbook(loginShot, acts) {
  const when = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let step = 0;
  const body = acts.map((a) => `
    <section class="act">
      <h2>${esc(a.act)}</h2>
      <p class="intro">${esc(a.intro)}</p>
      <p class="switch"><strong>Switch the company selector to ${esc(a.company)}</strong></p>
      ${a.steps.map((s) => {
        step += 1;
        return `
      <article class="step">
        <div class="copy">
          <div class="n">${step}</div>
          <h3>${esc(s.title)}</h3>
          <code>${esc(s.route)}</code>
          ${s.say ? `<p class="say">${esc(s.say)}</p>` : ''}
        </div>
        <a class="shot" href="shots/${s.file}" target="_blank"><img src="shots/${s.file}" alt="${esc(s.title)}"></a>
      </article>`;
      }).join('')}
    </section>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo runbook — FBR Digital Invoicing ERP</title>
<style>
  :root { --ink:#12212f; --muted:#5b6b7a; --line:#dde5ec; --bg:#f6f8fa; --accent:#1f6feb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 20px 80px; }
  header.top { border-bottom:3px solid var(--ink); padding-bottom:18px; margin-bottom:28px; }
  h1 { margin:0 0 6px; font-size:30px; letter-spacing:-0.02em; }
  .sub { color:var(--muted); margin:0; }
  .cred { margin-top:18px; background:#fff; border:1px solid var(--line); border-radius:10px;
          padding:14px 16px; display:flex; gap:28px; flex-wrap:wrap; font-size:14px; }
  .cred b { display:block; color:var(--muted); font-weight:600; font-size:11px;
            text-transform:uppercase; letter-spacing:.07em; margin-bottom:2px; }
  .act { margin-top:44px; }
  .act h2 { font-size:21px; margin:0 0 8px; padding-bottom:8px; border-bottom:2px solid var(--line); }
  .intro { color:var(--muted); margin:0 0 10px; max-width:74ch; }
  .switch { margin:0 0 22px; font-size:14px; color:var(--accent); }
  .step { display:grid; grid-template-columns: 320px 1fr; gap:22px; align-items:start;
          background:#fff; border:1px solid var(--line); border-radius:12px;
          padding:18px; margin-bottom:18px; }
  .copy .n { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%;
             background:var(--ink); color:#fff; font-size:13px; font-weight:700; margin-bottom:8px; }
  .copy h3 { margin:0 0 4px; font-size:16px; }
  .copy code { font-size:12px; color:var(--muted); background:var(--bg);
               border:1px solid var(--line); border-radius:5px; padding:1px 6px; }
  .say { margin:12px 0 0; font-size:14px; }
  .say::before { content:"Say: "; font-weight:700; color:var(--accent); }
  .shot { display:block; }
  .shot img { width:100%; border:1px solid var(--line); border-radius:8px; display:block; }
  footer { margin-top:50px; padding-top:18px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
  @media (max-width: 860px) { .step { grid-template-columns: 1fr; } }
  @media print { body { background:#fff; } .step { page-break-inside: avoid; } }
</style></head>
<body><div class="wrap">
<header class="top">
  <h1>Demo runbook</h1>
  <p class="sub">FBR Digital Invoicing ERP — a full-feature walkthrough in three acts. Captured ${esc(when)}.</p>
  <div class="cred">
    <div><b>Sign in at</b>${esc(BASE)}</div>
    <div><b>Username</b>${esc(USER)}</div>
    <div><b>Password</b>ask the presenter</div>
    <div><b>Companies</b>${acts.map((a) => esc(a.company.replace(/ \(Pvt\.\) Ltd\.$/, ''))).join(' · ')}</div>
  </div>
</header>

<section class="act">
  <h2>Before you start</h2>
  <p class="intro"><strong>Sign in in a private window</strong>, or clear <code>localStorage</code>
  first. Two things are cached in the browser and both mislead: the company selector keeps its
  list, so a tab last used by an administrator shows this account companies it cannot actually
  open; and the permission set is cached at sign-in, so a tab held open across a demo rebuild
  can answer &ldquo;your role doesn't have permission to view the dashboard&rdquo; when it
  plainly does. Neither is a fault in the product, and neither is something you want to be
  explaining live.</p>
  <article class="step">
    <div class="copy"><div class="n">0</div><h3>The front door</h3><code>/login</code>
      <p class="say">Everything in this demo is one operator account that can reach three
      companies and nothing else on the installation.</p></div>
    <a class="shot" href="shots/${loginShot}" target="_blank"><img src="shots/${loginShot}" alt="Login"></a>
  </article>
</section>
${body}
<footer>
  Regenerate: <code>node scripts/capture_demo_walkthrough.mjs --password "&lt;demo password&gt;"</code>.
  All data shown is fictional — see <code>scripts/setup_demo_environment.py</code>.
</footer>
</div></body></html>`;
  await fs.writeFile(path.join(OUT, 'runbook.html'), html, 'utf8');
}

// -- Pitch deck -----------------------------------------------------------
// The runbook is for the person driving the app; this is for the person who
// was not in the room. Same screenshots, one claim per slide, no click paths.
// Plain HTML so it opens anywhere and prints to a PDF you can send: a deck
// that needs a tool installed to read is a deck nobody reads.
const DECK_OPENING = [
  { kind: 'title', h: 'Digital invoicing, costing and stock',
    sub: 'for Pakistani importers and wholesalers who file with FBR' },
  { kind: 'claim', h: 'Three questions, one system',
    body: [
      'What did this consignment actually cost, once duty and clearing are in?',
      'What is on the shelf, and what is it worth today?',
      'Can we file it with FBR without a consultant?',
    ],
    note: 'Most businesses answer the first two in a spreadsheet and the third by hand. ' +
          'The spreadsheet is where the margin quietly goes, and the filing is where the ' +
          'penalty comes from.' },
];

const DECK_CLOSING = [
  { kind: 'claim', h: 'Built for how the rules actually work',
    body: [
      'FBR rates, SRO schedules and item serials are RESOLVED from FBR, never spelled by us',
      'All 11 importer scenarios validated and submitted against the FBR sandbox',
      'Every tenant is separated on the server, not by hiding menu items',
      'Every report reads the ledger, so the reports cross-check each other',
    ] },
  { kind: 'claim', h: 'What onboarding looks like',
    body: [
      'Send us your stock sheet and your GD costing sheet, in the shapes you already keep',
      'They import against a published template, matched by their own headings',
      'Your chart of accounts is seeded and opening balances post themselves',
      'FBR sandbox scenarios are run and evidenced before you file anything real',
    ] },
];

async function writeDeck(acts) {
  const slides = [...DECK_OPENING];
  for (const a of acts) {
    slides.push({ kind: 'section', h: a.act.replace(/^Act [0-9]+ . /, ''),
                  sub: a.intro, badge: a.act.slice(0, 5) });
    for (const st of a.steps) {
      // A screen with nothing to claim about it is a screenshot, not a slide.
      if (!st.say) continue;
      slides.push({ kind: 'shot', h: st.title, body: st.say, file: st.file });
    }
  }
  slides.push(...DECK_CLOSING);

  const render = (s, i) => {
    const num = `<div class="num">${i + 1} / ${slides.length}</div>`;
    if (s.kind === 'title') return `<section class="slide title">
      <div><h1>${esc(s.h)}</h1><p class="sub">${esc(s.sub)}</p></div>${num}</section>`;
    if (s.kind === 'section') return `<section class="slide section">
      <div><span class="badge">${esc(s.badge)}</span><h2>${esc(s.h)}</h2>
      <p class="sub">${esc(s.sub)}</p></div>${num}</section>`;
    if (s.kind === 'claim') return `<section class="slide claim">
      <div><h2>${esc(s.h)}</h2><ul>${s.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div>${num}</section>`;
    return `<section class="slide shot">
      <div class="head"><h2>${esc(s.h)}</h2><p>${esc(s.body)}</p></div>
      <img src="shots/${s.file}" alt="${esc(s.h)}">${num}</section>`;
  };

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FBR Digital Invoicing ERP - overview</title>
<style>
  :root { --ink:#0d1b2a; --muted:#5b6b7a; --line:#e2e8ef; --accent:#1f6feb; --page:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; background:#eef2f6; color:var(--ink);
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .deck { max-width:1120px; margin:0 auto; padding:28px 16px 60px; }
  .slide { position:relative; background:var(--page); border:1px solid var(--line);
           border-radius:14px; margin-bottom:22px; padding:44px 52px; min-height:520px;
           display:flex; flex-direction:column; justify-content:center; }
  .num { position:absolute; right:20px; bottom:16px; font-size:12px; color:#9aa9b7; }
  h1 { font-size:44px; line-height:1.15; margin:0 0 14px; letter-spacing:-0.03em; }
  h2 { font-size:30px; margin:0 0 14px; letter-spacing:-0.02em; }
  .sub { color:var(--muted); font-size:19px; max-width:62ch; margin:0; }
  .badge { display:inline-block; font-size:12px; font-weight:700; letter-spacing:.1em;
           text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  .claim ul { margin:8px 0 0; padding-left:0; list-style:none; }
  .claim li { font-size:20px; padding:11px 0 11px 30px; border-bottom:1px solid var(--line);
              position:relative; }
  .claim li::before { content:""; position:absolute; left:4px; top:21px; width:9px; height:9px;
                      border-radius:50%; background:var(--accent); }
  .claim li:last-child { border-bottom:0; }
  .note { margin-top:22px; color:var(--muted); font-size:15px; max-width:70ch; }
  .shot { justify-content:flex-start; }
  .shot .head { margin-bottom:16px; }
  .shot .head h2 { font-size:25px; margin-bottom:6px; }
  .shot .head p { margin:0; color:var(--muted); max-width:80ch; }
  .shot img { width:100%; border:1px solid var(--line); border-radius:8px; display:block; }
  @media print {
    body { background:#fff; }
    .deck { max-width:none; padding:0; }
    .slide { border:0; border-radius:0; margin:0; min-height:0; page-break-after:always;
             padding:34px 40px; }
  }
</style></head><body><div class="deck">
${slides.map(render).join('\n')}
</div></body></html>`;
  await fs.writeFile(path.join(OUT, 'deck.html'), html, 'utf8');
}

await main();
