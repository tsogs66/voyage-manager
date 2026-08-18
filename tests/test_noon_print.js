/*
 * Noon printout: operation becomes the title, idle M/E blocks stay off the
 * sheet, and flag registry names resolve from the e-ORB list.
 *
 * Run: node tests/test_noon_print.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('../eorb.js');
const EORB = global.EORB;
const ShipTime = require('../ship_time.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function extract(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in voyage_manager.html`);
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

const sandbox = { EORB, console, ShipTime, window: { ShipTime } };
vm.createContext(sandbox);
vm.runInContext(
  [extract('isNoonReportOp'), extract('noonSheetTitles'), extract('flagRegistryName'),
   extract('parseSeaTempValue'), extract('entrySeaTemp'),
   extract('sanitizeClockChangeMin'), extract('elapsedShipHours'),
   extract('previousReportReference'), extract('reportPeriodRunHours')].join('\n'),
  sandbox
);

console.log('\nprint title is the operation');
{
  const port = sandbox.noonSheetTitles('IN PORT - NOON');
  check('in-port title', port.title, 'IN PORT - NOON');
  check('in-port subtitle is the document kind', port.subtitle, 'Noon Report — Voyage Summary');
  const sea = sandbox.noonSheetTitles('AT SEA - NOON');
  check('at-sea title', sea.title, 'AT SEA - NOON');
  check('at-sea is still a noon report', sea.subtitle, 'Noon Report — Voyage Summary');
  const bunker = sandbox.noonSheetTitles('BUNKERING');
  check('non-noon title', bunker.title, 'BUNKERING');
  check('non-noon subtitle', bunker.subtitle, 'Voyage Summary');
  const empty = sandbox.noonSheetTitles('');
  check('empty operation falls back', empty.title, 'Voyage Summary');
}

console.log('\nflag registry name');
check('Liberia', sandbox.flagRegistryName('LR'), 'Liberia');
check('Marshall Islands', sandbox.flagRegistryName('MH'), 'Marshall Islands');
check('blank is empty', sandbox.flagRegistryName(''), '');
check('unknown code is returned as-is', sandbox.flagRegistryName('XX'), 'XX');

console.log('\nstern tube label and sea temp on the report');
check('voyage summary S/T is stern tube', HTML.includes('S/T Temp — Stern Tube (°C)'), true);
check('supplementary report S/T is stern tube', HTML.includes('id="rep_stTemp"') && HTML.includes('S/T Temp — Stern Tube (°C)'), true);
check('settling tank label is gone', HTML.includes('Settling Tank'), false);
check('sea temp field on report ER section', HTML.includes('id="rep_swTemp"') && HTML.includes('S/W Temp — Sea Water (°C)'), true);
check('sea temp field on voyage summary ER section', HTML.includes('id="vs_erSeaTemp"') && HTML.includes('S/W Temp — Sea Water (°C)'), true);
check('print names the stern tube', HTML.includes('S/T Temperature (Stern Tube)'), true);
check('print names sea water', HTML.includes('S/W Temperature (Sea Water)'), true);
check('weather sea temp wins over report copy', sandbox.entrySeaTemp({ weather:{seaTemp:18}, report:{swTemp:20} }), 18);
check('report swTemp is the fallback', sandbox.entrySeaTemp({ report:{swTemp:21} }), 21);
check('blank stays blank', sandbox.entrySeaTemp({}), null);

console.log('\nrun hours at the top of the sheet cover this report only');
{
  /* Noon to noon is 24 h no matter how long the voyage has been running. */
  const entries = [
    { id: 'a', datetime: '2026-08-16T12:00' },
    { id: 'b', datetime: '2026-08-17T12:00' },
    { id: 'c', datetime: '2026-08-18T12:00' }
  ];
  const carryover = { datetime: '2026-07-01T06:00' };
  sandbox.sortedEntries = () => entries.slice();
  sandbox.effectiveCarryover = () => carryover;

  const hrsFor = (id, row) => sandbox.reportPeriodRunHours(entries.find(e => e.id === id), row);
  check('17 Aug noon to 18 Aug noon is 24 h', hrsFor('c'), 24);
  check('16 Aug noon to 17 Aug noon is 24 h', hrsFor('b'), 24);
  check('never the voyage running total', hrsFor('c') === 24 && hrsFor('b') === 24, true);
  check('previous report is the entry before it', sandbox.previousReportReference(entries[2]).id, 'b');

  check('first report of the leg measures from the carryover',
    sandbox.previousReportReference(entries[0]).datetime, '2026-07-01T06:00');

  /* Clocks advanced 1 h over the period: noon to noon is 23 h of actual running. */
  const clocked = { id: 'c', datetime: '2026-08-18T12:00', clockChangeMin: 60 };
  sandbox.sortedEntries = () => [entries[1], clocked];
  check('clocks advanced 1 h make it 23 h', sandbox.reportPeriodRunHours(clocked), 23);

  /* A clock change stored on the wrong entry used to blank the figure; the plain
     ship's-clock difference stands in so a real period never prints as a dash. */
  const bad = { id: 'c', datetime: '2026-08-18T12:00', clockChangeMin: -1440 };
  sandbox.sortedEntries = () => [entries[1], bad];
  check('an impossible clock change falls back to the clock difference',
    sandbox.reportPeriodRunHours(bad), 24);

  /* No usable stamps at all — the computed row's own period hours are the last word. */
  sandbox.sortedEntries = () => [];
  sandbox.effectiveCarryover = () => null;
  check('no reference falls back to the computed row', sandbox.reportPeriodRunHours(entries[2], { hrs: 12 }), 12);
  check('no reference and no row is blank', sandbox.reportPeriodRunHours(entries[2], null), null);
}

