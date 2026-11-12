/*
 * ChEng AIO "Load vessel data" must reach the Voyage page: the shell posts
 * chengaio-load-vessel-data, the page picks the ship's latest leg and answers.
 * The handler was once lost when a copy of this page from an older snapshot was
 * mirrored over it, so the pieces are pinned here.
 *
 * Run: node tests/test_load_vessel_data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');
for (const re of [
  /function pickLatestVoyageLeg/,
  /function voyageLegEntryTime/,
  /function voyageLegContentStamp/,
  /async function loadLatestVoyageDataForActiveVessel/,
  /async function runChengAioLatestLoad/,
  /function paintActiveVesselLabel/,
  /function chengAioShellVesselName/,
  /chengaio-load-vessel-data/,
  /chengaio-vessel-data-loaded/,
  /aioLoadLatest/,
  /chengAioLoadLatest/,
  /nonce: msg\.nonce/,
]) {
  assert.match(html, re, 'Voyage page is missing ' + re);
}
/* One definition each: a second copy pasted in would silently win. */
for (const name of ['pickLatestVoyageLeg', 'runChengAioLatestLoad', 'vesselImoById', 'matchVesselForImport']) {
  const n = (html.match(new RegExp('function ' + name + '\\(', 'g')) || []).length;
  assert.strictEqual(n, 1, name + ' is defined ' + n + ' times');
}
console.log('ok — Voyage page handles Load vessel data');
