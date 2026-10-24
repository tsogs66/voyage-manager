/*
 * Sludge book-against-tank, and the BDN / sample retention clock.
 *
 * Both exist to catch something before an inspector does, so the tests are the
 * findings:
 *
 *   - more booked as disposed than the tank ever held  -> flagged impossible
 *   - a voided ORB line                                -> not counted as a disposal
 *   - a BDN past three years, a sample past twelve months -> expired
 *   - a receipt with no BDN number                     -> named, not ignored
 *
 * Run: node tests/test_sludge_bdn.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}
function near(label, actual, expected, tol) {
  checks += 1;
  const ok = actual != null && Math.abs(actual - expected) <= (tol == null ? 1e-9 : tol);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ~${expected}, got ${actual}`);
  if (!ok) fails += 1;
}

function extract(name) {
  let start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const asyncAt = HTML.lastIndexOf('async ', start);
  if (asyncAt >= 0 && asyncAt + 'async '.length === start) start = asyncAt;
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

/* Pull the constants straight from the source so a changed threshold is caught. */
function constant(name) {
  const m = HTML.match(new RegExp('const ' + name + ' = ([0-9.]+);'));
  if (!m) throw new Error(name + ' not found');
  return Number(m[1]);
}

const sandbox = {
  console, Math, Number, Object, Array, String, JSON, Date, isFinite,
  ORB_SLUDGE_ROUTES: { '12.1': 'ashore', '12.2': 'transferred', '12.3': 'incinerated', '12.4': 'other' },
  BDN_KEEP_YEARS: constant('BDN_KEEP_YEARS'),
  BDN_SAMPLE_KEEP_MONTHS: constant('BDN_SAMPLE_KEEP_MONTHS'),
  BDN_WARN_DAYS: constant('BDN_WARN_DAYS'),
  state: { orbEntries: [], receipts: [] }
};
vm.createContext(sandbox);
vm.runInContext([
  extract('numOrNull'),
  extract('sludgeDisposalsBetween'),
  extract('sludgeRobAtEntry'),
  extract('reconcileSludge'),
  extract('addYearsIso'),
  extract('addMonthsIso'),
  extract('bdnRetentionList')
].join('\n'), sandbox);

const { sludgeDisposalsBetween, reconcileSludge, bdnRetentionList, addYearsIso, addMonthsIso } = sandbox;

/* ---------------------------------------------------------------- sludge ---- */

sandbox.state.orbEntries = [
  { id: 'o1', code: 'C', itemNo: '12.3', date: '2026-03-02', values: { qtyDisposed: 1.5 } },   /* incinerated */
  { id: 'o2', code: 'C', itemNo: '12.1', date: '2026-03-04', values: { qtyDisposed: 4.0 } },   /* ashore */
  { id: 'o3', code: 'C', itemNo: '12.2', date: '2026-03-05', values: { qtyDisposed: 0.5 } },   /* transferred */
  { id: 'o4', code: 'C', itemNo: '11.3', date: '2026-03-05', values: { retention: 9 } },       /* a retention line, not a disposal */
  { id: 'o5', code: 'D', itemNo: '14',   date: '2026-03-05', values: { qtyDisposed: 7 } },     /* bilge, not sludge */
  { id: 'o6', code: 'C', itemNo: '12.3', date: '2026-03-06', values: { qtyDisposed: 2.0 },
    voided: true, voidReason: 'entered twice' },                                              /* struck through */
  { id: 'o7', code: 'C', itemNo: '12.3', date: '2026-04-01', values: { qtyDisposed: 3.0 } }    /* after the window */
];

const d = sludgeDisposalsBetween('2026-03-01T12:00:00Z', '2026-03-10T12:00:00Z');
near('incinerated is taken from item 12.3', d.incinerated, 1.5);
near('ashore from item 12.1', d.ashore, 4.0);
near('transferred from item 12.2', d.transferred, 0.5);
check('a retention line is not a disposal', d.entries.some(e => e.itemNo === '11.3'), false);
check('a bilge line under code D is not sludge', d.entries.some(e => e.id === 'o5'), false);
check('a voided line is not counted', d.entries.some(e => e.id === 'o6'), false);
check('and nothing outside the window is', d.entries.some(e => e.id === 'o7'), false);
check('four routes are tracked', Object.keys(sandbox.ORB_SLUDGE_ROUTES).length, 4);

