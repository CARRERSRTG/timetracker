'use strict';
// Generates the source art for @capacitor/assets (into web/assets/): the app
// icon (adaptive foreground/background + legacy) and the splash screens, matching
// the desktop app's identity — a rounded brand-blue tile with a white clock.
// Dependency-free PNG encoding (Node zlib only). Run: node scripts/make-android-assets.js
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const BLUE = [79, 124, 255];    // #4f7cff brand accent
const WHITE = [255, 255, 255];
const HAND = [16, 22, 38];      // dark navy clock hands
const NAVY = [15, 20, 32];      // #0f1420 dark splash ground
const LIGHT = [244, 246, 251];  // #f4f6fb light splash ground

function canvas(n) { return { n, px: new Uint8Array(n * n * 4) }; }
function set(c, x, y, rgb, a = 255) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n) return;
  const i = (y * c.n + x) * 4; c.px[i] = rgb[0]; c.px[i + 1] = rgb[1]; c.px[i + 2] = rgb[2]; c.px[i + 3] = a;
}
function fill(c, rgb) { for (let y = 0; y < c.n; y++) for (let x = 0; x < c.n; x++) set(c, x, y, rgb); }
function disk(c, cx, cy, r, rgb) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r2) set(c, x, y, rgb);
    }
}
function line(c, x0, y0, x1, y1, w, rgb) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) { const t = s / steps; disk(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, rgb); }
}
function roundedTile(c, cx, cy, size, r, rgb) {
  const half = size / 2, x0 = cx - half, y0 = cy - half;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(r - x, x - (size - 1 - r), 0), dy = Math.max(r - y, y - (size - 1 - r), 0);
    if (dx * dx + dy * dy <= r * r) set(c, Math.round(x0 + x), Math.round(y0 + y), rgb);
  }
}
// white clock face + hands centered at (cx,cy) with face radius r
function clock(c, cx, cy, r, faceRgb) {
  disk(c, cx, cy, r, faceRgb);
  const w = Math.max(1, r * 0.085);
  line(c, cx, cy, cx, cy - r * 0.72, w, HAND);            // minute → 12
  line(c, cx, cy, cx + r * 0.46, cy + r * 0.26, w, HAND); // hour → ~4-5
  disk(c, cx, cy, Math.max(1, r * 0.1), HAND);            // center pin
}

// --- PNG encoder ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function toPNG(c) {
  const n = c.n, raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) { raw[y * (n * 4 + 1)] = 0; c.px.subarray(y * n * 4, (y + 1) * n * 4).forEach((v, i) => { raw[y * (n * 4 + 1) + 1 + i] = v; }); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, c) => { fs.writeFileSync(path.join(OUT, name), toPNG(c)); console.log('wrote assets/' + name, c.n + 'px'); };

// icon foreground (transparent): white clock in the adaptive safe zone (~inner 66%)
let c = canvas(1024); clock(c, 512, 512, 512 * 0.30, WHITE); write('icon-foreground.png', c);
// icon background: solid brand blue
c = canvas(1024); fill(c, BLUE); write('icon-background.png', c);
// legacy icon: blue ground + white clock
c = canvas(1024); fill(c, BLUE); clock(c, 512, 512, 512 * 0.34, WHITE); write('icon-only.png', c);
// splash (light) + splash-dark: centered rounded blue tile with a white clock
function splash(ground) { const n = 2732, cx = n / 2, cy = n / 2, tile = 760; const cc = canvas(n); fill(cc, ground); roundedTile(cc, cx, cy, tile, tile * 0.22, BLUE); clock(cc, cx, cy, tile * 0.34, WHITE); return cc; }
write('splash.png', splash(LIGHT));
write('splash-dark.png', splash(NAVY));
