/*
 * Totals & Averages over a range that reaches back into archived voyage legs,
 * and the R.O.B. reconciliation that separates bunkering and survey corrections
 * from the burn.
 *
 * Two things are easy to get wrong here and both would be invisible on screen:
 *   - an average of two legs' averages is not the average over their reports
 *   - a leg's rows must be derived under THAT leg's setup, not the open one
 *
 * Run: node tests/test_range_across_legs.js
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

const FUEL_TYPES = ['LSFO', 'LSMGO'];

const sandbox = {
  console, Math, Number, Object, Array, String, JSON, Date, isFinite,
  FUEL_TYPES,
  FUEL_CONS_GROUPS: [{ label: 'LSFO', types: ['LSFO'] }, { label: 'LSMGO', types: ['LSMGO'] }],
  FUEL_DECIMALS: 3,
  EXTRA_DO_GRADES: [],
  state: { entries: [], receipts: [], setup: {} },
  /* Only the pieces the functions under test actually reach. */
  sumFuelGroup: (consByType, g) => g.types.reduce((a, t) => a + (Number(consByType?.[t]) || 0), 0),
  extraDoMap: () => ({}),
  totalCO2Tonnes: (byType) => Object.values(byType || {}).reduce((a, v) => a + v * 3.0, 0),
  effectiveCarryover: () => ({}),
  geUnitCount: () => 0,
  entryGeRunHours: () => null,
  entryBlrRunHours: () => null,
  fuelTankList: () => sandbox._tanks,
  _tanks: [],
  computeDerived: () => ({ rows: sandbox._rows }),
  _rows: []
};
vm.createContext(sandbox);
vm.runInContext([
  extract('rangeAggregateParts'),
  extract('emptyAggregateParts'),
  extract('mergeAggregateParts'),
  extract('finalizeAggregate'),
  extract('rangeAggregate'),
  extract('bunkeredByGradeBetween'),
  extract('surveyCorrectionByGradeBetween'),
  extract('robReconciliationParts'),
  extract('mergeReconciliationParts'),
  extract('finalizeReconciliation')
].join('\n'), sandbox);

/* ---------------------------------------------------------------- aggregation */

/* Leg A: two reports, engine turning slowly. Leg B: one report, turning fast.
   Averaging the two legs' averages would weight 2 reports the same as 1. */
function row(id, datetime, hrs, rpm, dist, lsfo) {
  return {
    id, datetime, hrs, meHrs: hrs, rpmEff: rpm, dailyRevs: rpm * 60 * hrs,
    distanceShip: dist, distEngine: dist, consByType: { LSFO: lsfo, LSMGO: 0 },
    meCons: lsfo, geCons: 0, blrCons: 0, miscCons: {}, mcrPct: null, kwEst: null,
    slip: null, sfocActual: null, sfocRef: null, fwProdD: 0, fwConsD: 0, cylCons: 0
  };
}

const legA = [row('a0', '2026-01-01T12:00:00Z', 24, 60, 300, 20),
              row('a1', '2026-01-02T12:00:00Z', 24, 60, 300, 20),
              row('a2', '2026-01-03T12:00:00Z', 24, 60, 300, 20)];
const legB = [row('b0', '2026-02-01T12:00:00Z', 12, 90, 240, 15)];

sandbox._rows = legA;
const partsA = sandbox.rangeAggregateParts(['a1', 'a2']);
sandbox._rows = legB;
const partsB = sandbox.rangeAggregateParts(['b0']);

const combined = sandbox.finalizeAggregate(sandbox.mergeAggregateParts([partsA, partsB]));
const soloA = sandbox.finalizeAggregate(partsA);
const soloB = sandbox.finalizeAggregate(partsB);

check('reports add across legs', combined.reports, 3);
near('hours add across legs', combined.hrs, 24 + 24 + 12);
near('distance adds across legs', combined.distShip, 300 + 300 + 240);
near('fuel adds across legs', combined.fuel.LSFO, 20 + 20 + 15);

/* The whole point of the num/den split. */
const meanOfMeans = (soloA.avgRpm + soloB.avgRpm) / 2;
near('RPM is weighted over every report, not averaged per leg',
  combined.avgRpm, (60 * 48 + 90 * 12) / 60);
check('and that differs from the mean of the two legs\' means',
  Math.abs(combined.avgRpm - meanOfMeans) > 1, true);

/* Speed over the range is total distance over total hours. */
near('speed is total distance over total hours', combined.avgSpeed, 840 / 60);

/* A mean-per-report figure must be the mean over every report. */
near('mean distance per report spans legs', combined.avgDistShip, (300 + 300 + 240) / 3);

/* Combining one leg must equal that leg alone — the merge must be a no-op for one. */
const oneLeg = sandbox.finalizeAggregate(sandbox.mergeAggregateParts([partsA]));
check('merging a single leg changes nothing',
  { reports: oneLeg.reports, hrs: oneLeg.hrs, rpm: oneLeg.avgRpm, co2: oneLeg.co2 },
  { reports: soloA.reports, hrs: soloA.hrs, rpm: soloA.avgRpm, co2: soloA.co2 });

/* And the public wrapper must still agree with the old behaviour. */
sandbox._rows = legA;
check('rangeAggregate still matches its parts',
  JSON.stringify(sandbox.rangeAggregate(['a1', 'a2'])), JSON.stringify(soloA));

