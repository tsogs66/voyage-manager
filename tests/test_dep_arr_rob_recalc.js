'use strict';
/**
 * Dep/Arr ROB: recalculate control + Received must not balloon (no stamp+receipt
 * double-count, no grade broadcast across tanks).
 *
 * Run: node tests/test_dep_arr_rob_recalc.js
 */
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

console.log('Dep/Arr ROB recalculate control');
check('recalculate button present', HTML.includes('id="btnRecalcDepArrRob"'), true);
check('undo button present', HTML.includes('id="btnUndoDepArrRobRecalc"'), true);
check('recalculate helper present', HTML.includes('async function recalculateDepArrRobComparison'), true);
check('commits Opening ROB from vessel management', HTML.includes('readFuelTypeManagementFromDom'), true);
check('rebuilds current entries', HTML.includes('recalculateCurrentEntries({ persist: true, clearOverrides })'), true);
check('undo button wired into shared undo UI', HTML.includes("'btnUndoDepArrRobRecalc'"), true);
check('status line present', HTML.includes('id="depArrRobRecalcStatus"'), true);
check('prefer-once book received helper', HTML.includes('function bookReceivedPreferOnce'), true);
check('stock share matches robAsOf deduct', HTML.includes('function depArrStockShare'), true);
check('strict receipt match helper', HTML.includes('function receiptMatchesTankStrict'), true);
check('consumed from log overrides path', HTML.includes('function voyageConsumedFromLog'), true);
check('present prefers saved log ROB', HTML.includes('function depArrPresentRob'), true);
check('hint says receipts only', HTML.includes('Received = Receipts / bunkering entries only'), true);

function extract(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return HTML.slice(start, i + 1);
}

const sandbox = {
  state: { receipts: [], entries: [], setup: { rob: {}, robLube: {} } },
  console,
  tankRobValue: (store, t) => (store && t ? (store[t.id] ?? 0) : 0),
  lubeKindToLabel: (k) => ({ cylHigh: 'CYL HIGH', cylLow: 'CYL LOW', meSys: 'ME SYS OIL', geSys: 'GE SYS OIL' }[k] || k),
  fuelTankList: () => sandbox._fuel,
  lubeTankList: () => sandbox._lube,
  fwTankList: () => sandbox._fw,
  _fuel: [],
  _lube: [],
  _fw: []
};

vm.runInNewContext(
  [
    extract('receiptMatchesTankStrict'),
    extract('entryHasStampedReceived'),
    extract('stampedReceivedAsOf'),
    extract('receiptDayAfter'),
    extract('bookReceivedPreferOnce'),
    extract('voyageReceivedQty'),
    extract('depArrOpenShare'),
    extract('depArrStockShare'),
    extract('voyageConsumedFromLog'),
    extract('depArrPresentRob')
  ].join('\n'),
  sandbox
);

console.log('\nReceived must not balloon');
{
  const t1 = { id: 't1', name: 'HFO TK1', grade: 'HFO' };
  const t2 = { id: 't2', name: 'HFO TK2', grade: 'HFO' };
  sandbox._fuel = [t1, t2, { id: 't3', name: 'HFO TK3', grade: 'HFO' }];

  /* Stamp + hand receipt for the same 238 bunker must stay 238 (prefer hand). */
  sandbox.state.receipts = [
    { id: 'r1', category: 'fuel', type: 'HFO TK1', tankId: 't1', qty: 238 },
    { id: 'r2', category: 'fuel', type: 'HFO TK1', tankId: 't1', qty: 238, source: 'rob-survey', surveyEntryId: 'e1' }
  ];
  sandbox.state.entries = [{ id: 'e1', robReceived: { t1: 238 }, robReceivedLube: {} }];
  check('hand preferred over survey mirror: 238 not 476', sandbox.voyageReceivedQty(t1, 'fuel'), 238);
  /* With only the survey mirror (typical after summary save with stamp): */
  sandbox.state.receipts = [
    { id: 'r2', category: 'fuel', type: 'HFO TK1', tankId: 't1', qty: 238, source: 'rob-survey', surveyEntryId: 'e1' }
  ];
  check('survey mirror alone is 238 (stamp not added again)', sandbox.voyageReceivedQty(t1, 'fuel'), 238);

  /* Grade-only legacy receipt must NOT hit every HFO tank. */
  sandbox.state.entries = [];
  sandbox.state.receipts = [{ id: 'rg', category: 'fuel', type: 'HFO', qty: 238 }];
  check('grade-only receipt does not match TK1 by name', sandbox.voyageReceivedQty(t1, 'fuel'), 0);
  check('grade-only receipt does not match TK2', sandbox.voyageReceivedQty(t2, 'fuel'), 0);

  sandbox.state.receipts = [{ id: 'rn', category: 'fuel', type: 'HFO TK1', qty: 238 }];
  check('name-only receipt matches TK1', sandbox.voyageReceivedQty(t1, 'fuel'), 238);
  check('name-only receipt does not match TK2', sandbox.voyageReceivedQty(t2, 'fuel'), 0);
}

