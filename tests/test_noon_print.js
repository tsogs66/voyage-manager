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

const sandbox = { EORB, console };
vm.createContext(sandbox);
vm.runInContext(
  [extract('isNoonReportOp'), extract('noonSheetTitles'), extract('flagRegistryName'),
   extract('parseSeaTempValue'), extract('entrySeaTemp')].join('\n'),
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

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
