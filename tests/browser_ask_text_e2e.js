/*
 * The program's own text prompt, measured in a browser.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_ask_text_e2e.js
 *
 * What only the browser can settle:
 *  - That the dialog PAINTS. The first attempt at this fix placed the overlay
 *    inside a page div that is display:none unless that page is open, so it
 *    opened at 0x0: the class said open, the rect said nothing was there, and
 *    a check that read classList alone passed. Nothing short of a measured
 *    bounding box catches that.
 *  - That the input takes focus, so a year can be typed without reaching for
 *    the mouse -- the reason the dialog exists is a one-field question.
 *  - That Enter accepts and Escape cancels, which is what anyone who used the
 *    native prompt will try first.
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
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  /* A native dialog reaching the browser would mean a call site still uses
     prompt(); record them rather than letting one hang the run. */
  const native = [];
  pg.on('dialog', async (d) => { native.push(d.type()); await d.dismiss(); });

  await pg.goto(`${BASE}/voyage_manager.html?chengaio=1`);
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => document.querySelector('[data-page="data"]').click());
  await pg.waitForTimeout(1200);

  console.log('\nthe DCS button opens the program\'s own dialog');
  await pg.click('#btnExportDcs');
  await pg.waitForTimeout(600);
  const open = await pg.evaluate(() => {
    const o = document.getElementById('askTextOverlay');
    const r = o.getBoundingClientRect();
    const i = document.getElementById('askTextInput');
    return {
      painted: r.width > 0 && r.height > 0,
      coversViewport: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1,
      title: document.getElementById('askTextTitle').textContent,
      label: document.getElementById('askTextLabel').textContent,
      type: i.type,
      value: i.value,
      focused: document.activeElement === i,
    };
  });
  check('the dialog is actually painted, not merely flagged open', open.painted, true);
  check('and it covers the viewport rather than opening inside a hidden page',
    open.coversViewport, true);
  check('it names what it is asking for', open.title, 'Compile IMO DCS / EU MRV year');
  check('the field is labelled', open.label, 'Calendar year');
  check('a year gets a numeric field', open.type, 'number');
  check('prefilled with the year a verifier asks about',
    open.value, String(new Date().getUTCFullYear() - 1));
  check('the field has focus, so the year can just be typed', open.focused, true);
  check('no native prompt was reached', native, []);

  console.log('\nEscape cancels, the way the native prompt did');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);
  check('the overlay is hidden again',
    await pg.evaluate(() => document.getElementById('askTextOverlay').hidden), true);

  console.log('\nEnter accepts');
  const typed = await pg.evaluate(async () => {
    const p = askText({ title: 'T', label: 'L', value: '' });
    const i = document.getElementById('askTextInput');
    i.value = '2024';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return await p;
  });
  check('it resolves with what was typed', typed, '2024');

  console.log('\nCancel resolves null, so a call site can tell it apart from ""');
  const cancelled = await pg.evaluate(async () => {
    const p = askText({ title: 'T' });
    document.getElementById('askTextCancel').click();
    return await p;
  });
  check('cancel gives null', cancelled, null);

  check('no uncaught page errors', pageErrors, []);
  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
