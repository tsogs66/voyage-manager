#!/usr/bin/env node
/*
 * Login-gate colours must follow theme tokens. Hardcoded near-white ghost
 * labels (#e8eef7) vanish on the bright-mode white card.
 *
 * Run: node tests/test_login_theme.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function blockBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error(`missing ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`missing ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

function tokenMap(cssBlock) {
  const map = {};
  for (const m of cssBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(hexA, hexB) {
  const l1 = relLuminance(hexToRgb(hexA));
  const l2 = relLuminance(hexToRgb(hexB));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const loginCss = blockBetween(HTML, '/* ---- Login gate ---- */', '.vessel-locked-note{');
const rootCss = blockBetween(HTML, ':root{', 'html.bright{');
const brightCss = blockBetween(HTML, 'html.bright{', 'html.bright body{');
const dark = tokenMap(rootCss);
const bright = tokenMap(brightCss);

console.log('\nlogin ghost labels follow theme tokens');
check('ghost colour is --paper', loginCss.includes('button.ghost{background:transparent;border:1px solid var(--line-strong);color:var(--paper);}'), true);
check('ghost hover stays --paper', loginCss.includes('button.ghost:hover{background:var(--nav-item-bg);color:var(--paper);}'), true);
check('no leftover near-white ghost colour', /button\.ghost\{[^}]*#e8eef7/.test(loginCss), false);
check('no leftover white ghost hover', /button\.ghost:hover\{[^}]*color:#fff/.test(loginCss), false);

console.log('\nlogin card and fields follow theme tokens');
check('card uses panel + paper', loginCss.includes('background:var(--panel);color:var(--paper);border:1px solid var(--line-strong);'), true);
check('inputs use ink + paper', loginCss.includes('border:1px solid var(--line-strong);background:var(--ink);color:var(--paper);'), true);
check('signed-in strip uses nav-item-bg', loginCss.includes('background:var(--nav-item-bg);border:1px solid var(--line);color:var(--paper);'), true);
check('status error uses --alert', loginCss.includes('.login-status.err{color:var(--alert);}'), true);
check('status ok uses --good', loginCss.includes('.login-status.ok{color:var(--good);}'), true);

console.log('\nprimary brass stays readable in both themes');
check('primary is brass on navy', loginCss.includes('button.primary{background:#c99a53;border:1px solid #c99a53;color:#0a1420;'), true);

console.log('\ncontrast of ghost label vs card');
const darkRatio = contrastRatio(dark.paper, dark.panel);
const brightRatio = contrastRatio(bright.paper, bright.panel);
const oldBrightRatio = contrastRatio('#e8eef7', bright.panel);
check('dark theme ghost vs panel >= 4.5', darkRatio >= 4.5, true);
check('bright theme ghost vs panel >= 4.5', brightRatio >= 4.5, true);
check('old hardcoded ghost would fail on bright card', oldBrightRatio < 2, true);
check(`dark contrast ${darkRatio.toFixed(2)}`, true, true);
check(`bright contrast ${brightRatio.toFixed(2)}`, true, true);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
