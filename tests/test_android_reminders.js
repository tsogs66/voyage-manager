/*
 * Android: the committed project has the alarm classes, the manifest lets them
 * ring and survive a reboot, and the Java compiles when an android.jar is at
 * hand (ANDROID_JAR=... to opt in).
 *
 * Run: node tests/test_android_reminders.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'android/app/src/main/java/com/noonreport/voyagemanager');
let fails = 0, checks = 0;
function check(label, ok) {
  checks += 1;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}`);
  if (!ok) fails += 1;
}
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');

for (const f of ['ReminderScheduler', 'ReminderReceiver', 'ReminderBootReceiver', 'ReminderBridge']) {
  check(f + '.java exists', fs.existsSync(path.join(dir, f + '.java')));
}
check('the page can reach the bridge as ChengAndroidReminders', /addJavascriptInterface\(new ReminderBridge\(this\), "ChengAndroidReminders"\)/.test(read('MainActivity.java')));
check('alarms go to the system clock', /setAlarmClock/.test(read('ReminderScheduler.java')));
check('a note\'s event is written straight into the calendar', /upsertCalendarEvent/.test(read('ReminderBridge.java')) && /cr\.insert\(CalendarContract\.Events\.CONTENT_URI/.test(read('ReminderBridge.java')));
check('an edit updates that same event, remembered by the note id', /cr\.update\(ContentUris\.withAppendedId/.test(read('ReminderBridge.java')) && /prefs\.getLong\(noteId/.test(read('ReminderBridge.java')));
check('it is removed when the note is deleted', /removeCalendarEvent/.test(read('ReminderBridge.java')));
check('the calendar\'s own event screen stays as the fallback', /ACTION_INSERT/.test(read('ReminderBridge.java')));
check('calendar access is declared', /android\.permission\.READ_CALENDAR/.test(manifest) && /android\.permission\.WRITE_CALENDAR/.test(manifest));
for (const perm of ['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED']) {
  check(perm + ' is requested', manifest.includes('android.permission.' + perm));
}
check('the alarm receiver is registered, and private', /<receiver android:name="\.ReminderReceiver" android:exported="false"/.test(manifest));
check('the boot receiver restores alarms after a reboot and an update', /BOOT_COMPLETED/.test(manifest) && /MY_PACKAGE_REPLACED/.test(manifest));
check('the calendar app stays visible on Android 11+', /android\.intent\.action\.INSERT/.test(manifest));
const gen = require('../scripts/android-reminders-java');
for (const [name, text] of Object.entries(gen.files)) {
  check(name + ' matches what the generator writes', read(name) === text);
}

const jar = process.env.ANDROID_JAR;
if (jar && fs.existsSync(jar)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-android-'));
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const holder = path.join(tmp, 'MainActivity.java');
  fs.writeFileSync(holder, 'package com.noonreport.voyagemanager; public class MainActivity extends android.app.Activity {}');
  let ok = true;
  try {
    execFileSync('javac', ['-d', out, '-cp', jar, holder, ...['ReminderScheduler', 'ReminderReceiver', 'ReminderBootReceiver', 'ReminderBridge'].map((f) => path.join(dir, f + '.java'))], { stdio: 'pipe' });
  } catch (e) { ok = false; console.log(String(e.stderr || e.message).slice(0, 800)); }
  check('compiles against the Android platform classes', ok);
  fs.rmSync(tmp, { recursive: true, force: true });
} else {
  console.log('  skip compile (set ANDROID_JAR to an android-all jar)');
}
console.log(fails ? `\nFAILED - ${fails} of ${checks} checks` : `\nPASSED - ${checks} checks`);
process.exit(fails ? 1 : 0);
