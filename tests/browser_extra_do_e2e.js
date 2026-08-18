/*
 * Boiler and incinerator extra distillate, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_extra_do_e2e.js
 *
 * The boiler's pilot burner and the incinerator burn distillate that no meter
 * counts, so the engineer books it on the log entry summary. Types the four boxes,
 * saves, and follows the quantity the whole way: onto the entry, into the period
 * total, into the per-grade figures R.O.B. is deducted against, onto the boiler's
 * own row of the printed fuel table, onto a row of its own for the incinerator,
 * and back into the boxes when the summary is reopened. Not in CI, which has no
 * browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = JSON.stringify(a) === JSON.stringify(e)
    || (typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) < 1e-6);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { await d.accept(); });

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  /* Everything metered on residual, so any distillate on the sheet can only have
     come from the two boxes under test. */
  const id = await pg.evaluate(() => {
    const list = sortedEntries();
    const e = list[list.length - 1];
    const prev = list[list.length - 2];
    e.operation = 'AT SEA - NOON';
    e.rpm = 80;
    e.revCounter = (prev.revCounter || 0) + 115200;
    e.me.meter = (prev.me.meter || 0) + 42000;
    e.me.type = 'LSFO'; e.ge.type = 'LSFO'; e.blr.type = 'LSFO';
    openVoyageSummary(e.id);
    return e.id;
  });
  await pg.waitForTimeout(1200);

  console.log('\nthe boxes are on the log entry summary');
  for (const boxId of ['vs_blrExtra_mdomgo', 'vs_blrExtra_lsmgo', 'vs_incExtra_mdomgo', 'vs_incExtra_lsmgo']) {
    check(boxId, !!(await pg.$('#' + boxId)), true);
  }

  /* Save once before measuring anything. Saving a summary rewrites the unit-cons
     boxes from what they display, and a metered figure whose third decimal is a 5
     lands exactly on unitOverrideIfDifferent's 0.0005 tolerance — so the first save
     of any summary can nudge the total by half a gram whether or not a field was
     touched. That is unrelated to the boxes under test and predates them; settling
     it here keeps the deltas below exact. */
  await pg.click('#btnSaveVoyageSummary');
  await pg.waitForTimeout(1500);
  await pg.evaluate((entryId) => openVoyageSummary(entryId), id);
  await pg.waitForTimeout(800);

  const before = await pg.evaluate(() => {
    const r = getComputedRow(currentVsEntryId);
    return { mdo: r.consByType['MDO/MGO'], lsmgo: r.consByType['LSMGO'], total: r.total };
  });
  check('no distillate burned before booking any', before.mdo + before.lsmgo, 0);

  await pg.fill('#vs_blrExtra_mdomgo', '0.35');
  await pg.fill('#vs_blrExtra_lsmgo', '0.20');
  await pg.fill('#vs_incExtra_mdomgo', '0.15');
  await pg.fill('#vs_incExtra_lsmgo', '0.10');
  await pg.click('#btnSaveVoyageSummary');
  await pg.waitForTimeout(1500);

  const after = await pg.evaluate((entryId) => {
    const e = state.entries.find(x => x.id === entryId);
    const r = getComputedRow(entryId);
    const d = document.createElement('div');
    d.innerHTML = buildVoyageNoonSheetHTML(e);
    const cells = tr => [...tr.querySelectorAll('th,td')].map(x => x.textContent.trim());
    const sect = t => [...d.querySelectorAll('.pr-section')]
      .find(s => new RegExp(t).test(s.querySelector('.pr-section-title').textContent));
    const rob = {};
    d.querySelectorAll('.pr-noon-full table.pr-table tr').forEach(tr => {
      const x = cells(tr);
      if (['MDO/MGO', 'LSMGO'].includes(x[0])) rob[x[0]] = x[2];
    });
    const blrInc = {};
    sect('Boiler & Incinerator').querySelectorAll('.pr-row').forEach(x => {
      blrInc[x.querySelector('.pr-row-lbl').textContent.trim()] = x.querySelector('.pr-row-val').textContent.trim();
    });
    const fuelRows = [...sect('Fuel Consumption').querySelectorAll('tr')].map(cells);
    return {
      stored: { blr: e.blrExtraCons, inc: e.incExtraCons },
      byType: { mdo: r.consByType['MDO/MGO'], lsmgo: r.consByType['LSMGO'] },
      total: r.total,
      header: fuelRows[0],
      byLabel: Object.fromEntries(fuelRows.slice(1).map(x => [x[0], x.slice(1)])),
      rob, blrInc
    };
  }, id);

  console.log('\nit is stored on the entry');
  check('boiler booking', after.stored.blr, { 'MDO/MGO': 0.35, 'LSMGO': 0.2 });
  check('incinerator booking', after.stored.inc, { 'MDO/MGO': 0.15, 'LSMGO': 0.1 });

  console.log('\nit is real fuel out of the tanks');
  check('MDO/MGO is boiler plus incinerator', after.byType.mdo, 0.5);
  check('LSMGO is boiler plus incinerator', after.byType.lsmgo, 0.3);
  check('the period total grew by exactly what was booked', after.total - before.total, 0.8);
  check('R.O.B. is deducted for MDO/MGO', after.rob['MDO/MGO'], '0.500');
  check('R.O.B. is deducted for LSMGO', after.rob['LSMGO'], '0.300');

  console.log('\nthe printed fuel table books it by unit');
  check('a DO/GO column appears', after.header.join(','), 'Unit,FUEL,DO/GO');
  /* The boiler's own row carries both: its metered residual and its hand-booked
     distillate. It is the same burner's fuel. */
  check('boiler keeps its metered burn and gains its extra', after.byLabel['Boiler'], ['0.304', '0.550']);
  check('the incinerator gets a row of its own', after.byLabel['Incinerator'], ['—', '0.250']);
  check('units that burned none are untouched', after.byLabel['Main Engine'], ['41.160', '—']);
  check('and the DO/GO column adds up', after.byLabel['Total'][1], '0.800');

  console.log('\nthe Boiler & Incinerator block names both');
  check('boiler extra', after.blrInc['Boiler Extra D.O.'], '0.550 MT');
  check('incinerator', after.blrInc['Incinerator D.O. Cons'], '0.250 MT');

  console.log('\nreopening the summary shows what was saved');
  await pg.evaluate((entryId) => openVoyageSummary(entryId), id);
  await pg.waitForTimeout(800);
  const roundTrip = await pg.evaluate(() =>
    ['vs_blrExtra_mdomgo', 'vs_blrExtra_lsmgo', 'vs_incExtra_mdomgo', 'vs_incExtra_lsmgo']
      .map(i => document.getElementById(i).value));
  check('the four boxes', roundTrip, ['0.35', '0.2', '0.15', '0.1']);

  /* Clearing the boxes has to take the fuel back off the sheet, not leave it
     stranded in R.O.B. */
  console.log('\nclearing it takes the fuel back off');
  for (const boxId of ['vs_blrExtra_mdomgo', 'vs_blrExtra_lsmgo', 'vs_incExtra_mdomgo', 'vs_incExtra_lsmgo']) {
    await pg.fill('#' + boxId, '0');
  }
  await pg.click('#btnSaveVoyageSummary');
  await pg.waitForTimeout(1500);
  const cleared = await pg.evaluate((entryId) => {
    const e = state.entries.find(x => x.id === entryId);
    const r = getComputedRow(entryId);
    const d = document.createElement('div');
    d.innerHTML = buildVoyageNoonSheetHTML(e);
    const rows = [...d.querySelectorAll('.pr-section')]
      .find(s => /Fuel Consumption/.test(s.querySelector('.pr-section-title').textContent))
      .querySelectorAll('tr');
    return {
      total: r.total,
      distillate: r.consByType['MDO/MGO'] + r.consByType['LSMGO'],
      labels: [...rows].map(tr => tr.querySelector('td,th').textContent.trim())
    };
  }, id);
  check('the period total is back where it started', cleared.total, before.total);
  check('and no distillate is left booked', cleared.distillate, 0);
  check('the incinerator row is gone again', cleared.labels.includes('Incinerator'), false);

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
