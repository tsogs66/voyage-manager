#!/usr/bin/env node
/*
 * Received on a voyage summary entry must raise that entry's closing ROB and
 * become the next report's Previous (opening ROB).
 * Run: node tests/test_recv_carry_next.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let checks = 0, failures = 0;
function check(label, cond) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}
function checkEq(label, actual, expected) {
  const ok = Object.is(actual, expected) ||
    (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9);
  checks++;
  console.log(ok ? `  ok  ${label}` : `  FAIL ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures++;
}

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
check('stampedReceivedAsOf helper', HTML.includes('function stampedReceivedAsOf'));
check('entryHasStampedReceived helper', HTML.includes('function entryHasStampedReceived'));
check('robAsOf uses stamped Received', HTML.includes('stampedReceivedAsOf(t.id, \'fuel\''));
check('day-based receipt cutoff', HTML.includes('rDay > cutoffDay'));
check('sync stores entry.datetime on receipt', HTML.includes('Use the entry datetime'));

console.log('\nstamped Received carries into later ROB');
const sandbox = {
  state: {
    entries: [
      { id: 'e1', datetime: '2026-09-01T12:00:00', robReceived: { hfo: 50 }, robReceivedLube: {} },
      { id: 'e2', datetime: '2026-09-02T12:00:00', robReceived: {}, robReceivedLube: {} },
    ],
    receipts: [],
    setup: { rob: { hfo: 100 }, robLube: {} },
  },
  receiptDayAfter(a, b) {
    return String(a || '').slice(0, 10) > String(b || '').slice(0, 10);
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  extract('entryHasStampedReceived') + '\n' + extract('stampedReceivedAsOf'),
  sandbox
);

const cut1 = new Date('2026-09-01T12:00:00');
const cut2 = new Date('2026-09-02T12:00:00');
checkEq('e1 closing includes 50 received', sandbox.stampedReceivedAsOf('hfo', 'fuel', cut1, null), 50);
checkEq('e2 opening chain still has e1 received', sandbox.stampedReceivedAsOf('hfo', 'fuel', cut2, null), 50);
checkEq('before e1 is zero', sandbox.stampedReceivedAsOf('hfo', 'fuel', new Date('2026-08-31T12:00:00'), null), 0);

const survey = { date: '2026-09-01T12:00:00', entryId: 'e1' };
checkEq('after survey, e1 received not re-added (inside measured)', sandbox.stampedReceivedAsOf('hfo', 'fuel', cut2, survey), 0);

sandbox.state.entries.push({ id: 'e3', datetime: '2026-09-03T12:00:00', robReceived: { hfo: 20 }, robReceivedLube: {} });
checkEq('post-survey entry received still counts', sandbox.stampedReceivedAsOf('hfo', 'fuel', new Date('2026-09-03T12:00:00'), survey), 20);

console.log();
if (failures) {
  console.log(`FAILED — ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
