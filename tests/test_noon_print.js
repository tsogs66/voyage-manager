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

const sandbox = {
  EORB, console, ShipTime, window: { ShipTime },
  /* Constants the extracted helpers close over. */
  EXTRA_DO_GRADES: ['MDO/MGO', 'LSMGO'],
  FUEL_DECIMALS: 3
};
vm.createContext(sandbox);
vm.runInContext(
  [extract('isNoonReportOp'), extract('noonSheetTitles'), extract('flagRegistryName'),
   extract('parseSeaTempValue'), extract('entrySeaTemp'),
   extract('sanitizeClockChangeMin'), extract('elapsedShipHours'),
   extract('previousReportReference'), extract('reportPeriodRunHours'),
   extract('extraDoMap'), extract('hasExtraDo'), extract('sumFuelGroup')].join('\n'),
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

console.log('\nfuel consumption is totalled per grade, not across grades');
{
  /* Each unit can burn a different grade, so the old single total added residual
     tonnes to distillate tonnes. Columns are now per grade. */
  check('the section is a table, not a stack of rows',
    HTML.includes("const fuelSection = printSection('Fuel Consumption (MT)', `"), true);
  check('only groups actually in use get a column', HTML.includes('const groupsUsed = FUEL_CONS_GROUPS.filter'), true);
  check('a unit books against its own group only', HTML.includes('const meteredOn = (grade, qty) =>'), true);
  /* Four grades, two fuels: the splits are a tank matter, not a difference in what
     went into the engine. */
  check('both residuals share one column',
    HTML.includes("{ label:'FUEL',  grades:['HFO','LSFO'] }"), true);
  check('both distillates share one column',
    HTML.includes("{ label:'DO/GO', grades:['MDO/MGO','LSMGO'] }"), true);
  check('and there are only those two', HTML.includes("grades:['HFO'] }") || HTML.includes("grades:['LSFO'] }"), false);
  check('misc burn is carried as its own row',
    HTML.includes("fuelUnitRows.push({ label:'Other', by: burnedOnly(row.miscCons) })"), true);
  /* The total row reads from consByType, which is what the R.O.B. table books per
     tank, so the two halves of the sheet cannot disagree. */
  check('the total row sums the group', HTML.includes('fuelCell(sumFuelGroup(row.consByType, g))'), true);
  check('a group with nothing in it stays blank, a real zero prints', HTML.includes('return seen ? total : null;'), true);
  check('the lumped cross-grade total is gone', HTML.includes("printRow('Total', fmtFuel(row.total))"), false);
  check('the total row is ruled off', HTML.includes('.pr-table tr.pr-total td{'), true);
}

console.log('\nboiler and incinerator extra distillate');
{
  const DO = { grades: ['MDO/MGO', 'LSMGO'] };
  /* Booked by hand: neither burner is on a meter of its own. */
  check('nothing booked is a pair of zeroes', sandbox.extraDoMap(null), { 'MDO/MGO': 0, 'LSMGO': 0 });
  check('what is booked is kept', sandbox.extraDoMap({ 'MDO/MGO': 0.35, 'LSMGO': 0.2 }), { 'MDO/MGO': 0.35, 'LSMGO': 0.2 });
  check('a residual grade cannot be booked here', sandbox.extraDoMap({ 'LSFO': 5 }), { 'MDO/MGO': 0, 'LSMGO': 0 });
  /* A blank box, a stray minus sign or a half-typed number must not become fuel. */
  check('rubbish is not fuel', sandbox.extraDoMap({ 'MDO/MGO': 'abc', 'LSMGO': -3 }), { 'MDO/MGO': 0, 'LSMGO': 0 });

  check('an empty booking shows no row', sandbox.hasExtraDo(sandbox.extraDoMap(null)), false);
  check('a zero booking shows no row', sandbox.hasExtraDo({ 'MDO/MGO': 0, 'LSMGO': 0 }), false);
  check('one grade is enough to show it', sandbox.hasExtraDo({ 'MDO/MGO': 0.1, 'LSMGO': 0 }), true);

  /* Both distillates land in the one DO/GO column. */
  check('the two grades total together',
    sandbox.sumFuelGroup(sandbox.extraDoMap({ 'MDO/MGO': 0.35, 'LSMGO': 0.2 }), DO), 0.55);
}

console.log('\nthe extra distillate is wired through');
{
  check('boiler boxes are on the summary',
    HTML.includes('id="vs_blrExtra_mdomgo"') && HTML.includes('id="vs_blrExtra_lsmgo"'), true);
  check('incinerator boxes are on the summary',
    HTML.includes('id="vs_incExtra_mdomgo"') && HTML.includes('id="vs_incExtra_lsmgo"'), true);
  check('the summary saves them', HTML.includes("entry.blrExtraCons = extraDoMap({ 'MDO/MGO': num0('vs_blrExtra_mdomgo')"), true);
  check('and reads them back', HTML.includes("document.getElementById('vs_incExtra_lsmgo').value = incExtraForm['LSMGO'];"), true);
  check('a new entry carries the fields', HTML.includes('blrExtraCons: extraDoMap(e.blrExtraCons),'), true);
  /* Real fuel out of the tanks: it joins the period total and the per-grade figures
     the R.O.B. chain deducts against. */
  check('it reaches the period total', HTML.includes('+miscTotal+extraDoTotal;'), true);
  check('it reaches R.O.B. per grade',
    HTML.includes('EXTRA_DO_GRADES.forEach(t => { rawFuel[t] += blrExtra[t] + incExtra[t]; });'), true);
  check('the boiler books its own on the boiler row',
    HTML.includes("{ label:'Boiler', by: addBurn(meteredOn(entry.blr?.type, row.blrCons), blrExtraRow) }"), true);
  check('the incinerator gets a row only when it burned something',
    HTML.includes("if (hasExtraDo(incExtraRow)) fuelUnitRows.push({ label:'Incinerator'"), true);
  check('both are named in the Boiler & Incinerator block',
    HTML.includes("printRow('Boiler Extra D.O.'") && HTML.includes("printRow('Incinerator D.O. Cons'"), true);
  check('the consumption table totals them',
    HTML.includes("incOf('MDO/MGO'), (r.miscCons||{})['MDO/MGO']"), true);
}

console.log('\ncurrent ROB is read from the record, surveys included');
{
  /* A bunker survey re-bases the chain. Reading current ROB as opening baseline plus
     receipts less consumption cannot see one, so a corrected ROB used to be right on
     the ROB tab and wrong on the voyage page and in every new leg opened from it. */
  check('current ROB is the ROB as of the last entry',
    HTML.includes('const asOf = robAsOfComputedRow(last, rows);'), true);
  check('the book-figure arithmetic is only the empty-log case',
    HTML.includes('No log entries yet, so there is nothing to re-base against'), true);
}

console.log('\nthe preview containers are white so ink shows on them');
{
  check('stamp / signature preview is paper white',
    HTML.includes('border:1px solid #c8d2e0; border-radius:4px; background:#fdfefe; padding:8px;'), true);
  /* The checkerboard proved transparency but hid dark ink on the dark theme. */
  check('the checkerboard is gone', HTML.includes('linear-gradient(45deg, rgba(128,128,128,0.22) 25%'), false);
  check('the empty-state text is legible on white', HTML.includes('.stamp-preview .stamp-empty{font-size:11px; color:#5a6578;'), true);
  /* Display only: what is stored, and printed, is still the transparent cut-out. */
  check('the cut-out still runs on upload', HTML.includes('url = await removeWhiteBackgroundDataUrl(url);'), true);
}

console.log('\na crowded sheet is fitted onto the paper rather than clipped');
{
  check('the noon sheet may densify like the others', HTML.includes('if (!isBunker && scale < 0.92){'), true);
  check('and its tables may go extra small', HTML.includes('if (!isBunker && scale < 0.82){'), true);
  /* Floors that raise the scale above what fits are what pushed the signature block
     off the bottom of the page. */
  check('no floor forces the noon sheet back up', HTML.includes('if (isStdPortrait) scale = Math.max(0.85, scale);'), false);
  check('nor the other portrait sheets', HTML.includes('else if (!isBunker) scale = Math.max(0.82, scale);'), false);
  check('the measure floor leaves room for a full sheet', HTML.includes('return Math.max(0.6, Math.min(1,'), true);
}

console.log('\nsaving and printing the summary read the form the same way');
{
  /* Two readers drifted apart: the save wrote some forty fields, the print snapshot
     merged about half. Printing before saving then built the sheet off the stored
     entry, so the distance, the generator table and the hand-booked consumption were
     the previous values. */
  check('one reader for the form', HTML.includes('function applyVoyageSummaryFormToEntry(entry){'), true);
  check('the save uses it', HTML.includes('  applyVoyageSummaryFormToEntry(entry);'), true);
  check('so does the print snapshot', HTML.includes('  applyVoyageSummaryFormToEntry(draft);'), true);
  /* Half the sheet is derived by computeDerived(), which looks the entry up in
     state.entries — a draft object on its own would change nothing. */
  check('the draft stands in while the sheet is built', HTML.includes('function withVoyageSummaryDraft(entry, fn){'), true);
  check('and is always put back', HTML.includes('finally { state.entries[idx] = stored; }'), true);
  check('printing goes through it', HTML.includes('const { entry, sheetHtml } = withVoyageSummaryDraft(baseEntry,'), true);
  /* The override comparison has to see the entry as it was before the form landed. */
  check('the prior override is captured before the form is applied',
    HTML.indexOf('const priorUnitOverride') < HTML.indexOf('  applyVoyageSummaryFormToEntry(entry);'), true);
}

console.log('\nthe sheet prints the stamp the period is measured from');
check('last report cell replaces the duplicated voyage no.', HTML.includes("{label:'Last Report', value:prevReportStr}"), true);
check('top hours are labelled as this report only', HTML.includes("{label:'Run Hrs (This Report)', value:fmt(periodHrs, 2)}"), true);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
