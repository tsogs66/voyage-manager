/**
 * A server check files the open voyage leg before it reads either side.
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

assert.match(html, /async function commitOpenWorkBeforeSync/);
assert.match(html, /readBunkerPlanFromDom\(\)/);
const openLeg = between(html, 'async function openLegForReconcile', 'function remoteLegSummaries');
assert.match(openLeg, /commitOpenWorkBeforeSync/);
assert.doesNotMatch(openLeg, /persistCurrent:\s*false/);
const compare = between(html, 'async function compareLocalAndServerLegs', 'async function openLatestVoyageLeg');
assert.match(compare, /commitOpenWorkBeforeSync/);
const latest = between(html, 'async function openLatestVoyageLeg', 'async function reconcileVoyageLegs');
assert.match(latest, /commitOpenWorkBeforeSync/);
assert.doesNotMatch(latest, /persistCurrent:\s*false/);
for (const action of ['export-db', 'export-vessel', 'push-active', 'pull-active']) {
  const chunk = between(html, "msg.action === '" + action + "'", 'reply(');
  assert.match(chunk, /commitOpenWorkBeforeSync/, action);
}
const pullLeg = between(html, "msg.action === 'pull-voyage-leg'", 'reply({');
assert.match(pullLeg, /commitOpenWorkBeforeSync[\s\S]{0,400}state\.setup\.voyageNumber = voyage/);
const summary = between(html, 'async function saveOpenVoyageSummary', "document.getElementById('btnSaveVoyageSummary')");
assert.match(summary, /archiveActiveVoyageLeg/);
assert.match(html, /noon-report-v346/);
assert.match(html, /function takeLegSyncHold/);
assert.match(html, /function restoreHeldLegRecords/);
assert.match(html, /function rememberVesselMiscForSync/);
const syncNow = between(html, 'async function syncNow', 'function queueBackgroundSync');
assert.match(syncNow, /takeLegSyncHold\(\)/);
assert.match(syncNow, /await refreshOrbEntriesFromDb\(\)/);
const commit = between(html, 'async function commitOpenWorkBeforeSync', 'async function compareLocalAndServerLegs');
assert.match(commit, /refreshOrbEntriesFromDb/);
const applyRemote = between(html, 'function applyRemoteSnapshot', 'function filterDeleted');
assert.match(applyRemote, /state\.setup\.voyageNumber = legSyncHold\.voyageNumber/);
assert.match(applyRemote, /restoreHeldLegRecords\(\)/);
const reconcile = between(html, 'async function reconcileVoyageLegs', 'const VOYAGE_BRIDGE_CHUNK');
assert.match(reconcile, /rememberVesselMiscForSync\(\)/);
assert.match(reconcile, /list\.unshift\(\{ voyage: prevVn, condition: prevCond \}\)/);
assert.match(reconcile, /if \(prevVn\)/);
assert.match(reconcile, /await activateVoyageLeg\(state\.activeVesselId, prevVn, prevCond\)/);
const payload = between(html, 'function buildSyncPayload', 'function recordTs');
assert.match(payload, /applyVesselMiscCarry\(\)/);

console.log('commit before sync: ok');
