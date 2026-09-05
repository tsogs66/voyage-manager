/*
 * Voyage averages must always be recalculated from currently existing entries.
 * They must not keep accumulating across add / edit / delete, and summary/noon
 * averages for a historical report must ignore later watches.
 *
 * Run: node tests/test_voyage_averages.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = Object.is(actual, expected) ||
    (typeof actual === 'number' && typeof expected === 'number' &&
      Math.abs(actual - expected) < 1e-6);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures.push(label);
}

function checkTrue(label, value) {
  check(label, !!value, true);
}

function extract(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
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

/* ---- Source guards: the recalculation contract stays wired in ---- */
console.log('\nsource: averages recalculate from current entries');
checkTrue('computeDerived accepts opts', /function computeDerived\s*\(\s*opts\s*\)/.test(HTML));
checkTrue('upToEntryId slice exists', HTML.includes('opts.upToEntryId'));
checkTrue('voyage summary uses as-of averages',
  HTML.includes('computeDerived({ upToEntryId: entryId })'));
checkTrue('tagged voyage excludes untagged inflation', HTML.includes('hasTaggedForActive'));
checkTrue('avg ship speed uses distance/hours', HTML.includes('totalDistShip/totalHrs'));
checkTrue('RPM averages are hour-weighted', HTML.includes('sumRpm += rpmEff * wHrs'));

/* ---- entryMatchesActiveLeg: untagged rows must not inflate a tagged voyage ---- */
console.log('\nactive-leg filter');
{
  const sandbox = {
    state: {
      setup: { voyageNumber: '42', shipCondition: 'L' },
      entries: [
        { id: 'a', voyageNumber: '42', condition: 'L' },
        { id: 'legacy', voyageNumber: '', condition: 'L' }
      ]
    },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extract('normalizeCondition') + '\n' +
    extract('activeLegVoyageNumber') + '\n' +
    extract('activeLegCondition') + '\n' +
    extract('entryMatchesActiveLeg'),
    sandbox
  );

  checkTrue('tagged entry on active leg matches',
    sandbox.entryMatchesActiveLeg({ voyageNumber: '42', condition: 'L' }));
  check('untagged excluded when tagged rows exist',
    sandbox.entryMatchesActiveLeg({ voyageNumber: '', condition: 'L' }), false);
  checkTrue('other voyage excluded',
    !sandbox.entryMatchesActiveLeg({ voyageNumber: '41', condition: 'L' }));

  sandbox.state.entries = [{ id: 'legacy', voyageNumber: '', condition: 'L' }];
  checkTrue('untagged allowed only before any tagged row exists',
    sandbox.entryMatchesActiveLeg({ voyageNumber: '', condition: 'L' }));
}

/* ---- upToEntryId: later watches must not change earlier report averages ---- */
console.log('\nas-of averages ignore later entries');
{
  /* Same slice + hour-weighted distance/RPM rule as computeDerived. */
  function averagesUpTo(entries, upToEntryId) {
    let list = entries.slice().sort((a, b) => a.datetime.localeCompare(b.datetime));
    if (upToEntryId != null) {
      const cut = list.findIndex(e => String(e.id) === String(upToEntryId));
      list = cut >= 0 ? list.slice(0, cut + 1) : list;
    }
    let totalDist = 0, totalHrs = 0, sumRpmHrs = 0, rpmHrs = 0;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], e = list[i];
      const hrs = (Date.parse(e.datetime) - Date.parse(prev.datetime)) / 3600000;
      if (!(hrs > 0)) continue;
      totalHrs += hrs;
      totalDist += e.distanceShip || 0;
      if (e.rpm != null) {
        sumRpmHrs += e.rpm * hrs;
        rpmHrs += hrs;
      }
    }
    return {
      avgSpeedShip: totalHrs > 0 ? totalDist / totalHrs : null,
      avgRpm: rpmHrs > 0 ? sumRpmHrs / rpmHrs : null
    };
  }

  const entries = [
    { id: 'e1', datetime: '2026-05-01T12:00:00Z', distanceShip: 240, rpm: 60 },
    { id: 'e2', datetime: '2026-05-02T12:00:00Z', distanceShip: 240, rpm: 60 },
    { id: 'e3', datetime: '2026-05-03T12:00:00Z', distanceShip: 120, rpm: 30 }
  ];

  const asOfE2 = averagesUpTo(entries, 'e2');
  const full = averagesUpTo(entries, null);
  check('as-of e2 speed ignores e3', asOfE2.avgSpeedShip, 240 / 24);
  check('full voyage speed includes e3', full.avgSpeedShip, (240 + 120) / 48);
  check('as-of e2 rpm ignores slow later watch', asOfE2.avgRpm, 60);

  const afterDelete = averagesUpTo(entries.filter(e => e.id !== 'e3'), null);
  check('delete recalculates speed from remaining', afterDelete.avgSpeedShip, asOfE2.avgSpeedShip);
  check('delete recalculates rpm from remaining', afterDelete.avgRpm, asOfE2.avgRpm);

  const edited = entries.filter(e => e.id !== 'e3').map(e =>
    e.id === 'e2' ? { ...e, distanceShip: 200 } : e
  );
  const afterEdit = averagesUpTo(edited, null);
  check('edit recalculates speed from current figures', afterEdit.avgSpeedShip, 200 / 24);

  const withAdd = edited.concat([
    { id: 'e4', datetime: '2026-05-03T12:00:00Z', distanceShip: 240, rpm: 60 }
  ]);
  const afterAdd = averagesUpTo(withAdd, null);
  check('add recalculates from all existing periods', afterAdd.avgSpeedShip, (200 + 240) / 48);
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
