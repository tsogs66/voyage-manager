/*
 * Total lubes and total water on the R.O.B. snapshot, summary, and printout.
 *
 * The lube total covers cylinder oil high and low plus ME and GE system oil. Fresh
 * water is not a lube and must stay out of it — it is stored in litres and shown
 * in m³. Folding it into an oil total would produce a figure that looks plausible
 * and means nothing. Water has its own total when more than one tank is fitted.
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

const sandbox = {
  console, Number, isNaN,
  L_PER_M3: 1000,
  lubeTankList: () => LUBE,
  fwTankList: () => [{ id: 'freshwater', name: 'FRESH WATER' }],
};
vm.createContext(sandbox);
vm.runInContext(
  extract('totalLubeRob') + '\n' + extract('totalFwRob') + '\n' + extract('litresToM3') + '\n' + extract('m3ToLitres') + '\n' + extract('fmtFw'),
  sandbox
);
const total = sandbox.totalLubeRob;
const totalFw = sandbox.totalFwRob;

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
check('its opening figure is the total', HTML.includes('totalLubeRob(prevRobData.robLube'), true);
check('its closing figure is the total', HTML.includes('totalLubeRob(asOf.robLube'), true);
check('it is built only from lube rows', HTML.includes("getRobRows().filter(r=>r.cat==='lube')"), true);
check('the printed sheet marks it as a total', HTML.includes('rob-total'), true);

console.log('\ntotal water is the fresh-water tanks, not the oils');
check('one tank is itself', totalFw({ freshwater: 60000 }), 60000);
check('two tanks add up', (() => {
  sandbox.fwTankList = () => [{ id: 'fwA', name: 'FW A' }, { id: 'fwB', name: 'FW B' }];
  return totalFw({ fwA: 40000, fwB: 25000 });
})(), 65000);
sandbox.fwTankList = () => [{ id: 'freshwater', name: 'FRESH WATER' }];
check('lube oil in the same store does not change the water total', totalFw({ freshwater: 60000, cylhigh: 8000 }), 60000);
check('the snapshot carries the water row', HTML.includes("label: 'TOTAL WATER'"), true);
check('water total is only when more than one tank', HTML.includes('if (fw.length > 1)'), true);
check('its opening figure is the water total', HTML.includes('totalFwRob(prevRobData.robLube'), true);
check('its closing figure is the water total', HTML.includes('totalFwRob(asOf.robLube'), true);
check('the ROB page has a water total strip', HTML.includes('id="fwTotalStrip"'), true);
check('the summary page has a water total strip', HTML.includes('id="fwTotalSummaryStrip"'), true);
check('summary consumption vs ROB splits water from lube', HTML.includes('id="fwDualGauges"'), true);
{
  const consRob = HTML.slice(HTML.indexOf('CONSUMPTION VS ROB'), HTML.indexOf('id="page-reports"'));
  check('fw gauges stay in the consumption vs ROB panel', consRob.includes('id="fwDualGauges"'), true);
  check('fw gauges sit on rows below total lube oil', consRob.indexOf('lubeTotalSummaryStrip') < consRob.indexOf('fwDualGauges'), true);
  check('fw is a sub-heading in that panel, not a fifth lube gauge', consRob.includes('<h3 class="sub">Fresh Water</h3>'), true);
}
check('summary has no standalone fresh-water panel', HTML.includes('<h2>Fresh Water</h2>'), false);
check('summary per-day splits water from lube', HTML.includes('id="fwPerDayStrip"'), true);
check('lube per-day no longer lists fresh water', /lubePerDayStrip[\s\S]*FRESH WATER/.test(HTML.slice(HTML.indexOf('lubePerDayStrip'), HTML.indexOf('lubePerDayStrip')+400)), false);
check('setup opening ROB for water is m³', HTML.includes('Opening ROB (m³)'), true);
check('gauge total is labelled m³', HTML.includes('Total Fresh Water (m³)'), true);

console.log('\nwater is shown in cubic metres');
check('50000 L is 50 m³', sandbox.litresToM3(50000), 50);
check('8.2 m³ stores as 8200 L', sandbox.m3ToLitres(8.2), 8200);
check('fmtFw uses two decimals', sandbox.fmtFw(50000), '50.00');
check('a missing value is a dash', sandbox.fmtFw(null), '—');

console.log('\nconsumption with nothing drawn stays blank');
/* A total of 0.00 against tanks that recorded nothing would read as "measured, and
   none used" rather than "not recorded". The row filters nulls and only totals
   what is there. */
check('nulls are filtered before summing', HTML.includes('v=>v!=null && !isNaN(v)'), true);
check('an empty list yields null, not zero', HTML.includes('vals.length ? vals.reduce'), true);

console.log(failures ? `\nFAILED — ${failures} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(failures ? 1 : 0);
