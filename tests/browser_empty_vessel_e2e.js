/*
 * The two ways an engineer gets a ship, driven in a real browser.
 *
 *   node tests/browser_empty_vessel_e2e.js
 *
 * The office either assigns an existing vessel, or creates the account with none
 * and the engineer enters the ship he joined. This walks the empty case end to
 * end and checks the other half of the rule: an engineer already on a registered
 * ship still cannot rename it.
 *
 * Creates its own account each run, so it is repeatable against a live server.
 * Not in CI, which has no browser.
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8863';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e;
  console.log(`  ${ok?'ok  ':'FAIL'} ${l}${ok?'':`: expected ${e}, got ${a}`}`); if (!ok) f++; };

const signIn = async (pg, user, pass) => {
  await pg.evaluate(([u, p]) => {
    document.getElementById('login_serverUrl').value = location.origin;
    document.getElementById('login_username').value = u;
    document.getElementById('login_password').value = p;
  }, [user, pass]);
  await pg.evaluate(() => handleLoginSubmit());
  await pg.waitForTimeout(3000);
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);

  console.log('\nan engineer with no ship yet');
  /* Make a fresh unassigned account each run, so the test does not depend on
     server state left by a previous run. */
  const tag = Date.now().toString(36).slice(-6);
  const user = `joiner${tag}`;
  const imo = '98' + String(Date.now() % 100000).padStart(5, '0');
  const made = await pg.evaluate(async ([u, base]) => {
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fleetmanager', password: 'demo-secret' })
    }).then(r => r.json());
    const res = await fetch(base + '/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': login.sessionToken },
      body: JSON.stringify({ username: u, password: 'no-ship-yet', role: 'chief_engineer' })
    }).then(r => r.json());
    return res;
  }, [user, BASE]);
  check('the office created him with no ship', made.vessel, null);
  await signIn(pg, user, 'no-ship-yet');
  const empty = await pg.evaluate(() => {
    switchTab('setup');
    return {
      user: state.session?.username,
      vessel: state.session?.vessel,
      nameLocked: document.getElementById('s_vesselName').readOnly,
      imoLocked: document.getElementById('s_imoNo').readOnly,
      registerShown: !document.getElementById('registerVesselRow').hidden,
      note: document.getElementById('vesselIdentityNote').textContent
    };
  });
  check('he is signed in', empty.user, user);
  check('with no vessel', empty.vessel, null);
  check('the name field is open for him to enter', empty.nameLocked, false);
  check('so is the IMO', empty.imoLocked, false);
  check('and Register Vessel is offered', empty.registerShown, true);
  check('the note tells him what to do', /Enter this ship/i.test(empty.note), true);

  console.log('\nhe enters the ship he joined and registers it');
  await pg.evaluate((im) => {
    document.getElementById('s_vesselName').value = 'M/V JOINED AT PORT ' + im;
    document.getElementById('s_imoNo').value = 'IMO ' + im;
    document.getElementById('s_company').value = 'Pacific Ocean Shipping';
  }, imo);
  pg.on('dialog', d => d.accept());
  await pg.evaluate(() => registerAssignedVessel());
  await pg.waitForTimeout(2500);
  const after = await pg.evaluate(() => ({
    vessel: state.session?.vessel?.vesselId,
    name: state.session?.vessel?.vesselName,
    pending: state.session?.vessel?.pendingReview,
    sync: state.setup?.sync?.vesselId
  }));
  check('the ship is registered', after.vessel, 'm-v-joined-at-port-' + imo);
  check('under the name he gave', after.name, 'M/V JOINED AT PORT ' + imo);
  check('flagged for the office to review', after.pending, true);
  check('and sync points at it', after.sync, 'm-v-joined-at-port-' + imo);

  console.log('\nan engineer on an established ship cannot rename it');
  await pg.evaluate(() => { state.session = null; localStorage.removeItem(SESSION_LS_KEY); });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);
  await signIn(pg, 'hberg', 'demo-secret');
  const est = await pg.evaluate(() => {
    switchTab('setup');
    return {
      vessel: state.session?.vessel?.vesselId,
      nameLocked: document.getElementById('s_vesselName').readOnly,
      imoLocked: document.getElementById('s_imoNo').readOnly,
      companyLocked: document.getElementById('s_company').readOnly,
      registerShown: !document.getElementById('registerVesselRow').hidden
    };
  });
  check('he is on his ship', est.vessel, 'mv-roadstead');
  check('the name is locked', est.nameLocked, true);
  check('the IMO is locked', est.imoLocked, true);
  check('the company is locked', est.companyLocked, true);
  check('and Register Vessel is not offered', est.registerShown, false);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
