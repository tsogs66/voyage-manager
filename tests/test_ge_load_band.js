/*
 * Generator load band on the printed report.
 *
 * The sheet carries each generator's load percentage taken down to 90% and up to
 * 110% of itself. These checks pin the arithmetic and, more importantly, that a
 * unit with no recorded load prints a dash rather than 0.00 — a printed 0% load on
 * a running generator would be read as a fault.
 *
 * Run: node tests/test_ge_load_band.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let failures = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const ok = actual === expected
    || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

function extract(name) {
  let start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in voyage_manager.html`);
  const prefix = 'async ';
  if (HTML.slice(start - prefix.length, start) === prefix) start -= prefix.length;
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

const sandbox = { console, Number, isFinite, isNaN, Math };
vm.createContext(sandbox);
vm.runInContext([extract('geLoadBandMin'), extract('geLoadBandMax'), extract('fmt')].join('\n'), sandbox);
const { geLoadBandMin: min, geLoadBandMax: max, fmt } = sandbox;

console.log('\nthe band is 90% and 110% of the recorded load');
check('75% reads 67.5 at the bottom', min(75), 67.5);
check('and 82.5 at the top', max(75), 82.5);
check('100% reads 90', min(100), 90);
check('and 110', max(100), 110);
check('a fractional load carries through', min(63.4), 57.06);
check('at the top too', max(63.4), 69.74);

console.log('\nthe band brackets the figure it came from');
for (const load of [12.5, 45, 88.8, 100]) {
  checks++;
  const ok = min(load) < load && load < max(load);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${load}% sits inside its own band`);
  if (!ok) failures++;
}

console.log('\na load that was never recorded prints a dash, not a zero');
/* A printed 0.00% on a generator that ran would be read as a fault, so the
   missing case has to stay visibly missing all the way to the paper. */
for (const empty of [null, undefined, '']) {
  check(`${JSON.stringify(empty)} gives no minimum`, min(empty), null);
  check(`${JSON.stringify(empty)} gives no maximum`, max(empty), null);
  check(`${JSON.stringify(empty)} prints as a dash`, fmt(min(empty), 2), '—');
}
check('a non-numeric load gives no minimum', min('n/a'), null);
check('and no maximum', max('n/a'), null);

console.log('\nzero is a real reading and is not treated as missing');
check('a stopped generator still bands at zero', min(0), 0);
check('at the top too', max(0), 0);
check('and prints as a number', fmt(min(0), 2), '0.00');

console.log('\nthe printed table carries the two columns');
check('the header has Min%', HTML.includes('<th>Min%</th>'), true);
check('and Max%', HTML.includes('<th>Max%</th>'), true);
check('the per-unit row calls the minimum', HTML.includes('geLoadBandMin(p.loadPct)'), true);
check('and the maximum', HTML.includes('geLoadBandMax(p.loadPct)'), true);
check('the voyage average carries it too', HTML.includes('Voy Min / Max Load %'), true);

console.log(failures ? `\nFAILED — ${failures} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(failures ? 1 : 0);
