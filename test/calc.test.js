/* Unit tests for the calculation engine. Run: node test/calc.test.js */
"use strict";

const { computeVoyage } = require("../js/calc.js");

let failures = 0;

function approx(actual, expected, label, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok   ${label} = ${actual.toFixed(2)}`);
  }
}

// --- Case 1: full voyage ---
const r = computeVoyage({
  cargoQty: 60000,
  freightRate: 25,
  lumpsum: 0,
  commissionPct: 3.75,
  ballastDist: 1200,
  ladenDist: 10800,
  ballastSpeed: 13,
  ladenSpeed: 12,
  seaMargin: 5,
  loadDays: 3,
  dischDays: 4,
  idleDays: 1,
  seaConsIfo: 28,
  portConsIfo: 3,
  seaConsMgo: 0.1,
  portConsMgo: 2,
  priceIfo: 480,
  priceMgo: 750,
  portCostLoad: 90000,
  portCostDisch: 110000,
  canalDues: 0,
  otherCosts: 15000,
});

// ballast: 1200/(13*24)*1.05 = 4.038461...
approx(r.ballastDays, (1200 / (13 * 24)) * 1.05, "ballastDays");
// laden: 10800/(12*24)*1.05 = 39.375
approx(r.ladenDays, 39.375, "ladenDays");
approx(r.portDays, 8, "portDays");
const seaDays = r.ballastDays + r.ladenDays;
approx(r.totalDays, seaDays + 8, "totalDays");

approx(r.grossFreight, 1500000, "grossFreight");
approx(r.commission, 56250, "commission");
approx(r.netFreight, 1443750, "netFreight");

approx(r.bunkerIfo, (seaDays * 28 + 8 * 3) * 480, "bunkerIfo");
approx(r.bunkerMgo, (seaDays * 0.1 + 8 * 2) * 750, "bunkerMgo");
approx(r.portCosts, 200000, "portCosts");
approx(r.canalOther, 15000, "canalOther");

const expectedExpenses = r.bunkerIfo + r.bunkerMgo + 200000 + 15000;
approx(r.totalExpenses, expectedExpenses, "totalExpenses");
approx(r.result, 1443750 - expectedExpenses, "result");
approx(r.tce, r.result / r.totalDays, "tce");

// --- Case 2: zero speeds / empty inputs must not divide by zero ---
const z = computeVoyage({});
approx(z.totalDays, 0, "empty totalDays");
approx(z.result, 0, "empty result");
approx(z.tce, 0, "empty tce (no NaN)");
if (Number.isNaN(z.tce)) { failures++; console.error("FAIL tce is NaN"); }

// --- Case 3: string inputs (as they come from form fields / CSV) ---
const s = computeVoyage({ cargoQty: "1000", freightRate: "10", commissionPct: "5" });
approx(s.grossFreight, 10000, "string grossFreight");
approx(s.netFreight, 9500, "string netFreight");

// --- Case 4: lumpsum freight ---
const l = computeVoyage({ lumpsum: "500000", commissionPct: "2.5" });
approx(l.netFreight, 487500, "lumpsum netFreight");

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll tests passed");
}
