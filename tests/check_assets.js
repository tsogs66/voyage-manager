#!/usr/bin/env node
/*
 * The service worker's cache name and precache list are duplicated inside
 * voyage_manager.html (androidInstallCacheName / androidInstallAssets), which drives the
 * Android install progress UI. They are edited by hand on every release, so they drift:
 * a stale cache name leaves phones on the previous build after an update. Check they
 * still agree, and that every precached path exists.
 *
 * Run: node tests/check_assets.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(REPO_ROOT, 'voyage_manager.html'), 'utf8');

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function matchOrDie(source, re, what) {
  const m = source.match(re);
  if (!m) {
    console.log(`  FAIL could not find ${what} — update tests/check_assets.js if it was renamed`);
    failures.push(what);
    return null;
  }
  return m[1];
}

const swCache = matchOrDie(sw, /const CACHE = '([^']+)'/, 'CACHE in sw.js');
const htmlCache = matchOrDie(html, /androidInstallCacheName = '([^']+)'/, 'androidInstallCacheName in voyage_manager.html');
if (swCache && htmlCache) {
  check('app cache name matches the service worker cache name', htmlCache, swCache);
}

function parsePathList(source, re, what) {
  const raw = matchOrDie(source, re, what);
  if (raw === null) return null;
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const precache = parsePathList(sw, /const PRECACHE = \[([\s\S]*?)\]/, 'PRECACHE in sw.js');
const installAssets = parsePathList(html, /androidInstallAssets = \[([\s\S]*?)\]/, 'androidInstallAssets in voyage_manager.html');
if (precache && installAssets) {
  check('Android install asset list matches the service worker precache list', installAssets, precache);
}

for (const rel of precache || []) {
  checked += 1;
  const full = path.join(REPO_ROOT, rel);
  if (fs.existsSync(full)) {
    console.log(`  ok   precached ${rel} exists`);
  } else {
    console.log(`  FAIL precached ${rel} does not exist`);
    failures.push(`precached ${rel}`);
  }
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checked} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checked} checks`);
