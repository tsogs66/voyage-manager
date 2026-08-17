/*
 * Total lubes on the R.O.B. snapshot.
 *
 * The total covers cylinder oil high and low plus ME and GE system oil. Fresh
 * water is not a lube and must stay out of it — it is measured in litres of water,
 * and folding it into an oil total would produce a figure that looks plausible and
 * means nothing.
 *
 * Run: node tests/test_lube_total.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let failures = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const ok = actual === expected
    || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9);
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

/* The four tanks the app ships with, and the fresh water tank alongside them, so
   the exclusion is tested against the real default rather than an invented one. */
const LUBE = [
  { id: 'cylhigh', name: 'CYL HIGH', kind: 'cylHigh' },
  { id: 'cyllow', name: 'CYL LOW', kind: 'cylLow' },
  { id: 'mesysoil', name: 'ME SYS OIL', kind: 'meSys' },
  { id: 'gesysoil', name: 'GE SYS OIL', kind: 'geSys' },
];

const sandbox = { console, Number, isNaN, lubeTankList: () => LUBE };
vm.createContext(sandbox);
vm.runInContext(extract('totalLubeRob'), sandbox);
const total = sandbox.totalLubeRob;

console.log('\nthe total is the four lube tanks');
check('all four add up', total({ cylhigh: 8000, cyllow: 1000, mesysoil: 5000, gesysoil: 2000 }), 16000);
check('an empty tank contributes nothing', total({ cylhigh: 8000, cyllow: 0, mesysoil: 5000, gesysoil: 2000 }), 15000);
check('a missing tank is treated as zero', total({ cylhigh: 8000, mesysoil: 5000 }), 13000);
check('nothing at all is zero', total({}), 0);

console.log('\nfresh water is not a lube');
/* A ship carries tens of thousands of litres of fresh water against a few
   thousand of oil, so including it would swamp the total and read as a huge
   lube stock. */
const withFw = { cylhigh: 8000, cyllow: 1000, mesysoil: 5000, gesysoil: 2000, freshwater: 60000 };
check('water in the same store does not change the total', total(withFw), 16000);
check('and the total is not the sum of everything', total(withFw) === 76000, false);

console.log('\ntanks can be keyed by name as well as id');
check('names resolve too', total({ 'CYL HIGH': 8000, 'CYL LOW': 1000, 'ME SYS OIL': 5000, 'GE SYS OIL': 2000 }), 16000);

console.log('\nthe snapshot carries the row');
check('the row is labelled', HTML.includes("label: 'TOTAL LUBES'"), true);
check('its opening figure is the total', HTML.includes('totalLubeRob(prevRobData.robLube)'), true);
check('its closing figure is the total', HTML.includes('totalLubeRob(asOf.robLube)'), true);
check('it is built only from lube rows', HTML.includes("getRobRows().filter(r=>r.cat==='lube')"), true);
check('the printed sheet marks it as a total', HTML.includes('rob-total'), true);

console.log('\nboth R.O.B. sheets carry the total, not just one of them');
/* There are two: the snapshot, and the Dep/Arr comparison. The first version of
   this change reached only the snapshot, and the sheet the report is actually
   printed from went without — so both are pinned here by name. */
check('the snapshot builds it', HTML.includes("label: 'TOTAL LUBES'"), true);
check('the dep/arr sheet builds it', HTML.includes("label:'TOTAL LUBES'"), true);
check('dep/arr totals every column', HTML.includes("const sum = key => lubeRows.reduce"), true);
check('and sums only the lube rows', HTML.includes('lubeRows.push(row)'), true);
/* Scoped to the function that builds the rows: fwTankList().forEach also appears
   earlier in the file, and comparing against that occurrence proved nothing. */
const depArr = extract('depArrRobRows');
check('the total is built inside depArrRobRows', depArr.includes("id:'__lubetotal'"), true);
check('after the lube tanks', depArr.indexOf('lubeTankList().forEach') < depArr.indexOf("id:'__lubetotal'"), true);
check('and before fresh water', depArr.indexOf("id:'__lubetotal'") < depArr.indexOf('fwTankList().forEach'), true);

console.log('\nconsumption with nothing drawn stays blank');
/* A total of 0.00 against tanks that recorded nothing would read as "measured, and
   none used" rather than "not recorded". The row filters nulls and only totals
   what is there. */
check('nulls are filtered before summing', HTML.includes('v=>v!=null && !isNaN(v)'), true);
check('an empty list yields null, not zero', HTML.includes('lubeCons.length ? lubeCons.reduce'), true);

console.log(failures ? `\nFAILED — ${failures} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(failures ? 1 : 0);
