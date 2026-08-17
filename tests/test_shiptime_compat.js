#!/usr/bin/env node
/*
 * New HTML must boot when a stale cached ship_time.js still has ShipTime
 * but not sanitizeClockChangeMin (the tablet crash on noonreport.tsogs.cloud).
 * Run: node tests/test_shiptime_compat.js
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

function runWithShipTime(shipTime) {
  const sandbox = { window: { ShipTime: shipTime }, ShipTime: shipTime, console };
  vm.createContext(sandbox);
  vm.runInContext(
    [extract('sanitizeClockChangeMin'), extract('shouldRecordShipClockChange')].join('\n'),
    sandbox
  );
  return sandbox;
}

console.log('\nstale ShipTime object must not crash startup');
{
  const oldApi = {
    elapsedShipHours: function () { return 24; },
    clampTzOffsetMin: function (n) { return n; }
  };
  const ctx = runWithShipTime(oldApi);
  check('480 min dropped without sanitize on ShipTime', ctx.sanitizeClockChangeMin(480), 0);
  check('real +60 kept without sanitize on ShipTime', ctx.sanitizeClockChangeMin(60), 60);
  check('first UTC+8 pick is not a clock change', ctx.shouldRecordShipClockChange(0, 480, false, false), false);
  check('mid-voyage +1 h still records', ctx.shouldRecordShipClockChange(480, 540, true, true), true);
}

console.log('\ncurrent ShipTime API is used when present');
{
  const ShipTime = require('../ship_time.js');
  const ctx = runWithShipTime(ShipTime);
  check('delegates 480 → 0', ctx.sanitizeClockChangeMin(480), 0);
  check('delegates 60 → 60', ctx.sanitizeClockChangeMin(60), 60);
}

console.log('\ncall sites do not assume the method exists');
checkTrue(
  'normalizeEntry uses the safe helper',
  /e\.clockChangeMin = sanitizeClockChangeMin\(e\.clockChangeMin\)/.test(HTML)
);
checkTrue(
  'no bare ShipTime.sanitizeClockChangeMin call',
  !/window\.ShipTime \? ShipTime\.sanitizeClockChangeMin/.test(HTML)
);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
