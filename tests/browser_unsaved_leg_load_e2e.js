#!/usr/bin/env node
'use strict';
/**
 * E2E: loading a library leg warns when current leg is not in voyageLegs.
 * APP_BASE=http://127.0.0.1:8860 NODE_PATH=... node tests/browser_unsaved_leg_load_e2e.js
 */
const { chromium } = require('playwright-core');
const BASE = (process.env.APP_BASE || 'http://127.0.0.1:8860').replace(/\/$/, '');
const CHROME = process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH
  || '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

let checks = 0, fails = 0;
function ok(label, cond, detail) {
  checks++;
  const pass = !!cond;
  if (!pass) fails++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail != null && !pass ? ` — ${detail}` : ''}`);
  return pass;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', async (d) => { await d.accept(); });

  await page.goto(`${BASE}/voyage_manager.html?chengaio=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginGate')?.setAttribute('hidden', '');
    document.getElementById('loginGate')?.remove();
  });

  const fleet = await page.evaluate(async () => {
    if (typeof installTestFleet !== 'function') return { error: 'no installTestFleet' };
    await installTestFleet({ switchToFirst: true });
    return {
      vn: (state.setup.voyageNumber || '').trim(),
      cond: normalizeCondition(state.setup.shipCondition),
      entries: state.entries.length,
    };
  });
  ok('test fleet loaded', !fleet.error, fleet.error);
  ok('has active voyage', !!(fleet.vn && fleet.entries > 0), JSON.stringify(fleet));

  const prep = await page.evaluate(async ({ vn, cond }) => {
    switchTab('setup');
    await renderVoyageLibrary();
    const id = voyageLegId(state.activeVesselId, vn, cond);
    await dbDelete('voyageLegs', id);
    const index = await getVoyageLibraryIndex(state.activeVesselId);
    const row = index.find(r => (r.voyageNumber || '').trim() === vn) || index[0];
    if (!row) return { error: 'no library rows' };
    const altCond = normalizeCondition(cond) === 'B' ? 'L' : 'B';
    let loadVn = row.voyageNumber;
    let loadCond = row[altCond] ? altCond : (row.B ? 'B' : 'L');
    const otherRow = index.find(r => (r.voyageNumber || '').trim() !== vn);
    if (!row[loadCond] && otherRow) {
      loadVn = otherRow.voyageNumber;
      loadCond = otherRow.B ? 'B' : 'L';
    }
    if (!row[loadCond] && !otherRow) return { error: 'no loadable library leg' };
    const sel = document.getElementById('s_voyageSelect');
    if (sel) sel.value = loadVn;
    const legSel = document.getElementById('s_legCondition');
    if (legSel) legSel.value = loadCond;
    const legs = await listVoyageLegsForVessel(state.activeVesselId);
    return { loadVn, loadCond, inLib: legs.some(l => l.id === id) };
  }, { vn: fleet.vn, cond: fleet.cond });
  ok('removed current leg from library only', prep && !prep.error && prep.inLib === false, prep?.error || JSON.stringify(prep));

  await page.click('#btnLoadVoyageLeg');
  await page.waitForSelector('#unsavedLegOverlay.open', { timeout: 8000 });
  ok('unsaved overlay opens', await page.isVisible('#unsavedLegOverlay.open'));

  const msg = await page.textContent('#unsavedLegMessage');
  ok('message mentions not saved', /not saved in the voyage library/i.test(msg || ''), msg);

  await page.click('#unsavedLegCancel');
  await page.waitForTimeout(400);
  ok('cancel closes overlay', !(await page.isVisible('#unsavedLegOverlay.open')));

  const still = await page.evaluate(() => ({
    vn: (state.setup.voyageNumber || '').trim(),
    entries: state.entries.length,
  }));
  ok('cancel keeps current leg', still.vn === fleet.vn && still.entries === fleet.entries, JSON.stringify(still));

  await page.click('#btnLoadVoyageLeg');
  await page.waitForSelector('#unsavedLegOverlay.open', { timeout: 8000 });
  await page.click('#unsavedLegSave');
  await page.waitForFunction(() => !document.getElementById('unsavedLegOverlay')?.classList.contains('open'), { timeout: 45000 });
  await page.waitForTimeout(800);

  const afterSave = await page.evaluate(async ({ origVn, loadVn, loadCond }) => {
    const legs = await listVoyageLegsForVessel(state.activeVesselId);
    const activeVn = (state.setup.voyageNumber || '').trim();
    const activeCond = normalizeCondition(state.setup.shipCondition);
    return {
      activeVn,
      activeCond,
      entries: state.entries.length,
      savedBack: legs.some(l => (l.voyageNumber || '').trim() === origVn && normalizeCondition(l.condition) === 'B'),
      loadedTarget: activeVn === loadVn && activeCond === normalizeCondition(loadCond),
    };
  }, { origVn: fleet.vn, loadVn: prep.loadVn, loadCond: prep.loadCond });
  ok('Save then load archives previous leg', afterSave.savedBack, JSON.stringify(afterSave));
  ok('Save then load switches to selected leg', afterSave.loadedTarget, JSON.stringify(afterSave));

  await browser.close();
  console.log();
  if (fails) {
    console.log(`FAILED — ${fails}/${checks}`);
    process.exit(1);
  }
  console.log(`PASSED — ${checks} checks`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
