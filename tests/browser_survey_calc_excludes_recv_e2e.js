/*
 * Typing Received must not inflate Bunker Survey Calculated.
 *
 *   APP_BASE=http://127.0.0.1:8860 node tests/browser_survey_calc_excludes_recv_e2e.js
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
'use strict';

const { chromium } = require('playwright-core');
const BASE = (process.env.APP_BASE || 'http://127.0.0.1:8860').replace(/\/$/, '');
const CHROME = process.env.PW_CHROMIUM
  || '/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let f = 0, c = 0;
const check = (l, ok, detail) => {
  c++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${!ok && detail != null ? ` — ${detail}` : ''}`);
  if (!ok) f++;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1000);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));

  console.log('\nload demo vessel');
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(3500);
  check('entries loaded', await pg.evaluate(() => state.entries.length > 0));

  console.log('\nReceived must not move Survey Calculated');
  const res = await pg.evaluate(async () => {
    const entry = state.entries[state.entries.length - 2];
    const tank = fuelTankList()[0];
    currentVsEntryId = entry.id;
    const beforeAsOf = Number(robAsOfEntry(entry.id).rob[tank.id]) || 0;
    const beforeBook = Number(surveyCalculatedBook(entry.id).rob[tank.id]) || 0;
    renderVsSurvey();
    const uiBefore = document.querySelector(`#vsSurveyBody [data-survey-book]`).dataset.bookBase;

    /* Stamp 50 MT received on this report (same path as typing Received + save). */
    if (!entry.robReceived) entry.robReceived = {};
    entry.robReceived[tank.id] = 50;
    await dbPut('entries', tagVesselId(entry));
    const afterAsOf = Number(robAsOfEntry(entry.id).rob[tank.id]) || 0;
    const afterBook = Number(surveyCalculatedBook(entry.id).rob[tank.id]) || 0;
    renderVsSurvey();
    const uiAfter = document.querySelector('#vsSurveyBody [data-survey-book]').dataset.bookBase;

    return {
      tank: tank.id,
      beforeAsOf, beforeBook, afterAsOf, afterBook,
      uiBefore: Number(uiBefore), uiAfter: Number(uiAfter),
      jump: afterBook - beforeBook,
      asOfDelta: afterAsOf - beforeAsOf
    };
  });

  check('asOf ROB rises by Received', Math.abs(res.asOfDelta - 50) < 1e-6, `delta=${res.asOfDelta}`);
  check('Survey Calculated stays put', Math.abs(res.jump) < 1e-6, `jump=${res.jump}`);
  check('UI book matches burn-only book', Math.abs(res.uiAfter - res.afterBook) < 1e-6,
    `ui=${res.uiAfter} book=${res.afterBook}`);
  check('UI book did not follow Received', Math.abs(res.uiAfter - res.uiBefore) < 1e-6,
    `before=${res.uiBefore} after=${res.uiAfter}`);
  check('asOf includes Received while book excludes it',
    Math.abs(res.afterAsOf - res.afterBook - 50) < 1e-6,
    `asOf=${res.afterAsOf} book=${res.afterBook}`);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join('; '));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
