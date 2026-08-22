/*
 * e-ORB new-entry operations, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_orb_scenarios_e2e.js
 *
 * Three things the headless suite cannot reach, because they only exist once the
 * wizard has actually rendered:
 *
 *  - Every operation must put its fields on screen. The tank branch of the field
 *    renderer read the scenario options on its first line and then declared a
 *    same-block const of the same name, so every operation carrying a tank threw
 *    a temporal-dead-zone error and left the engineer an empty field grid.
 *  - A Code I operation that moves oil has to move the tank R.O.B. with it, through
 *    the save path and into stored setup — not just in the pure helper.
 *  - The entry preview has to show one date and one code for the whole item set,
 *    because that is how the printed book reads.
 *
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

  /* Sludge and bilge tanks to move oil between. */
  await pg.evaluate(() => {
    switchTab('orb');
    const st = orbSetup();
    st.tanks.sludge = [{ id: 'SL1', name: 'Sludge Tk', capacityM3: 30, robM3: 12 }];
    st.tanks.bilge = [{ id: 'BW1', name: 'Bilge Holding Tk', capacityM3: 20, robM3: 8 }];
    st.tanks.bilgeWells = [{ id: 'BW-ER', name: 'E/R Bilge Well', capacityM3: 3, robM3: 1 }];
    state.setup.orb = st;
    fillOrbSetupForm();
    switchOrbPanel('new');
    renderOrbOpGrid();
  });
  await pg.waitForTimeout(1000);

  console.log('\nevery operation puts its fields on screen');
  const grids = await pg.evaluate(async () => {
    const out = {};
    const partSel = document.getElementById('orb_part');
    for (const part of ['1', '2', '3']){
      partSel.value = part;
      partSel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const ids = [...document.querySelectorAll('[data-orb-scenario]')].map(x => x.dataset.orbScenario);
      for (const id of ids){
        /* The weekly inventory opens its own sounding wizard, not the item field grid. */
        if ((EORB.getScenario(id) || {}).wizard === 'weekly') continue;
        const card = document.querySelector(`[data-orb-scenario="${id}"]`);
        if (!card) continue;
        card.click();
        await new Promise(r => setTimeout(r, 120));
        out[id] = [...document.querySelectorAll('#orbFieldGrid [data-orb-field]')].map(e => e.dataset.orbField);
      }
    }
    partSel.value = '1';
    partSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    return out;
  });
  const empty = Object.entries(grids).filter(([, v]) => !v.length).map(([k]) => k);
  check('no operation opens an empty field grid', empty, []);
  check('the sludge transfer offers both tanks',
    ['fromTank', 'toTank'].every(n => (grids['sludge-transfer'] || []).includes(n)), true);
  check('bunkering offers its tank list', (grids['bunker-fuel'] || []).includes('fuelTank'), true);
  check('and the changeover its tanks', (grids['changeover-to-ls-complete'] || []).includes('coTanks'), true);

  console.log('\nthe reference list of operations is all reachable');
  const scen = await pg.evaluate(() => {
    const byPart = {};
    [1, 2, 3].forEach(p => {
      byPart[p] = EORB.getScenarios(orbSetup(), p).map(s => s.id);
    });
    return byPart;
  });
  const wanted = ['sludge-water-drain', 'sludge-evaporation', 'sludge-regeneration',
    'bilge-tank-transfer', 'bilge-to-sludge', 'ows-restored', 'bunker-diesel',
    'bilge-unit-maintenance', 'bilge-oily-to-tank', 'missed-entry', 'debunker-fuel',
    'debunker-diesel', 'seal-applied', 'seal-broken', 'bilge-evaporation',
    'ows-ocm-test', 'aircooler-condensate'];
  check('every newly added Part I operation has a card',
    wanted.filter(id => !scen[1].includes(id)), []);
  check('and the four changeover events are on Part III', scen[3], [
    'changeover-to-ls-start', 'changeover-to-ls-complete',
    'changeover-to-hs-start', 'changeover-to-hs-complete']);

  console.log('\na Code I operation that moves oil moves the R.O.B. with it');
  const moved = await pg.evaluate(async () => {
    document.getElementById('orb_part').value = '1';
    document.getElementById('orb_part').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-orb-scenario="bilge-oily-to-tank"]').click();
    await new Promise(r => setTimeout(r, 400));
    const set = (n, v) => {
      const el = document.querySelector(`#orbFieldGrid [data-orb-field="${n}"]`);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('extraFromTank', 'SL1');
    set('extraToTank', 'BW1');
    set('extraQty', '2.5');
    document.getElementById('orb_officerName').value = 'A. Ruiz';
    const robOf = (src, id) => {
      const all = [].concat(src.tanks.sludge || [], src.tanks.bilge || []);
      const hit = all.find(t => t.id === id);
      return hit ? hit.robM3 : null;
    };
    const before = { sludge: robOf(orbSetup(), 'SL1'), bilge: robOf(orbSetup(), 'BW1') };
    const nBefore = (state.orbEntries || []).length;
    document.getElementById('btnOrbSaveEntry').click();
    await new Promise(r => setTimeout(r, 1200));
    const saved = (state.orbEntries || []).slice(-1)[0];
    return {
      before,
      after: { sludge: robOf(orbSetup(), 'SL1'), bilge: robOf(orbSetup(), 'BW1') },
      stored: { sludge: robOf(state.setup.orb, 'SL1'), bilge: robOf(state.setup.orb, 'BW1') },
      added: (state.orbEntries || []).length - nBefore,
      code: saved && saved.code,
      text: saved && saved.lines && saved.lines[0] && saved.lines[0].text,
      robNotes: (saved && saved.robNotes) || []
    };
  });
  check('the tanks started where they were seeded', moved.before, { sludge: 12, bilge: 8 });
  check('an entry was written', moved.added, 1);
  check('under Code I', moved.code, 'I');
  check('source drawn down', moved.after.sludge, 9.5);
  check('receiving topped up', moved.after.bilge, 10.5);
  check('and that is what is stored, not just shown',
    moved.stored, { sludge: 9.5, bilge: 10.5 });
  check('both movements are reported back to the engineer', moved.robNotes.length, 2);
  check('the wording carries the quantity', /2\.5 m³/.test(moved.text || ''), true);
  check('and names both tanks',
    /Sludge Tk/.test(moved.text || '') && /Bilge Holding Tk/.test(moved.text || ''), true);

  console.log('\nthe OWS / OCM test records how long it ran');
  const dur = await pg.evaluate(async () => {
    document.querySelector('[data-orb-scenario="ows-ocm-test"]').click();
    await new Promise(r => setTimeout(r, 400));
    const el = document.querySelector('#orbFieldGrid [data-orb-field="testDurationMin"]');
    const label = el && el.closest('.field').querySelector('label').textContent.trim();
    if (el){ el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); }
    await new Promise(r => setTimeout(r, 300));
    renderOrbPreview();
    return { present: !!el, label, preview: document.getElementById('orbPreview').textContent };
  });
  check('a duration box is on the form', dur.present, true);
  check('labelled in minutes', dur.label, 'Duration of test (minutes)');
  check('and it reaches the entry wording', /duration of test 20 minutes/.test(dur.preview), true);

  console.log('\none date and one code per item set');
  const preview = await pg.evaluate(async () => {
    document.querySelector('[data-orb-scenario="weekly-sludge-bilge"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    /* Preview an entry with several item lines under one code. */
    const st = orbSetup();
    const entry = { date: '2026-08-01', code: 'C', part: 1, officerName: 'A. Ruiz', lines: [
      { itemNo: '11.1', text: 'Sludge Tk 1' }, { itemNo: '11.2', text: '30 m³' }, { itemNo: '11.3', text: '12 m³' },
      { itemNo: '11.1', text: 'Sludge Tk 2' }, { itemNo: '11.2', text: '20 m³' }, { itemNo: '11.3', text: '4 m³' }] };
    const d = document.createElement('div');
    d.innerHTML = EORB.buildPrintHtml(st, [entry], 'test');
    return [...d.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
  });
  check('six item lines printed', preview.length, 6);
  check('the date sits on the first line only',
    preview.map(r => r[0]), ['01-AUG-2026', '', '', '', '', '']);
  check('and so does the letter code', preview.map(r => r[1]), ['C', '', '', '', '', '']);
  check('while each line keeps its own item number',
    preview.map(r => r[2]), ['11.1', '11.2', '11.3', '11.1', '11.2', '11.3']);

  console.log('\nnothing went wrong');
  check('no page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
