/*
 * The M/E and G/E flowmeter readings on a new log entry, driven in a real browser.
 *
 *   APP_BASE=http://127.0.0.1:8867 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_meter_prefill_e2e.js
 *
 * Guards a fault reported from a ship: opening a new entry showed no previous
 * reading for the main engine or the generator, while the boiler, cylinder-oil
 * and rev-counter fields showed theirs. Those two live in containers that
 * renderFuelMeterFields() rebuilt from scratch, and render() runs on every save,
 * sync and edit — so the value prefilled from the last watch was wiped moments
 * after it was put there. The engineer then had to look the reading up by hand,
 * and a mistyped cumulative counter corrupts the consumption for that watch and
 * every watch after it.
 *
 * Not in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = String(a) === String(e);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${e}, got ${a}`}`); if (!ok) f++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { await d.accept(); });
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  console.log('single flowmeter arrangement');
  const single = await pg.evaluate(() => {
    state.setup.flowArr = 'SINGLE';
    renderFuelMeterFields();
    switchTab('entry');
    prefillFromLastEntry();
    const v = id => document.getElementById(id)?.value;
    const before = { me: v('me_meter'), ge: v('ge_meter'), blr: v('blr_meter') };
    /* Every save, sync and edit ends in a render(); the reading must survive them. */
    render(); render();
    const last = sortedEntries().slice(-1)[0];
    return {
      before, after: { me: v('me_meter'), ge: v('ge_meter'), blr: v('blr_meter') },
      last: { me: last.me.meter, ge: last.ge.meter, blr: last.blr.meter }
    };
  });
  check('M/E prefills from the last watch', single.before.me, single.last.me);
  check('G/E prefills from the last watch', single.before.ge, single.last.ge);
  check('M/E survives render()', single.after.me, single.last.me);
  check('G/E survives render()', single.after.ge, single.last.ge);
  // The boiler field is static markup and always worked — it is the control.
  check('boiler still shows its reading', single.after.blr, single.last.blr);

  console.log('\noperation carries over too');
  /* A sea passage is a run of the same operation, so opening on the list's default
     meant re-picking it on every single watch. */
  const op = await pg.evaluate(() => {
    switchTab('entry');
    prefillFromLastEntry();
    return { field: document.getElementById('in_operation').value,
             last: sortedEntries().slice(-1)[0].operation };
  });
  check('the new entry opens on the last operation', op.field, op.last);

  const retired = await pg.evaluate(() => {
    /* An operation no longer offered must not blank the field — a logbook keeps
       what was written. */
    const last = sortedEntries().slice(-1)[0];
    const was = last.operation;
    last.operation = 'HEAVY WEATHER';
    prefillFromLastEntry();
    const v = document.getElementById('in_operation').value;
    last.operation = was;
    prefillFromLastEntry();
    return v;
  });
  check('a retired operation survives the prefill', retired, 'HEAVY WEATHER');

  console.log('\ntyped-but-unsaved readings');
  const typed = await pg.evaluate(() => {
    document.getElementById('me_meter').value = '123456';
    document.getElementById('ge_meter').value = '654321';
    render(); render(); render();
    return { me: document.getElementById('me_meter')?.value, ge: document.getElementById('ge_meter')?.value };
  });
  check('a typed M/E reading is not wiped', typed.me, '123456');
  check('a typed G/E reading is not wiped', typed.ge, '654321');

  console.log('\nchanging the arrangement still relays the fields');
  const layouts = await pg.evaluate(() => {
    const ids = id => [...(document.getElementById(id)?.querySelectorAll('input') || [])].map(i => i.id).join(',');
    const out = {};
    ['SINGLE', 'DUAL_ME', 'DUAL_GE', 'DUAL_BOTH'].forEach(arr => {
      state.setup.flowArr = arr;
      renderFuelMeterFields();
      out[arr] = { me: ids('meMeterFields'), ge: ids('geMeterFields') };
    });
    return out;
  });
  check('SINGLE M/E field',     layouts.SINGLE.me,    'me_meter');
  check('SINGLE G/E field',     layouts.SINGLE.ge,    'ge_meter');
  check('DUAL_ME M/E fields',   layouts.DUAL_ME.me,   'me_meter_in,me_meter_out');
  check('DUAL_ME G/E unchanged', layouts.DUAL_ME.ge,  'ge_meter');
  check('DUAL_GE G/E fields',   layouts.DUAL_GE.ge,   'ge_meter_in,ge_meter_out');
  check('DUAL_GE M/E unchanged', layouts.DUAL_GE.me,  'me_meter');
  check('DUAL_BOTH M/E fields', layouts.DUAL_BOTH.me, 'me_meter_in,me_meter_out');
  check('DUAL_BOTH G/E fields', layouts.DUAL_BOTH.ge, 'ge_meter_in,ge_meter_out');

  console.log('\ndual arrangement carries inlet and outlet forward');
  const dual = await pg.evaluate(() => {
    state.setup.flowArr = 'DUAL_BOTH';
    const last = sortedEntries().slice(-1)[0];
    last.me = { meterIn: 1450000, meterOut: 470000, type: 'HFO', sg: 0.98 };
    last.ge = { meterIn: 612000, meterOut: 193250, type: 'MDO/MGO', sg: 0.87 };
    renderFuelMeterFields();
    prefillFromLastEntry();
    render();
    const v = id => document.getElementById(id)?.value;
    return { meIn: v('me_meter_in'), meOut: v('me_meter_out'), geIn: v('ge_meter_in'), geOut: v('ge_meter_out') };
  });
  check('M/E inlet',  dual.meIn,  1450000);
  check('M/E outlet', dual.meOut, 470000);
  check('G/E inlet',  dual.geIn,  612000);
  check('G/E outlet', dual.geOut, 193250);

  console.log('\nsaving a watch, then opening the next one');
  const e2e = await pg.evaluate(async () => {
    state.setup.flowArr = 'SINGLE';
    renderFuelMeterFields();
    switchTab('entry');
    const before = sortedEntries().slice(-1)[0];
    document.getElementById('in_datetime').value = '2026-07-06T12:00';
    document.getElementById('me_meter').value = String((before.me.meter || 0) + 17000);
    document.getElementById('ge_meter').value = String((before.ge.meter || 0) + 2400);
    document.getElementById('btnAdd').click();
    await new Promise(r => setTimeout(r, 1200));
    const last = sortedEntries().slice(-1)[0];
    return {
      saved: { me: last.me.meter, ge: last.ge.meter },
      form: { me: document.getElementById('me_meter')?.value, ge: document.getElementById('ge_meter')?.value }
    };
  });
  check('next entry opens on the M/E reading just saved', e2e.form.me, e2e.saved.me);
  check('next entry opens on the G/E reading just saved', e2e.form.ge, e2e.saved.ge);

  check('no page errors', errs.length, 0);
  if (errs.length) console.log('   ', errs.slice(0, 3));
  await b.close();
  console.log('');
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
