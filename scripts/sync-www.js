#!/usr/bin/env node
/**
 * Copy the live web app into www/ for Capacitor / Android Studio builds.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(www);
fs.mkdirSync(www, { recursive: true });

/* One list, shared with the portable zip and the Windows installer, so a file added
   to the app cannot reach one package and miss another. */
const assets = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-assets.json'), 'utf8'));

assets.files.forEach(f => copyFile(path.join(root, f), path.join(www, f)));
assets.dirs.forEach(d => copyDir(path.join(root, d), path.join(www, d)));
/* Capacitor loads index.html; the app is also reachable under its own name so a
   link or bookmark written against the web build still resolves inside the APK. */
copyFile(path.join(root, 'voyage_manager.html'), path.join(www, 'index.html'));

console.log(`www/ synced for Android build — ${assets.files.length + 1} files, ${assets.dirs.length} folder(s)`);
