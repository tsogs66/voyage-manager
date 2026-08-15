#!/usr/bin/env node
/*
 * Parse every piece of JavaScript the app ships, including the inline <script> blocks
 * inside voyage_manager.html. The app is one large hand-edited HTML file with no build
 * step, so a syntax error there ships silently — nothing else would catch it.
 *
 * Run: node tests/check_js_syntax.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const STANDALONE = ['eorb.js', 'ship_time.js', 'sw.js', 'scripts/sync-www.js'];
const HTML = 'voyage_manager.html';

const failures = [];
let checked = 0;

function checkSource(label, source) {
  checked += 1;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jscheck-')), 'block.js');
  fs.writeFileSync(tmp, source);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`  ok   ${label}`);
  } catch (err) {
    const detail = String(err.stderr || err.message).split('\n').slice(0, 6).join('\n      ');
    console.log(`  FAIL ${label}\n      ${detail}`);
    failures.push(label);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

for (const rel of STANDALONE) {
  const full = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(full)) {
    console.log(`  FAIL ${rel} is missing`);
    failures.push(rel);
    continue;
  }
  checkSource(rel, fs.readFileSync(full, 'utf8'));
}

const html = fs.readFileSync(path.join(REPO_ROOT, HTML), 'utf8');
/* Inline blocks only — a src= script is a separate file, checked above. */
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (blocks.length === 0) {
  console.log(`  FAIL ${HTML} has no inline <script> blocks — the extractor is broken`);
  failures.push(`${HTML} script extraction`);
}
blocks.forEach((match, i) => {
  const line = html.slice(0, match.index).split('\n').length;
  checkSource(`${HTML} inline script #${i + 1} (line ${line})`, match[1]);
});

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checked} sources did not parse`);
  process.exit(1);
}
console.log(`PASSED — ${checked} sources parse`);
