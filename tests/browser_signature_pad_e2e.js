/*
 * Draw-to-sign pad and the signature block on the printed sheet, driven in a real
 * browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_signature_pad_e2e.js
 *
 * Signs the pad with pointer events the way a stylus or fingertip would, saves it
 * against the Chief Engineer, and checks the ink comes back as a transparent PNG
 * that prints on the sheet. Then measures the printed block: the stamp struck so it
 * touches only the left quarter of the signature line, and the two image sizes. Not
 * in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e, tol = 0.75) => {
  c++;
  const ok = a === e || (typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) < tol);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${e}, got ${a}`}`);
  if (!ok) f++;
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const dialogs = [];
  pg.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);
  await pg.evaluate(() => switchTab('voyagesetup'));
  await pg.waitForTimeout(800);

  console.log('\nthe pad');
  const pad = await pg.$('#chEngSignaturePad');
  check('is on the Chief Engineer Signature panel', !!pad, true);
  check('the upload input is still offered beside it', !!(await pg.$('#chEngSignatureFile')), true);
  const before = await pg.evaluate(() =>
    ['btnSigPadUndo', 'btnSigPadClear', 'btnSigPadSave'].every(id => document.getElementById(id).disabled));
  check('its buttons are dead until something is drawn', before, true);

  /* Sign it — two strokes, so undo has something to drop. */
  const box = await pad.boundingBox();
  await pg.mouse.move(box.x + 50, box.y + 105);
  await pg.mouse.down();
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    await pg.mouse.move(box.x + 50 + t * 240, box.y + 105 - Math.sin(t * Math.PI * 3) * 36);
  }
  await pg.mouse.up();
  await pg.mouse.move(box.x + 120, box.y + 128);
  await pg.mouse.down();
  await pg.mouse.move(box.x + 300, box.y + 120);
  await pg.mouse.up();
  await pg.waitForTimeout(200);

  const after = await pg.evaluate(() =>
    ['btnSigPadUndo', 'btnSigPadClear', 'btnSigPadSave'].every(id => !document.getElementById(id).disabled));
  check('drawing wakes the buttons up', after, true);

  const twoStrokes = await pg.evaluate(() => chEngSigPad.toDataUrl().length);
  await pg.click('#btnSigPadUndo');
  const oneStroke = await pg.evaluate(() => chEngSigPad.toDataUrl().length);
  check('undo drops the last stroke only', oneStroke !== twoStrokes && oneStroke > 0, true);

  console.log('\nsaving it');
  await pg.evaluate(() => { document.getElementById('s_chEng').value = ''; state.setup.chEng = ''; });
  await pg.click('#btnSigPadSave');
  await pg.waitForTimeout(300);
  check('an unnamed officer is refused', /name first/.test(dialogs[dialogs.length - 1] || ''), true);

  await pg.evaluate(() => { document.getElementById('s_chEng').value = 'M. ENDOZO'; });
  await pg.click('#btnSigPadSave');
  await pg.waitForTimeout(600);
  const stored = await pg.evaluate(() => signatureForChEng('M. ENDOZO') || '');
  check('it is filed against that name', stored.startsWith('data:image/png;base64,'), true);

  /* Ink on transparent paper, not a white box that would print over the sheet. */
  const ink = await pg.evaluate(() => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const x = cv.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0, opaque = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] === 0) clear++; else if (d[i] > 200) opaque++; }
      res({ clear, opaque, total: cv.width * cv.height });
    };
    img.src = signatureForChEng('M. ENDOZO');
  }));
  check('most of it is transparent', ink.clear > ink.total * 0.8, true);
  check('and some of it is ink', ink.opaque > 0, true);

  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3500);
  check('it survives a reload', await pg.evaluate(() => !!signatureForChEng('M. ENDOZO')), true);

  console.log('\nthe signature block on the printed sheet');
  const out = await pg.evaluate(() => {
    /* A square stamp, so its measured height and width are comparable. */
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
      '<circle cx="200" cy="200" r="190" fill="none" stroke="#1b4a8a" stroke-width="12"/></svg>';
    state.setup.vesselStamp = 'data:image/svg+xml;base64,' + btoa(svg);
    const e = state.entries[state.entries.length - 1];
    e.chEng = 'M. ENDOZO';
    return { css: printDocumentCss(), sheet: buildVoyageNoonSheetHTML(e) };
  });
  const pg2 = await b.newPage({ viewport: { width: 820, height: 1400 } });
  await pg2.setContent(`<style>body{margin:0;background:#fff}.wrap{width:204mm;padding:3mm;box-sizing:border-box}${out.css}</style><div class="wrap">${out.sheet}</div>`);
  await pg2.waitForTimeout(500);

  const g = await pg2.evaluate(() => {
    const line = document.querySelector('.pr-sign-line').getBoundingClientRect();
    const stamp = document.querySelector('.pr-sign-stamp img').getBoundingClientRect();
    const sig = document.querySelector('.pr-sign-space img').getBoundingClientRect();
    const name = document.querySelector('.pr-sign-name').getBoundingClientRect();
    const mm = px => px / (line.width / 42);
    return {
      stampRightFromLineLeft: stamp.right - line.x,
      aQuarterOfLine: line.width / 4,
      lineWidth: line.width,
      hangsOffToTheLeft: line.x - stamp.x,
      stampCentreOffLine: stamp.y + stamp.height / 2 - line.y,
      stampMm: mm(stamp.height),
      sigHMm: mm(sig.height),
      overlapsTheLine: stamp.x < line.right && stamp.right > line.x,
      clearOfTheName: stamp.right < name.right
    };
  });
  check('the stamp\'s right edge lands on the line\'s quarter mark', g.stampRightFromLineLeft, g.aQuarterOfLine);
  check('so it touches only the left quarter of the line', g.overlapsTheLine, true);
  /* The rest of a stamp wider than the line hangs off to the left rather than
     covering the name, which is right-aligned at the far end of the block. */
  check('the rest of it hangs off to the left', g.hangsOffToTheLeft > g.lineWidth / 2, true);
  check('leaving the printed name clear', g.clearOfTheName, true);
  check('and it sits level with the line itself', g.stampCentreOffLine, 0);
  check('the stamp prints 42.64mm tall', g.stampMm, 42.64);
  check('the signature prints 16.8mm tall', g.sigHMm, 16.8);

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