/* A consistent book: 10 opening, 6 booked out, 8 closing -> 4 generated. */
const okCase = reconcileSludge(
  { datetime: '2026-03-01T12:00:00Z', sludgeRob: 10 },
  { datetime: '2026-03-10T12:00:00Z', sludgeRob: 8 });
check('it reconciles', okCase.ok, true);
near('removed is the sum of every route', okCase.removed, 6.0);
near('generation is derived as the residual', okCase.generated, 4.0);
check('and a consistent book is not flagged', okCase.impossible, false);

/* More leaving the tank than its net fall is ORDINARY: sludge is being made the
   whole time. 2 opening, 6 booked out, 1.5 closing means 5.5 was generated. */
const busyCase = reconcileSludge(
  { datetime: '2026-03-01T12:00:00Z', sludgeRob: 2 },
  { datetime: '2026-03-10T12:00:00Z', sludgeRob: 1.5 });
near('disposing of more than the net fall is normal', busyCase.generated, 5.5);
check('and is not flagged', busyCase.impossible, false);

/* THE finding, which is the other way round: the tank fell by 9.5 while only
   6 is booked out, so 3.5 left it that nothing accounts for -- an unrecorded
   disposal, or a wrong sounding. Sludge cannot be un-generated. */
const badCase = reconcileSludge(
  { datetime: '2026-03-01T12:00:00Z', sludgeRob: 12 },
  { datetime: '2026-03-10T12:00:00Z', sludgeRob: 2.5 });
near('a tank that fell by more than was booked gives negative generation',
  badCase.generated, -3.5);
check('which is flagged as impossible', badCase.impossible, true);

/* Just-about-zero generation is rounding, not a finding. */
const edge = reconcileSludge(
  { datetime: '2026-03-01T12:00:00Z', sludgeRob: 6.0 },
  { datetime: '2026-03-10T12:00:00Z', sludgeRob: 0.0 });
near('a book that exactly balances gives zero generation', edge.generated, 0);
check('and is not flagged', edge.impossible, false);

/* Missing soundings: no claim either way. */
const noOpen = reconcileSludge({ datetime: '2026-03-01T12:00:00Z' }, { datetime: '2026-03-10T12:00:00Z', sludgeRob: 8 });
check('no opening sounding means no reconciliation', noOpen.ok, false);
check('and says which end is missing', /start of this stretch/.test(noOpen.reason), true);
check('but the booked disposals are still reported', noOpen.removed, 6);

const noClose = reconcileSludge({ datetime: '2026-03-01T12:00:00Z', sludgeRob: 10 }, { datetime: '2026-03-10T12:00:00Z' });
check('no closing sounding likewise', { ok: noClose.ok, end: /end of this stretch/.test(noClose.reason) },
  { ok: false, end: true });

/* A sounding of zero is a reading, not a missing value. */
const zeroOpen = reconcileSludge(
  { datetime: '2026-03-01T12:00:00Z', sludgeRob: 0 },
  { datetime: '2026-03-10T12:00:00Z', sludgeRob: 2 });
check('an empty tank is a real sounding', zeroOpen.ok, true);
near('and generation accounts for it', zeroOpen.generated, 8.0);

/* The sounding may sit under report.sludgeRob on older entries. */
check('an older entry shape is read too',
  reconcileSludge(
    { datetime: '2026-03-01T12:00:00Z', report: { sludgeRob: 10 } },
    { datetime: '2026-03-10T12:00:00Z', report: { sludgeRob: 8 } }).ok, true);

/* ------------------------------------------------------------------- BDN ---- */

const day = (offsetDays) => {
  const d2 = new Date(Date.now() + offsetDays * 86400000);
  return d2.toISOString().slice(0, 10);
};

check('three years is the BDN period', sandbox.BDN_KEEP_YEARS, 3);
check('twelve months is the sample period', sandbox.BDN_SAMPLE_KEEP_MONTHS, 12);
check('the retention date is three years on',
  addYearsIso('2026-03-01T00:00:00Z', 3), '2029-03-01');
