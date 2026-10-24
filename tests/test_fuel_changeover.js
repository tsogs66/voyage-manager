/*
 * Fuel changeover to a sulphur limit, built the way the FOBAS change-over
 * calculator is: the low-sulphur fuel blends into whatever is still in the
 * service system, so the inlet sulphur decays exponentially.
 *
 *   S(t) = S_low + (S_high - S_low) * exp(-Qt/V)
 *   t    = (V/Q) * ln[(S_high - S_low) / (S_limit - S_low)]
 *
 * The failure that matters is an answer that is too SHORT — the ship crosses
 * the boundary over the limit. So the cases below pin the direction of every
 * input, and the two ways the answer is not a number at all: a limit at or
 * below the new fuel's own sulphur (never reached), and a stopped engine
 * (nothing displaced).
 *
 * Run: node tests/test_fuel_changeover.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}
function near(label, actual, expected, tol) {
  checks += 1;
  const ok = actual != null && isFinite(actual) && Math.abs(actual - expected) <= (tol == null ? 1e-6 : tol);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ~${expected}, got ${actual}`);
  if (!ok) fails += 1;
}

function extract(name) {
  let start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const asyncAt = HTML.lastIndexOf('async ', start);
  if (asyncAt >= 0 && asyncAt + 'async '.length === start) start = asyncAt;
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

const sandbox = {
  console, Math, Number, Date, isFinite, String, Object, Array, JSON,
  fmt: (v, d) => Number(v).toFixed(d),
  CHANGEOVER_MAX_RAMP_C_PER_MIN: 2
};
vm.createContext(sandbox);
vm.runInContext([
  extract('computeFuelChangeover'),
  extract('changeoverThermalMinutes')
].join('\n'), sandbox);
const { computeFuelChangeover, changeoverThermalMinutes } = sandbox;

/* A realistic case: 3.0 m3 service system, 24 MT/day at 890 kg/m3,
   0.48 % in service, changing to 0.07 %, limit 0.10 %. */
const base = {
  sHigh: 0.48, sLow: 0.07, sLimit: 0.10,
  volumeM3: 3.0, consMtDay: 24, density: 890, marginHrs: 1
};
const r = computeFuelChangeover(base);

check('it works', r.ok, true);

/* Q = (24 * 1000 / 890) / 24 = 1.1236 m3/h ; tau = 3 / Q = 2.6700 h */
const Q = (24 * 1000 / 890) / 24;
near('the displacement rate goes through density', r.m3PerHour, Q, 1e-9);
near('one system volume is V/Q', r.tauHours, 3 / Q, 1e-9);

/* t = tau * ln(0.41 / 0.03) = 2.67 * 2.6137 = 6.979 h */
const expected = (3 / Q) * Math.log((0.48 - 0.07) / (0.10 - 0.07));
near('the changeover time follows the model', r.hours, expected, 1e-9);
near('and is about seven hours here', r.hours, 6.979, 0.01);

/* The curve must actually land on the limit, and start where we started. */
near('sulphur at t=0 is what is in service', r.sulphurAt(0), 0.48, 1e-12);
near('sulphur at the answer is the limit', r.sulphurAt(r.hours), 0.10, 1e-9);
check('it never goes below the new fuel', r.sulphurAt(1e6) >= 0.07 - 1e-12, true);
check('the curve is monotonic', r.curve.every((p, i, a) => i === 0 || p.sulphur <= a[i - 1].sulphur), true);
near('the curve ends at the limit', r.curve[r.curve.length - 1].sulphur, 0.10, 1e-9);

/* Quantity displaced is the rate times the time. */
near('fuel displaced is rate x time', r.lowSulphurUsedMt, (24 / 24) * r.hours, 1e-9);

