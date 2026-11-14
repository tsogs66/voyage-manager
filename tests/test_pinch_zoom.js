/**
 * Pinch-to-zoom stays available, and the signature stamp stays inside the sheet.
 *
 * `maximum-scale=1` (or `user-scalable=no`) in the viewport tag turns off pinch zoom on
 * Android, which leaves anyone with poor eyesight unable to enlarge a page. Each page also
 * re-writes its own viewport tag every 1.5 s to keep "Desktop site" off, so the string in
 * that script has to be free of it as well as the tag.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass += 1; };

for (const file of ['voyage_manager.html']) {
  const text = read(file);
  const tags = text.match(/content\s*=\s*"[^"]*width=device-width[^"]*"|const WANT = '[^']*'/g) || [];
  ok(tags.length >= 2, `${file}: expected the viewport tag and the viewport lock script`);
  for (const t of tags) {
    ok(!/maximum-scale/i.test(t), `${file}: ${t} blocks pinch zoom`);
    ok(!/user-scalable\s*=\s*(no|0)/i.test(t), `${file}: ${t} blocks pinch zoom`);
  }
}

/* Same for the printed signature block: the stamp is a flex strip (not absolute + transform,
   which Android's PrintManager drops), a stamped row is as tall as the stamp's reach, and the
   fit pass leaves out the page's own top padding. */
const html = read('voyage_manager.html');
ok(html.includes('.pr-sign-row.has-stamp{ min-height:38.2mm; }'), 'a stamped signature row reserves the stamp\'s reach');
ok(html.includes("pr-sign-row${stamp ? ' has-stamp' : ''}"), 'printSignatory marks a stamped row');
ok(html.includes('page.clientHeight - padTop - 8'), 'the portrait fit pass leaves out the page padding');

console.log(`pinch zoom: ${pass} checks passed`);
