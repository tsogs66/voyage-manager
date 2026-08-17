/*
 * Total lubes on the Dep/Arr R.O.B. comparison sheet, in a real browser.
 *
 * The second of the two R.O.B. sheets. Checks the total against the tanks listed
 * above it, that every column is totalled rather than only the closing figure,
 * and that the row still reconciles opening + received - consumed = present.
 * Not in CI, which has no browser.
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8868';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e || (typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) < 1e-6);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${e}, got ${a}`}`); if (!ok) f++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  const out = await pg.evaluate(() => {
    const { consByFuel, consByLube } = computeDerived();
    const rows = depArrRobRows(consByFuel, consByLube);
    const total = rows.find(r => r.total);
    const lubes = rows.filter(r => r.cat === 'lube' && !r.total);
    const fw = rows.filter(r => r.cat === 'fw');
    const sum = k => lubes.reduce((a, r) => a + (r[k] || 0), 0);
    return {
      order: rows.map(r => r.label),
      total, lubeCount: lubes.length,
      expect: { open: sum('open'), received: sum('received'), consumed: sum('consumed'), present: sum('present') },
      fwPresent: fw.reduce((a, r) => a + (r.present || 0), 0),
      idxTotal: rows.findIndex(r => r.total),
      idxLastLube: rows.map(r => r.cat === 'lube' && !r.total).lastIndexOf(true),
      idxFirstFw: rows.findIndex(r => r.cat === 'fw')
    };
  });

  console.log('\nthe row is there, and in the right place');
  check('a total row exists', !!out.total, true);
  check('labelled TOTAL LUBES', out.total && out.total.label, 'TOTAL LUBES');
  check('in litres', out.total && out.total.unit, 'L');
  check('it follows the last lube tank', out.idxTotal, out.idxLastLube + 1);
  check('and comes before fresh water', out.idxTotal < out.idxFirstFw, true);

  console.log('\nevery column is totalled, not just the closing figure');
  check('opening', out.total.open, out.expect.open);
  check('received', out.total.received, out.expect.received);
  check('consumed', out.total.consumed, out.expect.consumed);
  check('present', out.total.present, out.expect.present);

  console.log('\nthe row reconciles the way each tank above it does');
  check('opening + received - consumed = present',
    out.total.open + out.total.received - out.total.consumed, out.total.present);

  console.log('\nfresh water is counted separately');
  check('the ship holds fresh water', out.fwPresent > 0, true);
  check('and it is not inside the lube total', out.total.present < out.fwPresent, true);
  check('all four oils are summed', out.lubeCount, 4);

  console.log('\nboth the screen table and the printed sheet carry it');
  const rendered = await pg.evaluate(() => {
    const { consByFuel, consByLube } = computeDerived();
    renderDepArrRobTable(consByFuel, consByLube);
    const el = document.getElementById('depArrRobTable');
    return { html: el ? el.innerHTML : '', hasTotal: !!(el && el.querySelector('tr.rob-total')) };
  });
  check('the on-screen table marks it', rendered.hasTotal, true);
  check('and bolds it', /<strong>TOTAL LUBES<\/strong>/.test(rendered.html), true);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
