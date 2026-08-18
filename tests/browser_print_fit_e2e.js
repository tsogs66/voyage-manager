/*
 * A full noon report has to fit on the paper, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_print_fit_e2e.js
 *
 * The portrait page is a fixed A4 with overflow hidden, so anything the fit pass
 * fails to shrink is simply cut off. The noon and report sheets used to be exempt
 * from densifying AND floored at 0.85 scale, so a busy sea day — weather, M/E
 * cylinder detail, ECA, tank soundings and three generators at once — needed 0.72
 * and got 0.85, losing the remarks, the signature block, the stamp and the printed-on
 * line off the bottom of the page. Builds that sheet through the real print path and
 * checks every part of it lands inside the page box. Not in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = a === e || (typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) < 1e-6);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

const stampSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">'
  + '<circle cx="210" cy="210" r="196" fill="none" stroke="#1b4a8a" stroke-width="10"/></svg>';
const sigSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">'
  + '<path d="M20 150 C120 40 240 170 360 90 S520 30 580 120" fill="none" stroke="#10233d" stroke-width="7"/></svg>';

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1000, height: 1400 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  const geom = await pg.evaluate(async (args) => {
    /* The tall version of the sheet: main engine working and every optional block
       filled in, which is what a real noon report at sea in an ECA looks like. */
    const list = sortedEntries();
    const e = list[list.length - 1];
    const prev = list[list.length - 2];
    e.operation = 'AT SEA - NOON';
    e.rpm = 80;
    e.revCounter = (prev.revCounter || 0) + 115200;
    e.me.meter = (prev.me.meter || 0) + 42000;
    e.distanceShip = 340;
    e.weather = { windDir: 'NE', windBft: 4, seaState: 3, swellDir: 'NE', airTemp: 28, seaTemp: 29 };
    e.report = Object.assign({}, e.report, {
      pumpRack: [5.2, 5.1, 5.3, 5.2, 5.1, 5.2],
      exhaustTemp: [340, 345, 342, 338, 341, 344],
      turbos: [{ in: 380, out: 210, rpm: 9800 }, { in: 378, out: 208, rpm: 9750 }],
      scavTemp: 42, scavPress: 1.8, fuelTemp: 128, meLoTemp: 45, meLoPress: 3.2,
      eca: { grade: 'LSMGO', start: '2026-07-05T04:00', end: '2026-07-05T05:30', robIn: 120.5, robOut: 118.2, distNm: 62.4 },
      soundings: Object.fromEntries([...fuelTankList(), ...lubeTankList(), ...fwTankList()]
        .map((t, i) => [t.id, { soundingCm: 120 + i, tempC: 30 + i, volume: 100 + i }])),
      remarks: 'Vessel proceeding on passage. Main engine and auxiliaries running normally. '
        + 'Fuel changeover to LSMGO completed prior to ECA entry, log entries and ORB updated. '
        + 'Purifier overhauled during the watch; boiler pilot burner on distillate.'
    });
    state.setup.generatorCount = 3;
    state.setup.geArrangement = 'THREE';
    state.setup.vesselStamp = 'data:image/svg+xml;base64,' + btoa(args.stamp);
    const name = state.setup.chEng;
    chEngSignatureMap()[name] = 'data:image/svg+xml;base64,' + btoa(args.sig);
    e.chEng = name;

    /* Exactly what printPortraitSinglePage builds, short of calling print(). */
    const bodyInner = '<div class="pr-page-portrait"><div class="pr-page-portrait-inner">'
      + buildVoyageNoonSheetHTML(e) + '</div></div>';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(buildPrintDocumentHtmlPortrait(bodyInner));
    doc.close();
    await new Promise(r => setTimeout(r, 400));

    /* What the sheet needs before any fitting, for the record. */
    const pageEl = doc.querySelector('.pr-page-portrait');
    const innerEl = doc.querySelector('.pr-page-portrait-inner');
    innerEl.style.zoom = '1';
    const naturalNeed = (pageEl.clientHeight - 2) / innerEl.scrollHeight;

    const scale = fitPrintPortraitRoot(doc);
    await new Promise(r => setTimeout(r, 300));

    const box = sel => {
      const el = doc.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const page = box('.pr-page-portrait');
    const parts = {};
    for (const [name2, sel] of [
      ['stamp', '.pr-sign-stamp img'],
      ['signature', '.pr-sign-space img'],
      ['signatureLine', '.pr-sign-line'],
      ['signerName', '.pr-sign-name'],
      ['printedOn', '.pr-foot'],
      ['remarks', '.pr-remarks'],
      ['robTable', '.pr-noon-full table.pr-table']
    ]) {
      const r = box(sel);
      parts[name2] = r ? {
        belowPage: +(r.bottom - page.bottom).toFixed(1),
        pastRight: +(r.right - page.right).toFixed(1),
        pastLeft: +(page.left - r.left).toFixed(1)
      } : null;
    }
    return { naturalNeed: +naturalNeed.toFixed(3), scale: +scale.toFixed(3), parts };
  }, { stamp: stampSvg, sig: sigSvg });

  console.log(`\nthe sheet needs ${geom.naturalNeed} to fit and the fit pass chose ${geom.scale}`);
  check('it did not force a scale the page cannot hold', geom.scale <= 1, true);

  console.log('\nevery part of the sheet lands on the paper');
  for (const [name, p] of Object.entries(geom.parts)) {
    check(`${name} is present`, p !== null, true);
    if (!p) continue;
    check(`${name} is above the bottom edge`, p.belowPage < 0, true);
    check(`${name} is inside the right edge`, p.pastRight < 0, true);
    check(`${name} is inside the left edge`, p.pastLeft < 0, true);
  }

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
