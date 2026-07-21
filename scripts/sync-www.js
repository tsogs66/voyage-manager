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

copyFile(path.join(root, 'voyage_manager.html'), path.join(www, 'index.html'));
copyFile(path.join(root, 'voyage_manager.html'), path.join(www, 'voyage_manager.html'));
copyFile(path.join(root, 'sw.js'), path.join(www, 'sw.js'));
copyFile(path.join(root, 'manifest.webmanifest'), path.join(www, 'manifest.webmanifest'));
copyDir(path.join(root, 'icons'), path.join(www, 'icons'));

console.log('www/ synced for Android build');
