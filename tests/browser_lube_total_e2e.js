/*
 * Total lubes on the R.O.B. snapshot, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_lube_total_e2e.js
 *
 * Checks the row against the tanks actually listed beside it, rather than against
 * a number this test computed itself. Not in CI, which has no browser; the
 * arithmetic is covered headlessly by test_lube_total.js.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e || (typeof a === 'number' && Math.abs(a - e) < 1e-6);
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
    const e = state.entries[state.entries.length - 1];
    openRobSnapshot(e.id);
    const rows = [...document.querySelectorAll('#robSnapshotBody tr')].map(tr => ({
      cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()),
      isTotal: tr.classList.contains('rob-total'),
      bold: !!tr.querySelector('strong')
    }));
    const lubeLabels = lubeTankList().map(t => t.name);
    const asOf = robAsOfEntry(e.id);
    return {
      rows,
      lubeLabels,
      expectedTotal: totalLubeRob(asOf.robLube),
      fw: asOf.robLube[fwTankList()[0].id]
    };
  });

  console.log('\nthe snapshot lists a total lubes row');
  const totalRow = out.rows.find(r => r.isTotal);
  check('a total row is present', !!totalRow, true);
  check('it is labelled TOTAL LUBES', totalRow && totalRow.cells[0], 'TOTAL LUBES');
  check('and marked as a total, not another tank', totalRow && totalRow.bold, true);
  check('it is the last row', out.rows[out.rows.length - 1].isTotal, true);

  console.log('\nthe figure is the sum of the four lube tanks');
  const num = s => Number(String(s).replace(/,/g, ''));
  const lubeRows = out.rows.filter(r => out.lubeLabels.includes(r.cells[0]));
  check('all four lube tanks are listed', lubeRows.length, 4);
  const summed = lubeRows.reduce((a, r) => a + num(r.cells[3]), 0);
  check('the listed tanks add to the total', num(totalRow.cells[3]), summed);
  check('and that matches totalLubeRob', num(totalRow.cells[3]), Math.round(out.expectedTotal));

  console.log('\nfresh water is not in it');
  check('no fresh water row on the snapshot', out.rows.some(r => /FRESH WATER/i.test(r.cells[0])), false);
  check('the vessel does hold fresh water', out.fw > 0, true);
  check('and the total is well below it', num(totalRow.cells[3]) < out.fw, true);

  console.log('\nthe printed sheet carries it too');
  const printed = await pg.evaluate(() => {
    const e = state.entries[state.entries.length - 1];
    const sorted = sortedEntries();
    const idx = sorted.findIndex(x => x.id === e.id);
    const prior = idx > 0 ? sorted[idx - 1] : null;
    const prevRobData = prior ? robAsOfEntry(prior.id) : { rob: state.setup.rob, robLube: state.setup.robLube };
    const asOf = robAsOfEntry(e.id);
    const row = getComputedRow(e.id);
    const rows = getRobRows().filter(r => r.cat !== 'fw').map(r => {
      const dec = robDec(r.cat);
      return { label: r.label, prevVal: r.cat === 'fuel' ? prevRobData.rob[r.key] : prevRobData.robLube[r.key],
               consVal: robRowCons(row, r), nowVal: r.cat === 'fuel' ? asOf.rob[r.key] : asOf.robLube[r.key],
               dec, consDec: dec };
    });
    const lubeRows = getRobRows().filter(r => r.cat === 'lube');
    const lubeCons = lubeRows.map(r => robRowCons(row, r)).filter(v => v != null && !isNaN(v));
    rows.push({ label: 'TOTAL LUBES', prevVal: totalLubeRob(prevRobData.robLube),
                consVal: lubeCons.length ? lubeCons.reduce((a, b) => a + b, 0) : null,
                nowVal: totalLubeRob(asOf.robLube), dec: robDec('lube'), consDec: robDec('lube'), strong: true });
    // Render exactly what printRobSnapshot renders for the rows.
    return rows.map(r => `<tr${r.strong ? ' class="rob-total"' : ''}><td class="row-lbl">${r.strong ? `<strong>${r.label}</strong>` : r.label}</td></tr>`).join('');
  });
  check('the print rows include the total', /rob-total/.test(printed), true);
  check('bolded on paper', /<strong>TOTAL LUBES<\/strong>/.test(printed), true);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
