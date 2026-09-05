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

/*
 * Pull a top-level `const NAME = <expr>;` out of the app so the checks below read the
 * real list rather than a copy of it kept in step by hand — a copy is the very thing
 * that let an operation exist in one list and not another.
 */
function extractConst(name) {
  const start = HTML.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`const ${name} not found in voyage_manager.html`);
  let depth = 0;
  for (let i = start; i < HTML.length; i++) {
    const ch = HTML[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    /* `const` in a vm script is lexically scoped and never lands on the sandbox
       object, so the declaration is rewritten to one that does. */
    else if (ch === ';' && depth === 0) return 'var ' + HTML.slice(start + 'const '.length, i + 1);
  }
  throw new Error(`const ${name} is not terminated`);
}

const sandbox = {
  EORB, console, ShipTime, window: { ShipTime },
  /* Constants the extracted helpers close over. */
  EXTRA_DO_GRADES: ['MDO/MGO', 'LSMGO'],
  FUEL_DECIMALS: 3,
  escHtml: (v) => String(v),
  FUEL_CONS_GROUPS: [
    { key: 'fuel', label: 'FUEL', csv: 'FuelCons', grades: ['HFO', 'LSFO'] },
    { key: 'dogo', label: 'DO/GO', csv: 'DOGOCons', grades: ['MDO/MGO', 'LSMGO'] }
  ]
};
vm.createContext(sandbox);
vm.runInContext(
  ['OPERATION_GROUPS', 'DEFAULT_OPERATION', 'OPERATIONS', 'LEGACY_OPERATION_ALIASES',
   'SEA_TYPE_OPS', 'MANEUVERING_ME_OPS', 'NO_ME_DATA_OPS', 'ECA_OPS'].map(extractConst).join('\n'),
  sandbox
);
vm.runInContext(
  [extract('isNoonReportOp'), extract('noonSheetTitles'), extract('flagRegistryName'),
   extract('parseSeaTempValue'), extract('entrySeaTemp'),
   extract('sanitizeClockChangeMin'), extract('elapsedShipHours'),
   extract('previousReportReference'), extract('reportPeriodRunHours'),
   extract('extraDoMap'), extract('hasExtraDo'), extract('sumFuelGroup'),
   extract('entryMeRunHours'), extract('tankRobDelta'), extract('formatRobDelta'),
   extract('actualMeSfoc'), extract('rpmFromRevs'), extract('effectiveRpm'),
   extract('unitOverrideIfDifferent'),
   extract('fuelGroupColKey'), extract('rowFuelGroupCells'),
   extract('canonicalOperation'), extract('operationNeedsMeData'), extract('canShowMeDetailOp')].join('\n'),
  sandbox
);

console.log('\nprint title is the operation');
{
  const port = sandbox.noonSheetTitles('NOON - AT PORT');
  check('in-port title', port.title, 'NOON - AT PORT');
  check('in-port subtitle is the document kind', port.subtitle, 'Noon Report — Voyage Summary');
  const sea = sandbox.noonSheetTitles('NOON - AT SEA');
  check('at-sea title', sea.title, 'NOON - AT SEA');
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
    /label:'FUEL',[^}]*grades:\['HFO','LSFO'\]/.test(HTML), true);
  check('both distillates share one column',
    /label:'DO\/GO',[^}]*grades:\['MDO\/MGO','LSMGO'\]/.test(HTML), true);
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

