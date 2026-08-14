/*
 * Offline sign-in, driven in a real browser.
 *
 *   node tests/browser_offline_login_e2e.js
 *
 * Needs playwright-core, a Chromium binary, and a server serving the app with
 * a bundle exported to ./bundle.json. Not in CI, which has no browser. The
 * cross-language digest itself is covered headlessly by test_offline_verifier.js.
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8862';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e;
  console.log(`  ${ok?'ok  ':'FAIL'} ${l}${ok?'':`: expected ${e}, got ${a}`}`); if (!ok) f++; };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);

  const bundle = JSON.parse(fs.readFileSync('bundle.json', 'utf8'));

  console.log('\nthe bundle installs on the device');
  const installed = await pg.evaluate((bn) => {
    writeOfflineBundle(bn);
    const back = readOfflineBundle();
    return { vessel: back.vessel.vesselName, logins: back.logins.length };
  }, bundle);
  check('it is stored', installed.vessel, 'M/V ROADSTEAD');
  check('with its login', installed.logins, 1);

  console.log('\na bad bundle is refused');
  const bad = await pg.evaluate(() => {
    try { writeOfflineBundle({ hello: 'world' }); return 'accepted'; }
    catch (e) { return e.message; }
  });
  check('junk is rejected', /not a vessel credentials bundle/.test(bad), true);

  console.log('\noffline sign-in, with the server unreachable');
  // Simulate a vessel that has never reached the server: block all network.
  await pg.route('**/api/**', route => route.abort('failed'));

  const ok = await pg.evaluate(async () => {
    try {
      const s = await offlineLogin('hberg', 'demo-secret');
      return { ok: true, user: s.username, role: s.role, vessel: s.vessel.vesselId, offline: !!s.offline, token: s.vessel.token ? 'present' : 'missing' };
    } catch (e) { return { ok: false, msg: e.message }; }
  });
  check('the right password signs in', ok.ok, true);
  check('as the right user', ok.user, 'hberg');
  check('with the right role', ok.role, 'chief_engineer');
  check('assigned to the right ship', ok.vessel, 'mv-roadstead');
  check('flagged as an offline session', ok.offline, true);
  check('and it carries the sync token for later', ok.token, 'present');

  const bad2 = await pg.evaluate(async () => {
    try { await offlineLogin('hberg', 'wrong-password'); return 'accepted'; }
    catch (e) { return e.message; }
  });
  check('a wrong password is refused', /incorrect/i.test(bad2), true);

  const unknown = await pg.evaluate(async () => {
    try { await offlineLogin('nobody', 'demo-secret'); return 'accepted'; }
    catch (e) { return e.message; }
  });
  check('an unknown user is refused', /incorrect/i.test(unknown), true);
  check('and is not distinguishable from a wrong password', unknown, bad2);

  console.log('\nan expired bundle stops working');
  const expired = await pg.evaluate(async (bn) => {
    const old = JSON.parse(JSON.stringify(bn));
    old.expiresAt = '2020-01-01T00:00:00+00:00';
    writeOfflineBundle(old);
    try { await offlineLogin('hberg', 'demo-secret'); return 'accepted'; }
    catch (e) { return e.message; }
  }, bundle);
  check('expiry is enforced', /expired/i.test(expired), true);

  console.log('\nthe gate falls back only when the server is unreachable');
  await pg.evaluate((bn) => writeOfflineBundle(bn), bundle);
  await pg.evaluate(() => {
    document.getElementById('login_serverUrl').value = location.origin;
    document.getElementById('login_username').value = 'hberg';
    document.getElementById('login_password').value = 'demo-secret';
  });
  await pg.evaluate(() => handleLoginSubmit());
  await pg.waitForTimeout(2500);
  const gate = await pg.evaluate(() => ({
    hidden: document.getElementById('loginGate')?.hidden,
    user: state.session?.username,
    vessel: state.setup?.sync?.vesselId,
    offline: !!state.session?.offline
  }));
  check('the gate closed', gate.hidden, true);
  check('signed in offline through the real gate', gate.user, 'hberg');
  check('and the ship was assigned', gate.vessel, 'mv-roadstead');
  check('marked offline', gate.offline, true);

  console.log('\na server that answers "no" is not overridden by the bundle');
  // The dangerous case: a login revoked at the office must not be resurrected by
  // pulling the network cable. The server is reachable and says 401.
  await pg.unroute('**/api/**');
  await pg.evaluate(() => { state.session = null; localStorage.removeItem('nr_session'); });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);
  await pg.evaluate((bn) => writeOfflineBundle(bn), bundle);
  await pg.evaluate(() => {
    document.getElementById('login_serverUrl').value = location.origin;
    document.getElementById('login_username').value = 'hberg';
    document.getElementById('login_password').value = 'not-the-password';
  });
  await pg.evaluate(() => handleLoginSubmit());
  await pg.waitForTimeout(2500);
  const refused = await pg.evaluate(() => ({
    hidden: document.getElementById('loginGate')?.hidden,
    user: state.session?.username || null,
    status: document.getElementById('loginStatus')?.textContent || ''
  }));
  check('the gate stayed shut', refused.hidden, false);
  check('no session was granted', refused.user, null);
  check('the server answer is what the user sees', /incorrect/i.test(refused.status), true);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
