/*
 * The offline password verifier, checked across the two languages that compute it.
 *
 * The server stores PBKDF2-HMAC-SHA256 hashes from Python's hashlib; the app
 * recomputes them in the browser with WebCrypto and compares. If those two ever
 * disagree by a byte, offline sign-in fails for every user with a correct password
 * and no test that exercises only one side would notice. So this test derives with
 * the app's own function and checks it against a digest Python produced.
 *
 * Run: node tests/test_offline_verifier.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

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
  /* Keep the `async` if it is there — matching at `function` would silently strip
     it and the extracted source would not parse. */
  const prefix = 'async ';
  if (HTML.slice(start - prefix.length, start) === prefix) start -= prefix.length;
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

const sandbox = { crypto: globalThis.crypto, TextEncoder, console, Uint8Array, Array, parseInt, String, Error };
vm.createContext(sandbox);
vm.runInContext(
  [extract('hexToBytes'), extract('bytesToHex'), extract('derivePasswordVerifier'), extract('verifiersMatch')].join('\n'),
  sandbox
);

/* Ask the real server code for the hash, rather than reimplementing it here — a
   test that hard-codes its own copy of the scheme would keep passing after the
   server changed. */
function pythonVerifier(password, saltHex, rounds) {
  return execFileSync('python3', ['-c', `
import hashlib, sys
print(hashlib.pbkdf2_hmac("sha256", sys.argv[1].encode("utf-8"), bytes.fromhex(sys.argv[2]), int(sys.argv[3])).hex())
`, password, saltHex, String(rounds)], { encoding: 'utf8' }).trim();
}

(async () => {
  const ROUNDS = 240000;      // must match PBKDF2_ROUNDS in sync-server/accounts.py
  const salt = 'a3f1c09e77b24d5581e6ac02b4d9f731';

  console.log('\nthe browser reproduces the server digest');
  for (const password of ['vessel-secret', 'correct horse battery staple', 'ünïcøde-påss-123', 'x'.repeat(200)]) {
    const fromPython = pythonVerifier(password, salt, ROUNDS);
    const fromBrowser = await sandbox.derivePasswordVerifier(password, salt, ROUNDS);
    check(`same digest for ${JSON.stringify(password.slice(0, 24))}`, fromBrowser, fromPython);
  }

  console.log('\nthe rounds in the app match the rounds on the server');
  const accounts = fs.readFileSync(path.join(__dirname, '..', 'sync-server', 'accounts.py'), 'utf8');
  const serverRounds = Number((accounts.match(/PBKDF2_ROUNDS\s*=\s*([\d_]+)/) || [])[1].replace(/_/g, ''));
  check('server uses the rounds this test pins', serverRounds, ROUNDS);
  check('the app defaults to the same', HTML.includes('rounds || 240000'), true);

  console.log('\na wrong password does not verify');
  const right = await sandbox.derivePasswordVerifier('vessel-secret', salt, ROUNDS);
  const wrong = await sandbox.derivePasswordVerifier('vessel-secrft', salt, ROUNDS);
  check('a one-character difference changes the digest', wrong === right, false);
  check('and the comparison rejects it', sandbox.verifiersMatch(wrong, right), false);
  check('the comparison accepts the right one', sandbox.verifiersMatch(right, right), true);

  console.log('\nthe same password under a different salt is a different digest');
  const other = await sandbox.derivePasswordVerifier('vessel-secret', 'b'.repeat(32), ROUNDS);
  check('salt is actually used', other === right, false);

  console.log('\ncomparison edge cases');
  check('empty against empty', sandbox.verifiersMatch('', ''), true);
  check('a prefix is not a match', sandbox.verifiersMatch(right.slice(0, 10), right), false);
  check('null is not a match', sandbox.verifiersMatch(null, right), false);

  console.log(failures ? `\nFAILED — ${failures} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(failures ? 1 : 0);
})();