console.log('\nevery report totals fuel the way the sheet does');
{
  /* A watch with the M/E on residual and the generators on distillate: the two
     figures are not addable, and a report that added them produced a tonnage
     nobody bunkers, orders or reconciles a tank against. */
  const row = { consByType: { 'HFO': 0.5, 'LSFO': 1.25, 'MDO/MGO': 2.0, 'LSMGO': 0.75 } };
  const cells = sandbox.rowFuelGroupCells(row);
  check('residual column', cells[sandbox.fuelGroupColKey({ key: 'fuel' })], 1.75);
  check('distillate column', cells[sandbox.fuelGroupColKey({ key: 'dogo' })], 2.75);
  check('the two still account for every tonne', 1.75 + 2.75, 0.5 + 1.25 + 2.0 + 0.75);
  check('a grade the vessel does not carry leaves the group blank',
    sandbox.rowFuelGroupCells({ consByType: { 'MDO/MGO': 1 } })[sandbox.fuelGroupColKey({ key: 'fuel' })], null);
  check('a genuine zero is still a figure',
    sandbox.rowFuelGroupCells({ consByType: { 'HFO': 0 } })[sandbox.fuelGroupColKey({ key: 'fuel' })], 0);
  /* Abstracts archived before the split have no consByType to read. */
  check('an archived row without grades reports nothing rather than throwing',
    Object.values(sandbox.rowFuelGroupCells({})), [null, null]);
  check('keys are stable and distinct',
    [sandbox.fuelGroupColKey({ key: 'fuel' }), sandbox.fuelGroupColKey({ key: 'dogo' })],
    ['cons_fuel', 'cons_dogo']);

  /* The surfaces that used to print r.total: the abstract and its CSV, the two
     exports on the Backup tab, and the weekly abstract. */
  check('the abstract column is per group',
    HTML.includes("label: `Total ${g.label}`"), true);
  check('the consumption table column is per group',
    HTML.includes("label: `${g.label} Total`"), true);
  check('the lumped abstract column is gone',
    HTML.includes("{ key:'total', label:'Total Cons', kind:'fuel' }"), false);
  check('the lumped consumption column is gone',
    HTML.includes("{ key:'periodTotal', label:'Period Total', kind:'fuel' }"), false);
  check('no export still writes the cross-fuel sum', /fmtNum\(r\.total\s*,\s*3\)/.test(HTML), false);
  check('the abstract CSV names both columns', HTML.includes('...FUEL_CONS_GROUPS.map(g => g.csv)'), true);
  check('and the weekly abstract does too', HTML.includes("...FUEL_CONS_GROUPS.map(g=>g.csv),"), true);
  check('the CSV name travels with the group',
    sandbox.FUEL_CONS_GROUPS.map(g => g.csv), ['FuelCons', 'DOGOCons']);
}

