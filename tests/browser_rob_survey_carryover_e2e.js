/*
 * A bunker survey must survive into the next voyage leg, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_rob_survey_carryover_e2e.js
 *
 * A survey re-bases the ROB chain on the sounded figure. The ROB tab and the
 * printout always read that way, but "current ROB" — the figure the voyage page
 * shows, the bunker plan quotes, and a new leg opens from — used to be computed as
 * opening baseline plus receipts less total consumption, which cannot see a survey.
 * A corrected ROB therefore looked right on the ROB tab while every new leg opened
 * from the pre-correction figure, and the tanks and the book never reconverged.
 *
 * Records a survey that removes a material quantity, then creates a new voyage leg
 * and checks the opening ROB is the sounded figure. Not in CI, which has no browser.
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

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const dialogs = [];
  pg.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  pg.on('download', () => { /* the new-leg flow downloads a backup + abstract */ });

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  console.log('\na survey corrects the ROB downward');
  const surveyed = await pg.evaluate(async () => {
    const rows = computeDerived().rows;
    const last = rows[rows.length - 1];
    const tank = fuelTankList().find(t => t.grade === 'LSFO') || fuelTankList()[0];
    const book = robAsOfEntry(last.id).rob[tank.id];
    /* Sounded materially short of the book figure — a real correction, not rounding. */
    const measured = Math.round((book - 12) * 1000) / 1000;
    await recordRobSurvey(last.id, { measured: { [tank.id]: measured }, place: 'SINGAPORE', surveyor: 'C/E' });
    return { tankId: tank.id, book, measured, lastId: last.id };
  });
  check('the book figure was higher', surveyed.book - surveyed.measured, 12);

  const live = await pg.evaluate((s) => {
    const d = computeDerived();
    const depArr = depArrRobRows(d.consByFuel, d.consByLube).find(r => r.id === s.tankId);
    return {
      asOfEntry: robAsOfEntry(s.lastId).rob[s.tankId],
      current: currentROB(d.consByFuel, d.consByLube).rob[s.tankId],
      depArrPresent: depArr ? depArr.present : null
    };
  }, surveyed);

  console.log('\nevery "ROB now" reader agrees with the sounding');
  check('the ROB tab / printout path', live.asOfEntry, surveyed.measured);
  check('the voyage page / current ROB', live.current, surveyed.measured);
  check('the Dep/Arr sheet', live.depArrPresent, surveyed.measured);

  console.log('\nand a new voyage leg opens from it');
  /* The flow refuses unless voyage identity and date actually move on. */
  await pg.evaluate(() => switchTab('voyagesetup'));
  await pg.waitForTimeout(600);
  await pg.evaluate(() => {
    document.getElementById('s_voyageNumber').value = '99';
    document.getElementById('s_shipCondition').value = 'B';
    document.getElementById('s_initDateTime').value = '2026-09-01T08:00';
  });
  await pg.click('#btnResetVoyage');
  await pg.waitForTimeout(3000);

  const after = await pg.evaluate((s) => ({
    voyageNo: state.setup.voyageNumber,
    entries: state.entries.length,
    openingRob: tankRobValue(state.setup.rob, fuelTankList().find(t => t.id === s.tankId)),
    /* With an empty log the opening baseline is also the current ROB. */
    current: currentROB(computeDerived().consByFuel, computeDerived().consByLube).rob[s.tankId]
  }), surveyed);

  check('the new leg started', after.voyageNo, '99');
  check('with an empty log', after.entries, 0);
  check('opening ROB is the sounded figure, not the book one', after.openingRob, surveyed.measured);
  check('and current ROB agrees', after.current, surveyed.measured);
  check('no dialog complained', dialogs.some(m => /Cannot create/.test(m)), false);

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
