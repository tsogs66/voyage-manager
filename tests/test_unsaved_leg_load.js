#!/usr/bin/env node
/*
 * Loading a voyage leg from the library must warn when the current working
 * leg is not yet in voyageLegs, with Save / Load without saving / Cancel.
 * Run: node tests/test_unsaved_leg_load.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nUnsaved voyage-leg load warning');
check('unsaved-leg overlay markup exists',
  HTML.includes('id="unsavedLegOverlay"')
  && HTML.includes('id="unsavedLegSave"')
  && HTML.includes('id="unsavedLegDiscard"')
  && HTML.includes('id="unsavedLegCancel"')
  && HTML.includes('Save, then load')
  && HTML.includes('Load without saving'));
check('load paths go through loadSelectedVoyageLeg',
  /btnLoadVoyageLeg[\s\S]{0,280}loadSelectedVoyageLeg\(vn, cond, \{ successAlert: true \}\)/.test(HTML)
  && /voyage-leg-load[\s\S]{0,400}loadSelectedVoyageLeg\(vn, cond, \{ goSummary: true \}\)/.test(HTML)
  && !/btnLoadVoyageLeg[\s\S]{0,600}await activateVoyageLeg\(state\.activeVesselId/.test(HTML));
check('warns when current identity is missing from voyageLegs',
  HTML.includes('function currentVoyageLegIsInLibrary')
  && HTML.includes('async function confirmUnsavedVoyageLegBeforeLoad')
  && /is not saved in the voyage library/.test(HTML));
check('Save archives the working leg before load',
  HTML.includes('async function saveActiveVoyageLegFromLoadWarning')
  && /choice === 'save'[\s\S]{0,180}saveActiveVoyageLegFromLoadWarning/.test(HTML)
  && /saveActiveVoyageLegFromLoadWarning[\s\S]{0,400}archiveActiveVoyageLeg/.test(HTML));
check('Load without saving skips archive of the current vessel',
  /choice !== 'discard'/.test(HTML)
  && /persistCurrent: persistSource/.test(HTML)
  && /persistCurrent: persistTarget/.test(HTML)
  && /opts\.persistCurrent !== false/.test(HTML));
check('activateVoyageLeg honours persistCurrent:false',
  /async function activateVoyageLeg\(vesselId, voyageNumber, condition, opts\)/.test(HTML)
  && /const persistCurrent = !opts \|\| opts\.persistCurrent !== false/.test(HTML));
check('switchVessel honours persistCurrent so a vessel hop cannot silent-save',
  /async function switchVessel\(vesselId, opts\)/.test(HTML)
  && /switchVessel\(scopeVid, \{ persistCurrent: persistSource \}\)/.test(HTML));
check('library hint mentions the unsaved warning',
  /Loading another leg warns if the current one is not yet in this library/.test(HTML));

if (failures) {
  console.log(`\n${failures}/${checks} failed`);
  process.exit(1);
}
console.log(`\n${checks} checks passed`);
