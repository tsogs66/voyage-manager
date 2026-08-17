#!/usr/bin/env node
/*
 * Voyage Specifics initial date + time zone is the reference for the first
 * log entry. Run: node tests/test_voyage_init_tz.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const sandbox = { ShipTime, console };
vm.createContext(sandbox);
vm.runInContext(extract('voyageInitReference'), sandbox);

console.log('\nVoyage Specifics has a time-zone field');
checkTrue('select id is on Voyage Setup', HTML.indexOf('id="s_initTzOffset"') !== -1);
{
  const specifics = HTML.indexOf('Voyage Specifics');
  const tz = HTML.indexOf('id="s_initTzOffset"');
  const initDt = HTML.indexOf('id="s_initDateTime"');
  checkTrue('time zone sits with the initial date', specifics > 0 && tz > specifics && tz < specifics + 2500);
  checkTrue('initial date is still on Voyage Specifics', initDt > specifics && initDt < tz);
}

console.log('\nvoyage-start reference for the first log entry');
{
  const none = sandbox.voyageInitReference({});
  check('empty setup has no reference', none, null);

  const unzoned = sandbox.voyageInitReference({ initDateTime: '2026-08-15T12:00' });
  check('date without zone keeps the stamp', unzoned.datetime, '2026-08-15T12:00');
  check('date without zone has no offset', unzoned.tzOffsetMin, null);

  const ph = sandbox.voyageInitReference({ initDateTime: '2026-08-15T12:00', tzOffsetMin: 480 });
  check('UTC+8 voyage start date', ph.datetime, '2026-08-15T12:00');
  check('UTC+8 voyage start zone', ph.tzOffsetMin, 480);

  const hours = ShipTime.elapsedShipHours(ph.datetime, '2026-08-16T12:00', 0);
  check('first noon after voyage-start noon is 24 h', hours, 24);
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
