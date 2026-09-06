#!/usr/bin/env node
/*
 * Bunker survey: typing Received auto-fills Measured as current ROB + Received.
 * Run: node tests/test_survey_recv_meas.js
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
    (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures.push(label);
}

function checkTrue(label, v) { check(label, !!v, true); }

function extract(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

console.log('\nsource guards');
checkTrue('surveyBookWithReceived helper', HTML.includes('function surveyBookWithReceived'));
checkTrue('formatSurveyMeasuredInput helper', HTML.includes('function formatSurveyMeasuredInput'));
checkTrue('Received input auto-fills Measured', HTML.includes('measEl.dataset.measAuto = \'1\''));
checkTrue('prefill when Received already set', HTML.includes('autoFillFromReceived'));
checkTrue('hint mentions auto Measured', HTML.includes('Measured fills in as current R.O.B. + Received'));

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  extract('surveyBookWithReceived') + '\n' + extract('formatSurveyMeasuredInput'),
  sandbox
);

console.log('\nMeasured = current ROB + Received');
check('100 ROB + 50 received → 150', sandbox.surveyBookWithReceived(100, 0, 50), 150);
check('book already included 40 receipt; typed 50 → 150', sandbox.surveyBookWithReceived(140, 40, 50), 150);
check('clear received (typed 0, base 40) → 100', sandbox.surveyBookWithReceived(140, 40, 0), 100);
check('no typed amount keeps base-minus-prefill', sandbox.surveyBookWithReceived(140, 40, NaN), 100);

console.log('\nformat measured input');
check('fuel rounded', sandbox.formatSurveyMeasuredInput(150.1234, 'fuel'), '150.123');
check('null is blank', sandbox.formatSurveyMeasuredInput(null, 'fuel'), '');

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