/* ---- direction of every input: all of these must make it LONGER ---------- */
const longer = (label, patch) => {
  const x = computeFuelChangeover(Object.assign({}, base, patch));
  checks += 1;
  const ok = x.ok && x.hours > r.hours;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: ${r.hours} -> ${x && x.hours}`);
  if (!ok) fails += 1;
};
longer('a bigger service system takes longer', { volumeM3: 6 });
longer('a lower load takes longer', { consMtDay: 12 });
longer('dirtier fuel in service takes longer', { sHigh: 0.9 });
longer('a tighter limit takes longer', { sLimit: 0.08 });
longer('a new fuel closer to the limit takes longer', { sLow: 0.095 });
/* Denser fuel means fewer cubic metres per tonne, so slower displacement. */
longer('a denser new fuel takes longer', { density: 990 });

/* ---- the answers that are not a number ---------------------------------- */
const bad = (label, patch, mustSay) => {
  const x = computeFuelChangeover(Object.assign({}, base, patch));
  checks += 1;
  const ok = x.ok === false && (!mustSay || new RegExp(mustSay, 'i').test(x.reason || ''));
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: ${JSON.stringify(x).slice(0, 160)}`);
  if (!ok) fails += 1;
};

/* The important one. The blend approaches the new fuel asymptotically, so a
   limit at or below it is never reached — a longer changeover cannot fix a
   non-compliant fuel, and reporting some large number of hours would be a lie. */
bad('a new fuel at the limit is refused, not given a long time', { sLow: 0.10 }, 'never reaches the limit');
bad('a new fuel over the limit likewise', { sLow: 0.15 }, 'never reaches the limit');
bad('a stopped engine displaces nothing', { consMtDay: 0 }, 'never completes');
bad('no service volume is refused', { volumeM3: 0 });
bad('zero density is refused', { density: 0 });
bad('a new fuel no cleaner than the old is refused', { sLow: 0.48 }, 'Nothing to change over');
bad('a dirtier new fuel is refused', { sLow: 0.9 }, 'Nothing to change over');
bad('missing figures are refused', { volumeM3: '' }, 'Fill in every figure');
bad('nonsense figures are refused', { consMtDay: 'abc' }, 'Fill in every figure');

/* Already under the limit is a pass, not a failure — and no time needed. */
const already = computeFuelChangeover(Object.assign({}, base, { sHigh: 0.09 }));
check('fuel already under the limit needs no changeover',
  { ok: already.ok, compliant: already.alreadyCompliant, hours: already.hours },
  { ok: true, compliant: true, hours: 0 });

/* ---- the latest start time ---------------------------------------------- */
const eca = new Date('2026-06-01T12:00:00Z');
const timed = computeFuelChangeover(Object.assign({}, base, { ecaAt: eca.toISOString() }));
/* Date is millisecond-quantised, so this is exact only to about 3e-7 h. */
near('the start time backs off the changeover and the margin',
  (eca.getTime() - timed.latestStart.getTime()) / 3600000, timed.hours + 1, 1e-5);
check('and the margin is counted', timed.totalHours > timed.hours, true);

const noMargin = computeFuelChangeover(Object.assign({}, base, { ecaAt: eca.toISOString(), marginHrs: 0 }));
near('with no margin it is exactly the changeover',
  (eca.getTime() - noMargin.latestStart.getTime()) / 3600000, noMargin.hours, 1e-5);

const noEca = computeFuelChangeover(base);
check('with no crossing set there is no start time', noEca.latestStart, null);

/* ---- thermal ramp -------------------------------------------------------- */
near('the safe ramp from 120 to 40 C takes 40 minutes', changeoverThermalMinutes(120, 40), 40);
near('direction does not matter', changeoverThermalMinutes(40, 120), 40);
check('a missing temperature gives nothing', changeoverThermalMinutes(null, 40), null);

/* ---- it is wired to the regulation, and to the record ------------------- */
check('the ECA limit is the Annex VI figure',
  /const CHANGEOVER_ECA_LIMIT = 0\.10;/.test(HTML), true);
check('the global cap is there too',
  /const CHANGEOVER_GLOBAL_LIMIT = 0\.50;/.test(HTML), true);
check('the panel states the formula it used',
  /t = \(V\/Q\) · ln\[\(S_high − S_low\) ÷ \(S_limit − S_low\)\]/.test(HTML), true);
check('it says V must be the whole blending volume',
  /because anything left out makes the answer shorter than the truth/.test(HTML), true);
check('the printed sheet leaves the recorded times blank for the engineer',
  /To be recorded \(Annex VI Reg\. 14\.6\)/.test(HTML), true);
check('and says the calculated time is only a plan',
  /the entry in the record is the completion actually observed/.test(HTML), true);
check('copying to setup warns the record needs observed times',
  /These are the planned times\. Record the times actually observed/.test(HTML), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
