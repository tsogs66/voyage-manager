#!/usr/bin/env node
/*
 * Received on the voyage summary ROB table must persist on the entry.
 * Run: node tests/test_rob_received_persist.js
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
check('stampRobReceivedOnEntry helper', HTML.includes('function stampRobReceivedOnEntry'));
check('entry stamped on save + apply', (HTML.match(/stampRobReceivedOnEntry\(entry\)/g) || []).length >= 2);
check('robBalanceRows prefers stored Received', HTML.includes('entryRobReceivedQty'));
check('normalizeEntry keeps robReceived', HTML.includes('robReceived'));
check('blank inputs are omitted (not forced to 0)', HTML.includes('Empty inputs are omitted'));

console.log('\npure map logic');
const sandbox = {
  document: {
    querySelectorAll(sel) {
      if (sel !== '[data-rob-recv]') return [];
      return [
        { value: '12.5', dataset: { robRecv: 'hfo', robRecvCat: 'fuel', robRecvStore: 'rob' } },
        { value: '40', dataset: { robRecv: 'cyl', robRecvCat: 'lube', robRecvStore: 'robLube' } },
        { value: '', dataset: { robRecv: 'fw1', robRecvCat: 'fw', robRecvStore: 'robLube' } },
      ];
    }
  },
  parseFwM3Field: null,
};
vm.createContext(sandbox);
vm.runInContext(
  extract('vsRobReceivedMapsFromInputs') + '\n' +
  extract('stampRobReceivedOnEntry') + '\n' +
  extract('entryRobReceivedQty'),
  sandbox
);
const entry = {};
sandbox.stampRobReceivedOnEntry(entry);
check('fuel received saved on entry', entry.robReceived && entry.robReceived.hfo === 12.5);
check('lube received saved on entry', entry.robReceivedLube && entry.robReceivedLube.cyl === 40);
check('blank FW omitted', !entry.robReceivedLube.fw1);
check('entryRobReceivedQty reads fuel', sandbox.entryRobReceivedQty(entry, 'hfo', 'fuel') === 12.5);
check('missing tank falls back', sandbox.entryRobReceivedQty(entry, 'x', 'fuel') == null);

console.log();
if (failures) { console.log(`FAILED — ${failures} of ${checks}`); process.exit(1); }
console.log(`PASSED — ${checks} checks`);