check('and the sample date twelve months on',
  addMonthsIso('2026-03-01T00:00:00Z', 12), '2027-03-01');

sandbox.state.receipts = [
  /* delivered today: both clocks running */
  { id: 'r1', category: 'fuel', type: 'LSFO', qty: 500, date: day(0), bdnNo: 'BDN-1', location: 'Singapore' },
  /* 13 months ago: sample expired, BDN still live */
  { id: 'r2', category: 'fuel', type: 'LSFO', qty: 400, date: day(-400), bdnNo: 'BDN-2', location: 'Rotterdam' },
  /* over three years ago: both expired */
  { id: 'r3', category: 'fuel', type: 'HFO', qty: 300, date: day(-1200), bdnNo: 'BDN-3', location: 'Fujairah' },
  /* 11 months ago: sample expiring soon */
  { id: 'r4', category: 'fuel', type: 'LSMGO', qty: 80, date: day(-340), bdnNo: 'BDN-4', location: 'Gibraltar' },
  /* no BDN number recorded */
  { id: 'r5', category: 'fuel', type: 'LSFO', qty: 200, date: day(-10), bdnNo: '', location: 'Busan' },
  /* not fuel oil: no Annex VI retention */
  { id: 'r6', category: 'lube', type: 'CYL', qty: 2000, date: day(-1200), bdnNo: 'L-1' },
  { id: 'r7', category: 'fw', type: 'FRESH WATER', qty: 15000, date: day(-1200) }
];

const list = bdnRetentionList();
check('only fuel deliveries are listed', list.length, 5);
check('lube is excluded', list.some(r => r.id === 'r6'), false);
check('fresh water too', list.some(r => r.id === 'r7'), false);

const by = (id) => list.find(r => r.id === id);
check('a delivery today is inside both periods',
  { bdn: by('r1').bdnState, sample: by('r1').sampleState }, { bdn: 'ok', sample: 'ok' });
check('at 13 months the sample has expired but the BDN has not',
  { bdn: by('r2').bdnState, sample: by('r2').sampleState }, { bdn: 'ok', sample: 'expired' });
check('past three years both have expired',
  { bdn: by('r3').bdnState, sample: by('r3').sampleState }, { bdn: 'expired', sample: 'expired' });
check('at 11 months the sample is expiring soon', by('r4').sampleState, 'soon');
check('a missing BDN number is named', by('r5').missingBdnNo, true);
check('and one that is present is not', by('r1').missingBdnNo, false);

check('the soonest to expire is listed first', list[0].id, 'r3');
check('and days remaining are negative once expired', by('r3').sampleDays < 0, true);

/* A receipt with no date cannot be clocked; it must not appear with a wrong one. */
sandbox.state.receipts = [{ id: 'r8', category: 'fuel', type: 'LSFO', qty: 100, date: '', bdnNo: 'BDN-9' }];
check('a receipt with no delivery date is not given a clock', bdnRetentionList().length, 0);

/* ---------------------------------------------------------------- wiring ---- */
check('the sludge table is on the range page',
  HTML.includes('id="sludgeReconBody"') && HTML.includes('Sludge — book against tank'), true);
check('generation is labelled as derived, not measured',
  /not a measurement/.test(HTML), true);
check('an impossible figure is explained rather than just coloured',
  /left the tank that no entry accounts for/.test(HTML), true);
check('and the explanation names both causes',
  /Either a disposal went unrecorded or a sounding is wrong/.test(HTML), true);
check('while ordinary over-disposal is not called a discrepancy',
  /more leaving the tank than its net fall is ordinary/i.test(HTML), true);
check('the BDN panel cites the regulation',
  /Reg\. 18\.6 and 18\.8\.1/.test(HTML), true);
check('the handover pack says the R.O.B. are book figures, not soundings',
  /are BOOK figures carried forward from the last report, not soundings/.test(HTML), true);
check('and that it only reflects this device',
  /This pack reflects only what this device holds/.test(HTML), true);
check('outstanding requisitions use the real status field',
  /r\.status !== 'received'/.test(HTML), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
