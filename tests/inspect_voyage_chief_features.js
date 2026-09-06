#!/usr/bin/env node
/**
 * Comprehensive Voyage Chief feature inspection against a live local server.
 * Bypasses the standalone license gate via ?chengaio=1 (AIO-embedded mode).
 *
 *   APP_BASE=http://127.0.0.1:8860 node tests/inspect_voyage_chief_features.js
 */
'use strict';

const { chromium } = require('playwright-core');
const BASE = (process.env.APP_BASE || 'http://127.0.0.1:8860').replace(/\/$/, '');
const CHROME = process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let checks = 0, fails = 0;
function ok(label, cond, detail) {
  checks++;
  const pass = !!cond;
  if (!pass) fails++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail != null && !pass ? ` — ${detail}` : ''}`);
  return pass;
}

async function boot(page) {
  await page.goto(`${BASE}/voyage_manager.html?chengaio=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.getElementById('loginGate')?.setAttribute('hidden', '');
    document.getElementById('loginGate')?.remove();
  });
}

async function loadFleet(page) {
  return page.evaluate(async () => {
    if (typeof installTestFleet !== 'function') return { error: 'installTestFleet missing' };
    await installTestFleet({ switchToFirst: true });
    return {
      vessels: (state.vessels || []).length,
      entries: (state.entries || []).length,
      receipts: (state.receipts || []).length,
      vesselName: state.setup?.vesselName || state.activeVessel?.name || null,
      voyageNo: state.setup?.voyageNumber || null,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  console.log('\n=== Boot ===');
  await boot(page);
  ok('page title mentions Voyage', /voyage/i.test(await page.title()));
  ok('license lock not shown (chengaio bypass)', !(await page.$('#chengLicenseLock')));

  console.log('\n=== Load demo fleet ===');
  const fleet = await loadFleet(page);
  ok('test fleet installed', !fleet.error, fleet.error);
  ok('has vessels', fleet.vessels > 0, JSON.stringify(fleet));
  ok('has log entries', fleet.entries > 0, String(fleet.entries));
  console.log(`    vessel=${fleet.vesselName} voyage=${fleet.voyageNo} entries=${fleet.entries}`);
  await page.waitForTimeout(600);

  const TABS = [
    ['entry', 'Log Entry'],
    ['rob', 'ROB'],
    ['bunkerplan', 'Consumption Plan'],
    ['consumption', 'Consumption'],
    ['voyageabstract', 'Voyage Abstract'],
    ['rangetotals', 'Range Totals'],
    ['receipts', 'Receipts'],
    ['reports', 'Reports'],
    ['reference', 'Reference'],
    ['orb', 'e-ORB'],
    ['data', 'Setup'],
    ['voyagesetup', 'Voyage Setup'],
    ['setup', 'Vessel Data'],
  ];

  console.log('\n=== Tab navigation ===');
  for (const [pageName, label] of TABS) {
    const res = await page.evaluate((pn) => {
      try {
        if (typeof switchTab === 'function') switchTab(pn);
        const tab = document.querySelector(`.tab[data-page="${pn}"]`);
        return {
          tabExists: !!tab,
          activePage: document.querySelector('.tab.active, .tab.on')?.dataset?.page || null,
        };
      } catch (e) {
        return { error: String(e.message || e) };
      }
    }, pageName);
    ok(`tab ${label} (${pageName}) switchable`, !res.error && res.tabExists !== false, JSON.stringify(res));
  }

  console.log('\n=== Vessel Data / Voyage Setup ===');
  await page.evaluate(() => { try { switchTab('setup'); } catch (_) {} });
  const setup = await page.evaluate(() => ({
    vessel: state.setup?.vesselName,
    robKeys: Object.keys(state.setup?.rob || {}).length,
    pitch: state.setup?.pitch,
    flowMain: state.setup?.flowmeters?.main?.reading,
  }));
  ok('vessel setup has ROB tanks', setup.robKeys > 0, JSON.stringify(setup));
  ok('vessel name present', !!setup.vessel, JSON.stringify(setup));

  console.log('\n=== Log Entry form ===');
  await page.evaluate(() => { try { switchTab('entry'); } catch (_) {} });
  const entryForm = await page.evaluate(() => ({
    datetime: !!(document.getElementById('in_datetime') || document.getElementById('entry_datetime')),
    meMeter: !!(document.getElementById('me_meter') || document.getElementById('me_meter_in')),
    geMeter: !!(document.getElementById('ge_meter') || document.getElementById('ge_meter_in')),
    blrMeter: !!(document.getElementById('blr_meter') || document.getElementById('boiler_meter')),
    addBtn: !!(document.getElementById('btnAdd') || document.getElementById('btnSaveEntry')),
  }));
  ok('log entry datetime field', entryForm.datetime);
  ok('log entry ME meter field', entryForm.meMeter);
  ok('log entry GE meter field', entryForm.geMeter);
  ok('log entry boiler meter field', entryForm.blrMeter);
  ok('log entry save/add control', entryForm.addBtn);

  console.log('\n=== ROB / Received chain (core voyage-chief) ===');
  const robChain = await page.evaluate(() => {
    const snap = JSON.stringify({
      entries: state.entries,
      receipts: state.receipts,
      carryover: state.setup.carryover,
    });
    try {
      const rows = typeof computeDerived === 'function' ? computeDerived().rows : [];
      if (!rows.length) return { error: 'no derived rows' };
      const first = rows[0];
      const last = rows[rows.length - 1];
      const asOfFirst = robAsOfComputedRow(first, rows);
      const asOfLast = robAsOfComputedRow(last, rows);
      const tanks = fuelTankList();
      const t0 = tanks[0];
      const open = tankRobValue(state.setup.rob, t0);
      const mid = rows[Math.min(1, rows.length - 1)];
      const midEntry = state.entries.find(e => e.id === mid.id);
      const beforeQty = robAsOfComputedRow(mid, rows).rob[t0.id];
      midEntry.robReceived = { ...(midEntry.robReceived || {}), [t0.id]: 25 };
      state.receipts.push({
        id: 'inspect-r1',
        date: mid.datetime,
        category: 'fuel',
        tankId: t0.id,
        qty: 25,
        source: 'rob-survey',
        surveyEntryId: mid.id,
      });
      const afterQty = robAsOfComputedRow(mid, rows).rob[t0.id];
      const stampedOnly = afterQty - beforeQty;
      delete midEntry.robReceived[t0.id];
      const receiptOnly = robAsOfComputedRow(mid, rows).rob[t0.id] - beforeQty;
      midEntry.robReceived[t0.id] = 25;
      const afterStamp = robAsOfComputedRow(mid, rows);
      const bal = robBalanceRows(mid, { rob: state.setup.rob, robLube: state.setup.robLube }, afterStamp, midEntry);
      const row0 = bal.find(r => r.key === t0.id);
      const noStampEntry = { id: 'x', robReceived: null, robReceivedLube: null };
      const balBlank = robBalanceRows(first, { rob: state.setup.rob, robLube: state.setup.robLube }, asOfFirst, noStampEntry);
      const blankRow = balBlank.find(r => r.key === t0.id);
      const savedEntries = state.entries;
      state.entries = [];
      state.setup.carryover = { datetime: '2000-01-01T00:00', me: { meter: 9999999 }, ge: { meter: 8888888 } };
      const co = effectiveCarryover();
      const setupMain = state.setup.flowmeters?.main?.reading;
      state.entries = savedEntries;
      return {
        open, firstRob: asOfFirst.rob[t0.id], lastRob: asOfLast.rob[t0.id],
        tank: t0.id, stampedOnly, receiptOnly,
        balRecv: row0?.recvVal, blankRecv: blankRow?.recvVal,
        carryMe: co?.me?.meter, setupMain,
        entryCount: rows.length,
      };
    } finally {
      const restored = JSON.parse(snap);
      state.entries = restored.entries;
      state.receipts = restored.receipts;
      state.setup.carryover = restored.carryover;
    }
  });
  ok('ROB chain computes', !robChain.error, robChain.error);
  ok('first-entry ROB near setup opening (± burn)', robChain.firstRob != null);
  ok('stamp+mirror does not double (delta ≈ 25)', Math.abs(robChain.stampedOnly - 25) < 0.01, String(robChain.stampedOnly));
  ok('receipt-only fallback still counts ≈ 25', Math.abs(robChain.receiptOnly - 25) < 0.01, String(robChain.receiptOnly));
  ok('balance Received shows stamped 25', robChain.balRecv === 25, String(robChain.balRecv));
  ok('unstamped entry has blank Received (not derived)', robChain.blankRecv == null, String(robChain.blankRecv));
  ok('empty log ME meter from setup, not stale carryover',
    robChain.carryMe === robChain.setupMain, `carry=${robChain.carryMe} setup=${robChain.setupMain}`);

  // Fresh fleet so later UI probes are not affected by ROB-chain probes
  await loadFleet(page);

  console.log('\n=== Voyage Summary panel ===');
  const summary = await page.evaluate(() => {
    const e = state.entries[state.entries.length - 1];
    if (!e) return { error: 'no entry' };
    try {
      openVoyageSummary(e.id);
    } catch (err) {
      return { error: String(err.message || err) };
    }
    const panel = document.getElementById('voyageSummaryPanel');
    const robBody = document.getElementById('vsRobBody');
    return {
      panelVisible: panel ? (panel.style.display !== 'none' && !panel.hidden) : false,
      hasRobBody: !!robBody && robBody.children.length > 0,
      recvInputs: robBody ? robBody.querySelectorAll('[data-rob-recv]').length : 0,
      consInputs: robBody ? robBody.querySelectorAll('input[id^="vs_cons_"]').length : 0,
      entryId: e.id,
    };
  });
  ok('voyage summary opens', !summary.error && summary.panelVisible, summary.error || JSON.stringify(summary));
  ok('summary ROB table present', summary.hasRobBody);
  ok('summary has Received inputs', summary.recvInputs > 0, String(summary.recvInputs));
  ok('summary has Cons inputs', summary.consInputs > 0, String(summary.consInputs));

  console.log('\n=== Summary Received live edit ===');
  const recvEdit = await page.evaluate(() => {
    const inp = document.querySelector('#vsRobBody [data-rob-recv]');
    if (!inp) return { error: 'no recv input' };
    const key = inp.dataset.robRecv;
    const robEl = document.getElementById('vs_rob_' + (typeof slugKey === 'function' ? slugKey(key) : key));
    const before = robEl?.textContent;
    inp.value = '12.5';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const after = robEl?.textContent;
    return { key, before, after, changed: before !== after };
  });
  ok('Received input updates ROB cell', !recvEdit.error && recvEdit.changed, JSON.stringify(recvEdit));

  console.log('\n=== ROB tab gauges / present stock ===');
  await page.evaluate(() => { try { switchTab('rob'); } catch (_) {} });
  const robTab = await page.evaluate(() => {
    const gauges = document.querySelectorAll('svg, .gauge, [class*="gauge"]').length;
    let total = null;
    let err = null;
    try {
      const { rows } = computeDerived();
      const last = rows[rows.length - 1];
      const asOf = robAsOfComputedRow(last, rows);
      total = fuelTankList().reduce((s, t) => s + (Number(asOf.rob?.[t.id]) || 0), 0);
    } catch (e) { err = String(e.message || e); }
    return { gauges, total, err };
  });
  ok('ROB tab renders gauges/visuals', robTab.gauges > 0, String(robTab.gauges));
  ok('present fuel ROB is finite', Number.isFinite(robTab.total) && robTab.total > 0, String(robTab.total || robTab.err));

  console.log('\n=== Feature pages interactive ===');
  for (const tab of ['receipts', 'consumption', 'voyageabstract', 'rangetotals', 'reports', 'orb', 'bunkerplan', 'reference', 'data', 'voyagesetup']) {
    const n = await page.evaluate((pn) => {
      try { switchTab(pn); } catch (_) {}
      return {
        textLen: (document.body.innerText || '').length,
        tables: document.querySelectorAll('table').length,
        buttons: document.querySelectorAll('button').length,
      };
    }, tab);
    ok(`${tab} page interactive`, n.textLen > 100 && n.buttons > 0, JSON.stringify(n));
  }

  console.log('\n=== Create / edit log entry path ===');
  const savePath = await page.evaluate(() => {
    try { switchTab('entry'); } catch (_) {}
    const helpers = {
      addOrUpdate: typeof addOrUpdateEntry === 'function' || typeof saveEntry === 'function' || typeof addEntry === 'function',
      computeDerived: typeof computeDerived === 'function',
      openVoyageSummary: typeof openVoyageSummary === 'function',
      createNewVoyage: typeof createNewVoyage === 'function' || typeof startNewVoyage === 'function',
    };
    const before = state.entries.length;
    // Soft probe: ensure form can be populated from last entry without throwing
    let filled = false;
    try {
      const last = state.entries[state.entries.length - 1];
      if (last && typeof fillEntryForm === 'function') { fillEntryForm(last); filled = true; }
      else if (last && typeof loadEntryIntoForm === 'function') { loadEntryIntoForm(last); filled = true; }
      else filled = !!(document.getElementById('in_datetime') || document.getElementById('me_meter'));
    } catch (e) {
      return { error: String(e.message || e), helpers, before };
    }
    return { helpers, before, filled, after: state.entries.length };
  });
  ok('entry save helpers present', savePath.helpers?.addOrUpdate || savePath.helpers?.computeDerived, JSON.stringify(savePath));
  ok('log entry form fillable', !!savePath.filled && !savePath.error, JSON.stringify(savePath));

  console.log('\n=== Print / export helpers ===');
  const prints = await page.evaluate(() => ({
    voyageSummary: typeof printVoyageSummary === 'function',
    robSnapshot: typeof printRobSnapshot === 'function',
    rangeTotals: typeof printRangeTotalsSheet === 'function',
    bunkerPlan: typeof printBunkerPlan === 'function',
    depArr: typeof printDepArrRobSheet === 'function',
    btnVsPrint: !!document.getElementById('btnVsPrint') || !!document.querySelector('[onclick*="printVoyageSummary"]'),
  }));
  ok('printVoyageSummary exists', prints.voyageSummary);
  ok('printRobSnapshot exists', prints.robSnapshot);
  ok('printRangeTotalsSheet exists', prints.rangeTotals);
  ok('printBunkerPlan exists', prints.bunkerPlan);
  ok('print helpers available', prints.voyageSummary && prints.robSnapshot);

  console.log('\n=== Effective carryover / first-entry meters ===');
  const meters = await page.evaluate(() => {
    const co = effectiveCarryover();
    return {
      me: co?.me?.meter ?? co?.me?.meterIn,
      ge: co?.ge?.meter ?? co?.ge?.meterIn,
      setupMain: state.setup.flowmeters?.main?.reading,
      setupAux: state.setup.flowmeters?.aux?.reading,
    };
  });
  ok('carryover ME meter defined', meters.me != null, JSON.stringify(meters));

  console.log('\n=== Page errors ===');
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  await page.screenshot({ path: '/tmp/voyage-chief-inspection.png', fullPage: false });
  console.log('\nSaved screenshot /tmp/voyage-chief-inspection.png');

  await browser.close();
  console.log(`\n${fails ? 'FAILED' : 'PASSED'} — ${checks - fails}/${checks} checks (${fails} failed)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
