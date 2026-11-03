/**
 * Log Entry → New Voyage must file the new leg and leave it as the working voyage.
 * An empty log used to fall back to the ballast leg just archived, or to whichever
 * voyage sorted first in the library.
 *
 * Run: node tests/test_new_voyage_leg_load.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

function between(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, 'missing ' + end + ' after ' + start);
  return src.slice(i, j);
}

const create = between(html, 'async function createNewVoyageLeg', "document.getElementById('btnResetVoyage')");
const archiveAt = create.indexOf('await archiveActiveVoyageLeg()');
const saveNewAt = create.indexOf('await saveVoyageLegToLibrary(');
const loadAt = create.indexOf('await activateVoyageLeg(state.activeVesselId, newVoyageNo, newCondition, { persistCurrent: false })');
assert.ok(archiveAt >= 0 && saveNewAt > archiveAt, 'the previous leg is archived before the new one is filed');
assert.ok(loadAt > saveNewAt, 'the new leg is loaded after it is filed');
assert.match(create, /applyEntryDefaults\(\)/);
assert.match(create, /prefillFromLastEntry\(\)/);
assert.match(create, /carryover\.condition = newCondition/);
assert.match(html, /stayOnEntry: true/);
assert.doesNotMatch(create, /stayOnEntry: false/);

const openShip = between(html, 'async function loadVesselFromDb', 'function openWorkDraftKey');
assert.match(openShip, /preferredLibraryLeg\(index, vn, state\.setup\.shipCondition\)/);
assert.match(openShip, /persistCurrent: false/);
assert.doesNotMatch(openShip, /row\?\.B \? 'B'/);
assert.doesNotMatch(openShip, /index\[0\]/);

const preferSrc = between(html, 'function preferredLibraryLeg', 'function reportVesselLoad');
const prefer = new Function(preferSrc + '\nreturn preferredLibraryLeg;')();

const library = [
  { voyageNumber: '42', B: { entryCount: 4 }, L: { entryCount: 0 } },
  { voyageNumber: '43', B: { entryCount: 0 }, L: null },
];
assert.deepStrictEqual(prefer(library, '42', 'L'), { voyageNumber: '42', condition: 'L' });
assert.deepStrictEqual(prefer(library, '42', 'LADEN'), { voyageNumber: '42', condition: 'L' });
assert.deepStrictEqual(prefer(library, '42', 'B'), { voyageNumber: '42', condition: 'B' });
assert.deepStrictEqual(prefer(library, '43', 'B'), { voyageNumber: '43', condition: 'B' });
assert.strictEqual(prefer(library, '43', 'L'), null);
assert.strictEqual(prefer(library, '99', 'B'), null);
assert.deepStrictEqual(prefer(library, '', 'L'), { voyageNumber: '42', condition: 'B' });
assert.strictEqual(prefer([], '7', 'B'), null);

console.log('new voyage leg: ok');
