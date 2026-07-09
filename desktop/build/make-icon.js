'use strict';
// Generates desktop/build/icon.ico — a dependency-free placeholder app icon:
// a rounded brand-blue tile with a white clock face and two hands. Swap in real
// branding by replacing icon.ico (or editing the colors/marks below and re-running
// `node desktop/build/make-icon.js`). Uses only Node built-ins (zlib).
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const BG = [79, 124, 255];    // brand accent #4f7cff
const FACE = [255, 255, 255]; // clock face
const HAND = [16, 22, 38];    // dark navy hands
const SIZES = [16, 32, 48, 64, 128, 256];

// --- tiny raster helpers -------------------------------------------------
function makeCanvas(n) { return { n, px: new Uint8Array(n * n * 4) }; }
function set(c, x, y, rgb, a = 255) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n) return;
  const i = (y * c.n + x) * 4;
  c.px[i] = rgb[0]; c.px[i + 1] = rgb[1]; c.px[i + 2] = rgb[2]; c.px[i + 3] = a;
}
function disk(c, cx, cy, r, rgb) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) set(c, x, y, rgb);
    }
}
function thickLine(c, x0, y0, x1, y1, w, rgb) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disk(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, rgb);
  }
}
function roundedTile(c, rgb) {
  const n = c.n, r = n * 0.22;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // distance into the rounded-rect corners
      const dx = Math.max(r - x, x - (n - 1 - r), 0);
      const dy = Math.max(r - y, y - (n - 1 - r), 0);
      if (dx * dx + dy * dy <= r * r) set(c, x, y, rgb);
    }
}

function drawIcon(n) {
  const c = makeCanvas(n);
  roundedTile(c, BG);
  const cx = n / 2, cy = n / 2;
  disk(c, cx, cy, n * 0.34, FACE);              // clock face
  const hw = Math.max(1, n * 0.028);            // hand width
  thickLine(c, cx, cy, cx, cy - n * 0.24, hw, HAND);          // minute hand → 12
  thickLine(c, cx, cy, cx + n * 0.15, cy + n * 0.08, hw, HAND); // hour hand → ~4-5
  disk(c, cx, cy, Math.max(1, n * 0.035), HAND); // center pin
  return c;
}

// --- PNG encoder ---------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function toPNG(c) {
  const n = c.n;
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0; // filter: none
    c.px.subarray(y * n * 4, (y + 1) * n * 4).forEach((v, i) => { raw[y * (n * 4 + 1) + 1 + i] = v; });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- ICO packer (PNG-embedded entries) -----------------------------------
function toICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = []; let offset = 6 + pngs.length * 16;
  for (const { n, buf } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

const pngs = SIZES.map((n) => ({ n, buf: toPNG(drawIcon(n)) }));
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, toICO(pngs));
console.log('wrote', out, '(' + fs.statSync(out).size + ' bytes,', SIZES.join('/') + 'px)');
