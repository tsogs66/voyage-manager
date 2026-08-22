/*
 * Printing from the open log entry summary prints what is on screen, driven in a
 * real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_summary_print_parity_e2e.js
 *
 * Add Entry opens the summary for the watch just saved. Anything the engineer types
 * there — distance, generator hours and kW, boiler and incinerator figures, misc and
 * extra consumption — only reached the sheet once Save Summary had written it to the
 * entry, because the save and the print read the form through different code and the
 * print read about half of it. Printing before saving therefore produced a sheet off
 * the stored entry, with speed, slip, the generator table and R.O.B. all following
 * the wrong figures.
 *
 * Fills a watch in, prints before saving and after saving, and requires the two
 * sheets to be identical. Also checks the preview leaves the stored entry alone.
 * Not in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

/* Every label/value on a sheet built the way printVoyageSummary builds it. */
const SCRAPE = `(entryId) => {
  const base = state.entries.find(e => e.id === entryId);
  const html = withVoyageSummaryDraft(base, (e) => buildVoyageNoonSheetHTML(e));
  const d = document.createElement('div');
  d.innerHTML = html;
  const out = {};
  d.querySelectorAll('.pr-kpi-item').forEach(k => {
    out['KPI ' + k.querySelector('.pr-kpi-lbl').textContent.trim()] = k.querySelector('.pr-kpi-val').textContent.trim();
  });
  d.querySelectorAll('.pr-section').forEach(sec => {
    const title = sec.querySelector('.pr-section-title').textContent.trim();
    sec.querySelectorAll('.pr-row').forEach(r => {
      out[title + ' / ' + r.querySelector('.pr-row-lbl').textContent.trim()] = r.querySelector('.pr-row-val').textContent.trim();
    });
    sec.querySelectorAll('tr').forEach((tr, i) => {
      const cells = [...tr.querySelectorAll('th,td')].map(x => x.textContent.trim());
      if (cells.length) out[title + ' / row' + i + ' ' + cells[0]] = cells.slice(1).join(' | ');
    });
  });
  return out;
}`;

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

  /* Add a watch through the log entry form, exactly as an engineer would. */
  await pg.evaluate(() => switchTab('entry'));
  await pg.waitForTimeout(700);
  const seed = await pg.evaluate(() => {
    const prev = sortedEntries().slice(-1)[0];
    return { me: prev.me.meter, ge: prev.ge.meter, blr: prev.blr.meter, cyl: prev.cylMeter, rc: prev.revCounter };
  });
  await pg.evaluate((s) => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('in_datetime', '2026-07-06T12:00');
    set('in_operation', 'NOON - AT SEA');
    set('in_distanceShip', '340');
    set('in_revCounter', String((s.rc || 0) + 115200));
    set('me_meter', String((s.me || 0) + 42000));
    set('ge_meter', String((s.ge || 0) + 1500));
    set('blr_meter', String((s.blr || 0) + 320));
    set('cyl_meter', String((s.cyl || 0) + 400));
  }, seed);
  await pg.waitForTimeout(500);
  await pg.click('#btnAdd');
  await pg.waitForTimeout(2500);

  const id = await pg.evaluate(() => currentVsEntryId);
  check('Add Entry opens the summary for the new watch', typeof id === 'string' && id.length > 0, true);

  /* Fill the watch in on the summary, and do not save. */
  await pg.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('vs_distanceShip', '352');
    set('vs_blrRuntime', '6.5');
    set('vs_blrKw', '900');
    set('vs_incRuntime', '2.5');
    set('vs_incKw', '120');
    set('vs_misc_mdomgo', '0.22');
    set('vs_misc_lsmgo', '0.11');
    set('vs_blrExtra_mdomgo', '0.30');
    set('vs_incExtra_lsmgo', '0.18');
    set('vs_erTemp', '38');
    set('vs_windDir', 'SW');
    set('vs_windBft', '5');
    document.querySelectorAll('.vs-ge-runhours').forEach((el, i) => set(el.id, String(12 + i)));
    document.querySelectorAll('[id^="vs_ge"][id$="_kw"]').forEach((el, i) => set(el.id, String(320 + i * 10)));
  });
  await pg.waitForTimeout(900);

  const storedBefore = await pg.evaluate((entryId) =>
    JSON.stringify(state.entries.find(e => e.id === entryId)), id);
  const printedUnsaved = await pg.evaluate(new Function('return ' + SCRAPE)(), id);
  const storedAfterPreview = await pg.evaluate((entryId) =>
    JSON.stringify(state.entries.find(e => e.id === entryId)), id);

  console.log('\nbuilding the sheet is a preview, not an edit');
  check('the stored entry is untouched by it', storedAfterPreview, storedBefore);

  console.log('\nthe unsaved sheet already carries what was typed');
  check('ship distance', printedUnsaved['KPI Ship Dist (nm)'], '352.00');
  check('boiler hours', printedUnsaved['Boiler & Incinerator / Boiler Period Hrs'], '6.50');
  check('incinerator run time', printedUnsaved['Boiler & Incinerator / Incinerator Run Time'], '2.50 hrs');
  check('boiler extra distillate', printedUnsaved['Boiler & Incinerator / Boiler Extra D.O.'], '0.300 MT');
  check('incinerator distillate', printedUnsaved['Boiler & Incinerator / Incinerator D.O. Cons'], '0.180 MT');

  await pg.click('#btnSaveVoyageSummary');
  await pg.waitForTimeout(2000);
  const printedSaved = await pg.evaluate(new Function('return ' + SCRAPE)(), id);

  console.log('\nprinting before saving matches printing after saving');
  const keys = [...new Set([...Object.keys(printedUnsaved), ...Object.keys(printedSaved)])].sort();
  const diffs = keys.filter(k => printedUnsaved[k] !== printedSaved[k]);
  diffs.forEach(k => console.log(`      ${k}: unsaved ${printedUnsaved[k]} / saved ${printedSaved[k]}`));
  check('no field differs', diffs, []);
  check('and the sheet is not empty', keys.length > 30, true);

  console.log('\nsaving still writes the watch to the entry');
  const saved = await pg.evaluate((entryId) => {
    const e = state.entries.find(x => x.id === entryId);
    return {
      distanceShip: e.distanceShip,
      blrRunHours: e.report?.blrRunHours,
      incRunTime: e.report?.incinerator?.runTime,
      blrExtra: e.blrExtraCons,
      incExtra: e.incExtraCons,
      misc: e.miscCons,
      geHours: (e.report?.generators || []).map(g => g.periodHrs),
      perfTableUnits: Object.keys(e.report?.perfTable || {}).sort()
    };
  }, id);
  check('distance', saved.distanceShip, 352);
  check('boiler hours', saved.blrRunHours, 6.5);
  check('incinerator run time', saved.incRunTime, 2.5);
  check('boiler extra', saved.blrExtra, { 'MDO/MGO': 0.3, 'LSMGO': 0 });
  check('incinerator extra', saved.incExtra, { 'MDO/MGO': 0, 'LSMGO': 0.18 });
  check('misc', saved.misc, { 'MDO/MGO': 0.22, 'LSMGO': 0.11 });
  check('generator hours', saved.geHours, [12, 13]);
  check('performance table rebuilt', saved.perfTableUnits, ['AE1', 'AE2', 'BOILER', 'INCINERATOR', 'ME']);

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
