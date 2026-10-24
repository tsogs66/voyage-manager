/*
 * e-ORB tamper evidence.
 *
 * The question this answers is a port-state inspector's: how do I know this
 * page was not edited after it was signed? So the tests are written as the
 * attacks, not as the happy path:
 *
 *   - edit an old line            -> the chain breaks AT that line
 *   - insert a line in the middle -> breaks at the line that now follows it
 *   - delete a line               -> breaks at the next one
 *   - reorder two lines           -> breaks
 *   - edit after signing          -> the signature reads "edited", not intact
 *
 * And two things that must NOT be reported as tampering, because crying wolf
 * about them makes the whole mechanism useless: a book from before this
 * existed, and bookkeeping fields (sync stamps, device ids) changing.
 *
 * Run: node tests/test_orb_integrity.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EORB = require(path.join(__dirname, '..', 'eorb.js')) || global.EORB;
const E = global.EORB || EORB;
const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

/* The same shape the app supplies: algorithm-tagged hex. */
const digest = async (text) =>
  'sha256:' + crypto.createHash('sha256').update(String(text)).digest('hex');

function book() {
  return [
    { id: 'e1', date: '2026-03-01', code: 'C', itemNo: '11', quantity: 3.2, position: '51 00 N 001 00 E', officerName: 'A. Officer' },
    { id: 'e2', date: '2026-03-02', code: 'D', itemNo: '14', quantity: 1.1, position: '51 10 N 001 10 E', officerName: 'A. Officer' },
    { id: 'e3', date: '2026-03-03', code: 'I', itemNo: '25', remarks: 'weekly sludge inventory', officerName: 'A. Officer' },
    { id: 'e4', date: '2026-03-05', code: 'C', itemNo: '12', quantity: 0.8, position: '52 00 N 002 00 E', officerName: 'B. Officer' }
  ];
}

