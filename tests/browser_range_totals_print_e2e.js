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
 * Seeds a voyage long enough to overrun the printed list, then checks the totals, the
 * truncation note, and that the footer still lands on the page. Not in CI, no browser.
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
  const real = window.printPortraitSinglePage;
  let out = null;
  window.printPortraitSinglePage = (html) => { out = real(html); return out; };
  try { printRangeTotalsSheet(); } finally { window.printPortraitSinglePage = real; }
  return out;
}`;

const SCRAPE = `(html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  const rows = {};
  d.querySelectorAll('.pr-section').forEach(s => {
    const t = s.querySelector('.pr-section-title').textContent.trim().split(' —')[0];
    s.querySelectorAll('.pr-row').forEach(r => {
      rows[t + '/' + r.querySelector('.pr-row-lbl').textContent.trim()] = r.querySelector('.pr-row-val').textContent.trim();
    });
  });
  return {
    title: d.querySelector('.pr-doc-title')?.textContent.trim(),
    subtitle: d.querySelector('.pr-doc-subtitle')?.textContent.trim(),
    meta: [...d.querySelectorAll('.pr-meta-lbl')].map(m => m.textContent.trim()),
    kpis: [...d.querySelectorAll('.pr-kpi-lbl')].map(k => k.textContent.trim()),
    sections: [...d.querySelectorAll('.pr-section-title')].map(s => s.textContent.trim().split(' —')[0]),
    rows,
    listRows: d.querySelectorAll('.pr-table tr').length,
    totalRowLabel: d.querySelector('.pr-table tr.pr-total .row-lbl')?.textContent.trim(),
    note: d.querySelector('.pr-note')?.textContent.trim() || null,
    hasSignature: !!d.querySelector('.pr-sign'),
    hasFooter: !!d.querySelector('.pr-foot')
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
    for (let i = 1; i <= 25; i++){
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
  check('subtitle', s.subtitle, 'Report Range Summary');
  check('meta names the vessel, voyage and both ends of the range',
    s.meta, ['Vessel', 'Voyage No.', 'From Report', 'To Report']);
  check('a KPI strip leads', s.kpis, ['Reports', 'Period Hrs', 'Distance (nm)', 'Avg Speed (kn)', 'All Fuel (MT)']);
  check('totals, averages and the reports behind them',
    s.sections, ['Totals', 'Averages', 'Reports In Range']);
  check('it is signed', s.hasSignature, true);
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
  check('ship speed', s.rows['Averages/Ship speed'], `${tab.avgSpeed} kn`);
  check('total revolutions', s.rows['Totals/Total revolutions'], tab.revs);
  /* A count, not a rate: revolutions turned over the range is what an environmental
     return is worked from, and it must agree with the average rate reported beside it. */
  check('and it is a whole count, not the rate', /^\d+$/.test(tab.revs), true);
  check('revolutions reconcile with the average RPM',
    Math.round(tab.revsRaw / (Number(tab.hrs) * 60) * 100) / 100, Number(tab.avgRpm));
  check('M/E revolutions', s.rows['Averages/M/E revolutions'], `${tab.avgRpm} rpm`);
  check('shaft power', s.rows['Averages/Shaft power'], `${tab.avgKw} kW`);

  console.log('\na range too long for the page says so');
  const reports = Number(tab.reports);
  check('more reports than the sheet lists', reports > 20, true);
  /* header + capped list + total row */
  check('the list is capped', s.listRows, 22);
  check('and the sheet says what it cut', /Listing the first 20 of \d+ reports/.test(s.note || ''), true);
  check('the note gives the true count', s.note.includes(`of ${reports} reports`), true);
  check('the summed row is not called a total alone', s.totalRowLabel, 'Total / Avg');

  console.log('\nnothing falls off the paper');
  const css = await pg.evaluate(() => buildPrintDocumentHtmlPortrait('').match(/<style>([\s\S]*?)<\/style>/)[1]);
  const sheetPg = await b.newPage({ viewport: { width: 794, height: 1123 } });
  await sheetPg.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`);
  await sheetPg.waitForTimeout(700);
  const fit = await sheetPg.evaluate(() => {
    const page = document.querySelector('.pr-page-portrait').getBoundingClientRect();
    const inner = document.querySelector('.pr-page-portrait-inner').getBoundingClientRect();
    const foot = document.querySelector('.pr-foot').getBoundingClientRect();
    const sign = document.querySelector('.pr-sign-name').getBoundingClientRect();
    return {
      overflow: Math.round(inner.bottom - page.bottom),
      footOnPage: foot.bottom <= page.bottom + 1,
      signOnPage: sign.bottom <= page.bottom + 1,
      wide: Math.round(inner.right - page.right)
    };
  });
  check('the content ends above the bottom edge', fit.overflow <= 1, true);
  check('the signature is on the page', fit.signOnPage, true);
  check('so is the footer', fit.footOnPage, true);
  check('and it does not run off the side', fit.wide <= 1, true);

  console.log('\na short range prints the whole list, uncut');
  const short = await pg.evaluate(() => {
    const list = sortedEntries();
    document.getElementById('rangeFrom').value = list[list.length - 4].id;
    document.getElementById('rangeTo').value = list[list.length - 1].id;
    renderRangeTotals();
    const real = window.printPortraitSinglePage;
    let out = null;
    window.printPortraitSinglePage = (h) => { out = real(h); return out; };
    try { printRangeTotalsSheet(); } finally { window.printPortraitSinglePage = real; }
    const d = document.createElement('div');
    d.innerHTML = out;
    return {
      note: d.querySelector('.pr-note')?.textContent.trim() || null,
      listRows: d.querySelectorAll('.pr-table tr').length,
      reports: d.querySelector('.pr-kpi-val')?.textContent.trim()
    };
  });
  await pg.waitForTimeout(300);
  check('three periods between four reports', short.reports, '3');
  check('header, three reports and the total', short.listRows, 5);
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
