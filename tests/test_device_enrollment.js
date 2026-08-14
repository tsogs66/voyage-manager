#!/usr/bin/env node
/*
 * Device enrollment helpers extracted from voyage_manager.html.
 *
 * Offline unlock proves this laptop, not the password. These checks pin the
 * id/secret shape the server will accept, and that a device that has never
 * signed in is refused outright — the property a later refactor is most likely
 * to lose by putting an importer back on the login gate.
 *
 * Run: node tests/test_device_enrollment.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');
const ACCOUNTS = fs.readFileSync(path.join(__dirname, '..', 'sync-server', 'accounts.py'), 'utf8');

let failures = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

function extract(name) {
  let start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in voyage_manager.html`);
  const prefix = 'async ';
  if (HTML.slice(start - prefix.length, start) === prefix) start -= prefix.length;
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

const store = {};
const sandbox = {
  crypto: globalThis.crypto,
  Uint8Array,
  Array,
  navigator: { userAgent: 'Linux' },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  console,
  String,
  Error,
  Object,
  JSON,
  Date,
  state: {},
  document: { getElementById: () => null }
};
vm.createContext(sandbox);
vm.runInContext(
  [
    'const DEVICE_ENROLL_KEY = "nr_device_enrollment";',
    'const SESSION_LS_KEY = "noonReportSession";',
    extract('writeStoredSession'),
    extract('readDeviceEnrollment'),
    extract('writeDeviceEnrollment'),
    extract('newDeviceSecret'),
    extract('newDeviceId'),
    extract('deviceLabel'),
    extract('sessionFromEnrollment'),
    extract('unlockEnrolledDevice')
  ].join('\n'),
  sandbox
);

(async () => {
  console.log('\na device that has never signed in');
  check('holds nothing', sandbox.readDeviceEnrollment(), null);
  let refused = '';
  try { await sandbox.unlockEnrolledDevice(); refused = 'ACCEPTED'; }
  catch (e) { refused = e.message; }
  check('unlock is refused outright', /never signed in/i.test(refused), true);

  console.log('\nthe id and secret the server will accept');
  const id = sandbox.newDeviceId();
  const secret = sandbox.newDeviceSecret();
  const idRe = /DEVICE_ID_RE = re\.compile\(r"([^"]+)"\)/.exec(ACCOUNTS);
  check('the server publishes a device-id pattern', Boolean(idRe), true);
  if (idRe) {
    const re = new RegExp('^' + idRe[1] + '$');
    check('a generated id matches the server pattern', re.test(id), true);
  }
  check('the secret is 64 hex characters', /^[0-9a-f]{64}$/.test(secret), true);
  check('and is at least 32 characters (the server floor)', secret.length >= 32, true);
  check('two secrets differ', sandbox.newDeviceSecret() === secret, false);
  check('two ids differ', sandbox.newDeviceId() === id, false);

  console.log('\nunlock after enrollment, with no password');
  sandbox.writeDeviceEnrollment({
    deviceId: id,
    secret,
    username: 'hberg',
    role: 'chief_engineer',
    serverUrl: 'http://127.0.0.1:8787',
    vessel: { vesselId: 'mv-roadstead', vesselName: 'M/V ROADSTEAD' }
  });
  const session = await sandbox.unlockEnrolledDevice();
  check('unlocks as the enrolled engineer', session.username, 'hberg');
  check('onto his ship', session.vessel.vesselId, 'mv-roadstead');
  check('marked offline', session.offline, true);
  check('with no server session token', session.sessionToken, null);
  check('and no password was involved', Object.prototype.hasOwnProperty.call(session, 'password'), false);

  console.log('\nthere is no credential-file importer on the login gate');
  check('no load-offline-creds button', /id="btnLoadOfflineCreds"/.test(HTML), false);
  check('no password-verifier bundle key', /nr_offline_bundle/.test(HTML), false);

  console.log(failures ? `\nFAILED — ${failures} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(failures ? 1 : 0);
})();