(async () => {
  /* ---- a sealed book verifies ------------------------------------------ */
  const sealed = await E.rebuildOrbChain(book(), digest);
  check('every entry gets a content digest', sealed.every(e => !!e.contentHash), true);
  check('every entry gets a chain digest', sealed.every(e => !!e.chainHash), true);
  check('the first entry follows nothing', sealed[0].prevHash, '');
  check('each entry follows the one before it',
    sealed.slice(1).every((e, i) => e.prevHash === sealed[i].chainHash), true);

  const good = await E.verifyOrbChain(sealed, digest);
  check('a sealed book verifies', { ok: good.ok, complete: good.complete, checked: good.checked },
    { ok: true, complete: true, checked: 4 });
  check('and reports a head digest to quote', typeof good.headHash === 'string' && good.headHash.length > 10, true);

  /* Sealing does not mutate the caller's entries. */
  const original = book();
  await E.rebuildOrbChain(original, digest);
  check('sealing does not mutate the input', original.every(e => e.contentHash === undefined), true);

  /* Re-sealing an unchanged book is stable — otherwise every save would
     rewrite every row and the chain would mean nothing. */
  const again = await E.rebuildOrbChain(sealed, digest);
  check('resealing an unchanged book changes nothing',
    again.map(e => e.chainHash), sealed.map(e => e.chainHash));

  /* ---- the attacks ----------------------------------------------------- */

  /* Edit a quantity three entries back. */
  const edited = JSON.parse(JSON.stringify(sealed));
  edited[1].quantity = 9.9;
  const v1 = await E.verifyOrbChain(edited, digest);
  check('editing an old line fails', v1.ok, false);
  check('and points at that very line', v1.brokenAt.id, 'e2');
  check('and says the contents no longer match', /no longer match the digest/.test(v1.reason), true);
  check('and reports how many verified before it', v1.checked, 1);

  /* Change who signed it — that is record content too. */
  const reassigned = JSON.parse(JSON.stringify(sealed));
  reassigned[2].officerName = 'Someone Else';
  check('changing the officer named fails', (await E.verifyOrbChain(reassigned, digest)).ok, false);

  /* Un-void a struck line. */
  const unvoided = await E.rebuildOrbChain(
    book().map((e, i) => (i === 1 ? Object.assign({}, e, { voided: true, voidReason: 'wrong tank' }) : e)), digest);
  const tampered = JSON.parse(JSON.stringify(unvoided));
  tampered[1].voided = false;
  delete tampered[1].voidReason;
  check('un-voiding a struck line fails', (await E.verifyOrbChain(tampered, digest)).ok, false);

  /* Insert a line in the middle. */
  const insertedList = sealed.slice();
  insertedList.splice(2, 0, Object.assign({}, sealed[1], { id: 'x1', date: '2026-03-02', quantity: 7 }));
  const v2 = await E.verifyOrbChain(insertedList, digest);
  check('inserting a line fails', v2.ok, false);
  check('and names a line that does not follow its predecessor',
    /does not follow the one before it/.test(v2.reason) || /no longer match/.test(v2.reason), true);

  /* Remove a line. */
  const removed = sealed.filter(e => e.id !== 'e2');
  const v3 = await E.verifyOrbChain(removed, digest);
  check('removing a line fails', v3.ok, false);
  check('and breaks at the line that followed it', v3.brokenAt.id, 'e3');

  /* Reorder two lines by swapping their dates — book order then differs from
     the order they were sealed in. */
  const reordered = JSON.parse(JSON.stringify(sealed));
  reordered[1].date = '2026-03-04';
  check('reordering fails', (await E.verifyOrbChain(reordered, digest)).ok, false);

  /* ---- what must NOT be called tampering ------------------------------- */

  /* Bookkeeping is not the record. Sync stamps and device ids change every
     time a row moves between devices; if they were hashed, a book would read
     as tampered with after every sync. */
  const synced = JSON.parse(JSON.stringify(sealed));
  synced.forEach(e => {
    e.updatedAt = '2030-01-01T00:00:00Z';
    e.recordTs = 12345;
    e.vesselId = 'other-vessel';
    e.deviceId = 'dev-999';
    e.syncedAt = '2030-01-01T00:00:00Z';
  });
  const v4 = await E.verifyOrbChain(synced, digest);
  check('syncing a book does not make it read as tampered with', v4.ok, true);
  check('and it still verifies completely', v4.complete, true);

  /* A book written before any of this existed. */
  const legacy = await E.verifyOrbChain(book(), digest);
  check('an unsealed book is not called broken', legacy.ok, true);
  check('but is reported as not fully checked', legacy.complete, false);
  check('and says which entry it stopped at', legacy.firstUnchained.id, 'e1');

  /* A book sealed only part-way through — older paper-era lines imported
     alongside new sealed ones. */
  const partial = book().concat([]);
  const mixed = (await E.rebuildOrbChain(partial, digest)).slice();
  delete mixed[0].contentHash;
  delete mixed[0].chainHash;
  const v5 = await E.verifyOrbChain(mixed, digest);
  check('a partly sealed book is not called broken', v5.ok, true);
  check('and stops at the unsealed line', v5.complete, false);

  check('an empty book verifies trivially',
    { ok: (await E.verifyOrbChain([], digest)).ok, checked: (await E.verifyOrbChain([], digest)).checked },
    { ok: true, checked: 0 });

  /* ---- a signature that is bound to what it signed --------------------- */
  const entry = book()[0];
  check('an unsigned entry says so', await E.orbSignatureState(entry, digest), 'unsigned');

  const signed = await E.signOrbEntry(entry, { name: 'A. Officer', rank: 'C/E' }, digest);
  check('signing records what was signed', !!signed.signature.signedContentHash, true);
  check('a freshly signed entry is intact', await E.orbSignatureState(signed, digest), 'intact');

  const changedAfter = Object.assign({}, signed, { quantity: 99 });
  check('an entry edited after signing reads as edited',
    await E.orbSignatureState(changedAfter, digest), 'edited');

  /* The case that must not read as intact: an old signature with no hash bound
     to it. Claiming "intact" there would vouch for something never checked. */
  const oldSig = Object.assign({}, entry, { signature: { name: 'A. Officer', signedAt: '2026-01-01T00:00:00Z' } });
  check('a signature from before the hash was bound is unknown, not intact',
    await E.orbSignatureState(oldSig, digest), 'unknown');

  /* ---- a void and its correction are a pair ---------------------------- */
  const voided = Object.assign({}, book()[1], { voided: true, voidReason: 'wrong tank' });
  const replacement = Object.assign({}, book()[1], { id: 'e2b', quantity: 1.4 });
  const pair = E.linkOrbVoidReplacement(voided, replacement);
  check('the voided line names its replacement', pair.voided.voidedByEntryId, 'e2b');
  check('and the replacement names what it replaces', pair.replacement.replacesEntryId, 'e2');
  check('the link is sealed with the record',
    E.ORB_CONTENT_FIELDS.includes('replacesEntryId') && E.ORB_CONTENT_FIELDS.includes('voidedByEntryId'), true);

  /* So breaking the link is tampering, not bookkeeping. */
  const linked = await E.rebuildOrbChain([pair.voided, pair.replacement], digest);
  const unlinked = JSON.parse(JSON.stringify(linked));
  delete unlinked[0].voidedByEntryId;
  check('removing the link to a correction fails verification',
    (await E.verifyOrbChain(unlinked, digest)).ok, false);

  /* ---- the canonical form ---------------------------------------------- */
  check('key order does not change the digest',
    E.orbCanonicalContent({ code: 'C', date: '2026-03-01' }),
    E.orbCanonicalContent({ date: '2026-03-01', code: 'C' }));
  check('nested key order does not either',
    E.orbCanonicalContent({ values: { b: 1, a: 2 } }),
    E.orbCanonicalContent({ values: { a: 2, b: 1 } }));
  check('an absent field and an undefined one hash alike',
    E.orbCanonicalContent({ code: 'C' }), E.orbCanonicalContent({ code: 'C', quantity: undefined }));

  /* ---- a legitimate sync must not read as tampering -------------------- */
  /* Two devices each seal their own book. A pull or two-way sync interleaves
     them by date, so an incoming entry dated between two existing ones lands
     mid-order and every line after it follows a different predecessor. The
     chain breaks on a book nobody touched.

     Unhandled, that means every multi-device ship is told its record book was
     tampered with the first time it syncs -- and a warning that fires on
     normal operation gets ignored, which takes the real warning with it. */
  const deviceA = [
    { id: 'a1', date: '2026-03-01', code: 'C', itemNo: '11.3', values: { retention: 5 } },
    { id: 'a2', date: '2026-03-05', code: 'C', itemNo: '12.3', values: { qtyDisposed: 1 } }
  ];
  const deviceB = [{ id: 'b1', date: '2026-03-03', code: 'D', itemNo: '14', values: { qty: 2 } }];
  const sealedDeviceA = await E.rebuildOrbChain(deviceA, digest);
  const sealedDeviceB = await E.rebuildOrbChain(deviceB, digest);
  check('each device verifies on its own',
    [(await E.verifyOrbChain(sealedDeviceA, digest)).ok,
     (await E.verifyOrbChain(sealedDeviceB, digest)).ok], [true, true]);

  const justMerged = sealedDeviceA.concat(sealedDeviceB);
  check('straight after a merge the chain does not verify — this is why a reseal is needed',
    (await E.verifyOrbChain(justMerged, digest)).ok, false);

  const afterReseal = await E.rebuildOrbChain(justMerged, digest);
  const resealVerdict = await E.verifyOrbChain(afterReseal, digest);
  check('resealing makes a legitimately merged book verify',
    { ok: resealVerdict.ok, checked: resealVerdict.checked }, { ok: true, checked: 3 });

  /* And the whole point must survive the reseal. */
  const editedAfter = JSON.parse(JSON.stringify(afterReseal));
  editedAfter[1].values.qty = 999;
  const stillCaught = await E.verifyOrbChain(editedAfter, digest);
  check('an edit made after the reseal is still caught', stillCaught.ok, false);
  check('and still points at the line', stillCaught.brokenAt.id, 'b1');

  check('every path that brings entries in from elsewhere reseals',
    [/resealOrbChainAfterSync\('a backup was restored'\)/.test(HTML),
     /resealOrbChainAfterSync\('a backup was merged in'\)/.test(HTML),
     /await resealOrbChainAfterSync\(why\)/.test(HTML)], [true, true, true]);
  check('a pull sets the reseal flag',
    /_orbNeedsReseal = 'the active leg was pulled from the server'/.test(HTML), true);
  check('a server merge sets it too',
    /_orbNeedsReseal = 'entries were merged from the server'/.test(HTML), true);
  check('and it is consumed after the writes, not between them',
    /if \(_orbNeedsReseal\)\{[\s\S]{0,400}?resealOrbChainAfterSync\(why\)/.test(HTML), true);

  /* Honesty: once a sync has resealed, the claim is "unaltered since then",
     not "unaltered since written". */
  check('the reseal is recorded', /ORB_SEAL_MARKER_KEY = 'orbChainSeal'/.test(HTML), true);
  check('with whether it followed an external merge', /external: !!external/.test(HTML), true);
  check('and the line on screen narrows the claim',
    /Unaltered since \$\{seal\.reason\}/.test(HTML), true);
  check('as does the dialog',
    /this confirms the book is unaltered SINCE THEN/.test(HTML), true);
  check('and the reseal goes in the sync log so it is not invisible',
    /kind: 'e-ORB resealed'/.test(HTML), true);

  /* ---- wired into the app --------------------------------------------- */
  check('the app seals the book after an entry is saved',
    (HTML.match(/await resealOrbChain\(\);/g) || []).length >= 3, true);
  check('and after a line is voided',
    /resealOrbChain[\s\S]{0,200}?renderOrbBrowse\(\)/.test(HTML), true);
  check('the whole book is resealed, not just the new line',
    HTML.includes('It has to be the whole book, not just the new line'), true);
  check('only changed rows are written back',
    /if \(prev\.contentHash === next\.contentHash &&/.test(HTML), true);
  check('there is a verify button',
    HTML.includes('id="btnOrbVerify"'), true);
  check('verifying is stated to change nothing',
    /running it changes nothing/.test(HTML), true);
  check('a break is reported at the first failing line',
    /First line that fails/.test(HTML), true);
  check('the digest primitive is the host\'s, not a second copy',
    !/createHash|crypto\.subtle/.test(fs.readFileSync(path.join(__dirname, '..', 'eorb.js'), 'utf8')), true);

  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
