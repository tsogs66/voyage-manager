/**
 * Signed numeric helper for bunker survey correction (+/−) on Android.
 * Run: node scripts/test-signed-numeric-input.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = path.join(__dirname, '..', 'signed-numeric-input.js');
const html = path.join(__dirname, '..', 'voyage_manager.html');
const sw = path.join(__dirname, '..', 'sw.js');

assert.ok(fs.existsSync(js), 'signed-numeric-input.js missing');
const src = fs.readFileSync(js, 'utf8');
assert(src.includes('[data-survey-corr]'), 'must target survey correction inputs');
assert(src.includes('applyAccessoryChar'), 'must insert via accessory buttons');
assert(src.includes('lastSignedInput'), 'must keep target field when Insert is tapped');

const page = fs.readFileSync(html, 'utf8');
assert(page.includes('signed-numeric-input.js'), 'voyage_manager must load signed-numeric-input.js');
assert(/data-signed="1" data-survey-corr/.test(page) || page.includes('data-signed="1"'),
  'survey correction inputs must be marked data-signed');

const swSrc = fs.readFileSync(sw, 'utf8');
assert(swSrc.includes("'./signed-numeric-input.js'"), 'sw precache must include signed-numeric-input.js');

console.log('ok — signed-numeric-input (voyage)');
