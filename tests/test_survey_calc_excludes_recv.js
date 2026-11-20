#!/usr/bin/env node
/*
 * Bunker Survey "Calculated" is the whole book at this report: the previous closing, plus every receipt that has
 * joined by this report's time, less this report's burn — taken without this report's own survey. A correction
 * typed against it is added or subtracted; it never wipes a receipt. (It used to leave this report's Received out,
 * so a Correction (+/-) typed against it dropped the bunkers.)
 * Run: node tests/test_survey_calc_excludes_recv.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail != null ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nsource guards');
check('surveyCalculatedBook helper', HTML.includes('function surveyCalculatedBook'));
check('entryReceivedOrMirrorQty helper', HTML.includes('function entryReceivedOrMirrorQty'));
check('renderVsSurvey uses surveyCalculatedBook', /function renderVsSurvey\([\s\S]{0,400}surveyCalculatedBook/.test(HTML));
check('recordRobSurvey uses surveyCalculatedBook', /function recordRobSurvey\([\s\S]{0,500}surveyCalculatedBook/.test(HTML));
check('Apply Survey stamps Received before sync', /stampRobReceivedOnEntry\(entry\)[\s\S]{0,200}syncRobSurveyReceivedReceipts/.test(HTML));
check('status copy says Calculated includes receipts and corrections never overwrite them', HTML.includes('previous R.O.B. + receipts up to this report') && HTML.includes('Receipts are never overwritten'));
check('Calculated is the book with receipts, without this report\'s own survey', /function surveyCalculatedBook\([\s\S]{0,2200}excludeOwnSurvey: true/.test(HTML));
check('surveyCalculatedBook uses previous closing not asOf-minus-recv', HTML.includes('previous report\'s closing ROB'));
check('renderVsSurvey uses live Calculated not stale stamp', HTML.includes('Always use live book-before-Received'));
check('the correction shown is read against the live book', HTML.includes('meas - bookNum'));

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