console.log('\nPresent prefers saved survey / identity');
{
  const t1 = { id: 't1', name: 'HFO TK1', grade: 'HFO' };
  check(
    'identity when no survey',
    sandbox.depArrPresentRob(t1, 'fuel', 100, 50, 20, null),
    130
  );
  check(
    'survey measured wins',
    sandbox.depArrPresentRob(t1, 'fuel', 100, 50, 20, {
      robSurvey: { measured: { t1: 111 } }
    }),
    111
  );
}

console.log('\nConsumed uses Opening+Received stock share (matches robAsOf)');
{
  sandbox._fuel = [
    { id: 't1', name: 'HFO TK1', grade: 'HFO' },
    { id: 't2', name: 'HFO TK2', grade: 'HFO' }
  ];
  sandbox.state.setup.rob = { t1: 75, t2: 25 };
  sandbox.state.receipts = [];
  sandbox.state.entries = [];
  const rows = [{ cumFuel: { HFO: 40 }, cumLube: {} }];
  check('equal open share 75%', Math.round(sandbox.voyageConsumedFromLog(sandbox._fuel[0], 'fuel', rows) * 1000) / 1000, 30);
  check('equal open share 25%', Math.round(sandbox.voyageConsumedFromLog(sandbox._fuel[1], 'fuel', rows) * 1000) / 1000, 10);

  /* Uneven bunker into TK1 shifts burn share the same way robAsOf does. */
  sandbox.state.receipts = [{ id: 'r', category: 'fuel', tankId: 't1', qty: 100 }];
  check('after recv TK1 stock share 87.5%', Math.round(sandbox.voyageConsumedFromLog(sandbox._fuel[0], 'fuel', rows) * 1000) / 1000, 35);
  check('after recv TK2 stock share 12.5%', Math.round(sandbox.voyageConsumedFromLog(sandbox._fuel[1], 'fuel', rows) * 1000) / 1000, 5);
}

console.log('\nHand receipt + stamped Received must not double');
{
  const t1 = { id: 'lsfo1', name: 'LSFO TK1', grade: 'LSFO' };
  sandbox._fuel = [t1];
  sandbox.state.setup.rob = { lsfo1: 500 };
  sandbox.state.entries = [{ id: 'e1', datetime: '2026-09-01T12:00', robReceived: { lsfo1: 120 }, robReceivedLube: {} }];
  sandbox.state.receipts = [
    { id: 'hand', date: '2026-09-01', category: 'fuel', tankId: 'lsfo1', qty: 120 },
    { id: 'mir', date: '2026-09-01', category: 'fuel', tankId: 'lsfo1', qty: 120, source: 'rob-survey', surveyEntryId: 'e1' }
  ];
  check('LSFO hand+stamp+mirror still 120', sandbox.voyageReceivedQty(t1, 'fuel'), 120);
}

if (fails) {
  console.log(`\nFAILED — ${fails} of ${checks} checks`);
  process.exit(1);
}
console.log(`\nPASSED — ${checks} checks`);
