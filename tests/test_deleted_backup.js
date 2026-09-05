/* Deleted-entry local backup / restore wiring.
 * Run: node tests/test_deleted_backup.js
 */
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
console.log('\ndeleted entry backup');
check('idb version 7', HTML.includes("indexedDB.open('noonReportDB', 7)"), true);
check('deletedBackup store', HTML.includes("createObjectStore('deletedBackup'"), true);
check('backup on entry delete', HTML.includes('await backupDeletedRecord(') && HTML.includes("kind: 'entry'"), true);
check('backup on abstract delete', HTML.includes("kind:'abstract'") || HTML.includes('kind: \'abstract\''), true);
check('forget tombstone on undo', HTML.includes("forgetDeleted('entries', action.entry.id)"), true);
check('forget tombstone on restore', HTML.includes("forgetDeleted('entries', entry.id)"), true);
check('restore UI panel', HTML.includes('id="deletedBackupPanel"'), true);
check('in full DB backup list', HTML.includes("'deletedBackup']"), true);
check('data tab refreshes list', HTML.includes("pageName === 'data'") && HTML.includes('renderDeletedBackupList()'), true);
console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
