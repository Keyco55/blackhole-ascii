// ASCII black hole — procedural renderer.
// A flat accretion disk seen nearly edge-on, a bright body of light
// wrapping the shadow, and the far side bent up over the top. Every
// pixel of the picture is a character from a small ink ramp, drawn
// into an ImageData buffer.

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

    const count = Math.round(n * 0.019);
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

  // a thin ring thrown outward, brightest as it leaves
  ripple(u, rr, reach, strength) {
    if (u < 0 || u > 1) return 0;
    const rad = 1.12 + (reach - 1.12) * Math.pow(u, 0.6);
    const w = 0.14 + 0.09 * u * u;
    const env = smooth(u * 8) * Math.pow(1 - u, 2.6);
    return Math.exp(-Math.pow((rr - rad) / w, 2)) * env * strength;
  }

  shade(x, y, t) {
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
      const rim = Math.exp(-Math.pow((rr - 1.02) / 0.014, 2)) * 1.15;
      const gloss = Math.exp(-Math.pow((rr - 1.1) / 0.05, 2)) * 0.3;
      heat += (rim + gloss) * ringOn;

      // a second, finer ring just outside the shadow
      heat += Math.exp(-Math.pow((rr - 1.19) / 0.035, 2)) * 0.55 * smooth((t - 4.4) / 2.0);

      const hug = Math.exp(-Math.pow((rr - 1.18) / 0.08, 2)) * 0.5;
      const hugOn = smooth((t - 3.2) / 1.4) * (1 - smooth((t - 7.2) / 2.4));
      heat += hug * hugOn;
    }

    // 3. the body of light wrapping the shadow
    const bodyOn = smooth((t - 4.8) / 2.6);
    if (bodyOn > 0) {
      const prof = Math.exp(-Math.pow((rr - 1.58) / 0.62, 2));
      const plane = Math.exp(-Math.pow(y / (R0 * 1.15), 2));
      const wide = 0.78 + 0.22 * plane;
      const swirl = 0.76 + 0.24 * Math.sin(ang * 3 - t * 0.3 + 0.8);
      const cloud = fbm(x * 5.5 + 2.3 + t * 0.03, y * 5.5 - 1.1);
      heat += prof * wide * swirl * (0.62 + 0.55 * cloud) * 1.15 * bodyOn;

      // the hot lip where the disk crosses in front
      const low = Math.max(0, -Math.sin(ang));
      heat += Math.exp(-Math.pow((rr - 1.06) / 0.06, 2)) * low * 0.55 * bodyOn;
    }

    // 4. the disk itself
    const grow = smooth((t - 4.7) / 2.7);
    const ignite = smooth((t - 5.2) / 1.7);
    if (grow > 0 && ignite > 0) {
      const mid = 0.05 * x - 0.004;
      const yy = y - mid;
      const thick =
        0.072 +
        0.028 * Math.exp(-Math.pow(x / 0.3, 2)) -
        0.018 * Math.min(1, Math.abs(x) / 0.5);
      const band = Math.exp(-Math.pow(Math.abs(yy) / thick, 1.8));
      const skirt = Math.exp(-Math.pow(Math.abs(yy) / (thick * 2.4), 2)) * 0.3;

      const reach = 0.16 + 0.95 * grow;
      const edge = smooth((reach - Math.abs(x)) / 0.16);
      const beam = 0.6 + 0.65 * Math.exp(-Math.pow((Math.abs(x) - 0.1) / 0.38, 2));
      const lanes =
        0.92 +
        0.08 * Math.sin((16 * yy) / thick + 2.1 * Math.sin(x * 9 - t * 0.45) - t * 0.55);
      const dust =
        0.52 +
        0.44 * fbm(x * 9 + t * 0.05, yy * 34 - t * 0.1) +
        0.2 * fbm(x * 20 - t * 0.07, yy * 52 + 4);

      const flash = Math.exp(-Math.pow((t - 6.3) / 0.7, 2));
      const breathe = 1 + 0.03 * Math.sin(t * 0.35);
      heat +=
        (band + skirt) * edge * beam * lanes * dust * ignite * 0.72 * (1 + flash) * breathe;
    }

    // 5. the far side, bent up over the top
    const haloOn = smooth((t - 5.9) / 1.5);
    if (haloOn > 0) {
      const width = 0.05 + 0.022 * Math.min(1.5, Math.abs(x) / R0);
      let band = Math.exp(-Math.pow((r - R0 * 1.3) / width, 2));
      const up = smooth((y / R0 + 0.15) / 1.0);
      band *= 0.26 + 0.74 * up;
      band *= 0.7 + 0.3 * Math.sin(ang * 5 - t * 0.4);
      const flash = Math.exp(-Math.pow((t - 6.6) / 0.9, 2));
      heat += band * haloOn * 1.15 * (1 + 0.4 * flash);
    }

    // 6. rings thrown outward as it catches
    heat += this.ripple((t - 2.95) / 1.45, rr, 4.6, 1.6);
    heat += this.ripple((t - 6.8) / 1.7, rr, 5.2, 1.0);
    if (t > 13.5) {
      const u = ((t - 13.5) % 9.5) / 2.6;
      heat += this.ripple(u, rr, 5.8, 0.5);
    }

    // the flash of the burst itself
    heat *= 1 + 0.22 * Math.exp(-Math.pow((t - 2.95) / 0.22, 2));

    // roll the highlights off instead of clipping them flat
    heat = 1 - Math.exp(-1.6 * heat);

    if (rr < 0.995) heat = 0;

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
          const scaled = Math.pow(clamp01(heat), 1 / 1.15);
          let level = Math.floor(scaled * (INK.length - 1) + grain * 0.9);
          if (level > INK.length - 1) level = INK.length - 1;
          if (level < 1) level = 1;

          const cool = hash2(col * 3.1 + 7, row * 5.7 + 3) < 0.19 ? 1 : 0;
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