console.log('\nthe operations a watch can be logged against');
{
  const ops = sandbox.OPERATIONS;
  check('the list the deck asked for, in order', ops, [
    'DEPARTURE - STANDBY', 'DEPARTURE - LAST LINE', 'DEPARTURE - PORT',
    'DEPARTURE - ANCHORAGE', 'DEPARTURE - PILOT ONBOARD',
    'SHIFTING STATIONS', 'PILOT ONBOARD', 'PILOT OFFLOAD', 'CHANGE SPEED',
    'START OF SEA PASSAGE', 'END OF SEA PASSAGE',
    'NOON - AT PORT', 'NOON - AT SEA', 'NOON - ANCHORAGE', 'NOON - DRIFTING',
    'DRIFTING - START', 'DRIFTING - END',
    'ARRIVAL - STANDBY', 'ARRIVAL - FIRST LINE', 'ARRIVAL - ANCHORAGE',
    'ARRIVAL - FINISHED ENGINE',
    'ECA - CHANGEOVER START', 'ECA - ENTRY', 'ECA - EXIT', 'ECA - CHANGEOVER COMPLETE',
    'BUNKERING', 'BUNKER SURVEY'
  ]);
  check('none is listed twice', ops.length, new Set(ops).size);
  check('the default is a sea noon', sandbox.DEFAULT_OPERATION, 'NOON - AT SEA');
  check('and it is one of them', ops.includes(sandbox.DEFAULT_OPERATION), true);

  /* A logbook is a record: an old name keeps its meaning under the new vocabulary. */
  console.log('\n  a watch logged under an old name keeps its meaning');
  const renamed = {
    'AT SEA - NOON': 'NOON - AT SEA',
    'IN PORT - NOON': 'NOON - AT PORT',
    'AT ANCHOR - NOON': 'NOON - ANCHORAGE',
    'START - PASSAGE': 'START OF SEA PASSAGE',
    'END - PASSAGE': 'END OF SEA PASSAGE',
    'EOSP - END OF SEA PASSAGE': 'END OF SEA PASSAGE',
    'LAST LINE - DEPARTURE': 'DEPARTURE - LAST LINE',
    'PILOT ONBOARD - DEPARTURE': 'DEPARTURE - PILOT ONBOARD',
    'STAND BY - ARRIVAL': 'ARRIVAL - STANDBY',
    'FIRST LINE - ARRIVAL': 'ARRIVAL - FIRST LINE',
    'CHANGE OF SPEED': 'CHANGE SPEED',
    'SHIFTING': 'SHIFTING STATIONS'
  };
  Object.entries(renamed).forEach(([was, now]) =>
    check(`${was} → ${now}`, sandbox.canonicalOperation(was), now));
  check('every alias lands on an operation that exists',
    Object.values(sandbox.LEGACY_OPERATION_ALIASES).filter(o => !ops.includes(o)), []);
  check('no alias shadows a current name',
    Object.keys(sandbox.LEGACY_OPERATION_ALIASES).filter(o => ops.includes(o)), []);
  check('a current name is left alone', sandbox.canonicalOperation('NOON - AT SEA'), 'NOON - AT SEA');
  /* Dropped rather than guessed at: bare DRIFTING could be the start or the end. */
  ['HEAVY WEATHER', 'DRIFTING', 'CARGO - LOADING', 'IDLE IN PORT'].forEach(o =>
    check(`${o} stays exactly as it was logged`, sandbox.canonicalOperation(o), o));
  check('nothing is invented for an empty operation', sandbox.canonicalOperation(''), '');
  check('nor for one that was never set', sandbox.canonicalOperation(null), '');

  console.log('\n  watches that are not about the main engine');
  const noMe = [
    'NOON - AT PORT', 'NOON - ANCHORAGE',
    'DEPARTURE - STANDBY', 'DEPARTURE - LAST LINE', 'DEPARTURE - PORT',
    'DEPARTURE - ANCHORAGE', 'DEPARTURE - PILOT ONBOARD',
    'BUNKERING', 'BUNKER SURVEY'
  ];
  check('exactly the ones named', [...sandbox.NO_ME_DATA_OPS].sort(), noMe.slice().sort());
  check('all of them are real operations', noMe.filter(o => !ops.includes(o)), []);
  noMe.forEach(o => check(`${o} does not ask for M/E figures`, sandbox.operationNeedsMeData(o), false));
  check('an old name reaches the same rule', sandbox.operationNeedsMeData('IN PORT - NOON'), false);
  /* The engine is the point of these, so they keep their M/E panels. */
  ['NOON - AT SEA', 'START OF SEA PASSAGE', 'END OF SEA PASSAGE', 'CHANGE SPEED',
   'ARRIVAL - STANDBY', 'SHIFTING STATIONS', 'ECA - ENTRY'].forEach(o =>
    check(`${o} still carries them`, sandbox.operationNeedsMeData(o), true));
  check('no watch is in both the M/E sets',
    [...sandbox.SEA_TYPE_OPS].filter(o => sandbox.MANEUVERING_ME_OPS.has(o)), []);
  check('and none of those is also excused M/E data',
    [...sandbox.SEA_TYPE_OPS, ...sandbox.MANEUVERING_ME_OPS].filter(o => sandbox.NO_ME_DATA_OPS.has(o)), []);
  check('cylinder detail follows the same rule',
    sandbox.canShowMeDetailOp('BUNKERING'), false);
  check('and is offered where the engine is turning',
    sandbox.canShowMeDetailOp('NOON - AT SEA'), true);

  console.log('\n  every operation is classified somewhere');
  const classified = (o) =>
    sandbox.SEA_TYPE_OPS.has(o) || sandbox.MANEUVERING_ME_OPS.has(o) || sandbox.NO_ME_DATA_OPS.has(o);
  check('nothing falls through the rules', ops.filter(o => !classified(o)), []);
  check('the ECA legs are all sea ops',
    [...sandbox.ECA_OPS].filter(o => !sandbox.SEA_TYPE_OPS.has(o)), []);

  /* The voyage-progress widget decides the ship's status from its own three sets.
     They are written by hand against the same names, so a rename that missed them
     would leave a ship steaming alongside. Legacy names are allowed in them. */
  vm.runInContext(['PORT_OPS', 'ANCHOR_OPS', 'DRIFT_OPS'].map(extractConst).join('\n'), sandbox);
  const legacy = new Set(Object.keys(sandbox.LEGACY_OPERATION_ALIASES)
    .concat(['CARGO - LOADING', 'CARGO - DISCHARGING', 'IDLE IN PORT', 'DRIFTING', 'HEAVY WEATHER']));
  const known = (o) => ops.includes(o) || legacy.has(o);
  check('port ops are all real names', [...sandbox.PORT_OPS].filter(o => !known(o)), []);
  check('anchor ops are all real names', [...sandbox.ANCHOR_OPS].filter(o => !known(o)), []);
  check('drift ops are all real names', [...sandbox.DRIFT_OPS].filter(o => !known(o)), []);
  check('a ship alongside is not also at anchor',
    [...sandbox.PORT_OPS].filter(o => sandbox.ANCHOR_OPS.has(o) || sandbox.DRIFT_OPS.has(o)), []);
  check('the anchorage watches are recognised',
    ['NOON - ANCHORAGE', 'ARRIVAL - ANCHORAGE', 'DEPARTURE - ANCHORAGE'].filter(o => !sandbox.ANCHOR_OPS.has(o)), []);
  check('and the drifting ones', ['DRIFTING - START', 'DRIFTING - END', 'NOON - DRIFTING']
    .filter(o => !sandbox.DRIFT_OPS.has(o)), []);
  check('a sea passage is never marked alongside',
    ['NOON - AT SEA', 'START OF SEA PASSAGE', 'CHANGE SPEED'].filter(o => sandbox.PORT_OPS.has(o)), []);
  /* Reports are filtered by category keyword; an operation matching none of them
     could only ever be found under "All Entries". */
  vm.runInContext(extractConst('REPORT_CATEGORIES'), sandbox);
  const keywords = sandbox.REPORT_CATEGORIES.map(c => c.keyword).filter(Boolean);
  check('every operation falls under some report category',
    ops.filter(o => !keywords.some(k => o.toUpperCase().includes(k))), []);
  check('the pilot movements have one of their own', keywords.includes('PILOT'), true);

  /* The dropdown is built from the list, so the two cannot drift apart. */
  check('the dropdown is built, not hand-written',
    HTML.includes('<select id="in_operation"></select>'), true);
  check('editing an old entry does not blank its operation',
    HTML.includes("setOperationSelectValue(document.getElementById('in_operation'), e.operation)"), true);
  check('and loading one brings it up to date',
    HTML.includes('if (e.operation) e.operation = canonicalOperation(e.operation);'), true);
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

console.log('\nM/E run hours drive the engine figures');
{
  /* Blank means the engine ran the whole watch. */
  check('blank falls back to the watch', sandbox.entryMeRunHours({}, 24), 24);
  check('typed hours win', sandbox.entryMeRunHours({ meRunHours: 12 }, 24), 12);
  check('zero is not a run', sandbox.entryMeRunHours({ meRunHours: 0 }, 24), 24);
  /* The engine cannot have run longer than the watch it is being reported for. */
  check('capped at the watch', sandbox.entryMeRunHours({ meRunHours: 30 }, 24), 24);

  /* Average RPM over stopped time, then cubed, is what made SFOC absurd: an engine
     that turned 80 rpm for 12 of 24 hours averaged 40 and reported an eighth of the
     power, so fuel over that power came out several times too high. */
  const revs = 80 * 60 * 12;
  check('revolutions over the watch halve the average', sandbox.rpmFromRevs(revs, 24), 40);
  check('over the running hours they do not', sandbox.rpmFromRevs(revs, 12), 80);
  /* Same fuel, same engine — only the hours it is divided by. */
  const sfocWatch = sandbox.actualMeSfoc(20, 674, 24);
  const sfocRun = sandbox.actualMeSfoc(20, 5396, 12);
  check('the watch-hours figure is the wild one', Math.round(sfocWatch) > 3 * Math.round(sfocRun), true);
}

console.log('\nbilge and sludge carry forward with their change');
{
  check('a rise', sandbox.formatRobDelta(sandbox.tankRobDelta(12.2, 11)), '+1.20');
  check('a fall', sandbox.formatRobDelta(sandbox.tankRobDelta(6.9, 7.5)), '-0.60');
  check('no change still reads as zero', sandbox.formatRobDelta(sandbox.tankRobDelta(7.5, 7.5)), '0.00');
  check('nothing to compare against', sandbox.tankRobDelta(7.5, null), null);
  check('and prints as nothing', sandbox.formatRobDelta(null), '');
}

console.log('\nthe rest of this batch is wired in');
{
  check('run hours are an input, not a readout', HTML.includes('id="me_runtime_period" placeholder='), true);
  check('and are stored on the entry', HTML.includes('meRunHours: formMeRunHours() ?? existing?.meRunHours ?? null,'), true);
  /* Editing a watch rebuilds the entry, so anything the summary owns has to be
     named or it is dropped — this is how weather went missing. */
  ['weather', 'blrExtraCons', 'incExtraCons', 'shaftKw', 'robSurvey'].forEach(f => {
    check(`${f} survives an edit`, new RegExp(`\\n\\s+${f}: existing\\?|\\n\\s+${f}: extraDoMap\\(existing`).test(HTML), true);
  });
  check('the printed sheet carries the rev counter', HTML.includes("printRow('Rev. Counter', entry.revCounter==null"), true);
  check('bilge and sludge print their movement', HTML.includes("printRow('Bilge R.O.B.', robWithDelta("), true);
  check('ECA is gated by the leg — every changeover step counts',
    [...sandbox.ECA_OPS].sort(),
    ['ECA - CHANGEOVER COMPLETE', 'ECA - CHANGEOVER START', 'ECA - ENTRY', 'ECA - EXIT']);
  check('an entry already carrying changeover data stays editable', HTML.includes('function entryHasEcaData(entry){'), true);
  check('R.O.B. per report table', HTML.includes('function renderRobByReport(){'), true);
  check('gauges can be pointed at a report', HTML.includes('function robGaugeSource(){'), true);
  check('and the rest of the page still shows live R.O.B.', HTML.includes('const {rob, robLube} = asOfPick || live;'), true);
  check('range totals tab', HTML.includes('function rangeAggregate(ids){'), true);
  check('the from-report period belongs to the range before it',
    HTML.includes('return list.slice(fi === ti ? fi : fi + 1, ti + 1).map(e => e.id);'), true);
}

console.log('\nsaving a summary you did not edit changes nothing');
{
  /* The box is filled with the metered figure rounded to three decimals, so a value
     that renders the same as the calculation is not an edit. */
  check('the displayed figure is not an override', sandbox.unitOverrideIfDifferent(0.304, 0.3045), null);
  check('nor is an exact match', sandbox.unitOverrideIfDifferent(0.304, 0.304), null);
  /* The case that broke: 0.3045 shows as 0.304 and differs by exactly 0.0005, which
     the old strict "< 0.0005" test failed, storing an override half a gram light. */
  check('a half-gram rounding is still not an override', sandbox.unitOverrideIfDifferent(1.2345, 1.234), null);
  check('and neither is it the other way', sandbox.unitOverrideIfDifferent(1.234, 1.2345), null);

  /* A real correction must still be kept, to the last digit the box can hold. */
  check('a typed correction is kept', sandbox.unitOverrideIfDifferent(0.305, 0.3045), 0.305);
  check('one digit is enough to count', sandbox.unitOverrideIfDifferent(0.304, 0.305), 0.304);
  check('a wholly different figure', sandbox.unitOverrideIfDifferent(12.5, 0.304), 12.5);
  /* Nothing typed is nothing to store; nothing calculated means the typed value stands. */
  check('an empty box stores nothing', sandbox.unitOverrideIfDifferent(null, 0.3045), null);
  check('with no calculation the typed value wins', sandbox.unitOverrideIfDifferent(0.5, null), 0.5);
}

console.log('\nthe sheet prints the stamp the period is measured from');
check('last report cell replaces the duplicated voyage no.', HTML.includes("{label:'Last Report', value:prevReportStr}"), true);

check('route comes before last report on the noon meta strip',
  HTML.indexOf("{label:'Route', value:`${state.setup.departPort") < HTML.indexOf("{label:'Last Report', value:prevReportStr}"), true);
check('slip % sits between RPM and speed on the KPI strip',
  HTML.includes("{label:'Slip %', value:fmt(row.slip,2)}") && HTML.indexOf("{label:'RPM'") < HTML.indexOf("{label:'Slip %'") && HTML.indexOf("{label:'Slip %'") < HTML.indexOf("{label:'Speed (kn)'"), true);
check('ship dist is omitted when the main engine is not running',
  HTML.includes("/* Slip % sits between RPM and Speed on the KPI strip. Ship Dist is omitted when"), true);
check('condition prints as Laden / Ballasted',
  HTML.includes("? 'Laden' : 'Ballasted'"), true);
check('turbo RPM is separate from T/C in/out',
  HTML.includes('T/C #${i+1} In / Out') && HTML.includes('T/C #${i+1} RPM'), true);
check('rev counter lives under M/E performance',
  HTML.includes("printSection('M/E Performance'") && HTML.includes("printRow('Rev. Counter', entry.revCounter==null"), true);

check('top hours are labelled as this report only', HTML.includes("{label:'Run Hrs (This Report)', value:fmt(periodHrs, 2)}"), true);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
