/*
 * The online-first rule, driven in a real browser.
 *
 *   node tests/browser_offline_login_e2e.js
 *
 * The fleet manager creates the account; the engineer must sign in ONLINE once
 * to enroll this laptop, and only then does that device unlock at sea. This
 * walks all three states: never signed in (refused), the first online sign-in
 * (enrolls the device), and afterwards with the network blocked (unlocks
 * without a password). A reachable server's 401 still stands.
 *
 * Not in CI, which has no browser.
 *
 * Env: APP_BASE, PW_CHROMIUM.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8863';
let f = 0, c = 0;
const check = (l, a, e) => { c++; const ok = a === e;
  console.log(`  ${ok?'ok  ':'FAIL'} ${l}${ok?'':`: expected ${e}, got ${a}`}`); if (!ok) f++; };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);

  console.log('\na device that has never signed in');
  check('there is no way to install credentials by hand',
    await pg.evaluate(() => !!document.getElementById('btnLoadOfflineCreds')), false);
  check('it holds nothing', await pg.evaluate(() => readDeviceEnrollment()), null);
  check('and it says the first sign-in needs the server',
    await pg.evaluate(() => /first sign-in needs the server/i.test(document.getElementById('offlineCredsStatus')?.textContent || '')), true);

  await pg.route('**/api/**', r => r.abort('failed'));
  const cold = await pg.evaluate(async () => {
    try { await unlockEnrolledDevice(); return 'ACCEPTED'; }
    catch (e) { return e.message; }
  });
  check('offline unlock is refused outright', /never signed in/i.test(cold), true);

  console.log('\nthe first sign-in, online');
  await pg.unroute('**/api/**');
  await pg.evaluate(() => {
    document.getElementById('login_serverUrl').value = location.origin;
    document.getElementById('login_username').value = 'hberg';
    document.getElementById('login_password').value = 'demo-secret';
  });
  await pg.evaluate(() => handleLoginSubmit());
  await pg.waitForTimeout(3000);
  const on = await pg.evaluate(() => ({
    hidden: document.getElementById('loginGate')?.hidden,
    user: state.session?.username,
    vessel: state.setup?.sync?.vesselId,
    enrolled: !!readDeviceEnrollment(),
    enrolledAs: readDeviceEnrollment()?.username
  }));
  check('the engineer is signed in', on.user, 'hberg');
  check('the gate closed', on.hidden, true);
  check('his ship was fetched', on.vessel, 'mv-roadstead');
  check('and the device enrolled', on.enrolled, true);
  check('as him', on.enrolledAs, 'hberg');

  console.log('\nafter that, at sea');
  await pg.evaluate(() => { state.session = null; localStorage.removeItem(SESSION_LS_KEY); });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1500);
  await pg.route('**/api/**', r => r.abort('failed'));
  const unlockBtn = await pg.evaluate(() => !document.getElementById('btnUnlockDevice')?.hidden);
  check('Continue on this device is offered', unlockBtn, true);
  await pg.evaluate(() => handleUnlockDevice());
  await pg.waitForTimeout(1500);
  const off = await pg.evaluate(() => ({
    hidden: document.getElementById('loginGate')?.hidden,
    user: state.session?.username,
    vessel: state.setup?.sync?.vesselId,
    offline: !!state.session?.offline
  }));
  check('he unlocks with no server', off.user, 'hberg');
  check('the gate closed', off.hidden, true);
  check('still on his ship', off.vessel, 'mv-roadstead');
  check('marked as an offline session', off.offline, true);

  console.log('\na reachable server\'s refusal stands');
  await pg.unroute('**/api/**');
  await pg.route('**/api/auth/device-login', r => r.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'unauthorized', reason: 'device_revoked', message: 'revoked' })
  }));
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2000);
  const after401 = await pg.evaluate(() => ({
    enroll: readDeviceEnrollment(),
    gate: !document.getElementById('loginGate')?.hidden,
    status: document.getElementById('loginStatus')?.textContent || ''
  }));
  check('a 401 clears the enrollment', after401.enroll, null);
  check('and the gate is up', after401.gate, true);

  console.log('\npage errors');
  check('no uncaught page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 4));

  await b.close();
  console.log(f ? `\nFAILED — ${f} of ${c} checks` : `\nPASSED — ${c} checks`);
  process.exit(f ? 1 : 0);
})();
