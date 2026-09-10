'use strict';
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');
let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = actual === expected;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}
console.log('Dep/Arr ROB recalculate control');
check('recalculate button present', HTML.includes('id="btnRecalcDepArrRob"'), true);
check('undo button present', HTML.includes('id="btnUndoDepArrRobRecalc"'), true);
check('recalculate helper present', HTML.includes('async function recalculateDepArrRobComparison'), true);
check('commits Opening ROB from vessel management', HTML.includes('readFuelTypeManagementFromDom'), true);
check('rebuilds current entries', HTML.includes('recalculateCurrentEntries({ persist: true, clearOverrides })'), true);
check('undo button wired into shared undo UI', HTML.includes("'btnUndoDepArrRobRecalc'"), true);
check('status line present', HTML.includes('id="depArrRobRecalcStatus"'), true);
if (fails) { console.log(`\nFAILED — ${fails} of ${checks} checks`); process.exit(1); }
console.log(`\nPASSED — ${checks} checks`);
