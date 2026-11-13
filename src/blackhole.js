// ASCII black hole — procedural renderer.
// The shadow and the light around it are ray traced: photon paths through
// the bent space are tabulated once, then every cell asks which parts of
// the disk its ray crosses. The gas turns with Kepler's law, so the inner
// edge races while the outer rim crawls, and the far side of the disk is
// bent up over the shadow. Every pixel of the picture is a character from
// a small ink ramp, drawn into an ImageData buffer.

const TAU = Math.PI * 2;
const CY = -0.115; // the hole sits a little below the middle
const RAMP = " .:-=+<~i!lI?][}{1)(tfjrxnuvcz*#%@";

const INK = [
  [10, 7, 4],
  [34, 22, 12],
  [58, 37, 20],
  [84, 54, 28],
  [112, 73, 38],
  [146, 98, 52],
  [172, 119, 65],
  [196, 139, 78],
  [216, 160, 96],
  [232, 182, 116],
  [242, 202, 142],
  [248, 219, 172],
  [253, 236, 204],
];

const COOL = [126, 126, 108];

// optics: distances in Schwarzschild radii, the camera level with the disk
const CAM = 30;
const DISK_IN = 3;
const DISK_OUT = 9;
const TILT = 0.15;
const BMAX = 10;
const NB = 1600;
const STEP = 0.022;
const B_CRIT = (3 * Math.sqrt(3)) / 2;

// gas: rings of noise whose harmonics close after LOOP seconds
const BANDS = 10;
const LOOP = 40;
const SPIN = 6;
const TAB = 256;

const SUB_X = 2;
const SUB_Y = 3;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lutFor(rgb) {
  const [r, g, b] = rgb;
  const lut = new Uint32Array(256);
  for (let a = 0; a < 256; a++) {
    const rr = (r * a) >> 8;
    const gg = (g * a) >> 8;
    const bb = (b * a) >> 8;
    lut[a] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
  }
  return lut;
}

