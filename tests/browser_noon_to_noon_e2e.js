/*
 * The Noon to Noon report (Reports tab), driven in a real browser.
 *
 *   node tests/browser_noon_to_noon_e2e.js                      (starts its own static server)
 *   APP_BASE=http://127.0.0.1:8868 node tests/browser_noon_to_noon_e2e.js
 *
 * The sheet is a roll-up of the reports between two noons, and it gets signed and sent to a
 * charterer, so it has to agree with the rest of the app: its totals are Range Totals' totals for
 * the same reports, its unit rows add up to the total row printed under them, and the stock on
 * board closes. Not in CI (needs a browser).
 */
const http = require('http'), fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }
const ROOT = path.join(__dirname, '..');
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};
const mt = (x) => parseFloat(String(x).replace(/,/g, '')) || 0;

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (p.endsWith(path.sep)) p += 'voyage_manager.html';
      fs.readFile(p, (e, b) => {
        if (e) { r.writeHead(404); r.end(); return; }
        r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(b);
      });
    });
    srv.listen(0, () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

/* Build the sheet exactly as printing does, without opening a print dialog. */
const CAPTURE = `(id) => {
  const real = window.printPortraitSinglePage; let out = null;
  window.printPortraitSinglePage = (html) => { out = html; return html; };
  try { printNoonToNoon(id); } finally { window.printPortraitSinglePage = real; }
  return out;
}`;
const SCRAPE = `(html) => {
  const d = document.createElement('div'); d.innerHTML = html;
  const sec = (name) => [...d.querySelectorAll('.pr-section')].find(s => s.querySelector('.pr-section-title').textContent.trim().startsWith(name));
  const rows = {};
  d.querySelectorAll('.pr-section').forEach(s => {
    const t = s.querySelector('.pr-section-title').textContent.trim();
    s.querySelectorAll('.pr-row').forEach(r => { rows[t + '/' + r.querySelector('.pr-row-lbl').textContent.trim()] = r.querySelector('.pr-row-val').textContent.trim(); });
  });
  const fuel = sec('Fuel Consumption');
  const fuelRows = fuel ? [...fuel.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
  const inc = sec('Reports Included');
  const incRows = inc ? [...inc.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
  const rob = sec('Remaining On Board');
  const robRows = rob ? [...rob.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
  return {
    title: d.querySelector('.pr-doc-title')?.textContent.trim(),
    subtitle: d.querySelector('.pr-doc-subtitle')?.textContent.trim(),
    meta: [...d.querySelectorAll('.pr-meta-lbl')].map(m => m.textContent.trim()),
    metaVals: [...d.querySelectorAll('.pr-meta-val')].map(m => m.textContent.trim()),
    kpis: [...d.querySelectorAll('.pr-kpi-lbl')].map(k => k.textContent.trim()),
    kpiVals: [...d.querySelectorAll('.pr-kpi-val')].map(k => k.textContent.trim()),
    sections: [...d.querySelectorAll('.pr-section-title')].map(s => s.textContent.trim()),
    rows, fuelRows, incRows, robRows,
    remarks: d.querySelector('.pr-remarks-body')?.textContent.trim() || '',
    signed: !!d.querySelector('.pr-sign')
  };
}`;

(async () => {
  let srv = null, base = process.env.APP_BASE;
  if (!base) { const s = await serve(); srv = s.srv; base = s.base; }
  const exe = process.env.CHROMIUM_PATH;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { await d.accept(); });

  await pg.goto(`${base}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  /* A voyage of three days. Day 1 and day 3 are plain noon to noon; day 2 has operations in
     between (a speed change, an ECA entry, a heavy-weather report) and a bunkering is NOT used. */
  const ids = await pg.evaluate(() => {
    const base = sortedEntries().slice(-1)[0];
    const start = new Date(base.datetime).getTime();
    let me = base.me.meter, ge = base.ge.meter, blr = base.blr.meter, rc = base.revCounter || 0, cyl = base.cylMeter || 0;
    const H = 3600 * 1000, out = {};
    const add = (key, hoursAfter, op, extra) => {
      const hrsSinceLast = key === 'first' ? 24 : (extra.span || 24);
      rc += 78 * 60 * hrsSinceLast; me += 1700 * hrsSinceLast; ge += 58 * hrsSinceLast; blr += 12 * hrsSinceLast; cyl += 16 * hrsSinceLast;
      state.entries.push({
        ...JSON.parse(JSON.stringify(base)), id: 'n2n-' + key,
        datetime: new Date(start + hoursAfter * H).toISOString().slice(0, 16), operation: op,
        distanceShip: 14 * hrsSinceLast, rpm: 78, revCounter: rc, cylMeter: cyl,
        me: { ...base.me, meter: me, type: 'LSFO' }, ge: { ...base.ge, meter: ge, type: 'MDO/MGO' }, blr: { ...base.blr, meter: blr },
        meRunHours: null, unitOverride: {}, robSurvey: null, clockChangeMin: 0,
        report: { ...(base.report || {}), remarks: extra.remarks || '' }
      });
      out[key] = 'n2n-' + key;
    };
    add('first', 24, 'NOON - AT SEA', {});              // first noon: no earlier noon in this leg's new entries
    add('speed', 24 + 6, 'CHANGE SPEED', { span: 6, remarks: 'Speed reduced for ETA' });
    add('eca', 24 + 9.5, 'ECA - ENTRY', { span: 3.5 });
    add('heavy', 24 + 12, 'HEAVY WEATHER', { span: 2.5, remarks: 'Rough seas' });
    add('noon2', 48, 'NOON - AT SEA', { span: 12 });
    add('noon3', 72, 'NOON - AT SEA', {});
    render();
    return out;
  });
  await pg.waitForTimeout(1500);

  console.log('\nthe Reports tab offers the report');
  await pg.evaluate(() => switchTab('reports'));
  await pg.waitForTimeout(600);
  check('the panel is there', await pg.evaluate(() => !!document.getElementById('n2nPanel') && !!document.getElementById('btnN2nPrint')), true);
  const opts = await pg.evaluate(() => [...document.getElementById('n2nEnd').options].map(o => o.value));
  check('every noon report can be picked, newest first, and nothing else', opts.slice(0, 3), [ids.noon3, ids.noon2, ids.first]);
  check('heavy weather is not offered as a noon', opts.includes(ids.heavy), false);

  console.log('\nthe window');
  const win = await pg.evaluate((id) => { const w = noonToNoonWindow(id); return { start: w.startEntry && w.startEntry.id, ids: w.ids, partial: w.partial }; }, ids.noon2);
  check('starts at the previous noon', win.start, ids.first);
  check('holds every report in between, with the noon itself', win.ids, [ids.speed, ids.eca, ids.heavy, ids.noon2]);
  check('is not partial', win.partial, false);
  const win1 = await pg.evaluate((id) => { const w = noonToNoonWindow(id); return { start: w.startEntry && w.startEntry.id, partial: w.partial, n: w.ids.length }; }, ids.first);
  check('the first noon of the leg has no earlier noon among the new entries', win1.partial || !!win1.start, true);

  console.log('\nthe sheet for the noon with operations in between');
  const html = await pg.evaluate(new Function('return ' + CAPTURE)(), ids.noon2);
  check('printing produced a sheet', typeof html === 'string' && html.length > 800, true);
  const s = await pg.evaluate(new Function('return ' + SCRAPE)(), html);
  check('title', s.title, 'Noon to Noon Report');
  check('subtitle counts the reports', s.subtitle, 'Voyage Chief — Summary of 4 reports');
  check('meta', s.meta, ['Date & Time', 'Previous Noon', 'Route']);
  check('KPI strip', s.kpis, ['Run Hrs (Noon to Noon)', 'Ship Dist (nm)', 'RPM', 'Slip %', 'Speed (kn)', '% MCR', 'Est. kW']);
  check('it is signed', s.signed, true);
  check('it has the fuel, fresh water, generators, reports and stock sections',
    ['Fuel Consumption (MT)', 'Fresh Water', 'Boiler & Incinerator', 'Reports Included (4)', 'Remaining On Board'].every(n => s.sections.includes(n)), true);
  check('remarks of the reports in between are carried', /Speed reduced for ETA/.test(s.remarks) && /Rough seas/.test(s.remarks), true);

  console.log('\nthe figures are the ones Range Totals gives for the same reports');
  const tab = await pg.evaluate((idList) => {
    const agg = rangeAggregate(idList);
    return { hrs: fmt(agg.hrs, 2), dist: fmt(agg.distShip, 2), fuel: fmtFuel(agg.fuelTotal), n: agg.reports, groups: FUEL_CONS_GROUPS.map(g => agg.fuel[g.label]) };
  }, win.ids);
  check('run hours (the first KPI)', s.kpiVals[0], tab.hrs);
  check('ship distance', s.kpiVals[1], tab.dist);
  const totalRow = s.incRows[s.incRows.length - 1];
  check('the list ends on the noon-to-noon total', totalRow[0], 'Noon to noon');
  check('total hours in the list', totalRow[1], tab.hrs);
  check('total distance in the list', totalRow[2], tab.dist);
  check('total fuel in the list', totalRow[3], tab.fuel);
  const listed = s.incRows.slice(1, -1);
  check('one row per report', listed.length, 4);
  const sum = (i) => listed.reduce((a, r) => a + mt(r[i]), 0);
  check('the rows add up to the total hours', sum(2).toFixed(2), mt(tab.hrs).toFixed(2));
  check('the rows add up to the total fuel', sum(4).toFixed(3), mt(tab.fuel).toFixed(3));

  console.log('\nthe fuel table');
  const fr = s.fuelRows;
  const unitRows = fr.slice(1, -1), total = fr[fr.length - 1];
  check('the three machinery rows are always there', unitRows.slice(0, 3).map(r => r[0]), ['Main Engine', 'Diesel Generator', 'Boiler']);
  for (let col = 1; col < total.length; col++) {
    const colSum = unitRows.reduce((a, r) => a + mt(r[col]), 0);
    check(`column ${fr[0][col]}: the units add up to the total`, colSum.toFixed(3), mt(total[col]).toFixed(3));
  }
  check('and the totals add up to the all-fuel figure', total.slice(1).reduce((a, v) => a + mt(v), 0).toFixed(3), mt(tab.fuel).toFixed(3));

  console.log('\nremaining on board closes');
  const robOk = await pg.evaluate((idList) => {
    const d = noonToNoonData(idList.end);
    const asOf = robAsOfEntry(idList.end);
    const tank = d.robRows.find(r => r.cat === 'fuel');
    const prior = robAsOfEntry(idList.start);
    return { now: Number(tank.nowVal), asOfNow: Number(asOf.rob[tank.key]), prev: Number(tank.prevVal), priorNow: Number(prior.rob[tank.key]), recv: tank.recvVal, cons: tank.consVal };
  }, { end: ids.noon2, start: ids.first });
  check('present stock is the closing noon\'s stock', robOk.now, robOk.asOfNow);
  check('previous stock is the previous noon\'s stock', robOk.prev, robOk.priorNow);
  check('the stock row of the sheet has a Previous noon column', s.robRows[0].length > 1 && s.robRows.some(r => r[0] === 'Previous noon'), true);

  console.log('\nthe panel');
  await pg.selectOption('#n2nEnd', ids.noon2);
  await pg.waitForTimeout(300);
  const panel = await pg.evaluate(() => ({
    rows: document.querySelectorAll('#n2nBody tr').length, win: document.getElementById('n2nWindow').textContent,
    disabled: document.getElementById('btnN2nPrint').disabled
  }));
  check('lists the four reports and a total row', panel.rows, 5);
  check('names the period and the number of reports', /4 reports/.test(panel.win), true);
  check('print is enabled', panel.disabled, false);
  await pg.evaluate(() => document.getElementById('btnN2nPreview').click());
  await pg.waitForTimeout(900);
  const prev = await pg.evaluate(() => {
    const fr = document.querySelector('#n2nPreviewHost iframe');
    return fr ? { title: fr.contentDocument.querySelector('.pr-doc-title')?.textContent.trim(), signed: !!fr.contentDocument.querySelector('.pr-sign') } : null;
  });
  check('the preview shows the same sheet', prev, { title: 'Noon to Noon Report', signed: true });

  console.log('\nprint history');
  await pg.evaluate(async (id) => { const real = window.printPortraitSinglePage; window.printPortraitSinglePage = () => ''; try { await printNoonToNoon(id); } finally { window.printPortraitSinglePage = real; } }, ids.noon2);
  await pg.waitForTimeout(400);
  const hist = await pg.evaluate(() => state.printHistory.filter(p => p.type === 'noon-to-noon').length);
  check('the print is recorded', hist >= 1, true);
  check('and can be rebuilt from the history', await pg.evaluate((id) => sheetHtmlForPrintType('noon-to-noon', state.entries.find(e => e.id === id)).includes('Noon to Noon Report'), ids.noon2), true);

  console.log('\nedge cases');
  const partial = await pg.evaluate((id) => {
    const keep = state.entries;
    state.entries = keep.filter(e => e.id.startsWith('n2n-'));
    try {
      const w = noonToNoonWindow(id);
      const html = buildNoonToNoonSheetHTML(id);
      return { partial: w.partial, start: w.startEntry, html: /partial period/.test(html), note: /no earlier noon report/.test(html) };
    } finally { state.entries = keep; }
  }, ids.first);
  check('a noon with no earlier noon is a partial period', partial.partial, true);
  check('and the sheet says so', [partial.html, partial.note], [true, true]);
  const clock = await pg.evaluate((id) => {
    const e = state.entries.find(x => x.id === 'n2n-eca'); const was = e.clockChangeMin; e.clockChangeMin = 60;
    try {
      const html = buildNoonToNoonSheetHTML(id);
      return { note: /clock advanced 60 min/.test(html) };
    } finally { e.clockChangeMin = was; }
  }, ids.noon2);
  check('a clock change in the period is named on the sheet', clock.note, true);
  const unknown = await pg.evaluate(() => buildNoonToNoonSheetHTML('no-such-entry'));
  check('an unknown noon builds nothing', unknown, '');

  console.log('\nevery noon in a range (one print)');
  const batch = await pg.evaluate(async (ids) => {
    const real = window.printPortraitPages; let out = null, sheets = null;
    window.printPortraitPages = (list) => { sheets = list; out = real(list); return out; };
    const histBefore = state.printHistory.filter(p => p.type === 'noon-to-noon').length;
    try { await printNoonToNoonBatch(ids.first, ids.noon3); } finally { window.printPortraitPages = real; }
    const d = document.createElement('div'); d.innerHTML = out || '';
    const pages = [...d.querySelectorAll('.pr-page-portrait')];
    return {
      sheets: Array.isArray(sheets) ? sheets.length : -1,
      pages: pages.length,
      signed: pages.every(p => !!p.querySelector('.pr-sign')),
      titles: pages.map(p => p.querySelector('.pr-doc-title')?.textContent.trim()),
      dates: pages.map(p => p.querySelectorAll('.pr-meta-val')[0]?.textContent.trim()),
      hist: state.printHistory.filter(p => p.type === 'noon-to-noon').length - histBefore,
      expected: noonToNoonRange(ids.first, ids.noon3, null).map(x => x.id)
    };
  }, ids);
  check('one sheet per noon in the range', batch.sheets, 3);
  check('printed as one page each', batch.pages, 3);
  check('every page is a Noon to Noon report and is signed', [batch.titles.every(t => t === 'Noon to Noon Report'), batch.signed], [true, true]);
  check('the noons are in time order', batch.expected, [ids.first, ids.noon2, ids.noon3]);
  check('each noon is filed in the print history', batch.hist, 3);
  const perNoon = await pg.evaluate((ids) => [ids.first, ids.noon2, ids.noon3].map(id => {
    const d = noonToNoonData(id, null); return { hrs: d.agg.hrs, n: d.views.length };
  }), ids);
  check('the second noon is the 4-report period', perNoon[1].n, 4);
  check('and each period is worked on its own (hours differ by period, not cumulative)', perNoon[2].hrs <= 24.01 && perNoon[1].hrs <= 24.01, true);

  console.log('\na long period still fits one page');
  const longRun = await pg.evaluate(async () => {
    const keep = state.entries;
    const base = keep.find(e => e.id === 'n2n-noon2');
    const start = new Date(base.datetime).getTime();
    const extra = [];
    for (let i = 1; i <= 12; i++) {
      extra.push({ ...JSON.parse(JSON.stringify(base)), id: 'n2n-long-' + i, operation: i % 2 ? 'CHANGE SPEED' : 'HEAVY WEATHER',
        datetime: new Date(start + (i * 1.5 + 0.5) * 3600 * 1000).toISOString().slice(0, 16),
        report: { ...(base.report || {}), remarks: 'Report ' + i + ': a short remark about the watch.' } });
    }
    const noon = { ...JSON.parse(JSON.stringify(base)), id: 'n2n-long-noon', operation: 'NOON - AT SEA',
      datetime: new Date(start + 23.5 * 3600 * 1000).toISOString().slice(0, 16) };
    state.entries = keep.concat(extra, [noon]);
    try {
      /* The sheet is fitted to the page: the signature has to end up inside the A4 page, not past its edge. */
      switchTab('reports'); renderNoonToNoonPanel(); document.getElementById('n2nEnd').value = 'n2n-long-noon'; updateNoonToNoonPanel(); previewNoonToNoon();
      await new Promise(r => setTimeout(r, 900));
      const fr = document.querySelector('#n2nPreviewHost iframe'), fd = fr && fr.contentDocument;
      const pageEl = fd && fd.querySelector('.pr-page-portrait'), sign = fd && fd.querySelector('.pr-sign');
      var fit = (pageEl && sign) ? { signBottom: Math.round(sign.getBoundingClientRect().bottom), pageBottom: Math.round(pageEl.getBoundingClientRect().bottom) } : null;
      const real = window.printPortraitSinglePage; let out = null;
      window.printPortraitSinglePage = (h) => { out = real(h); return out; };
      try { printNoonToNoon('n2n-long-noon'); } finally { window.printPortraitSinglePage = real; }
      const d = document.createElement('div'); d.innerHTML = out || '';
      const w = noonToNoonWindow('n2n-long-noon');
      return { sheets: d.querySelectorAll('.pr-sheet').length, signed: !!d.querySelector('.pr-sign'), n: w ? w.ids.length : -1,
               rows: d.querySelectorAll('.pr-section')[0] ? 1 : 0, win: w && w.ids, fit };
    } finally { state.entries = keep; }
  });
  check('the period holds many reports', longRun.n >= 13, true);
  check('and prints as one signed sheet', [longRun.sheets, longRun.signed], [1, true]);
  check('with the signature inside the A4 page', !!longRun.fit && longRun.fit.signBottom <= longRun.fit.pageBottom + 1, true);

  console.log('\na period across a voyage-leg change');
  const cross = await pg.evaluate(async (ids) => {
    const keep = state.entries, keepPool = _rangeLegPool, keepFlag = _n2nIncludeArchived;
    const act = keep.filter(e => e.id.startsWith('n2n-') && !e.id.startsWith('n2n-long'));
    const first = act.find(e => e.id === ids.first);
    const t0 = new Date(first.datetime).getTime(), H = 3600 * 1000;
    let me = first.me.meter - 4000, ge = first.ge.meter - 400, blr = first.blr.meter - 100, rc = (first.revCounter || 0) - 90000, cyl = (first.cylMeter || 0) - 300;
    const mk = (id, hoursBefore, op, span) => {
      rc += 78 * 60 * span; me += 1700 * span; ge += 58 * span; blr += 12 * span; cyl += 16 * span;
      return { ...JSON.parse(JSON.stringify(first)), id, operation: op, datetime: new Date(t0 - hoursBefore * H).toISOString().slice(0, 16),
        distanceShip: 14 * span, rpm: 78, revCounter: rc, cylMeter: cyl,
        me: { ...first.me, meter: me, type: 'LSFO' }, ge: { ...first.ge, meter: ge, type: 'MDO/MGO' }, blr: { ...first.blr, meter: blr },
        report: { ...(first.report || {}), remarks: id === 'old-arr' ? 'All fast, voyage ended' : '' }, robSurvey: null, clockChangeMin: 0 };
    };
    const oldEntries = [mk('old-noon', 36, 'NOON - AT SEA', 24), mk('old-arr', 20, 'ARRIVAL - FIRST LINE', 16)];
    const pack = { setup: JSON.parse(JSON.stringify(state.setup)), entries: oldEntries, receipts: [], documents: [], abstracts: [], printHistory: [] };
    state.entries = act;
    const vid = vesselRegistryId(state.activeVesselId || LEGACY_VESSEL_ID);
    const oldLeg = { key: 'old-leg', label: 'Voyage 07 · Laden', voyageNumber: '07', condition: 'L', active: false, pack,
      entries: oldEntries.map(e => normalizeEntry(cloneEntry(e))) };
    const activeLeg = { key: 'active', label: 'Voyage 08 · Ballast · open', voyageNumber: '08', condition: 'B', active: true, pack: null, entries: sortedEntries().slice() };
    _rangeLegPool = { vesselId: vid, legs: [oldLeg, activeLeg] };
    try {
      const box = document.getElementById('n2nIncludeArchived');
      box.checked = true; box.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 400));
      const opts = [...document.getElementById('n2nEnd').options].map(o => o.value);
      const groups = [...document.querySelectorAll('#n2nEnd optgroup')].map(g => g.label);
      const w = noonToNoonWindow(ids.first, _rangeLegPool);
      const d = noonToNoonData(ids.first, _rangeLegPool);
      const flatIds = w.ids;
      const ref = aggregateAcrossLegs(_rangeLegPool, 'old-noon', ids.first, true);
      const html = buildNoonToNoonSheetHTML(ids.first, _rangeLegPool);
      const dd = document.createElement('div'); dd.innerHTML = html;
      const fuel = [...dd.querySelectorAll('.pr-section')].find(s => s.querySelector('.pr-section-title').textContent.startsWith('Fuel Consumption'));
      const fr = [...fuel.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      const inc = [...dd.querySelectorAll('.pr-section')].find(s => s.querySelector('.pr-section-title').textContent.startsWith('Reports Included'));
      const ir = [...inc.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      const panelWin = document.getElementById('n2nWindow').textContent;
      document.getElementById('n2nEnd').value = ids.first;
      updateNoonToNoonPanel();
      return {
        opts: opts.slice(0, 5), groups, start: w.startEntry && w.startEntry.id, ids: flatIds, spans: w.spansLegs, segs: w.segments.map(s => s.legKey),
        hrs: d.agg.hrs, refHrs: ref.hrs, dist: d.agg.distShip, refDist: ref.distShip, fuel: d.agg.fuelTotal, refFuel: ref.fuelTotal,
        views: d.views.map(v => v.id), fuelRows: fr, incRows: ir, remarks: dd.querySelector('.pr-remarks-body').textContent,
        subtitle: dd.querySelector('.pr-doc-subtitle').textContent, signed: !!dd.querySelector('.pr-sign'),
        rob: !!d.robRows, panel: document.getElementById('n2nWindow').textContent
      };
    } finally {
      state.entries = keep; _rangeLegPool = keepPool; _n2nIncludeArchived = keepFlag;
      const box = document.getElementById('n2nIncludeArchived'); if (box) box.checked = keepFlag;
      renderNoonToNoonPanel();
    }
  }, ids);
  check('the saved leg\'s noons are offered, grouped by leg', cross.groups.length, 2);
  check('the previous noon is in the earlier leg', cross.start, 'old-noon');
  check('the period holds the old leg\'s closing report and the new leg\'s noon', cross.ids, ['old-arr', ids.first]);
  check('it spans two legs', [cross.spans, cross.segs], [true, ['old-leg', 'active']]);
  check('hours are Range Totals\' hours across the same legs', cross.hrs.toFixed(3), cross.refHrs.toFixed(3));
  check('distance too', cross.dist.toFixed(2), cross.refDist.toFixed(2));
  check('and fuel', cross.fuel.toFixed(3), cross.refFuel.toFixed(3));
  check('the list names both reports and the total', [cross.views, cross.incRows.length], [['old-arr', ids.first], 4]);
  const cu = cross.fuelRows.slice(1, -1), ct = cross.fuelRows[cross.fuelRows.length - 1];
  for (let col = 1; col < ct.length; col++) {
    check(`fuel column ${cross.fuelRows[0][col]}: units add up to the total across legs`, cu.reduce((a, r) => a + mt(r[col]), 0).toFixed(3), mt(ct[col]).toFixed(3));
  }
  check('the sheet says it crosses legs and carries the old leg\'s remark',
    [/across 2 voyage legs/.test(cross.remarks), /All fast, voyage ended/.test(cross.remarks)], [true, true]);
  check('it is signed and has the stock table', [cross.signed, cross.rob], [true, true]);
  check('the panel says the period crosses legs', /across 2 voyage legs/.test(cross.panel), true);

  check('no script errors', errs, []);
  console.log(`\n${c - f}/${c} passed`);
  await b.close();
  if (srv) srv.close();
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
