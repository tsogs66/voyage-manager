#!/usr/bin/env node
/*
 * After Add Entry, the entry selector and Voyage Summary must stay on the
 * watch that was just saved — not flip to "— New Entry —".
 *
 *   APP_BASE=http://127.0.0.1:8860 node tests/browser_add_entry_select_e2e.js
 *
 * Not in CI (no browser).
 */
'use strict';

const { chromium } = require('playwright-core');
const BASE = (process.env.APP_BASE || 'http://127.0.0.1:8860').replace(/\/$/, '');
const CHROME = process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = String(a) === String(e);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { await d.accept(); });

  await pg.goto(`${BASE}/voyage_manager.html?chengaio=1`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.remove());
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(800);

  const beforeCount = await pg.evaluate(() => state.entries.length);

  await pg.evaluate(() => {
    switchTab('entry');
    const last = sortedEntries().slice(-1)[0];
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    /* Clear selection so we are on a true New Entry form. */
    document.getElementById('in_selectEntry').value = '';
    exitEditMode();
    prefillFromLastEntry();
    set('in_datetime', '2026-07-06T12:00');
    set('in_operation', 'NOON - AT SEA');
    set('me_meter', String((last.me?.meter || 0) + 17000));
    set('ge_meter', String((last.ge?.meter || 0) + 2400));
    set('blr_meter', String((last.blr?.meter || 0) + 300));
    set('cyl_meter', String((last.cylMeter || 0) + 200));
    set('in_revCounter', String((last.revCounter || 0) + 10000));
  });

  await pg.click('#btnAdd');
  await pg.waitForTimeout(2000);

  const after = await pg.evaluate(() => {
    const sel = document.getElementById('in_selectEntry');
    const panel = document.getElementById('voyageSummaryPanel');
    const last = sortedEntries().slice(-1)[0];
    return {
      entryCount: state.entries.length,
      selected: sel?.value || '',
      editingId,
      currentVsEntryId,
      lastId: last?.id || null,
      btnLabel: document.getElementById('btnAdd')?.textContent?.trim(),
      summaryVisible: panel ? (panel.style.display !== 'none' && !panel.hidden) : false,
      title: document.getElementById('logEntryTitle')?.textContent?.trim(),
    };
  });

  console.log('after Add Entry');
  check('a new entry was saved', after.entryCount, beforeCount + 1);
  check('selector lands on the saved entry', after.selected, after.lastId);
  check('editingId is the saved entry', after.editingId, after.lastId);
  check('Voyage Summary targets the saved entry', after.currentVsEntryId, after.lastId);
  check('Voyage Summary panel is open', after.summaryVisible, true);
  check('button says Update Entry', after.btnLabel, 'Update Entry');
  check('title is edit mode', after.title, 'EDIT LOG ENTRY');
  check('no page errors', errs.length, 0);
  if (errs.length) console.log('   ', errs.slice(0, 3));

  await b.close();
  console.log('');
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})().catch(e => { console.error(e); process.exit(2); });
