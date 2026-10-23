#!/usr/bin/env node
'use strict';
const assert = require('assert');
const stem = require('../stem-advice.js');

const covered = stem.advise(
  { unpumpableMt: 15, weatherMarginMt: 20 },
  { required: 400, rob: 500, receive: 0 }
);
assert.strictEqual(covered.orderMt, 0);
assert.strictEqual(covered.arrivalMt, 100);
assert.strictEqual(covered.usableMt, 85);

const short = stem.advise(
  { unpumpableMt: 15, weatherMarginMt: 20 },
  { required: 400, rob: 300, receive: 0 }
);
assert.strictEqual(short.orderMt, 135);
assert.strictEqual(short.arrivalMt, 35);
assert.strictEqual(short.usableMt, 20);
assert.ok(stem.sentence('HFO', short, (n) => n.toFixed(3)).startsWith('Order 135.000 MT HFO.'));

const partial = stem.advise(
  { unpumpableMt: 15, weatherMarginMt: 20 },
  { required: 400, rob: 300, receive: 100 }
);
assert.strictEqual(partial.orderMt, 135);
assert.strictEqual(partial.stemStill, 35);
assert.ok(stem.sentence('LSFO', partial, (n) => n.toFixed(3)).includes('order another 35.000 MT'));

const blank = stem.advise({}, { required: 10, rob: null, receive: 0 });
assert.strictEqual(blank.orderMt, null);
assert.strictEqual(stem.sentence('HFO', blank), 'Enter current ROB to see what to order.');

const none = stem.advise({}, { required: 100, rob: 80, receive: 0 });
assert.strictEqual(none.orderMt, 20);
assert.strictEqual(none.stemStill, 20);

console.log('stem advice ok');
