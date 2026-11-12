// ASCII black hole — procedural renderer.
// A flat accretion disk seen nearly edge-on, a photon ring, and the
// lensed far side bent up over the shadow. Every pixel of the picture
// is a character from a small ink ramp, drawn into an ImageData buffer.

const TAU = Math.PI * 2;
const CY = -0.115; // the hole sits a little below the middle
const RAMP = " .:-=+<~i!lI?][}{1)(tfjrxnuvcz*#%@";

const INK = [
  [10, 7, 4],
  [32, 21, 12],
  [54, 35, 19],
  [78, 51, 27],
  [102, 67, 36],
  [136, 92, 50],
  [162, 112, 62],
  [188, 134, 76],
  [210, 156, 94],
  [226, 176, 112],
  [228, 184, 124],
  [238, 204, 148],
  [248, 226, 186],
];

const COOL = [126, 126, 108];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

function fbm(x, y) {
  return (
    0.6 * vnoise(x, y) +
    0.28 * vnoise(x * 2.3 + 11, y * 2.3 + 7) +
    0.12 * vnoise(x * 5.1 + 3, y * 5.1 + 9)
  );
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
    const targetCols = Math.max(56, Math.min(118, Math.round(rect.width / 3.75)));
    this.cw = Math.max(5, Math.floor(W / targetCols));
    this.cols = Math.max(1, Math.floor(W / this.cw));
    this.ch = Math.max(8, Math.round(this.cw * 1.62));
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
    const size = Math.max(7, Math.round(ch * 0.92));
    g.font = `600 ${Math.round(ch * 0.99)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
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
        g.fillText(c, cw / 2 + 0.3, ch / 2 + 0.4);
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

    // bright pixel mask used to clear a cell quickly
    this.clearRow = new Uint32Array(cw).fill(0xff000000);
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

    const count = Math.round(n * 0.015);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rnd() * n);
      if (this.starB[idx] > 0) continue;
      const b = 0.06 + Math.pow(rnd(), 3.0) * 0.68;
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

  shade(x, y, t) {
    const R0 = this.R0;
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);

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

    // 2. photon ring around the shadow
    const ringOn = smooth((t - 2.8) / 1.2);
    if (ringOn > 0) {
      const edge = Math.exp(-Math.pow((r - R0 * 1.03) / 0.0065, 2)) * 1.25;
      const glow = Math.exp(-Math.pow((r - R0 * 1.07) / 0.016, 2)) * 0.24;
      heat += (edge + glow) * ringOn;

      // a soft skirt of light around the ring while it settles
      const hug = Math.exp(-Math.pow((r - R0 * 1.17) / 0.035, 2)) * 0.55;
      const hugOn = smooth((t - 3.2) / 1.4) * (1 - smooth((t - 7.2) / 2.4));
      heat += hug * hugOn;
    }

    // 3. the disk itself
    const grow = smooth((t - 4.7) / 2.7);
    const ignite = smooth((t - 5.2) / 1.7);
    if (grow > 0 && ignite > 0) {
      const mid = 0.045 * x - 0.004;
      const yy = y - mid;
      const thick =
        0.055 +
        0.02 * Math.exp(-Math.pow(x / 0.28, 2)) -
        0.018 * Math.min(1, Math.abs(x) / 0.45);
      let band = Math.exp(-Math.pow(Math.abs(yy) / thick, 2.4));

      const reach = 0.1 + 0.86 * grow;
      band *= smooth((reach - Math.abs(x)) / 0.12);
      band *= 0.55 + 0.75 * Math.exp(-Math.pow((Math.abs(x) - 0.1) / 0.36, 2));

      const lanes = Math.sin((22 * yy) / thick + 2.1 * Math.sin(x * 9 - t * 0.45) - t * 0.55);
      band *= 0.88 + 0.14 * lanes;

      const dust = fbm(x * 11 + t * 0.06, yy * 46 - t * 0.1);
      band *= 0.68 + 0.5 * dust;
      band = Math.pow(band, 0.92);

      const flash = Math.exp(-Math.pow((t - 6.3) / 0.7, 2));
      const breathe = 1 + 0.03 * Math.sin(t * 0.35);
      heat += band * ignite * 1.0 * (1 + 1.05 * flash) * breathe;
    }

    // 4. the far side, bent up over the shadow
    const haloOn = smooth((t - 5.9) / 1.6);
    if (haloOn > 0) {
      const width = 0.038 + 0.006 * Math.min(2, Math.abs(x) / R0);
      let band = Math.exp(-Math.pow((r - R0 * 1.32) / width, 2));
      const up = smooth((y / R0 + 0.2) / 0.95);
      band *= 0.32 + 0.68 * up;
      band *= 0.68 + 0.32 * Math.sin(ang * 6 + t * 0.35);
      const flash = Math.exp(-Math.pow((t - 6.6) / 0.9, 2));
      heat += band * haloOn * 1.35 * (1 + 0.45 * flash);

      // light folded between the ring and the arch
      const fill = Math.exp(-Math.pow((r - R0 * 1.14) / 0.14, 2));
      const above = smooth((y / R0 + 0.6) / 1.4);
      const grain = 0.68 + 0.32 * Math.sin(ang * 9 - t * 0.5 + 1.3);
      heat += fill * above * grain * 0.42 * haloOn;
    }

    if (r < R0 * 0.995) heat = 0;

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
      for (let gx = 0; gx < cw; gx++) {
        const a = mask[mrow + gx];
        if (a) buf[base + gx] = lut[a];
      }
    }
  }

  draw(t) {
    const { W, H, cols, rows, cw, ch, ox, oy, buf, ux, vy, R0 } = this;
    buf.fill(0xff000000);

    const shadowOn = smooth((t - 2.2) / 1.2);
    let letters = 0;

    for (let row = 0; row < rows; row++) {
      const y0 = vy[row] - CY;
      const py = oy + row * ch;

      for (let col = 0; col < cols; col++) {
        const x = ux[col];
        const y = y0;
        const heat = this.shade(x, y, t);
        const idx = row * cols + col;
        const px = ox + col * cw;
        const r = Math.hypot(x, y);

        if (heat >= 0.018) {
          const grain = hash2(col * 1.7 + 0.3, row * 2.3 + 0.1);
          const scaled = Math.pow(clamp01(heat), 1 / 1.25);
          let level = Math.floor(scaled * (INK.length - 1) + grain * 0.9);
          if (level > INK.length - 1) level = INK.length - 1;
          if (level < 1) level = 1;

          const cool = hash2(col * 3.1 + 7, row * 5.7 + 3) < 0.16 ? 1 : 0;
          const lut = this.inks[level][cool];
          this.blit(this.glyphFor(level, grain), lut, px, py, true);
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
      const col = Math.floor(((ex + W / (2 * H)) / (W / H)) * cols);
      const row = Math.floor((0.5 - ey) * rows);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      if (this.starB[row * cols + col] > 0) continue;
      const x = (ox + (col + 0.5) * cw - W / 2) / H;
      const y = 0.5 - (oy + (row + 0.5) * ch) / H - CY;
      if (Math.hypot(x, y) < R0 * 1.05) continue;
      if (this.shade(x, y, t) > 0.02) continue;
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
    if (grain > 0.86) idx += 1;
    else if (grain < 0.12) idx -= 1;
    if (idx < 1) idx = 1;
    if (idx > span) idx = span;
    return idx;
  }
}