console.log('\nsignature block sizing and the stamp struck over the line');
{
  /* Stamp 5% down from 44mm then 2% back up, signature 20% up from 14mm / 42mm. */
  check('stamp height is 42.64mm', HTML.includes('height:42.64mm; width:auto; max-width:77.52mm;'), true);
  check('signature grew to 16.8mm tall', HTML.includes('max-height:16.8mm; max-width:50.4mm;'), true);
  check('the space above the line grew with it', HTML.includes('height:16.8mm; width:42mm; margin-left:auto;'), true);
  check('the signature line itself is untouched at 42mm', HTML.includes('.pr-sign-line{ width:42mm;'), true);

  /* Out of flow, so it overlaps what is under it instead of displacing it, with its
     right edge on the line's quarter mark. */
  check('stamp is taken out of flow at the quarter mark', HTML.includes('position:absolute; left:25%; top:16.8mm;'), true);
  check('its right edge lands on that point, not its centre', HTML.includes('transform:translate(-100%, -50%);'), true);
  check('stamp sits inside the block it is measured against', HTML.includes('.pr-sign-block{ flex:0 0 42mm; text-align:right; position:relative; }'), true);
  check('stamp markup moved inside the signature block',
    /pr-sign-block">\s*\$\{stamp\}/.test(HTML), true);
}

console.log('\na signature can be drawn as well as uploaded');
check('the pad is on the page', HTML.includes('id="chEngSignaturePad"'), true);
check('the upload input is still there', HTML.includes('id="chEngSignatureFile"'), true);
check('a fingertip draws instead of scrolling', HTML.includes('touch-action:none'), true);
check('pointer events cover stylus, touch and mouse', HTML.includes("canvas.addEventListener('pointerdown', begin)"), true);
check('pen pressure widens the stroke', HTML.includes("ev.pointerType === 'pen' && ev.pressure > 0"), true);
check('the pad exports a transparent PNG', HTML.includes("out.toDataURL('image/png')"), true);

console.log('\nthe sheet prints the stamp the period is measured from');
check('last report cell replaces the duplicated voyage no.', HTML.includes("{label:'Last Report', value:prevReportStr}"), true);
check('top hours are labelled as this report only', HTML.includes("{label:'Run Hrs (This Report)', value:fmt(periodHrs, 2)}"), true);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
