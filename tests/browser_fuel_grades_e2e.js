/*
 * Fuel consumption on the printed sheet, totalled per grade, driven in a real
 * browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_fuel_grades_e2e.js
 *
 * The main engine, the generators and the boiler can each be on a different
 * grade, so one figure added across them totals tonnes the ship never bunkered.
 * Sets up a mixed-grade period and checks the printed table books every unit
 * against its own grade, totals each column on its own, and reconciles with the
 * Consumption column of the R.O.B. table further down the same sheet. MDO/MGO and
 * LSMGO are one distillate product and share a column, so the diesel total is
 * those two R.O.B. rows added. Not in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = a === e || (typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) < 1e-6);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  const out = await pg.evaluate(() => {
    /* M/E on residual, generators and boiler on distillate, plus a little misc on
       a third grade — the arrangement the single total used to flatten. */
    const list = sortedEntries();
    const e = list[list.length - 1];
    const prev = list[list.length - 2];
    e.operation = 'AT SEA - NOON';
    e.rpm = 80;
    e.revCounter = (prev.revCounter || 0) + 115200;
    e.me.meter = (prev.me.meter || 0) + 42000;
    e.me.type = 'LSFO';
    e.ge.type = 'LSMGO';
    e.blr.type = 'LSMGO';
    e.miscCons = { 'MDO/MGO': 0.12, 'LSMGO': 0 };

    const row = getComputedRow(e.id);
    const d = document.createElement('div');
    d.innerHTML = buildVoyageNoonSheetHTML(e);

    const section = [...d.querySelectorAll('.pr-section')]
      .find(s => /Fuel Consumption/.test(s.querySelector('.pr-section-title').textContent));
    const cells = tr => [...tr.querySelectorAll('th,td')].map(x => x.textContent.trim());
    const rows = [...section.querySelectorAll('tr')].map(cells);

    /* Consumption column of the R.O.B. table, keyed by fuel row label. */
    const rob = {};
    d.querySelectorAll('.pr-noon-full table.pr-table tr').forEach(tr => {
      const r = cells(tr);
      if (['HFO', 'LSFO', 'MDO/MGO', 'LSMGO'].includes(r[0])) rob[r[0]] = r[2];
    });

    return {
      header: rows[0],
      body: rows.slice(1, -1),
      totalRow: rows[rows.length - 1],
      totalIsRuled: !!section.querySelector('tr.pr-total'),
      rob,
      byType: row.consByType,
      units: { me: row.meCons, ge: row.geCons, blr: row.blrCons },
      lumped: row.total
    };
  });

  console.log('\ncolumns are the fuels actually burned');
  check('residual and distillate, nothing else', out.header.length, 3);
  check('unit column first', out.header[0], 'Unit');
  check('residual column', out.header[1], 'LSFO');
  /* MDO/MGO and LSMGO are the same product — one column, not two. */
  check('one distillate column', out.header[2], 'DIESEL');
  check('the grades are not split out', out.header.includes('LSMGO') || out.header.includes('MDO/MGO'), false);
  check('unburned HFO gets no column', out.header.includes('HFO'), false);

  console.log('\neach unit books against its own fuel only');
  const byLabel = Object.fromEntries(out.body.map(r => [r[0], r.slice(1)]));
  check('main engine on LSFO alone', byLabel['Main Engine'].join(','), '41.160,—');
  check('generators on diesel alone', byLabel['Diesel Generator'].join(','), '—,1.392');
  check('boiler on diesel alone', byLabel['Boiler'].join(','), '—,0.304');
  check('misc burn on its own row', byLabel['Other'].join(','), '—,0.120');

  console.log('\neach column totals on its own');
  check('total row is labelled', out.totalRow[0], 'Total');
  check('LSFO total', out.totalRow[1], '41.160');
  /* 0.120 MDO/MGO + 1.696 LSMGO, the two distillate tanks together. */
  check('diesel total is both distillates', out.totalRow[2], '1.816');
  check('and is ruled off from the readings', out.totalIsRuled, true);

  /* The point of the whole block: a reader adding the column by hand lands on the
     printed total, rather than a kilo off it through a rounding step. */
  out.header.slice(1).forEach((col, i) => {
    const shown = out.body
      .map(r => r[i + 1])
      .filter(v => v !== '\u2014')
      .reduce((sum, v) => sum + Number(v), 0);
    check(`${col} column adds up by eye`, shown.toFixed(3), out.totalRow[i + 1]);
  });

  /* The old behaviour: one number adding residual to distillate. */
  check('no column carries the old cross-grade sum',
    out.totalRow.slice(1).includes(out.lumped.toFixed(3)), false);

  console.log('\nit reconciles with the R.O.B. table on the same sheet');
  check('LSFO matches R.O.B. consumption', out.totalRow[1], out.rob['LSFO']);
  check('diesel is the two distillate R.O.B. rows added',
    out.totalRow[2], (Number(out.rob['MDO/MGO']) + Number(out.rob['LSMGO'])).toFixed(3));
  check('R.O.B. still reports the tanks apart',
    !!out.rob['MDO/MGO'] && !!out.rob['LSMGO'], true);

  console.log('\npage errors');
  check('none', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
