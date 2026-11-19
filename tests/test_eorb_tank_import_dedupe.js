/* e-ORB "Get fuel & lube oil tanks from Tank Chief" — a tank already in the list is updated, never copied again. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../voyage_manager.html'), 'utf8');
let fails = 0, checks = 0;
const check = (n, ok) => { checks++; if (!ok) { fails++; console.log('  FAIL ' + n); } else console.log('  ok   ' + n); };
const a = html.indexOf('const tankKey = s =>');
const b = html.indexOf('btn.addEventListener', a);
if (a < 0 || b < 0) { console.log('  FAIL could not find the merge code'); process.exit(1); }
const sb = { uid: (() => { let i = 0; return () => 'u' + (++i); })() };
vm.createContext(sb);
vm.runInContext(html.slice(a, b) + '\nthis.merge = merge;', sb);
const { merge } = sb;

let list = [{ id: 'fuel_a', name: 'No.1 HFO Service', capacityM3: 50, robM3: 0 }];
let st = merge(list, [{ id: 'T1', name: 'NO 1 HFO SERVICE', capacityM3: 55, robM3: 12 }], true);
check('a tank already inside (name differs by case/punctuation) is updated, not added', list.length === 1 && st.updated === 1 && st.added === 0);
check('and takes the Tank Chief figures and id', list[0].robM3 === 12 && list[0].capacityM3 === 55 && list[0].tankChiefId === 'T1');

st = merge(list, [{ id: 'T1', name: 'No 1 HFO Service' }], true);
check('pressing the button again changes nothing in the count', list.length === 1 && st.added === 0);

list = [];
st = merge(list, [{ id: 'T2', name: 'MDO Tank' }, { id: 'T2', name: 'MDO Tank' }, { id: 'T3', name: 'mdo-tank' }], true);
check('the same tank sent twice is copied once', list.length === 1 && st.added === 1 && st.skipped === 2);

list = [{ id: 'x', name: 'Port Aft Tank', frameNo: 'FR 45-50' }];
st = merge(list, [{ id: 'T4', name: 'Different name', frameNo: 'fr45-50' }], true);
check('a tank with the same frame number is the same tank', list.length === 1 && st.updated === 1);

list = [{ id: 'y', name: 'Cyl Oil Storage' }];
st = merge(list, [{ id: 'L1', name: 'CYL OIL STORAGE' }, { id: 'L2', name: 'ME Sump' }], false);
check('new tanks are still added', list.length === 2 && st.added === 1 && st.updated === 1);
console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
