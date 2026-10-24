/*
 * IMO DCS / EU MRV calendar-year compilation.
 *
 * Two ways this can mislead a verifier, and both are silent:
 *
 *   1. Reporting a partial year as if it were the year. Ten months of data
 *      labelled "2026" is worse than no figure — the verifier has no reason
 *      to go looking for the rest.
 *   2. Reporting period hours as "hours under way". The DCS data item is
 *      hours under way; counting port and anchor time overstates it.
 *
 * Run: node tests/test_dcs_year.js
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

function row(id, datetime, hrs, dist, lsfo, underWay) {
  return {
    id, datetime, hrs, meHrs: underWay ? hrs : 0,
    distanceShip: underWay ? dist : 0, distEngine: underWay ? dist : 0,
    dailyRevs: underWay ? 1000 : 0,
    consByType: { LSFO: lsfo, LSMGO: 0 },
    meCons: lsfo, geCons: 0, blrCons: 0, miscCons: {},
    rpmEff: null, mcrPct: null, kwEst: null, slip: null, sfocActual: null, sfocRef: null,
    fwProdD: 0, fwConsD: 0, cylCons: 0
  };
}

/* Two legs: one in 2026, one straddling into 2027. Port days have no way on. */
const legA = [
  row('a1', '2026-03-01T12:00:00Z', 24, 300, 20, true),
  row('a2', '2026-03-02T12:00:00Z', 24, 300, 20, true),
  row('a3', '2026-03-03T12:00:00Z', 24, 0, 5, false)      /* in port: fuel but no way on */
];
const legB = [
  row('b1', '2026-12-30T12:00:00Z', 24, 250, 18, true),
  row('b2', '2027-01-02T12:00:00Z', 24, 250, 18, true)     /* next year — must not count */
];

const sandbox = {
  console, Math, Number, Object, Array, String, JSON, Date, isFinite,
  FUEL_TYPES,
  FUEL_CONS_GROUPS: [{ label: 'LSFO', types: ['LSFO'] }, { label: 'LSMGO', types: ['LSMGO'] }],
  FUEL_DECIMALS: 3,
  EXTRA_DO_GRADES: [],
  sumFuelGroup: (c, g) => g.types.reduce((a, t) => a + (Number(c?.[t]) || 0), 0),
  extraDoMap: () => ({}),
  totalCO2Tonnes: (byType) => Object.values(byType || {}).reduce((a, v) => a + v * 3.114, 0),
  effectiveCarryover: () => ({}),
  geUnitCount: () => 0,
  entryGeRunHours: () => null,
  entryBlrRunHours: () => null,
  state: {
    entries: [],
    setup: {
      shipName: 'MV Example', imoNo: 'IMO 9876543', flag: 'LR',
      ciiShipType: 'bulk', dwt: 60000, grossTonnage: 35000, netTonnage: 20000,
      mcrKw: 18630, auxPowerKw: 2400
    }
  },
  computeDerived: () => ({ rows: sandbox._rows }),
  _rows: [],
  withLegState: (pack, fn) => { sandbox._rows = pack.rows; const r = fn(); return r; },
  loadRangeLegPool: async () => sandbox._pool,
  _pool: null,
  rangePoolEntries: () => [],
  Promise
};
vm.createContext(sandbox);
vm.runInContext([
  extract('numOrNull'),
  extract('rangeAggregateParts'),
  extract('emptyAggregateParts'),
  extract('mergeAggregateParts'),
  extract('finalizeAggregate'),
  extract('dcsYearWindow'),
  extract('buildDcsReport'),
  extract('dcsReportCsvRows')
].join('\n'), sandbox);

sandbox._pool = {
  vesselId: 'v1',
  legs: [
    { key: 'L1', label: 'Voyage 01 · Laden', active: false, entries: legA, pack: { rows: legA } },
    { key: 'L2', label: 'Voyage 02 · Ballast', active: false, entries: legB, pack: { rows: legB } }
  ]
};

