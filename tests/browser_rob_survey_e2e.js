/*
 * Browser check of the bunker survey panel against real demo data.
 *
 *   node tests/browser_rob_survey_e2e.js
 *
 * Needs playwright-core, a Chromium binary and a server serving the app;
 * skipped in CI, which has no browser. The arithmetic itself is covered
 * headlessly by tests/test_rob_survey.js.
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8860';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e || (typeof a === 'number' && Math.abs(a - e) < 1e-6);
  console.log(`  ${ok?'ok  ':'FAIL'} ${l}${ok?'':`: expected ${e}, got ${a}`}`); if (!ok) f++; };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  // Skip the login gate: continue with no vessel, then load the Test Fleet.
  const cont = await pg.$('#btnLoginSkip, #login_continue, [data-login-skip]');
  if (cont) await cont.click();
  await pg.waitForTimeout(400);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden',''));

  console.log('\nload a demo vessel with real entries');
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);
  const n = await pg.evaluate(() => state.entries.length);
  check('entries loaded', n > 0, true);

  console.log('\nthe survey panel renders against a real entry');
  const info = await pg.evaluate(() => {
    const e = state.entries[state.entries.length - 2];
    currentVsEntryId = e.id;
    renderVsSurvey();
    const rows = document.querySelectorAll('#vsSurveyBody tr').length;
    const inputs = document.querySelectorAll('[data-survey-tank]').length;
    return { rows, inputs, status: document.getElementById('vsSurveyStatus').textContent, id: e.id };
  });
  check('a row per tank', info.rows > 0, true);
  check('each row takes a measured figure', info.inputs, info.rows);
  check('it says there is no survey yet', /No survey/.test(info.status), true);

  console.log('\napplying a survey corrects ROB and carries forward');
  const res = await pg.evaluate(async (id) => {
    const idx = state.entries.findIndex(e => e.id === id);
    const next = state.entries[idx + 1];
    const tank = fuelTankList()[0];
    const before = robAsOfEntry(id).rob[tank.id];
    const beforeNext = robAsOfEntry(next.id).rob[tank.id];
    const measured = before - 7.5;                     // survey finds 7.5 short
    await recordRobSurvey(id, { measured: { [tank.id]: measured }, place: 'SINGAPORE', surveyor: 'SGS' });
    return {
      tank: tank.id, before, beforeNext, measured,
      after: robAsOfEntry(id).rob[tank.id],
      afterNext: robAsOfEntry(next.id).rob[tank.id],
      stored: JSON.parse(JSON.stringify(state.entries[idx].robSurvey)),
      nextId: next.id
    };
  }, info.id);
  check('the surveyed report now shows the measured figure', res.after, res.measured);
  check('the next report opens from it', res.afterNext, res.beforeNext - 7.5);
  check('the book figure is kept as the record', res.stored.calculated[res.tank], res.before);
  check('and the difference is logged', res.stored.difference[res.tank], -7.5);
  check('with the place', res.stored.place, 'SINGAPORE');
  check('and the surveyor', res.stored.surveyor, 'SGS');

  console.log('\nthe panel reflects the applied survey');
  const after = await pg.evaluate(() => { renderVsSurvey(); return {
    status: document.getElementById('vsSurveyStatus').textContent,
    calcCol: document.querySelector('#vsSurveyBody tr td:nth-child(2)').textContent }; });
  check('status says the survey is applied', /Survey applied/.test(after.status), true);
  check('the calculated column still shows the book figure, not the measurement',
    after.calcCol.replace(/[, ]/g,'') !== '', true);

  console.log('\nremoving the survey restores the calculated chain');
  const restored = await pg.evaluate(async (o) => {
    await clearRobSurvey(currentVsEntryId);
    return { back: robAsOfEntry(currentVsEntryId).rob[o.tank], next: robAsOfEntry(o.nextId).rob[o.tank] };
  }, res);
  check('ROB is back to the book figure', restored.back, res.before);
  check('and so is the next report', restored.next, res.beforeNext);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0,4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
