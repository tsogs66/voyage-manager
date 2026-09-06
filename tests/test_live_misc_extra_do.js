/*
 * Live ROB must include Misc and Boiler/Incinerator Extra D.O. for MDO/MGO and
 * LSMGO as soon as those boxes are typed — not only after Save.
 *
 * Run: node tests/test_live_misc_extra_do.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}

function sliceFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = HTML.indexOf('\nfunction ', start + 10);
  return HTML.slice(start, next < 0 ? start + 2500 : next);
}

console.log('\nlive ROB includes manual distillate');
{
  const vs = sliceFn('computeVsLiveConsByType');
  check('computeVsLiveConsByType adds Extra D.O.',
    vs.includes('EXTRA_DO_GRADES') && vs.includes('vs_blrExtra_mdomgo') && vs.includes('vs_incExtra_lsmgo'));
  check('computeVsLiveConsByType still adds Misc',
    vs.includes('vs_misc_mdomgo') && vs.includes('vs_misc_lsmgo'));
  const live = sliceFn('computeLiveConsByType');
  check('computeLiveConsByType adds Extra D.O.',
    live.includes('EXTRA_DO_GRADES') && live.includes('vs_blrExtra_mdomgo') && live.includes('vs_incExtra_lsmgo'));
  check('misc + Extra D.O. fields listen for live ROB refresh',
    /\[\s*'vs_misc_mdomgo'\s*,\s*'vs_misc_lsmgo'\s*,\s*'vs_blrExtra_mdomgo'\s*,\s*'vs_blrExtra_lsmgo'\s*,\s*'vs_incExtra_mdomgo'\s*,\s*'vs_incExtra_lsmgo'\s*\][\s\S]*?updateVsRobLiveFromCons/.test(HTML));
}

console.log('\nROB survey Received is editable for bunkering');
check('Received column is an input',
  HTML.includes('data-survey-recv=') && HTML.includes('data-recv-base='));
check('Apply syncs Received into receipts',
  HTML.includes('syncRobSurveyReceivedReceipts') && HTML.includes("source: 'rob-survey'"));
check('Clear removes survey-sourced receipts',
  /async function clearRobSurvey[\s\S]*?removeRobSurveyReceipts/.test(HTML));
check('live Difference refreshes while typing Received',
  HTML.includes('refreshVsSurveyLiveDiffs'));

console.log();
if (failures) {
  console.log(`FAILED — ${failures} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
