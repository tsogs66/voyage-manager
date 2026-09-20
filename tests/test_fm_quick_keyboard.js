#!/usr/bin/env node
/*
 * Enter Flowmeters popup must sit in the visual viewport when the tablet
 * numpad is open — 88vh of the layout viewport covers the focused fields.
 * Run: node tests/test_fm_quick_keyboard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nFlowmeter popup vs tablet numpad');
check('pins overlay to --vv-top / --vv-height when keyboard-open',
  /html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,280}top:\s*var\(--vv-top/.test(HTML)
  && /html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,400}height:\s*var\(--vv-height/.test(HTML));
check('dialog max-height uses visual viewport, not 88vh',
  /html\.keyboard-open \.fm-quick-dialog\{[\s\S]{0,180}max-height:\s*calc\(var\(--vv-height/.test(HTML)
  && !/html\.keyboard-open \.fm-quick-dialog\{max-height:min\(88vh/.test(HTML));
check('publishes --vv-* from visualViewport',
  HTML.includes("setProperty('--vv-height'") && HTML.includes("setProperty('--vv-top'"));
check('scrolls focused flowmeter field into view',
  HTML.includes('function keepFmQuickFieldVisible')
  && HTML.includes("el.closest('#fmQuickOverlay')"));
check('log-entry input helper includes the popup',
  /function isLogEntryInput\([\s\S]{0,280}#fmQuickOverlay/.test(HTML));

if (failures) {
  console.log(`\n${failures}/${checks} failed`);
  process.exit(1);
}
console.log(`\n${checks} checks passed`);
