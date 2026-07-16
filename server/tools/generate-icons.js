#!/usr/bin/env node
/*
 * Generates the PWA icons (PNG) used by manifest.webmanifest, with no
 * external dependencies (raw pixel buffer -> zlib -> PNG). Draws a simple
 * nautical gauge: dark navy field, brass bezel ring, teal arc and a needle.
 * Re-run after tweaking if you want different artwork:  node generate-icons.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tp = Buffer.from(type, 'ascii');
  const body = Buffer.concat([tp, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function mix(a, b, t) { return Math.round(a + (b - a) * t); }
function set(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= buf.length) return;
  const ia = a / 255;
  buf[i]   = mix(buf[i], r, ia);
  buf[i+1] = mix(buf[i+1], g, ia);
  buf[i+2] = mix(buf[i+2], b, ia);
  buf[i+3] = Math.max(buf[i+3], a);
}

function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const pad = maskable ? size * 0.02 : size * 0.06;
  const R = size / 2 - pad;                 // outer dial
  const ringOuter = R, ringInner = R - size * 0.09;
  const arcR = R - size * 0.20;
  const needleLen = R - size * 0.28;
  const start = -225 * Math.PI / 180, end = 45 * Math.PI / 180; // 270deg sweep
  const needleAng = start + (end - start) * 0.62;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      // rounded-square navy background field
      set(buf, size, x, y, 10, 20, 32, 255);
      if (d <= ringOuter) {
        // dial face gradient (panel colours)
        const t = d / ringOuter;
        set(buf, size, x, y, mix(18, 14, t), mix(34, 28, t), mix(56, 48, t), 255);
      }
      // brass bezel ring
      if (d <= ringOuter && d >= ringInner) set(buf, size, x, y, 201, 154, 83, 255);
      // teal value arc
      let ang = Math.atan2(dy, dx);
      // normalise angle onto the sweep
      let a2 = ang; if (a2 < start) a2 += Math.PI * 2;
      const within = a2 >= start && a2 <= (needleAng);
      if (Math.abs(d - arcR) <= size * 0.028 && within) set(buf, size, x, y, 87, 179, 171, 255);
    }
  }
  // needle
  for (let s = 0; s <= needleLen; s += 0.5) {
    const nx = cx + Math.cos(needleAng) * s;
    const ny = cy + Math.sin(needleAng) * s;
    for (let ox = -Math.round(size*0.012); ox <= Math.round(size*0.012); ox++)
      for (let oy = -Math.round(size*0.012); oy <= Math.round(size*0.012); oy++)
        set(buf, size, Math.round(nx)+ox, Math.round(ny)+oy, 233, 228, 214, 255);
  }
  // hub
  const hubR = size * 0.05;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
      if (d <= hubR) set(buf, size, x, y, 201, 154, 83, 255);
    }
  return encodePNG(size, size, buf);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
];
targets.forEach(([name, size, maskable]) => {
  fs.writeFileSync(path.join(OUT_DIR, name), draw(size, maskable));
  console.log('wrote', path.join(OUT_DIR, name));
});
