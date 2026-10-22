/*
 * The Range Totals tab prints an A4 portrait sheet, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_range_totals_print_e2e.js
 *
 * The sheet is signed, so two things have to hold. The figures on it must be the ones
 * the tab shows — a signed total that disagrees with the screen is worse than no sheet
 * at all. And it must fit one page: the print root has overflow:hidden, so anything
 * past the bottom is silently cut, and the signature and footer are the last things on
 * it — exactly how the noon sheet once printed with its stamp off the paper.
 *
 * Seeds a voyage long enough to overrun one page, then checks the totals, that every
 * report in the range is printed, and that each page still holds its own signature
 * or footer. Not in CI, no browser.
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

/* Build the sheet without opening a print dialog. */
const CAPTURE = `() => {
  const real = window.printPortraitPages;
  let out = null;
  window.printPortraitPages = (html) => { out = real(html); return out; };
  try { printRangeTotalsSheet(); } finally { window.printPortraitPages = real; }
  return out;
}`;

const SCRAPE = `(html) => {
  /* The fitter strips and re-assigns pr-table-wide while it densifies the sheet, so
     the reports list has to be found by the section it lives in, not by that class. */
  const sectionTable = (root, name) => [...root.querySelectorAll('.pr-section')]
    .find(s => s.querySelector('.pr-section-title')?.textContent.trim().startsWith(name))
    ?.querySelector('table') || null;
  const listTable = (root) => sectionTable(root, 'Reports In Range');
  const consumerTable = (root) => sectionTable(root, 'Fuel Consumption By Consumer');
  const d = document.createElement('div');
  d.innerHTML = html;
  const rows = {};
  d.querySelectorAll('.pr-section').forEach(s => {
    const t = s.querySelector('.pr-section-title').textContent.trim().split(' —')[0];
    s.querySelectorAll('.pr-row').forEach(r => {
      rows[t + '/' + r.querySelector('.pr-row-lbl').textContent.trim()] = r.querySelector('.pr-row-val').textContent.trim();
    });
  });
  const pages = [...d.querySelectorAll('.pr-page-portrait')];
  const root = pages[0] || d;
  const reportSections = [...d.querySelectorAll('.pr-section')]
    .filter(s => (s.querySelector('.pr-section-title')?.textContent || '').includes('Reports In Range'));
  const reportNotes = reportSections.flatMap(s => [...s.querySelectorAll('.pr-note')].map(n => n.textContent.trim()));
  const listed = reportSections.reduce((sum, s) => {
    const table = s.querySelector('table');
    if (!table) return sum;
    return sum + [...table.querySelectorAll('tr')].filter(tr =>
      tr.querySelector('th') == null && !tr.classList.contains('pr-total')).length;
  }, 0);
  return {
    title: root.querySelector('.pr-doc-title')?.textContent.trim(),
    subtitle: root.querySelector('.pr-doc-subtitle')?.textContent.trim(),
    meta: [...root.querySelectorAll('.pr-meta-lbl')].map(m => m.textContent.trim()),
    kpis: [...root.querySelectorAll('.pr-kpi-lbl')].map(k => k.textContent.trim()),
    sections: [...root.querySelectorAll('.pr-section-title')].map(s => s.textContent.trim().split(' —')[0]),
    rows,
    pages: pages.length || 1,
    listed,
    listRows: listTable(root) ? listTable(root).querySelectorAll('tr').length : 0,
    totalRowLabel: [...d.querySelectorAll('tr.pr-total .row-lbl')].map(el => el.textContent.trim()).pop() || '',
    consumerRows: consumerTable(root)
      ? [...consumerTable(root).querySelectorAll('tr')].slice(1).map(tr =>
          [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      : null,
    notes: reportNotes,
    hasSignature: !!d.querySelector('.pr-sign'),
    hasFooter: !!d.querySelector('.pr-foot'),
    signatureOnLast: pages.length
      ? !!pages[pages.length - 1].querySelector('.pr-sign')
      : !!d.querySelector('.pr-sign')
  };
}`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  const dialogs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  console.log('\nthe tab offers the sheet');
  await pg.evaluate(() => switchTab('rangetotals'));
  await pg.waitForTimeout(600);
  check('a print button is on the page',
    await pg.evaluate(() => !!document.getElementById('btnPrintRangeTotals')), true);

  /* A voyage long enough to overrun the printed list. */
  await pg.evaluate(() => {
    const base = sortedEntries().slice(-1)[0];
    const start = new Date(base.datetime).getTime();
    let me = base.me.meter, ge = base.ge.meter, blr = base.blr.meter, rc = base.revCounter || 0, cyl = base.cylMeter || 0;
    for (let i = 1; i <= 80; i++){
      const rpm = 78 + (i % 5);
      rc += rpm * 60 * 24;
      me += 41000; ge += 1400; blr += 300; cyl += 380;
      state.entries.push({
        ...JSON.parse(JSON.stringify(base)),
        id: 'range-print-' + i,
        datetime: new Date(start + i * 24 * 3600 * 1000).toISOString().slice(0, 16),
        operation: 'NOON - AT SEA',
        distanceShip: 336, rpm, revCounter: rc, cylMeter: cyl,
        me: { ...base.me, meter: me, type: 'LSFO' },
        ge: { ...base.ge, meter: ge, type: 'MDO/MGO' },
        blr: { ...base.blr, meter: blr },
        meRunHours: null, unitOverride: {}, robSurvey: null
      });
    }
    render();
  });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { switchTab('rangetotals'); document.getElementById('btnRangeAll').click(); });
  await pg.waitForTimeout(700);

  const html = await pg.evaluate(new Function('return ' + CAPTURE)());
  await pg.waitForTimeout(300);
  check('printing produced a sheet', typeof html === 'string' && html.length > 500, true);
  const s = await pg.evaluate(new Function('return ' + SCRAPE)(), html);

  console.log('\nit is the same document as the other printouts');
  check('title', s.title, 'Totals & Averages');
  check('subtitle names the range summary', String(s.subtitle || '').startsWith('Report Range Summary'), true);
  check('meta names the vessel, voyage and both ends of the range',
    s.meta, ['Vessel', 'Voyage No.', 'From Report', 'To Report']);
  check('a KPI strip leads', s.kpis, ['Reports', 'Period Hrs', 'Distance (nm)', 'Avg Speed (kn)', 'All Fuel (MT)']);
  check('totals, averages, the consumer split and the reports behind them',
    s.sections, ['Totals', 'Averages', 'Fuel Consumption By Consumer', 'Remaining On Board', 'Reports In Range']);
  check('it is signed', s.hasSignature, true);

  /* Fuel split by what burned it. The four consumers have to account for the whole
     burn, or the sheet contradicts the All Fuel figure printed beside them — so the
     check is that they add up to the printed total, not that each is some value. */
  const consumers = s.consumerRows || [];
  check('one row per consumer plus the sum', consumers.length, 5);
  check('the consumers named', consumers.slice(0, 4).map(r => r[0]),
    ['Main Engine', 'Generator', 'Boiler', 'Other']);
  const mt = (x) => parseFloat(String(x).replace(/,/g, '')) || 0;
  const consumerSum = consumers.slice(0, 4).reduce((a, r) => a + mt(r[1]), 0);
  check('they add up to the printed total', consumerSum.toFixed(3), mt(consumers[4][1]).toFixed(3));
  check('and that total is the All Fuel figure', mt(consumers[4][1]).toFixed(3),
    mt(s.rows['Totals/All fuel']).toFixed(3));
  const shareSum = consumers.slice(0, 4).reduce((a, r) => a + mt(r[3]), 0);
  check('the shares come to 100%', Math.round(shareSum), 100);
  check('each consumer carries a per-day rate, or a dash when it did not run',
    consumers.slice(0, 4).every(r => /^[\d.]+$/.test(r[2]) || r[2] === '—'), true);
  check('and carries the printed-on footer', s.hasFooter, true);

  console.log('\nthe figures are the ones the tab shows');
  const tab = await pg.evaluate(() => {
    const agg = rangeAggregate(rangeEntryIds());
    const n = (v, d = 2) => v == null || isNaN(v) ? '—' : fmt(v, d);
    return {
      reports: String(agg.reports), hrs: n(agg.hrs), meHrs: n(agg.meHrs),
      distShip: n(agg.distShip), fuelTotal: n(agg.fuelTotal, 3),
      revs: n(agg.revs, 0), revsRaw: agg.revs,
      groups: FUEL_CONS_GROUPS.map(g => [g.label, n(agg.fuel[g.label], 3)]),
      avgSpeed: n(agg.avgSpeed), avgRpm: n(agg.avgRpm), avgKw: n(agg.avgKw, 0)
    };
  });
  check('reports in range', s.rows['Totals/Reports in range'], tab.reports);
  check('period hours', s.rows['Totals/Period hours'], tab.hrs);
  check('M/E running hours', s.rows['Totals/M/E running hours'], tab.meHrs);
  check('distance by ship', s.rows['Totals/Distance by ship'], `${tab.distShip} nm`);
  check('all fuel', s.rows['Totals/All fuel'], `${tab.fuelTotal} MT`);
  tab.groups.forEach(([label, v]) =>
    check(`${label} burned`, s.rows[`Totals/${label} burned`], `${v} MT`));
  check('ship speed', s.rows['Averages/Ship Speed'], `${tab.avgSpeed} kn`);
  check('total revolutions', s.rows['Totals/Total revolutions'], tab.revs);
  /* A count, not a rate: revolutions turned over the range is what an environmental
     return is worked from, and it must agree with the average rate reported beside it. */
  check('and it is a whole count, not the rate', /^\d+$/.test(tab.revs), true);
  check('revolutions reconcile with the average RPM',
    Math.round(tab.revsRaw / (Number(tab.hrs) * 60) * 100) / 100, Number(tab.avgRpm));
  check('RPM', s.rows['Averages/RPM'], `${tab.avgRpm} rpm`);
  check('Load (kW)', s.rows['Averages/Load (kW)'], `${tab.avgKw} kW`);
  check('Load % (MCR)', !!s.rows['Averages/Load % (MCR)'], true);
  check('Engine Distance', /nm$/.test(s.rows['Averages/Engine Distance'] || ''), true);
  check('Engine Speed', /kn$/.test(s.rows['Averages/Engine Speed'] || ''), true);
  check('Ship Distance', /nm$/.test(s.rows['Averages/Ship Distance'] || ''), true);

  console.log('\na long range prints every report, on as many pages as that takes');
  const reports = Number(tab.reports);
  check('more reports than the old 20-line cap', reports > 20, true);
  check('every report in the range is on the sheet', s.listed, reports);
  check('the list is not cut at 20 lines', s.notes.some(t => /Listing the first/.test(t)), false);
  check('a long range uses more than one page', s.pages > 1, true);
  console.log(`  ${s.listed} reports on ${s.pages} pages`);
  check('later pages say the list continues', s.notes.some(t => /Continued on the next page/.test(t)), true);
  check('the last page says the total covers the whole range',
    s.notes.some(t => t.includes(`all ${reports} reports`)), true);
  check('the summed row is not called a total alone', s.totalRowLabel, 'Total / Avg');
  check('the signature is on the last page', s.signatureOnLast, true);

  console.log('\nnothing falls off the paper');
  const css = await pg.evaluate((multi) => buildPrintDocumentHtmlPortrait('', multi).match(/<style>([\s\S]*?)<\/style>/)[1], s.pages > 1);
  const sheetPg = await b.newPage({ viewport: { width: 794, height: 1123 } });
  await sheetPg.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`);
  await sheetPg.waitForTimeout(700);
  const fit = await sheetPg.evaluate(() => [...document.querySelectorAll('.pr-page-portrait')].map(page => {
    const inner = page.querySelector('.pr-page-portrait-inner').getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const foot = page.querySelector('.pr-foot');
    const sign = page.querySelector('.pr-sign-name');
    return {
      overflow: Math.round(inner.bottom - box.bottom),
      footOnPage: !foot || foot.getBoundingClientRect().bottom <= box.bottom + 1,
      signOnPage: !sign || sign.getBoundingClientRect().bottom <= box.bottom + 1,
      wide: Math.round(inner.right - box.right),
      hasSign: !!sign
    };
  }));
  console.log('  pages', s.pages, 'fit', JSON.stringify(fit));
  check('every page ends above its own bottom edge', fit.every(p => p.overflow <= 1), true);
  check('the signature is on its page', fit.some(p => p.hasSign) && fit.every(p => p.signOnPage), true);
  check('so is the footer', fit.filter(p => p.hasSign).every(p => p.footOnPage), true);
  check('and no page runs off the side', fit.every(p => p.wide <= 1), true);

  console.log('\na short range prints the whole list, uncut');
  const short = await pg.evaluate(() => {
    const list = sortedEntries();
    document.getElementById('rangeFrom').value = list[list.length - 4].id;
    document.getElementById('rangeTo').value = list[list.length - 1].id;
    renderRangeTotals();
    const real = window.printPortraitPages;
    let out = null;
    window.printPortraitPages = (h) => { out = real(h); return out; };
    try { printRangeTotalsSheet(); } finally { window.printPortraitPages = real; }
    const d = document.createElement('div');
    d.innerHTML = out;
    /* Same reason as SCRAPE: find the list by its section, not by pr-table-wide. */
    const list2 = [...d.querySelectorAll('.pr-section')]
      .find(s => s.querySelector('.pr-section-title')?.textContent.trim().startsWith('Reports In Range'))
      ?.querySelector('table');
    const notes = [...d.querySelectorAll('.pr-section')]
      .filter(s => (s.querySelector('.pr-section-title')?.textContent || '').includes('Reports In Range'))
      .flatMap(s => [...s.querySelectorAll('.pr-note')].map(n => n.textContent.trim()));
    return {
      note: notes.find(t => /Listing the first|Continued on the next page/.test(t)) || null,
      pages: d.querySelectorAll('.pr-page-portrait').length || 1,
      listRows: list2 ? list2.querySelectorAll('tr').length : 0,
      reports: d.querySelector('.pr-kpi-val')?.textContent.trim()
    };
  });
  await pg.waitForTimeout(300);
  check('three periods between four reports', short.reports, '3');
  check('header, three reports and the total', short.listRows, 5);
  check('a short range stays on one page', short.pages, 1);
  check('no truncation note', short.note, null);

  console.log('\nnothing went wrong');
  check('no page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));
  check('and it never had to warn the engineer', dialogs, []);

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