/* An empty selection must not produce NaN on screen. */
const empty = sandbox.finalizeAggregate(sandbox.mergeAggregateParts([]));
check('an empty range gives no reports and no averages',
  { reports: empty.reports, hrs: empty.hrs, rpm: empty.avgRpm, speed: empty.avgSpeed },
  { reports: 0, hrs: 0, rpm: null, speed: null });

/* ------------------------------------------------------------ reconciliation */

sandbox._tanks = [
  { id: 't1', grade: 'LSFO' },
  { id: 't2', grade: 'LSMGO' }
];

/* A range that opens at 100 MT, takes a 500 MT delivery, burns 60, and whose
   survey found 3 MT more in the tank than the book said. */
sandbox.state.receipts = [
  { id: 'r1', category: 'fuel', type: 'LSFO', qty: 500, date: '2026-01-02' },
  /* on the opening day — already inside the opening figure */
  { id: 'r2', category: 'fuel', type: 'LSFO', qty: 77, date: '2026-01-01' },
  /* after the range */
  { id: 'r3', category: 'fuel', type: 'LSFO', qty: 99, date: '2026-01-09' },
  /* a survey mirror of r1: the ROB chain already counts the stamped Received */
  { id: 'r4', category: 'fuel', type: 'LSFO', qty: 500, date: '2026-01-02', source: 'rob-survey' },
  /* not fuel */
  { id: 'r5', category: 'lube', type: 'LSFO', qty: 1000, date: '2026-01-02' }
];
sandbox.state.entries = [
  { id: 'a1', datetime: '2026-01-02T12:00:00Z',
    robSurvey: { measured: { t1: 540 }, calculated: { t1: 537 } } },
  /* a survey before the window — already absorbed into the opening figure */
  { id: 'a0', datetime: '2026-01-01T06:00:00Z',
    robSurvey: { measured: { t1: 100 }, calculated: { t1: 90 } } }
];

const bunkered = sandbox.bunkeredByGradeBetween('2026-01-01T12:00:00Z', '2026-01-03T12:00:00Z');
near('a delivery inside the window counts', bunkered.LSFO, 500);
check('a delivery on the opening day does not (it is in the opening figure)',
  bunkered.LSFO === 577, false);
check('a lube receipt is not fuel', bunkered.LSMGO, 0);

const corr = sandbox.surveyCorrectionByGradeBetween('2026-01-01T12:00:00Z', '2026-01-03T12:00:00Z');
near('the survey correction is measured less book', corr.LSFO, 3);
check('a survey before the window is excluded', corr.LSFO === 13, false);

const parts = sandbox.robReconciliationParts(
  '2026-01-01T12:00:00Z', '2026-01-03T12:00:00Z', { LSFO: 60, LSMGO: 0 });
const rows = sandbox.finalizeReconciliation(parts, { LSFO: 100 }, { LSFO: 543 });
const lsfo = rows.find(r => r.grade === 'LSFO');

check('the reconciliation names each movement',
  { opening: lsfo.opening, bunkered: lsfo.bunkered, survey: lsfo.survey, consumed: lsfo.consumed, closing: lsfo.closing },
  { opening: 100, bunkered: 500, survey: 3, consumed: 60, closing: 543 });
near('and it balances: 100 + 500 + 3 - 60 = 543', lsfo.residual, 0);

/* The case the plain Change column hides: stock went UP by 443 while 60 was burned. */
near('stock rose even though fuel was burned', lsfo.closing - lsfo.opening, 443);

/* A closing figure that does not add up must show as unaccounted, not vanish. */
const off = sandbox.finalizeReconciliation(parts, { LSFO: 100 }, { LSFO: 540 });
near('a short closing figure shows up as unaccounted',
  off.find(r => r.grade === 'LSFO').residual, -3);

/* Missing bookends must give null, not a misleading zero. */
const noEnds = sandbox.finalizeReconciliation(parts, {}, {});
check('no bookends means no residual claimed',
  { opening: noEnds[0].opening, residual: noEnds[0].residual }, { opening: null, residual: null });

/* Merging two legs' movements adds them. */
const merged = sandbox.mergeReconciliationParts([parts, parts]);
near('movements add when legs are merged', merged.LSFO.bunkered, 1000);
near('and so does the burn', merged.LSFO.consumed, 120);

/* ------------------------------------------------------- source-level wiring */

check('an archived leg is derived in its own state',
  /withLegState\(leg\.pack, \(\) => rangeAggregateParts\(ids\)\)/.test(HTML), true);
check('withLegState always puts state back',
  /function withLegState[\s\S]{0,1400}?\} finally \{[\s\S]{0,400}?state\.setup = saved\.setup;/.test(HTML), true);
check('the active leg is not double-counted from the library',
  /if \(row\.voyageNumber === activeLeg\.voyageNumber &&/.test(HTML), true);
check('switching vessel drops the cached legs',
  /invalidateRangeLegPool\(\);\s*\n\s*_rangeIncludeArchived = false;/.test(HTML), true);
check('writing a leg drops the cache too',
  /async function putVoyageLeg[\s\S]{0,300}?invalidateRangeLegPool\(\)/.test(HTML), true);
check('a multi-leg range says so on screen',
  /This range spans \$\{agg\.legsUsed\.length\} voyage legs/.test(HTML), true);
check('the reconciliation is on the range page',
  HTML.includes('id="rangeRobReconBody"') && HTML.includes('Where the stock went'), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
