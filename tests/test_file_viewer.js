/**
 * Uploaded files open in the in-app viewer (zoom, pinch, wheel, double tap), the Reports tab is in
 * the order the chief engineer reads it, and the flowmeter popup holds only meter inputs.
 *
 * A new browser tab (window.open) does not exist inside the Android app or the AIO frame, which is
 * why the card previews did nothing there. Everything that used one now goes through
 * ChengFileViewer. Checked here as text; tests/browser_* drive it in a real browser.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; };

const html = read('voyage_manager.html');
const viewer = read('file-viewer.js');
ok(/<script src="file-viewer\.js"><\/script>/.test(html), 'the page loads file-viewer.js');
ok(read('sw.js').includes("'./file-viewer.js'"), 'the service worker caches it for offline use');
ok(read('scripts/app-assets.json').includes('"file-viewer.js"'), 'the Android / installer file list carries it');
ok(!/window\.open\(/.test(html), 'no preview opens a new tab');
for (const fn of ['previewFlowmeterRecordSample', 'previewLogEntryDataSample', 'viewPrintHistoryRecord']) {
  const i = html.indexOf('function ' + fn);
  ok(i > 0 && /ChengFileViewer\.openHtml\(/.test(html.slice(i, i + 3500)), fn + ' opens in the viewer');
}
ok(/function showBdnDocument\(doc\)\{[\s\S]{0,400}ChengFileViewer\.open\(/.test(html), 'BDN documents open in the viewer');
ok(/function openReqFile\([\s\S]{0,500}ChengFileViewer\.open\(/.test(html), 'requisition files open in the viewer');
for (const alt of ['Attached voyage summary photo', "Vessel stamp", 'Chief Engineer signature']) {
  ok(new RegExp('alt="' + alt + '" data-viewer').test(html), alt + ' opens full screen when tapped');
}

/* viewer behaviours that matter on a phone */
ok(/pointerdown/.test(viewer) && /pinch/.test(viewer), 'two-finger pinch zoom');
ok(/wheel/.test(viewer) && /ctrlKey/.test(viewer), 'Ctrl + wheel zoom on Windows');
ok(/dblclick|lastTap/.test(viewer), 'double tap toggles fit / zoom');
ok(/touch-action:none/.test(viewer), 'the stage takes the gestures itself');
ok(/min-height:44px/.test(viewer), 'controls are finger-sized');
ok(/Escape/.test(viewer), 'Esc closes it');

/* Reports tab order */
const a = html.indexOf('id="page-reports"');
const b = html.indexOf('id="page-orb"');
const titles = [...html.slice(a, b).matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(m => m[1].trim());
const want = ['Select Report Category', 'Matching Entries', 'Supplementary Report', 'Flowmeter and Manual Consumption', 'Flowmeter Card', 'Log Entry Data Card'];
const got = want.map(w => titles.findIndex(t => t.startsWith(w)));
ok(got.every(i => i >= 0), 'every Reports panel is there: ' + titles.join(' | '));
ok(got.every((v, i) => i === 0 || v > got[i - 1]), 'Reports order: category, matching entries, [editor], flowmeter and manual consumption, flowmeter card, log entry data card');

/* Flowmeter popup: inputs only */
const ps = html.indexOf('id="fmQuickOverlay"');
const pe = html.indexOf('fm-quick-actions', ps);
const popup = html.slice(ps, pe);
ok(!/<select/i.test(popup), 'the flowmeter popup has no list boxes');
for (const id of ['fmq_meMeters', 'fmq_geMeters', 'fmq_blr_meter', 'fmq_cyl_meter', 'fmq_revCounter', 'fmq_rpm', 'fmq_fwProd']) {
  ok(popup.includes('id="' + id + '"'), 'popup keeps ' + id);
}
ok(!/fmq_(me|ge|blr)_type|fmq_tbn/.test(html), 'nothing reads the removed list boxes');
console.log(`file viewer / reports / flowmeter popup: ${pass} checks passed`);
