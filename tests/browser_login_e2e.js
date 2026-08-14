/*
 * Browser end-to-end check of the login gate, run against a live sync server
 * seeded with sync-server/seed_demo_fleet.py.
 *
 *   node tests/browser_login_e2e.js
 *
 * Needs playwright-core and a Chromium binary; skipped in CI, which has no
 * browser. Kept in the repo because the defects it caught — CSS landing in a
 * print template, a gold label on a gold button — are invisible to unit tests.
 *
 * Env: APP_BASE (server URL), PW_CHROMIUM (browser path).
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE;
let fails = 0, n = 0;
const check = (label, actual, expected) => {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`${BASE}/voyage_manager.html`);
  /* The gate itself is the signal: either it has been raised, or the boot path
     decided a session already exists. #dbStatus is no good — the markup ships
     with "local database ready" already in it. */
  const ready = () => page.waitForFunction(
    () => !document.getElementById('loginGate').hidden
       || (typeof state !== 'undefined' && 'session' in state),
    null, { timeout: 60000 });
  await ready();

  console.log('\nlogin gate on first boot');
  check('gate is shown', await page.isVisible('#loginGate'), true);
  check('sign-in step is shown', await page.isVisible('#loginStepSignIn'), true);

  console.log('\nwrong password');
  await page.fill('#login_serverUrl', BASE);
  await page.fill('#login_username', 'hberg');
  await page.fill('#login_password', 'wrong-password');
  await page.click('#btnLoginSubmit');
  await page.waitForTimeout(1500);
  check('gate stays up', await page.isVisible('#loginGate'), true);
  const errText = await page.textContent('#loginStatus');
  check('the error names the credentials', /incorrect/i.test(errText), true);

  console.log('\nvessel account sign-in');
  await page.fill('#login_password', 'demo-secret');
  await page.click('#btnLoginSubmit');
  await page.waitForSelector('#loginGate', { state: 'hidden', timeout: 15000 });
  check('gate closes', await page.isVisible('#loginGate'), false);

  const assigned = await page.evaluate(() => ({
    vesselName: state.setup.vesselName,
    company: state.setup.company,
    syncVessel: state.setup.sync && state.setup.sync.vesselId,
    hasToken: !!(state.setup.sync && state.setup.sync.apiToken),
    sessionVessel: state.session && state.session.vessel && state.session.vessel.vesselId,
    role: state.session && state.session.role,
  }));
  check('the assigned vessel is loaded', assigned.vesselName, 'M/V ROADSTEAD');
  check('company came from the database', assigned.company, 'Pacific Ocean Shipping');
  check('sync is pointed at that vessel', assigned.syncVessel, 'mv-roadstead');
  check('the vessel token was adopted', assigned.hasToken, true);
  check('role is chief engineer', assigned.role, 'chief_engineer');

  console.log('\nsingle vessel: the switcher is locked');
  await page.evaluate(() => switchTab('setup'));
  check('vessel selector disabled', await page.isDisabled('#s_vesselSelect'), true);
  check('Add New Vessel disabled', await page.isDisabled('#btnAddVessel'), true);
  check('Test Fleet disabled', await page.isDisabled('#btnInstallTestFleet'), true);
  const note = await page.textContent('#vesselLockNote');
  check('the lock is explained', /assigned to/i.test(note), true);
  const bar = await page.textContent('#assignedVesselLabel');
  check('the account bar names the ship', /ROADSTEAD/.test(bar) && /hberg/.test(bar), true);

  console.log('\nthe session survives a reload (offline-first)');
  await page.reload();
  await ready();
  check('no gate on second boot', await page.isVisible('#loginGate'), false);
  const after = await page.evaluate(() => ({
    v: state.setup.vesselName, s: state.setup.sync && state.setup.sync.vesselId,
  }));
  check('still the same vessel', after.s, 'mv-roadstead');

  console.log('\nsync actually works with the login-issued token');
  const pushed = await page.evaluate(async () => {
    const base = syncApiBase();
    const res = await fetch(`${base}/api/voyage/mv-roadstead/44/B`, {
      method: 'PUT', headers: syncRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ entries: [{ id: 'e-e2e', updatedAt: '2026-02-02T00:00:00Z' }] })
    });
    return res.status;
  });
  check('push to its own vessel succeeds', pushed, 200);
  const denied = await page.evaluate(async () => {
    const base = syncApiBase();
    const res = await fetch(`${base}/api/voyage/mv-circumnav`, { headers: syncRequestHeaders() });
    return res.status;
  });
  check('the other vessel is refused', denied, 403);

  console.log('\nsign out returns to the gate');
  await page.evaluate(() => switchTab('setup'));
  await page.click('#btnSignOut');
  await page.waitForTimeout(1200);
  check('gate is back', await page.isVisible('#loginGate'), true);

  console.log('\nadmin picks one vessel from the fleet');
  await page.fill('#login_serverUrl', BASE);
  await page.fill('#login_username', 'fleetmanager');
  await page.fill('#login_password', 'demo-secret');
  await page.click('#btnLoginSubmit');
  await page.waitForSelector('#loginStepAssign:not([hidden])', { timeout: 15000 });
  check('admin is asked to choose', await page.isVisible('#loginVesselPick'), true);
  const options = await page.$$eval('#login_vesselSelect option', els => els.map(e => e.value));
  check('all four sample vessels are offered', options.length, 4);
  await page.selectOption('#login_vesselSelect', 'mv-pacific-trader');
  await page.click('#btnLoginLoadVessel');
  await page.waitForSelector('#loginGate', { state: 'hidden', timeout: 15000 });
  const adminState = await page.evaluate(() => ({
    s: state.setup.sync && state.setup.sync.vesselId, role: state.session.role,
    switcherLocked: document.getElementById('s_vesselSelect').disabled,
  }));
  check('the manager loaded the chosen vessel', adminState.s, 'mv-pacific-trader');
  check('admin is not locked to one ship', adminState.switcherLocked, false);

  console.log('\nblank program: no vessel assignment');
  await page.evaluate(() => switchTab('setup'));
  await page.click('#btnSignOut');
  await page.waitForTimeout(1000);
  await page.click('#btnLoginOffline');
  await page.waitForTimeout(1500);
  check('gate closes with no vessel', await page.isVisible('#loginGate'), false);
  const blank = await page.evaluate(() => state.session);
  check('no session, no assignment', blank, null);
  const blankBar = await page.textContent('#assignedVesselLabel');
  check('the bar says so', /no vessel assigned/i.test(blankBar), true);

  console.log('\nadd a vessel later with a token');
  await page.click('#btnOpenLogin');
  await page.waitForTimeout(500);
  await page.fill('#login_serverUrl', BASE);
  await page.fill('#login_username', 'pnair');
  await page.fill('#login_password', 'demo-secret');
  await page.click('#btnLoginSubmit');
  await page.waitForSelector('#loginGate', { state: 'hidden', timeout: 15000 });
  check('signing in later assigns the ship', await page.evaluate(() => state.setup.sync.vesselId), 'mv-circumnav');
  console.log('\nvessel identity is the fleet manager\'s to change');
  await page.evaluate(() => switchTab('setup'));
  check('name is read-only for an engineer', await page.getAttribute('#s_vesselName', 'readonly') !== null, true);
  check('IMO is read-only for an engineer', await page.getAttribute('#s_imoNo', 'readonly') !== null, true);
  check('company is read-only for an engineer', await page.getAttribute('#s_company', 'readonly') !== null, true);

  console.log('\npage errors');
  const real = errors.filter(e => !/favicon|manifest|Failed to load resource/i.test(e));
  check('no uncaught page errors', real, []);

  await browser.close();
  console.log();
  if (fails) { console.log(`FAILED — ${fails} of ${n} checks`); process.exit(1); }
  console.log(`PASSED — ${n} checks`);
})();