// A ray stays in a plane through the hole, and its path there depends only
// on its impact parameter b. In that plane u = 1/r obeys u'' = 1.5u^2 - u
// in the angle swept from the camera; each path is stepped with RK4 until
// it falls in or leaves, and kept as u at every step.
let PATHS = null;
function paths() {
  if (PATHS) return PATHS;
  const f = (u) => 1.5 * u * u - u;
  const table = [];
  for (let n = 0; n < NB; n++) {
    const b = ((n + 0.5) / NB) * BMAX;
    let u = 1 / CAM;
    let w = Math.sqrt(Math.max(0, 1 - (b / CAM) ** 2)) / b;
    const us = [u];
    let guard = 0;
    while (u < 1 && (u > 1 / (DISK_OUT + 1) || w > 0) && guard++ < 4000) {
      const k1 = w;
      const l1 = f(u);
      const k2 = w + (STEP / 2) * l1;
      const l2 = f(u + (STEP / 2) * k1);
      const k3 = w + (STEP / 2) * l2;
      const l3 = f(u + (STEP / 2) * k2);
      const k4 = w + STEP * l3;
      const l4 = f(u + STEP * k3);
      u += (STEP / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      w += (STEP / 6) * (l1 + 2 * l2 + 2 * l3 + l4);
      us.push(u);
    }
    table.push(Float32Array.from(us));
  }
  PATHS = table;
  return table;
}

// Each band's gas is a ring of noise: a few whole harmonics, so it closes.
let BAND_DATA = null;
function bandData() {
  if (BAND_DATA) return BAND_DATA;
  const rand = mulberry32(17);
  const out = [];
  for (let b = 0; b < BANDS; b++) {
    const r = DISK_IN + ((DISK_OUT - DISK_IN) * b) / (BANDS - 1);
    const turns = Math.max(1, Math.round(SPIN * (DISK_IN / r) ** 1.5));
    const waves = [2, 3, 5, 8, 13].map((k) => [k, rand() * TAU, (0.5 + rand()) / Math.sqrt(k)]);
    const tab = new Float32Array(TAB);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < TAB; i++) {
      let v = 0;
      for (let j = 0; j < waves.length; j++) {
        const [k, p, a] = waves[j];
        v += a * Math.sin((k * TAU * i) / TAB + p);
      }
      tab[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // soft, so the thin band reads as wisps rather than static
    for (let i = 0; i < TAB; i++) tab[i] = 0.76 + (0.24 * (tab[i] - lo)) / (hi - lo);
    out.push({ tab, turns });
  }
  BAND_DATA = out;
  return out;
}

export class BlackHole {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.W = 0;
    this.H = 0;
    this.maskKey = "";
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (Math.abs(W - this.W) < 2 && Math.abs(H - this.H) < 2) return;

    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;

    // cell size, in device pixels
    const targetCols = Math.max(56, Math.min(118, Math.round(rect.width / 3.6)));
    this.cw = Math.max(5, Math.floor(W / targetCols));
    this.cols = Math.max(1, Math.floor(W / this.cw));
    this.ch = Math.max(8, Math.round(this.cw * 1.6));
    this.rows = Math.max(1, Math.floor(H / this.ch));
    this.ox = Math.floor((W - this.cols * this.cw) / 2);
    this.oy = Math.floor((H - this.rows * this.ch) / 2);

    this.R0 = 0.1 * (W / H);
    this.ux = new Float32Array(this.cols);
    this.vy = new Float32Array(this.rows);
    for (let c = 0; c < this.cols; c++) {
      this.ux[c] = (this.ox + (c + 0.5) * this.cw - W / 2) / H;
    }
    for (let r = 0; r < this.rows; r++) {
      this.vy[r] = 0.5 - (this.oy + (r + 0.5) * this.ch) / H;
    }

    this.img = this.ctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.buf.fill(0xff000000);

    this.buildMasks();
    this.buildStars();
    this.buildLens();
    this.ctx.putImageData(this.img, 0, 0);
  }

  buildMasks() {
    const key = this.cw + "x" + this.ch;
    if (key === this.maskKey) return;
    this.maskKey = key;

    const { cw, ch } = this;
    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const g = off.getContext("2d", { willReadFrequently: true });
    const size = Math.max(7, Math.round(ch * 0.99));
    g.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";

    this.chars = RAMP.split("");
    this.index = new Map();
    this.masks = [];

    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      this.index.set(c, i);
      g.clearRect(0, 0, cw, ch);
      if (c !== " ") {
        g.fillStyle = "#fff";
        // draw twice, a hair apart, so the cells fill like film grain
        g.fillText(c, cw / 2, ch / 2 + 0.2);
        g.fillText(c, cw / 2 + 0.5, ch / 2 + 0.6);
      }
      const data = g.getImageData(0, 0, cw, ch).data;
      const mask = new Uint8Array(cw * ch);
      for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3];
      this.masks.push(mask);
    }

    // ink tables: amber and olive, one lookup per alpha
    this.inks = [];
    for (let l = 0; l < INK.length; l++) {
      const warm = INK[l];
      const cool = [
        Math.round(warm[0] * 0.8 + COOL[0] * 0.2),
        Math.round(warm[1] * 0.82 + COOL[1] * 0.18),
        Math.round(warm[2] * 0.75 + COOL[2] * 0.25),
      ];
      this.inks.push([lutFor(warm), lutFor(cool)]);
    }

    // stars and dust
    this.starInks = [
      [lutFor([52, 52, 50]), lutFor([96, 95, 88]), lutFor([150, 147, 138]), lutFor([206, 202, 192])],
      [lutFor([76, 52, 30]), lutFor([118, 80, 44]), lutFor([156, 110, 62]), lutFor([192, 148, 94])],
    ];
  }

  buildStars() {
    const n = this.cols * this.rows;
    this.starB = new Float32Array(n);
    this.starTier = new Uint8Array(n);
    this.starPhase = new Float32Array(n);
    this.starSpeed = new Float32Array(n);
    this.starTint = new Uint8Array(n);

    let seed = 20261224;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const count = Math.round(n * 0.021);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rnd() * n);
      if (this.starB[idx] > 0) continue;
      const b = 0.06 + Math.pow(rnd(), 3.0) * 0.72;
      this.starB[idx] = b;
      this.starTier[idx] = b < 0.26 ? 0 : b < 0.5 ? 1 : 2;
      this.starPhase[idx] = rnd() * TAU;
      this.starSpeed[idx] = 0.25 + rnd() * 0.85;
      this.starTint[idx] = rnd() < 0.18 ? 1 : 0;
    }

    // a few drifting embers close to the disk
    this.embers = [];
    for (let i = 0; i < 42; i++) {
      this.embers.push({
        x: (rnd() - 0.5) * 1.1,
        y: (rnd() - 0.5) * 0.52,
        phase: rnd() * TAU,
        speed: 0.12 + rnd() * 0.3,
        drift: 0.004 + rnd() * 0.012,
        size: rnd() < 0.55 ? 0 : 1,
      });
    }
  }

  // ---- the lensed image ------------------------------------------------
  // For every subsample of every cell, find the angles at which its ray
  // crosses the disk, and keep the radius, azimuth and weight of each
  // crossing. This never changes with time, so it is done on resize only.
  buildLens() {
    const { cols, rows, cw, ch, H, R0, ux, vy } = this;
    this.S = B_CRIT / (CAM * R0);
    const S = this.S;
    const cT = Math.cos(TILT);
    const sT = Math.sin(TILT);
    const table = paths();
    const bands = bandData();
    const n = cols * rows;
    const cells = new Array(n);
    const hasDisk = new Uint8Array(n);
    const dxW = cw / H;
    const dyW = ch / H;

    for (let row = 0; row < rows; row++) {
      const wy = vy[row] - CY;
      for (let col = 0; col < cols; col++) {
        const wx = ux[col];
        const k = row * cols + col;
        let list = null;

        for (let syi = 0; syi < SUB_Y; syi++) {
          const y = wy + ((syi + 0.5) / SUB_Y - 0.5) * dyW;
          for (let sxi = 0; sxi < SUB_X; sxi++) {
            const x = wx + ((sxi + 0.5) / SUB_X - 0.5) * dxW;
            const px = x * S;
            const py = y * S;
            const len = Math.hypot(px, py, 1);
            const dx = px / len;
            const dy = (py * cT - sT) / len;
            const dz = (py * sT + cT) / len;
            const out = dy * sT - dz * cT;
            const side = Math.sqrt(Math.max(0, 1 - out * out));
            if (side < 1e-4) continue;
            const e2x = dx / side;
            const e2y = (dy - out * sT) / side;
            const e2z = (dz + out * cT) / side;

            const bi = Math.floor((CAM * side * NB) / BMAX);
            if (bi < 0 || bi >= NB) continue;
            const us = table[bi];

            // Images that wind more than once round the hole are thinner
            // than a cell, so they are left out of the sum.
            const end = Math.min((us.length - 1) * STEP, 5.6);
            let light = 1;
            for (let a = (Math.atan2(-sT, e2y) + TAU) % Math.PI; a < end; a += Math.PI) {
              const p = a / STEP;
              const q = Math.floor(p);
              if (q + 1 >= us.length) break;
              const r = 1 / (us[q] + (us[q + 1] - us[q]) * (p - q));
              if (!(r > DISK_IN && r < DISK_OUT)) continue;

              const phi = Math.atan2(
                Math.sin(a) * e2z - Math.cos(a) * cT,
                Math.sin(a) * e2x,
              );
              // bright and thin at the inner edge, gone by the outer one
              const edge =
                Math.min(1, (r - DISK_IN) / 0.7) *
                (DISK_IN / r) ** 1.15 *
                (1 - smooth((r - 4.3) / 4.7));
              const doppler = 1 - 0.18 * Math.cos(phi);
              const pos = ((r - DISK_IN) / (DISK_OUT - DISK_IN)) * (BANDS - 1);
              const b0 = Math.min(BANDS - 2, Math.floor(pos));
              if (!list) list = [];
              list.push(
                b0,
                pos - b0,
                phi,
                (light * edge * doppler * (DISK_IN / r) ** 1.5) / (SUB_X * SUB_Y),
              );
              hasDisk[k] = 1;
              light *= 0.3; // a crossing seen through the disk is dimmer
            }
          }
        }
        cells[k] = list;
      }
    }

    this.cells = cells;
    this.hasDisk = hasDisk;
    this.bands = bands;
    this.field = new Float32Array(n);
    this.shown = new Float32Array(n);
    this.smoothField = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.scratch = new Float32Array(n);
  }

  // The gas turns: each band sweeps its own azimuth, faster near the hole.
  sampleDisk(t) {
    const { cells, bands, field } = this;
    const turn = TAU * ((t % LOOP) / LOOP);

    for (let k = 0; k < field.length; k++) {
      const h = cells[k];
      if (!h) {
        field[k] = 0;
        continue;
      }
      let sum = 0;
      for (let i = 0; i < h.length; i += 4) {
        const b0 = h[i];
        const fr = h[i + 1];
        const phi = h[i + 2];
        const b1 = b0 + 1;
        const t0 = bands[b0];
        const t1 = bands[b1];

        let a0 = phi - t0.turns * turn;
        let i0 = Math.floor((a0 / TAU) * TAB) % TAB;
        if (i0 < 0) i0 += TAB;

        let a1 = phi - t1.turns * turn;
        let i1 = Math.floor((a1 / TAU) * TAB) % TAB;
        if (i1 < 0) i1 += TAB;

        const g0 = t0.tab[i0];
        sum += h[i + 3] * (g0 + (t1.tab[i1] - g0) * fr);
      }
      field[k] = sum;
    }
  }

  blur(src, dst, radius) {
    const { cols, rows, scratch } = this;
    const w = 1 / (radius * 2 + 1);
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let d = -radius; d <= radius; d++) {
          const cc = c + d;
          s += src[base + (cc < 0 ? 0 : cc >= cols ? cols - 1 : cc)];
        }
        scratch[base + c] = s * w;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let d = -radius; d <= radius; d++) {
          const rr = r + d;
          s += scratch[(rr < 0 ? 0 : rr >= rows ? rows - 1 : rr) * cols + c];
        }
        dst[r * cols + c] = s * w;
      }
    }
  }

  // a thin ring thrown outward, brightest as it leaves
  ripple(u, rr, reach, strength) {
    if (u < 0 || u > 1) return 0;
    const rad = 1.12 + (reach - 1.12) * Math.pow(u, 0.6);
    const w = 0.14 + 0.09 * u * u;
    const env = smooth(u * 8) * Math.pow(1 - u, 2.6);
    return Math.exp(-Math.pow((rr - rad) / w, 2)) * env * strength;
  }

  // the choreography: the circle that draws itself, the rim of the shadow,
  // the rings thrown outward as it catches
  atmosphere(x, y, t) {
    const R0 = this.R0;
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const rr = r / R0;
    let heat = 0;

    // 1. the first circle, drawn counter-clockwise out of nothing
    if (t < 5.2) {
      const sweep = smooth((t - 0.35) / 2.2) * TAU;
      if (sweep > 0) {
        let d = (ang - 1.05) % TAU;
        if (d < 0) d += TAU;
        if (d <= sweep) {
          const radius = R0 * (1.95 - 0.78 * smooth((t - 0.3) / 2.6));
          const width = 0.007 + 0.005 * smooth((t - 0.3) / 2.0);
          const band = Math.exp(-Math.pow((r - radius) / width, 2));
          const trail = 1 - 0.5 * (d / Math.max(sweep, 1e-3));
          const spark = 0.7 + 0.3 * Math.sin(ang * 41 - t * 7.5);
          heat += band * trail * spark * (1 - smooth((t - 3.4) / 1.4));
        }
      }
    }

    // 2. the rim of the shadow
    const ringOn = smooth((t - 2.6) / 1.1);
    if (ringOn > 0) {
      // one cell thick, so the ring survives being sampled at cell centres
      const rim = Math.exp(-Math.pow((rr - 1.03) / 0.05, 2)) * 1.45;
      const gloss = Math.exp(-Math.pow((rr - 1.12) / 0.07, 2)) * 0.28;
      heat += (rim + gloss) * ringOn;

      // a second, finer ring just outside the shadow
      heat += Math.exp(-Math.pow((rr - 1.2) / 0.06, 2)) * 0.45 * smooth((t - 4.4) / 2.0);
    }

    // 3. rings thrown outward as it catches
    heat += this.ripple((t - 2.95) / 1.45, rr, 4.6, 1.6);
    heat += this.ripple((t - 6.8) / 1.7, rr, 5.2, 1.0);
    if (t > 13.5) {
      const u = ((t - 13.5) % 9.5) / 2.6;
      heat += this.ripple(u, rr, 5.8, 0.5);
    }

    // the flash of the burst itself
    heat *= 1 + 0.22 * Math.exp(-Math.pow((t - 2.95) / 0.22, 2));
    return heat;
  }

  blit(index, lut, px, py, clear) {
    const { cw, ch, W, buf } = this;
    const mask = this.masks[index];
    for (let gy = 0; gy < ch; gy++) {
      const mrow = gy * cw;
      const base = (py + gy) * W + px;
      if (clear) {
        for (let gx = 0; gx < cw; gx++) buf[base + gx] = 0xff000000;
      }
      if (!mask) continue;
      for (let gx = 0; gx < cw; gx++) {
        const a = mask[mrow + gx];
        if (a) buf[base + gx] = lut[a];
      }
    }
  }

  draw(t) {
    const { cols, rows, cw, ch, ox, oy, buf, ux, vy, R0, field, shown, smoothField, glow } = this;
    buf.fill(0xff000000);

    // the disk catches over a few seconds, from the inside out
    const diskOn = smooth((t - 4.6) / 2.4);
    const grow = smooth((t - 4.7) / 2.7);
    const ignite = smooth((t - 5.0) / 1.5);
    const reach = 0.14 + 0.95 * grow;
    const glowOn = smooth((t - 5.2) / 2.2);
    const flash = 1 + 0.5 * Math.exp(-Math.pow((t - 6.3) / 0.7, 2));
    const breathe = 1 + 0.03 * Math.sin(t * 0.35);

    this.sampleDisk(t);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const k = row * cols + col;
        const x = ux[col];
        let v = field[k] * diskOn * ignite;
        if (v > 0) v *= smooth((reach - Math.abs(x)) / 0.15);
        shown[k] = v;
      }
    }
    // a little smoothing along the band, then a wide glow around it
    this.blur(shown, smoothField, 1);
    this.blur(smoothField, glow, 2);

    const shadowOn = smooth((t - 2.2) / 1.2);
    let letters = 0;

    for (let row = 0; row < rows; row++) {
      const y0 = vy[row] - CY;
      const py = oy + row * ch;

      for (let col = 0; col < cols; col++) {
        const x = ux[col];
        const y = y0;
        const idx = row * cols + col;
        const px = ox + col * cw;
        const r = Math.hypot(x, y);
        const k = idx;

        let heat = this.atmosphere(x, y, t);
        heat += smoothField[k] * 2.3 * flash * breathe;
        heat += glow[k] * 0.95 * glowOn;

        // roll the highlights off instead of clipping them flat
        heat = 1 - Math.exp(-1.6 * heat);
        if (r < R0 * 0.995) heat = 0;

        if (heat >= 0.03) {
          const grain = hash2(col * 1.7 + 0.3, row * 2.3 + 0.1);
          const scaled = Math.pow(clamp01(heat), 1 / 1.15);
          let level = Math.floor(scaled * (INK.length - 1) + grain * 0.35);
          if (level > INK.length - 1) level = INK.length - 1;
          if (level < 0) level = 0;

          const cool = hash2(col * 3.1 + 7, row * 5.7 + 3) < 0.12 ? 1 : 0;
          this.blit(this.glyphFor(level, grain), this.inks[level][cool], px, py, true);
          letters++;
          continue;
        }

        // stars sit behind the disk and vanish inside the shadow
        const b = this.starB[idx];
        if (b <= 0 || (r < R0 * 1.02 && shadowOn > 0.4)) continue;

        const twinkle = 0.52 + 0.48 * Math.sin(t * this.starSpeed[idx] + this.starPhase[idx]);
        const vis = b * twinkle;
        if (vis < 0.1) continue;

        const tier = vis < 0.26 ? 0 : vis < 0.48 ? 1 : this.starTier[idx] + 1;
        const lut = this.starInks[this.starTint[idx]][Math.min(tier, 3)];
        const glyph = vis < 0.26 ? 1 : vis < 0.5 ? 6 : this.index.get("*");
        this.blit(glyph, lut, px, py, false);
      }
    }

    // embers drifting through the frame
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      const ex = e.x + Math.sin(t * 0.12 + e.phase) * 0.02;
      const ey = e.y + ((t * e.drift + e.phase * 0.1) % 0.7) - 0.35;
      const col = Math.floor(((ex + this.W / (2 * this.H)) / (this.W / this.H)) * cols);
      const row = Math.floor((0.5 - ey) * rows);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      if (this.starB[row * cols + col] > 0) continue;
      const x = (ox + (col + 0.5) * cw - this.W / 2) / this.H;
      const y = 0.5 - (oy + (row + 0.5) * ch) / this.H - CY;
      if (Math.hypot(x, y) < R0 * 1.05) continue;
      if (this.field[row * cols + col] > 0.02) continue;
      const a = 0.35 + 0.4 * Math.sin(t * e.speed + e.phase);
      if (a < 0.12) continue;
      const lut = this.starInks[1][1];
      this.blit(this.index.get("."), lut, ox + col * cw, oy + row * ch, false);
    }

    this.ctx.putImageData(this.img, 0, 0);
    return letters;
  }

  glyphFor(level, grain) {
    // map ink level to the character ramp, with a little jitter
    const span = this.chars.length - 1;
    let idx = Math.round((level / (INK.length - 1)) * span);
    if (grain > 0.93) idx += 1;
    else if (grain < 0.07) idx -= 1;
    if (idx < 0) idx = 0;
    if (idx > span) idx = span;
    return idx;
  }
}