(async () => {
  const win = sandbox.dcsYearWindow(2026);
  check('the year window starts on 1 January', win.from.slice(0, 10), '2026-01-01');
  check('and ends before 1 January next', win.to.slice(0, 10), '2027-01-01');

  const rep = await sandbox.buildDcsReport(2026);

  /* Only the 2026 reports. legA's three plus legB's one. */
  check('reports outside the year are excluded', rep.reports, 4);
  check('both legs contribute', rep.legsUsed.length, 2);
  check('and each says how many reports it gave',
    rep.legsUsed.map(l => l.reports), [3, 1]);

  /* 300 + 300 + 0 + 250 */
  check('distance is the sum over the year', rep.distanceNm, 850);

  /* THE important one: 24 + 24 + 24(port) + 24 = 96 period hours, but only
     72 with way on. Reporting 96 as hours under way overstates the item. */
  check('period hours include the port day', rep.periodHours, 96);
  check('hours under way exclude it', rep.hoursUnderWay, 72);
  check('and the two are not the same figure', rep.hoursUnderWay === rep.periodHours, false);

  /* Fuel counts the port day — it was burned. */
  check('fuel includes fuel burned in port', rep.fuelByType.LSFO, 63);
  check('and the total agrees', rep.fuelTotalMt, 63);
  check('CO2 comes off the fuel', rep.co2Tonnes, Number((63 * 3.114).toFixed(2)));

  /* Coverage honesty. */
  check('the period covered is what the device actually holds',
    { from: rep.periodFrom, to: rep.periodTo }, { from: '2026-03-01', to: '2026-12-30' });
  check('a year that is not fully covered is flagged partial', rep.partial, true);
  check('and the full year is stated for comparison',
    { start: rep.yearStart, end: rep.yearEnd }, { start: '2026-01-01', end: '2026-12-31' });

  /* Particulars come through, including the fields DCS needs that CII did not. */
  check('the IMO number is read from imoNo', rep.particulars.imo, 'IMO 9876543');
  check('gross tonnage is carried', rep.particulars.grossTonnage, 35000);
  check('net tonnage is carried', rep.particulars.netTonnage, 20000);
  check('engine powers are carried',
    { me: rep.particulars.mainEnginePowerKw, ae: rep.particulars.auxEnginePowerKw },
    { me: 18630, ae: 2400 });
  check('a complete set of particulars leaves no gaps', rep.gaps, []);

  /* Missing particulars are named, not silently blank. */
  sandbox.state.setup.grossTonnage = null;
  sandbox.state.setup.imoNo = '';
  const gappy = await sandbox.buildDcsReport(2026);
  check('a missing GT is reported as a gap',
    gappy.gaps.some(g => /Gross tonnage/.test(g)), true);
  check('a missing IMO number too',
    gappy.gaps.some(g => /IMO number/.test(g)), true);
  sandbox.state.setup.grossTonnage = 35000;
  sandbox.state.setup.imoNo = 'IMO 9876543';

  /* A year with nothing in it must not report zeros as if they were measured. */
  const empty = await sandbox.buildDcsReport(2024);
  check('an empty year reports no reports', empty.reports, 0);
  check('and says so as a gap',
    empty.gaps.some(g => /No reports at all fall in this year/.test(g)), true);

  /* The CSV a verifier opens. */
  const rows = sandbox.dcsReportCsvRows(rep);
  const flat = rows.map(r => r.join('|')).join('\n');
  check('the CSV names hours under way', /Hours under way\|72/.test(flat), true);
  check('and marks period hours as not that item',
    /not the DCS "hours under way" item/.test(flat), true);
  check('it splits fuel by type, as DCS requires',
    rows.filter(r => /^Fuel consumed — /.test(r[0])).length, 2);
  check('it carries the partial-year warning',
    /PARTIAL: this device does not hold the whole year/.test(flat), true);
  check('it names each leg included',
    rows.filter(r => r[0] === 'Voyage leg included').length, 2);
  check('and states plainly that it is not a submission',
    /This is a compilation, not a submission\./.test(flat), true);

  /* Not-recorded particulars must say so in the CSV rather than look like zero. */
  const gappyRows = sandbox.dcsReportCsvRows(gappy).map(r => r.join('|')).join('\n');
  check('a missing figure reads NOT RECORDED, not 0',
    /Gross tonnage\|\|GT\|NOT RECORDED/.test(gappyRows), true);

  /* ---- wiring --------------------------------------------------------- */
  check('the compilation reuses the cross-leg machinery',
    /withLegState\(leg\.pack, run\)/.test(HTML), true);
  check('the DCS fields are on the vessel setup form',
    HTML.includes('id="s_grossTonnage"') && HTML.includes('id="s_netTonnage"') &&
    HTML.includes('id="s_auxPowerKw"'), true);
  check('and they are saved at every setup save site',
    (HTML.match(/state\.setup\.grossTonnage = parseFloat/g) || []).length, 3);
  check('a partial year is said out loud, not only in the file',
    /PARTIAL YEAR\. This device holds/.test(HTML), true);

  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
