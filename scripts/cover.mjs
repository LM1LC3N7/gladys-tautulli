// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark gradient, a screen
// with a play sign, and an activity chart with a bandwidth line beside it.
// Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [14, 16, 24];
const SLATE = [36, 44, 62];
const WHITE = [236, 240, 246];
const AMBER = [240, 170, 40];
const TEAL = [40, 190, 170];
const SCREEN = [24, 28, 40];

/** Distance from a point to a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance to a triangle (negative inside). */
function triangle(x, y, [a, b, c]) {
  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ];
  let inside = true;
  let distance = Infinity;
  for (const [[x0, y0], [x1, y1]] of edges) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
    if (dx * (y - y0) - dy * (x - x0) > 0) inside = false;
  }
  return inside ? -distance : distance;
}

const PLAY = [
  [215, 185],
  [215, 335],
  [345, 260],
];
const BARS = [70, 120, 95, 160, 135, 190, 150];
const LINE = [
  [470, 330],
  [520, 290],
  [570, 310],
  [620, 230],
  [670, 250],
  [720, 170],
];

function segment(x, y, [x0, y0], [x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

function pixel(x, y) {
  let color = mix(DARK, SLATE, (x / WIDTH) * 0.4 + (y / HEIGHT) * 0.6);
  // The screen and its stand.
  const screen = roundedBox(x, y, 260, 260, 170, 115, 14);
  color = mix(color, WHITE, smooth(0, Math.abs(screen) - 3) * 0.85);
  color = mix(color, SCREEN, smooth(0, screen + 3));
  color = mix(color, WHITE, smooth(0, roundedBox(x, y, 260, 400, 60, 6, 3)) * 0.85);
  color = mix(color, WHITE, smooth(0, roundedBox(x, y, 260, 385, 8, 12, 2)) * 0.85);
  // The play sign.
  color = mix(color, AMBER, smooth(0, triangle(x, y, PLAY)));
  // The activity bars.
  for (const [i, h] of BARS.entries()) {
    const cx = 470 + i * 42;
    color = mix(color, TEAL, smooth(0, roundedBox(x, y, cx, 400 - h / 2, 14, h / 2, 4)) * 0.9);
  }
  // The bandwidth line and its points.
  for (let i = 0; i < LINE.length - 1; i += 1) {
    color = mix(color, AMBER, smooth(3, segment(x, y, LINE[i], LINE[i + 1])));
  }
  for (const [px, py] of LINE) color = mix(color, WHITE, smooth(6, Math.hypot(x - px, y - py)));
  // Base line of the chart.
  color = mix(color, WHITE, smooth(0, roundedBox(x, y, 596, 403, 150, 2, 1)) * 0.6);
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
