#!/usr/bin/env node
/*
 * Received lives on Previous / Received / Consumption / R.O.B.
 * Survey panel is sounding correction only (Calculated / Measured / Difference).
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
checkTrue('ROB Received inputs', HTML.includes('data-rob-recv='));
checkTrue('readVsRobReceivedInputs helper', HTML.includes('function readVsRobReceivedInputs'));
checkTrue('ROB table has Received column', HTML.includes('Previous / Received / Consumption / R.O.B.'));
checkTrue('survey is sounding-only hint', HTML.includes('Sounding correction only'));
checkTrue('survey table has no Received header',
  /<thead><tr><th>Tank<\/th><th>Calculated<\/th><th>Measured \(survey\)<\/th><th>Difference<\/th><\/tr><\/thead>/.test(HTML));
checkTrue('no survey Received auto-fill', !HTML.includes('autoFillFromReceived') && !HTML.includes('measEl.dataset.measAuto'));
checkTrue('clear survey keeps ROB bunkers', HTML.includes('Bunkers received on the ROB table are kept'));
checkTrue('save syncs ROB Received receipts', HTML.includes('readVsRobReceivedInputs()'));

/* Balance identity: Received = R.O.B. − Previous + Consumption */
function recvFromBalance(prev, cons, rob) {
  return (Number(rob) || 0) - (Number(prev) || 0) + (Number(cons) || 0);
}
function robFromBalance(prev, recv, cons) {
  return (Number(prev) || 0) + (Number(recv) || 0) - (Number(cons) || 0);
}

console.log('\nReceived from consumption/ROB balance');
check('100 prev, 20 cons, 130 rob → 50 recv', recvFromBalance(100, 20, 130), 50);
check('100 prev, 20 cons, 80 rob → 0 recv', recvFromBalance(100, 20, 80), 0);
check('ROB = prev + recv − cons', robFromBalance(100, 50, 20), 130);

/* Keep legacy helper available for book arithmetic if still present */
if (HTML.includes('function surveyBookWithReceived')) {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(extract('surveyBookWithReceived') + '\n' + extract('formatSurveyMeasuredInput'), sandbox);
  console.log('\nlegacy surveyBookWithReceived still parses');
  check('100 + 50 recv', sandbox.surveyBookWithReceived(100, 0, 50), 150);
  check('format measured', sandbox.formatSurveyMeasuredInput(150.1234, 'fuel'), '150.123');
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
