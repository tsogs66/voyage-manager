#!/usr/bin/env node
/*
 * Summary machinery running hours list each generator by number, never a
 * combined total (two 24 h units must not show as 48 h).
 * Run: node tests/test_ge_summary_hours.js
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
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function checkTrue(label, value) {
  check(label, !!value, true);
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

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(extract('machineryGeHourCells'), sandbox);

console.log('\nper-generator voyage hours, not a combined total');
{
  const two = sandbox.machineryGeHourCells([24, 24, 0], 2);
  check('two units are listed separately', two.length, 2);
  check('A/E #1 is 24 h', two[0], { n: 1, hours: 24, used: true });
  check('A/E #2 is 24 h', two[1], { n: 2, hours: 24, used: true });
  check('combined 48 is not a cell', two.reduce((s, c) => s + c.hours, 0), 48);
}

{
  const three = sandbox.machineryGeHourCells([24, 0, 12], 3);
  check('three fitted units', three.length, 3);
  check('idle A/E #2 is unused', three[1].used, false);
  check('A/E #3 kept its own 12 h', three[2].hours, 12);
}

{
  const one = sandbox.machineryGeHourCells([24], 1);
  check('single generator ship', one.length, 1);
  check('A/E #1 only', one[0].n, 1);
}

console.log('\nsummary UI no longer shows a lumped A/E total');
checkTrue('old combined label is gone', HTML.indexOf('A/E hrs (voyage)') === -1);
checkTrue('strip uses A/E #n hrs', HTML.indexOf('A/E #${c.n} hrs') !== -1);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
