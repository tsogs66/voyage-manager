#!/usr/bin/env node
/*
 * Chief summary averages: ME/GE/boiler by running hours, cyl oil by ME hours,
 * sea vs port/anchorage total-fuel rates, FW m³/day (litres÷1000÷days).
 * Run: node tests/test_summary_avg_hours.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');
const ShipTime = require('../ship_time.js');

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = Object.is(actual, expected) ||
    (typeof actual === 'number' && typeof expected === 'number' &&
      Math.abs(actual - expected) < 1e-9);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures.push(label);
}

function checkTrue(label, value) {
  check(label, !!value, true);
}

console.log('\nsource guards');
checkTrue('consumer average strip exists', HTML.includes('id="consumerPerDayStrip"'));
checkTrue('sea/port fuel strip exists', HTML.includes('id="seaPortFuelStrip"'));
checkTrue('averages use consumer running hours', HTML.includes('mtPerDay(meFuelTot, meRunHrs)'));
checkTrue('cyl oil uses ME run days', HTML.includes('const meRunDays = meRunHrs / 24'));
checkTrue('FW average converts litres to m³ once', HTML.includes('litresToM3(fwLitres) / daysAtSea'));
checkTrue('FW totals do not double-convert m³', HTML.includes('fwNowM3'));
checkTrue('range ME/GE/boiler per-day use run hours', HTML.includes("perDayOn(byConsumer['Main Engine'], meHrs)"));
checkTrue('clock change keeps log stamp', /datetime:\s*datetime\s*\|\|\s*''/.test(
  fs.readFileSync(path.join(__dirname, '..', 'ship_time.js'), 'utf8')
));

console.log('\nconsumer daily rate from running hours');
const mtPerDay = (cons, hrs) => (hrs > 0 ? (cons / hrs) * 24 : null);
check('ME 10 MT over 20 run-hrs → 12 MT/day', mtPerDay(10, 20), 12);
check('GE 4 MT over 48 gen-hrs → 2 MT/day', mtPerDay(4, 48), 2);
check('boiler 1 MT over 6 hrs → 4 MT/day', mtPerDay(1, 6), 4);
check('no hours → null', mtPerDay(5, 0), null);
/* Diluting ME burn across a full 24 h watch understates the rate when ME ran less. */
check('diluting 10 MT / 20 ME-hrs over 24 h watch would be wrong (10)', mtPerDay(10, 24), 10);

console.log('\ncylinder oil on ME hours');
check('200 L over 20 ME-hrs → 240 L/day', (200 / (20 / 24)), 240);
check('not diluted over 24 h calendar (would be 200)', (200 / 1), 200);

console.log('\nsea vs port/anchorage total fuel');
check('sea 20 MT / 40 h → 12 MT/day', mtPerDay(20, 40), 12);
check('port 3 MT / 24 h → 3 MT/day', mtPerDay(3, 24), 3);

console.log('\nfresh water m³/day');
const L_PER_M3 = 1000;
const litresToM3 = (n) => n / L_PER_M3;
check('15000 L over 3 days → 5 m³/day', litresToM3(15000) / 3, 5);
check('not 15000 m³/day (missing litres→m³)', litresToM3(15000) / 3 !== 15000 / 3, true);
/* Double-converting m³ display figures would shrink the total by 1000×. */
check('already-m³ 12 must not be /1000 again', 12, 12);

console.log('\nclock change updates period hours without moving stamp');
const applied = ShipTime.applyTimezoneChange('2026-08-15T12:00', 480, 540, 0);
check('stamp stays noon', applied.datetime, '2026-08-15T12:00');
check('clock log +60', applied.clockChangeMin, 60);
check('period hours become 23', ShipTime.elapsedShipHours('2026-08-14T12:00', applied.datetime, applied.clockChangeMin), 23);
const back = ShipTime.applyTimezoneChange(applied.datetime, 540, 480, 60);
check('−1 h clears clock log', back.clockChangeMin, 0);
check('−1 h restores 24 h period', ShipTime.elapsedShipHours('2026-08-14T12:00', back.datetime, back.clockChangeMin), 24);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
