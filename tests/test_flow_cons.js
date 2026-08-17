/*
 * Flowmeter arrangement consumption and multi-tank fresh-water balance.
 *
 * SINGLE / DUAL GE / DUAL ME / DUAL BOTH are the Setup → Flowmeters formulas.
 * Fresh water: production is the meter quantity added; consumption is
 * previous total + production − present total, booked on the chosen tanks.
 *
 * Run: node tests/test_flow_cons.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = Math.abs((actual ?? NaN) - expected) < 1e-6 || actual === expected;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures.push(label);
}

function extract(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in voyage_manager.html`);
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return HTML.slice(start, i + 1);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  [
    extract('meterDelta'),
    extract('dualDelta'),
    extract('meGeRawLitres'),
    extract('fwPeriodBalance'),
    extract('unitOverrideIfDifferent'),
  ].join('\n'),
  sandbox
);

const rolls = { main: 1e8, mainOut: 1e8, aux: 1e8, auxOut: 1e8 };

function unit(meter, meterIn, meterOut) {
  return { meter, meterIn, meterOut };
}

console.log('\nSINGLE — present less previous');
{
  const prev = { me: unit(1000), ge: unit(200) };
  const e = { me: unit(1600), ge: unit(350) };
  const { meRaw, geRaw } = sandbox.meGeRawLitres(e, prev, rolls, 'SINGLE');
  check('M/E 1600 − 1000', meRaw, 600);
  check('D/G 350 − 200', geRaw, 150);
}

console.log('\nDUAL GE — D/G inlet−outlet; M/E = M/E delta − D/G cons');
{
  const prev = { me: unit(10000), ge: unit(null, 5000, 4800) };
  const e = { me: unit(11200), ge: unit(null, 5600, 5200) };
  const { meRaw, geRaw } = sandbox.meGeRawLitres(e, prev, rolls, 'DUAL_GE');
  // D/G in Δ 600, out Δ 400 → cons 200
  check('D/G (5600−5000) − (5200−4800)', geRaw, 200);
  // M/E meter Δ 1200 − D/G 200 → 1000
  check('M/E 1200 − D/G 200', meRaw, 1000);
}

console.log('\nDUAL ME — M/E inlet−outlet; D/G = D/G delta − M/E cons');
{
  const prev = { me: unit(null, 20000, 19000), ge: unit(8000) };
  const e = { me: unit(null, 21200, 19600), ge: unit(9500) };
  const { meRaw, geRaw } = sandbox.meGeRawLitres(e, prev, rolls, 'DUAL_ME');
  // M/E in Δ 1200, out Δ 600 → cons 600
  check('M/E (21200−20000) − (19600−19000)', meRaw, 600);
  // D/G meter Δ 1500 − M/E 600 → 900
  check('D/G 1500 − M/E 600', geRaw, 900);
}

console.log('\nDUAL BOTH — each unit independent inlet−outlet');
{
  const prev = { me: unit(null, 1000, 900), ge: unit(null, 400, 350) };
  const e = { me: unit(null, 1300, 1050), ge: unit(null, 520, 430) };
  const { meRaw, geRaw } = sandbox.meGeRawLitres(e, prev, rolls, 'DUAL_BOTH');
  check('M/E (300 − 150)', meRaw, 150);
  check('D/G (120 − 80)', geRaw, 40);
}

console.log('\nrollover-safe SINGLE');
{
  const prev = { me: unit(99999990), ge: unit(10) };
  const e = { me: unit(15), ge: unit(40) };
  const { meRaw, geRaw } = sandbox.meGeRawLitres(e, prev, rolls, 'SINGLE');
  check('M/E rolled past 1e8', meRaw, 25);
  check('D/G ordinary', geRaw, 30);
}

console.log('\nunit override only when the typed figure differs');
check('match within 0.0005 is not an override', sandbox.unitOverrideIfDifferent(1.234, 1.2342), null);
check('blank is not an override', sandbox.unitOverrideIfDifferent(null, 1.2), null);
check('typed 1.500 vs calc 1.200 is kept', sandbox.unitOverrideIfDifferent(1.5, 1.2), 1.5);
check('no calculated figure keeps the typed one', sandbox.unitOverrideIfDifferent(0.8, null), 0.8);

console.log('\nfresh water — single tank (legacy total)');
{
  const bal = sandbox.fwPeriodBalance({
    tankIds: ['freshwater'],
    prevByTank: { freshwater: 60000 },
    prevTotal: 60000,
    prodDelta: 800,
    presentByTank: {},
    presentTotal: 60200,
    prodTankId: 'freshwater',
    consTankId: 'freshwater',
  });
  check('produced is the meter quantity', bal.prod, 800);
  check('consumed = prev + prod − present', bal.cons, 600);
  check('tank ROB is the present total', bal.byTank.freshwater, 60200);
  check('cons booked on the only tank', bal.consByTank.freshwater, 600);
}

console.log('\nfresh water — two tanks, produce A consume B, book from total');
{
  const bal = sandbox.fwPeriodBalance({
    tankIds: ['fwA', 'fwB'],
    prevByTank: { fwA: 10000, fwB: 20000 },
    prevTotal: 30000,
    prodDelta: 1000,
    presentByTank: {},
    presentTotal: 30500,
    prodTankId: 'fwA',
    consTankId: 'fwB',
  });
  check('produced 1000', bal.prod, 1000);
  check('consumed 500', bal.cons, 500);
  check('production tank 10000 + 1000', bal.byTank.fwA, 11000);
  check('consumption tank 20000 − 500', bal.byTank.fwB, 19500);
  check('total 30500', bal.total, 30500);
  check('prod attributed to A', bal.prodByTank.fwA, 1000);
  check('cons attributed to B', bal.consByTank.fwB, 500);
  check('A has no consumption', bal.consByTank.fwA, 0);
}

console.log('\nfresh water — two tanks, per-tank soundings');
{
  const bal = sandbox.fwPeriodBalance({
    tankIds: ['fwA', 'fwB'],
    prevByTank: { fwA: 10000, fwB: 20000 },
    prevTotal: 30000,
    prodDelta: 1000,
    presentByTank: { fwA: 10950, fwB: 19400 },
    presentTotal: null,
    prodTankId: 'fwA',
    consTankId: 'fwB',
  });
  check('sounded A kept', bal.byTank.fwA, 10950);
  check('sounded B kept', bal.byTank.fwB, 19400);
  check('total is the sum of soundings', bal.total, 30350);
  check('cons = 30000 + 1000 − 30350', bal.cons, 650);
  check('cons still attributed to B', bal.consByTank.fwB, 650);
}

console.log('\nfresh water — unchanged ROB means all production was consumed');
{
  const bal = sandbox.fwPeriodBalance({
    tankIds: ['fwA', 'fwB'],
    prevByTank: { fwA: 10000, fwB: 20000 },
    prevTotal: 30000,
    prodDelta: 400,
    presentByTank: {},
    presentTotal: 30000,
    prodTankId: 'fwA',
    consTankId: 'fwB',
  });
  check('cons equals production', bal.cons, 400);
  check('A ends at previous + prod − 0', bal.byTank.fwA, 10400);
  check('B ends at previous − cons', bal.byTank.fwB, 19600);
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
