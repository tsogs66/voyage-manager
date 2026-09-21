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
check('keeps overlay full-screen when keyboard-open (no visualViewport pin)',
  /html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,280}justify-content:\s*center/.test(HTML)
  && /html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,280}inset:\s*0/.test(HTML)
  && !/html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,280}top:\s*var\(--vv-top/.test(HTML)
  && !/html\.keyboard-open \.fm-quick-overlay\{[\s\S]{0,400}width:\s*var\(--vv-width/.test(HTML));
check('dialog max-height uses visual viewport, not 88vh',
  /html\.keyboard-open \.fm-quick-dialog\{[\s\S]{0,180}max-height:\s*calc\(var\(--vv-height/.test(HTML)
  && !/html\.keyboard-open \.fm-quick-dialog\{max-height:min\(88vh/.test(HTML));
check('landscape tablet dialog fills the overlay instead of a 760px card',
  /html\.landscape-view \.fm-quick-dialog/.test(HTML)
  && /width:\s*min\(1180px/.test(HTML)
  && !/width:min\(760px/.test(HTML)
  && !/width:\s*min\(760px/.test(HTML));
check('publishes --vv-* from visualViewport',
  HTML.includes("setProperty('--vv-height'") && HTML.includes("setProperty('--vv-top'"));
check('scrolls focused flowmeter field into view',
  HTML.includes('function keepFmQuickFieldVisible')
  && HTML.includes("el.closest('#fmQuickOverlay')"));
check('log-entry input helper includes the popup',
  /function isLogEntryInput\([\s\S]{0,280}#fmQuickOverlay/.test(HTML));
check('popup numeric fields are text+decimal so select-all works on Android',
  HTML.includes('inputmode="decimal" autocomplete="off" id="fmq_blr_meter"')
  && HTML.includes('inputmode="decimal" autocomplete="off" id="fmq_${prefix}_meter"'));
check('select-all helper exists and is used on overlay click/focus',
  HTML.includes('function selectAllEditableField')
  && HTML.includes('function bindFmQuickSelectAll')
  && HTML.includes('selectAllEditableField(el)'));
check('reparents overlay to body so Android/AIO containing blocks cannot clip it',
  HTML.includes('if (overlay.parentElement !== document.body) document.body.appendChild(overlay)'));
check('dialog is a flex column so Accept stays pinned',
  /\.fm-quick-dialog\{[\s\S]{0,280}flex-direction:\s*column/.test(HTML)
  && /\.fm-quick-actions\{[\s\S]{0,220}flex:\s*0 0 auto/.test(HTML)
  && /\.fm-quick-actions\{[\s\S]{0,220}position:\s*sticky/.test(HTML));
check('a tap on the field already being edited is left alone (caret, not select-all)',
  /let wasFocused = false;/.test(HTML)
  && /overlay\.addEventListener\('pointerdown'[\s\S]{0,200}wasFocused =/.test(HTML)
  && /const keep = \(e\)=>\{[\s\S]{0,400}if \(wasFocused\) return;/.test(HTML));
check('the popup no longer cancels the tap it fires on',
  !/e\.cancelable && e\.type !== 'touchend'\) e\.preventDefault\(\)/.test(HTML));
check('the deferred re-select gives way to a caret the engineer placed',
  /setTimeout\(\(\)=>\{[\s\S]{0,420}el\.selectionStart !== el\.selectionEnd\) return;[\s\S]{0,120}el\.selectionStart !== 0\) return;/.test(HTML));
check('reading selectionStart off a number input cannot abort the decimal coercion',
  /let start = null;\s*try \{ start = el\.selectionStart; \} catch\(_e\)\{\}\s*el\.value = out;/.test(HTML));
check('landscape tablet uses two columns of flowmeter rows',
  /html\.landscape-view \.fm-quick-rows,[\s\S]{0,80}html\.vm-land-rows \.fm-quick-rows\{[\s\S]{0,120}grid-template-columns:\s*1fr 1fr/.test(HTML));

if (failures) {
  console.log(`\n${failures}/${checks} failed`);
  process.exit(1);
}
console.log(`\n${checks} checks passed`);
