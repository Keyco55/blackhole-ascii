// 3D Gargantua ASCII Black Hole — Real-Time Schwarzschild Ray Tracer + Bloom
// Precomputes exact RK4 photon geodesics u(a) and asymptotic deflection angles
// in Schwarzschild spacetime, then renders every frame with:
//   - Full 3D orbital camera (16° dynamic tilt + cinematic fly-by + drag/zoom)
//   - Relativistic Doppler beaming & crimson-amber-whitehot temperature palette
//   - 3D comet-shaped orbital pulses streaming across disk and lensed halo
//   - Phase-flowing ASCII glyph pools + directional tangent glyphs (/ | \ -)
//   - Motion-trail buffer + bilinear pyramid bloom (iOS Safari & desktop safe)
//   - Gravitationally lensed 3D starfield (Einstein arcs) + 3D spiraling embers

const TAU = Math.PI * 2;

// Flowing glyph pools (dark -> bright) + directional tangent glyphs for the ring
const POOLS = [
  "1il!;:",
  "rtfjcvxz=+",
  "aeoun0{}[]<>",
  "08B$#&%Q",
];
const CHARS = " .,:~+*^/\\|-" + POOLS.join("");
const AT = new Map(CHARS.split("").map((c, i) => [c, i]));
const FILL = POOLS.map((pool) =>
  Array.from({ length: 12 }, (_, k) => AT.get(pool[k % pool.length])),
);

// 18-level fiery Gargantua luminance ramp (crimson -> orange -> amber -> white-hot)
const INK_FIRE = [
  [18, 4, 2],
  [44, 9, 4],
  [78, 16, 6],
  [118, 24, 8],
  [162, 34, 11],
  [198, 46, 14],
  [226, 64, 18],
  [244, 86, 22],
  [255, 112, 28],
  [255, 138, 40],
  [255, 162, 56],
  [255, 184, 78],
  [255, 204, 108],
  [255, 220, 142],
  [255, 232, 176],
  [255, 242, 208],
  [255, 250, 232],
  [255, 255, 250],
];

// Optics in Schwarzschild units (r_s = 1, photon sphere = 1.5)
const CAM = 28;
const DISK_IN = 2.6;
const DISK_OUT = 12.6;
const BMAX = 20.0;
const NB = 2000;
const STEP = 0.018;
const B_CRIT = (3 * Math.sqrt(3)) / 2;

// Gas turbulence & harmonic rings
const BANDS = 12;
const LOOP = 42;
const SPIN = 9;
const TAB = 256;

const LOG_C1 = Math.log(1.38);
const LOG_C2 = Math.log(1.92);
const LOG_C3 = Math.log(2.65);

// 3D sky map resolution
const SKY_W = 512;
const SKY_H = 256;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
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

function makeOffscreen(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Precompute Schwarzschild photon geodesics:
//   usTable[n]     -> 1/r at step index q (a = q * STEP)
//   escapeAngle[n] -> asymptotic swept angle a_inf where u -> 0 (-1 if captured)
let GEO = null;
function geodesics() {
  if (GEO) return GEO;
  const f = (u) => 1.5 * u * u - u;
  const usTable = new Array(NB);
  const escapeAngle = new Float32Array(NB);
  const uStoreMin = 0.04;

  for (let n = 0; n < NB; n++) {
    const b = ((n + 0.5) / NB) * BMAX;
    let u = 1 / CAM;
    let w = Math.sqrt(Math.max(0, 1 - (b / CAM) ** 2)) / b;
    const us = [u];
    let guard = 0;
    let aEsc = -1;

    while (guard < 2600) {
      const k1 = w;
      const l1 = f(u);
      const k2 = w + (STEP / 2) * l1;
      const l2 = f(u + (STEP / 2) * k1);
      const k3 = w + (STEP / 2) * l2;
      const l3 = f(u + (STEP / 2) * k2);
      const k4 = w + STEP * l3;
      const l4 = f(u + STEP * k3);
      const uNext = u + (STEP / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      const wNext = w + (STEP / 6) * (l1 + 2 * l2 + 2 * l3 + l4);

      if (uNext >= 1) {
        us.push(uNext);
        aEsc = -1;
        break;
      }
      if (uNext <= 0 && wNext < 0) {
        const frac = u / Math.max(1e-9, u - uNext);
        aEsc = (guard + frac) * STEP;
        break;
      }
      u = uNext;
      w = wNext;
      if (u >= uStoreMin || w > 0) {
        us.push(u);
      }
      guard++;
    }

    usTable[n] = Float32Array.from(us);
    escapeAngle[n] = aEsc;
  }

  GEO = { usTable, escapeAngle };
  return GEO;
}

// Gas harmonics per radial ring
let BAND_DATA = null;
function bandData() {
  if (BAND_DATA) return BAND_DATA;
  const rand = mulberry32(42);
  const out = [];
  for (let b = 0; b < BANDS; b++) {
    const r = DISK_IN + ((DISK_OUT - DISK_IN) * b) / (BANDS - 1);
    const turns = Math.max(1, Math.round(SPIN * (DISK_IN / r) ** 1.5));
    const waves = [2, 3, 5, 7, 11, 17].map((k) => [
      k,
      rand() * TAU,
      (0.55 + rand()) / Math.pow(k, 0.55),
    ]);
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
    for (let i = 0; i < TAB; i++) {
      tab[i] = 0.62 + (0.38 * (tab[i] - lo)) / Math.max(1e-6, hi - lo);
    }
    out.push({ tab, turns });
  }
  BAND_DATA = out;
  return out;
}

// 3D sky map: crisp pinpoint stars on pure void
let SKY_MAP = null;
function skyMap() {
  if (SKY_MAP) return SKY_MAP;
  const val = new Float32Array(SKY_W * SKY_H);
  const tint = new Uint8Array(SKY_W * SKY_H);
  const phase = new Float32Array(SKY_W * SKY_H);
  const rand = mulberry32(20261114);

  const tilt = 0.6;
  const nx = Math.sin(tilt) * 0.45;
  const ny = Math.cos(tilt);
  const nz = Math.sin(tilt) * 0.89;

  for (let s = 0; s < 2400; s++) {
    const u = rand() * 2 - 1;
    const phi = rand() * TAU;
    const root = Math.sqrt(Math.max(0, 1 - u * u));
    const dx = root * Math.cos(phi);
    const dy = u;
    const dz = root * Math.sin(phi);

    const plane = Math.abs(dx * nx + dy * ny + dz * nz);
    if (s > 1400 && plane > 0.28) continue;

    let uPix = (Math.atan2(dz, dx) / TAU + 0.5) % 1;
    if (uPix < 0) uPix += 1;
    const ix = Math.floor(uPix * SKY_W);
    const iy = clamp(Math.floor((Math.acos(clamp(dy, -1, 1)) / Math.PI) * SKY_H), 0, SKY_H - 1);
    const idx = iy * SKY_W + ix;

    const bright = 0.24 + Math.pow(rand(), 3.4) * 1.15;
    if (bright > val[idx]) {
      val[idx] = bright;
      const cRoll = rand();
      tint[idx] = cRoll < 0.34 ? 2 : cRoll < 0.68 ? 0 : 1;
      phase[idx] = rand() * TAU;
    }
  }

  SKY_MAP = { val, tint, phase };
  return SKY_MAP;
}

export class BlackHole {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.W = 0;
    this.H = 0;
    this.maskKey = "";

    // Interactive 3D orbital camera offsets
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 1;
    this.velYaw = 0;
    this.velPitch = 0;
    this.dragging = false;
    this.lastInteract = -100;
    this.currentTiltDeg = 0;

    this.geo = geodesics();
    this.bands = bandData();
    this.sky = skyMap();
    this.rayOut = {
      near: 0,
      far: 0,
      dop: 1,
      ring: 0,
      sky: 0,
      skyTint: 0,
      hitHorizon: false,
      flowPhase: 0,
      logR: 0,
    };
    this.skyOut = { v: 0, tint: 0 };

    this.resize();
  }

  setDragging(active) {
    this.dragging = active;
    if (active) this.lastInteract = performance.now() / 1000;
  }

  orbitBy(dYaw, dPitch) {
    this.userYaw += dYaw;
    this.userPitch = clamp(this.userPitch + dPitch, -1.28, 1.28);
    this.velYaw = dYaw;
    this.velPitch = dPitch;
    this.lastInteract = performance.now() / 1000;
  }

  zoomBy(scale) {
    this.userZoom = clamp(this.userZoom * scale, 0.58, 1.95);
    this.lastInteract = performance.now() / 1000;
  }

  resetOrbit() {
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 1;
    this.velYaw = 0;
    this.velPitch = 0;
    this.lastInteract = -100;
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

    // Bold cell density matching crisp terminal ASCII aesthetic
    const targetCols = Math.max(66, Math.min(130, Math.round(rect.width / 3.45)));
    this.cw = Math.max(5, Math.floor(W / targetCols));
    this.cols = Math.max(1, Math.floor(W / this.cw));
    this.ch = Math.max(8, Math.round(this.cw * 1.56));
    this.rows = Math.max(1, Math.floor(H / this.ch));
    this.ox = Math.floor((W - this.cols * this.cw) / 2);
    this.oy = Math.floor((H - this.rows * this.ch) / 2);

    // Larger dramatic Gargantua scale
    this.R0 = 0.112 * (W / H);
    this.ux = new Float32Array(this.cols);
    this.vy = new Float32Array(this.rows);
    for (let c = 0; c < this.cols; c++) {
      this.ux[c] = (this.ox + (c + 0.5) * this.cw - W / 2) / H;
    }
    for (let r = 0; r < this.rows; r++) {
      this.vy[r] = 0.5 - (this.oy + (r + 0.5) * this.ch) / H;
    }

    const n = this.cols * this.rows;
    this.front = new Float32Array(n);
    this.back = new Float32Array(n);
    this.frontShown = new Float32Array(n);
    this.frontSmooth = new Float32Array(n);
    this.shown = new Float32Array(n);
    this.smoothField = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.dopplerMap = new Float32Array(n);
    this.skyHeat = new Float32Array(n);
    this.skyTintCell = new Uint8Array(n);
    this.ringMap = new Float32Array(n);
    this.shadowMask = new Float32Array(n);
    this.flowPhaseMap = new Float32Array(n);
    this.logRMap = new Float32Array(n);
    this.cellSeed = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      this.cellSeed[k] = Math.floor(hash2(k % this.cols, Math.floor(k / this.cols)) * 12);
    }

    this.img = this.ctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.buf.fill(0xff000000);

    // Offscreen compositing buffers for motion trail & 2-tier GPU bloom
    this.rawCanvas = makeOffscreen(W, H);
    this.rawCtx = this.rawCanvas.getContext("2d", { alpha: false });
    this.trailCanvas = makeOffscreen(W, H);
    this.trailCtx = this.trailCanvas.getContext("2d", { alpha: false });
    this.trailCtx.fillStyle = "#000";
    this.trailCtx.fillRect(0, 0, W, H);

    const bw1 = Math.max(16, Math.floor(W / 4));
    const bh1 = Math.max(16, Math.floor(H / 4));
    const bw2 = Math.max(12, Math.floor(W / 10));
    const bh2 = Math.max(12, Math.floor(H / 10));
    this.bloomA = makeOffscreen(bw1, bh1);
    this.bloomACtx = this.bloomA.getContext("2d", { alpha: false });
    this.bloomB = makeOffscreen(bw2, bh2);
    this.bloomBCtx = this.bloomB.getContext("2d", { alpha: false });

    this.buildMasks();
    this.buildEmbers();
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

    this.chars = CHARS.split("");
    this.masks = [];

    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      g.clearRect(0, 0, cw, ch);
      if (c !== " ") {
        g.fillStyle = "#fff";
        g.fillText(c, cw / 2, ch / 2 + 0.2);
        g.fillText(c, cw / 2 + 0.45, ch / 2 + 0.55);
      }
      const data = g.getImageData(0, 0, cw, ch).data;
      const mask = new Uint8Array(cw * ch);
      for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3];
      this.masks.push(mask);
    }

    // 3 blackbody temperature tints per luminance level:
    //   0: deep fiery crimson-red / receding copper
    //   1: molten orange-amber core -> pale white-hot
    //   2: relativistic Doppler white-gold / ice-blue highlight
    this.inks = [];
    for (let l = 0; l < INK_FIRE.length; l++) {
      const base = INK_FIRE[l];
      const frac = l / (INK_FIRE.length - 1);

      const crimsonRecede = [
        clamp(Math.round(base[0] * 1.04), 0, 255),
        clamp(Math.round(base[1] * 0.66), 0, 255),
        clamp(Math.round(base[2] * 0.48), 0, 255),
      ];
      const hotWhiteBlue = [
        clamp(Math.round(base[0] * 0.94 + frac * 32), 0, 255),
        clamp(Math.round(base[1] * 0.98 + frac * 42), 0, 255),
        clamp(Math.round(Math.min(255, base[2] * 1.26 + 55 * frac)), 0, 255),
      ];
      this.inks.push([lutFor(crimsonRecede), lutFor(base), lutFor(hotWhiteBlue)]);
    }

    // Star & comet dust inks: [coolWhite, warmGold, iceBlue]
    this.starInks = [
      [lutFor([76, 80, 88]), lutFor([134, 138, 146]), lutFor([196, 202, 212]), lutFor([242, 246, 255])],
      [lutFor([96, 54, 24]), lutFor([158, 92, 42]), lutFor([218, 142, 72]), lutFor([255, 204, 140])],
      [lutFor([64, 88, 130]), lutFor([110, 148, 202]), lutFor([164, 202, 244]), lutFor([220, 238, 255])],
    ];
  }

  buildEmbers() {
    const rand = mulberry32(20261224);
    this.embers = [];
    for (let i = 0; i < 68; i++) {
      const r = 3.2 + rand() * 9.0;
      this.embers.push({
        r0: r,
        y0: (rand() - 0.5) * (0.55 + r * 0.14),
        phi0: rand() * TAU,
        speed: (0.48 + rand() * 0.55) * (DISK_IN / r) ** 1.2,
        phase: rand() * TAU,
        twinkle: 0.4 + rand() * 1.2,
        infall: 0.08 + rand() * 0.22,
      });
    }
  }

  // Smooth 3D orbital camera basis with dramatic ~16° tilted Gargantua framing
  cameraState(t) {
    const nowSec = performance.now() / 1000;
    if (!this.dragging) {
      this.userYaw += this.velYaw;
      this.userPitch = clamp(this.userPitch + this.velPitch, -1.28, 1.28);
      this.velYaw *= 0.91;
      this.velPitch *= 0.91;

      const idle = nowSec - this.lastInteract;
      if (idle > 7) {
        this.userPitch *= 0.985;
        this.userZoom += (1 - this.userZoom) * 0.015;
      }
    }

    // Begins with a bold 16° tilt and near-edge-on Gargantua profile,
    // then glides smoothly through elevated 3D spiral viewpoints after ignition.
    const fly = smooth((t - 5.2) / 3.8);
    const autoYaw = fly * (0.24 * (t - 5.2) + 0.32 * Math.sin((t - 5.2) * 0.17));
    const pitchWave = 0.5 - 0.5 * Math.cos((t - 5.2) * 0.23);
    const autoPitch = 0.08 + fly * (0.04 + 0.34 * pitchWave);
    const baseRoll = 0.275; // ~15.8° dynamic diagonal tilt
    const roll = baseRoll * (1 - 0.35 * fly) + fly * 0.085 * Math.sin((t - 5.2) * 0.19);
    const autoZoom =
      1 +
      0.06 * Math.sin(t * 0.24) +
      0.1 * smooth((t - 5.8) / 2.6) * (1 - smooth((t - 12.0) / 5.0));

    const yaw = autoYaw + this.userYaw;
    const pitch = clamp(autoPitch + this.userPitch, -1.36, 1.36);
    const zoom = clamp(autoZoom * this.userZoom, 0.55, 2.0);
    this.currentTiltDeg = (pitch * 180) / Math.PI;

    const cP = Math.cos(pitch);
    const sP = Math.sin(pitch);
    const cY = Math.cos(yaw);
    const sY = Math.sin(yaw);

    const r0x = cP * sY;
    const r0y = sP;
    const r0z = cP * cY;

    const fx = -r0x;
    const fy = -r0y;
    const fz = -r0z;

    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    rz /= rLen;

    const ux0 = ry * fz - rz * fy;
    const uy0 = rz * fx - rx * fz;
    const uz0 = rx * fy - ry * fx;

    const cR = Math.cos(roll);
    const sR = Math.sin(roll);
    const Rx = cR * rx + sR * ux0;
    const Ry = cR * ry + sR * uy0;
    const Rz = cR * rz + sR * uz0;

    const Ux = -sR * rx + cR * ux0;
    const Uy = -sR * ry + cR * uy0;
    const Uz = -sR * rz + cR * uz0;

    const cyOffset = -0.025 * Math.cos(pitch * 1.4) * clamp01(1 - Math.abs(pitch) / 0.75);

    return {
      r0x, r0y, r0z,
      fx, fy, fz,
      Rx, Ry, Rz,
      Ux, Uy, Uz,
      zoom,
      cyOffset,
    };
  }

  spinPhase(t) {
    if (t <= 5.0) return t * 0.16;
    const since = t - 5.0;
    return 5.0 * 0.16 + since * 1.24 - 2.6 * (1 - Math.exp(-since / 2.6));
  }

  // Trace one 3D ray through Schwarzschild spacetime (writes into this.rayOut)
  traceRay(x, y, S, cam, ph, turn, pulseOn, t) {
    const out = this.rayOut;
    const px = x * S;
    const py = y * S;
    const dx0 = px * cam.Rx + py * cam.Ux + cam.fx;
    const dy0 = px * cam.Ry + py * cam.Uy + cam.fy;
    const dz0 = px * cam.Rz + py * cam.Uz + cam.fz;
    const invLen = 1 / Math.hypot(dx0, dy0, dz0);
    const dx = dx0 * invLen;
    const dy = dy0 * invLen;
    const dz = dz0 * invLen;

    const dr = dx * cam.r0x + dy * cam.r0y + dz * cam.r0z;
    const t0x = dx - dr * cam.r0x;
    const t0y = dy - dr * cam.r0y;
    const t0z = dz - dr * cam.r0z;
    const side = Math.hypot(t0x, t0y, t0z);

    if (side < 1e-4) {
      out.near = 0; out.far = 0; out.dop = 1; out.ring = 0;
      out.sky = 0; out.skyTint = 0; out.hitHorizon = true;
      out.flowPhase = 0; out.logR = 0;
      return out;
    }

    const invSide = 1 / side;
    const tx = t0x * invSide;
    const ty = t0y * invSide;
    const tz = t0z * invSide;

    const b = CAM * side;
    const bi = Math.floor((b / BMAX) * NB);
    const { usTable, escapeAngle } = this.geo;

    if (bi >= NB) {
      const skySample = this.sampleSky(dx, dy, dz, t);
      out.near = 0; out.far = 0; out.dop = 1; out.ring = 0;
      out.sky = skySample.v; out.skyTint = skySample.tint; out.hitHorizon = false;
      out.flowPhase = 0; out.logR = 0;
      return out;
    }

    const us = usTable[bi];
    const aEsc = escapeAngle[bi];
    const hitHorizon = aEsc < 0;
    const end = (us.length - 1) * STEP;

    let near = 0;
    let far = 0;
    let dopAccum = 0;
    let dopWeight = 0;
    let domWeight = -1;
    let domFlowPhase = 0;
    let domLogR = 0;

    let r0y = cam.r0y;
    let t0yC = ty;
    if (Math.abs(r0y) < 1e-5 && Math.abs(t0yC) < 1e-5) r0y = 1e-5;

    let a0 = Math.atan2(-r0y, t0yC) % Math.PI;
    if (a0 < 0) a0 += Math.PI;

    let light = 1.0;
    let crossings = 0;
    for (let a = a0; a < end && crossings < 3; a += Math.PI) {
      const p = a / STEP;
      const q = Math.floor(p);
      if (q + 1 >= us.length) break;
      const uVal = us[q] + (us[q + 1] - us[q]) * (p - q);
      if (uVal <= 0.04) continue;
      const r = 1 / uVal;

      if (r > DISK_IN && r < DISK_OUT) {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const hx = ca * cam.r0x + sa * tx;
        const hz = ca * cam.r0z + sa * tz;
        const phi = Math.atan2(hz, hx);

        // Relativistic Doppler beaming
        const wSlope = (us[q + 1] - us[q]) / STEP;
        const qx = -sa * cam.r0x + ca * tx;
        const qy = -sa * cam.r0y + ca * ty;
        const qz = -sa * cam.r0z + ca * tz;
        const kx = wSlope * hx - uVal * qx;
        const ky = -uVal * qy;
        const kz = wSlope * hz - uVal * qz;
        const kInv = 1 / (Math.hypot(kx, ky, kz) || 1);

        const vDotK = (hz * kx - hx * kz) * kInv;
        const beta = Math.min(0.48, Math.sqrt(0.48 / Math.max(1.25, r - 1)));
        const gamma = 1 / Math.sqrt(1 - beta * beta);
        const doppler = 1 / (gamma * (1 - beta * vDotK));
        const beam = Math.pow(doppler, 1.8);

        const edge =
          Math.min(1, (r - DISK_IN) / 0.45) *
          Math.pow(DISK_IN / r, 1.02) *
          (1 - smooth((r - 5.8) / 6.8));

        const pos = ((r - DISK_IN) / (DISK_OUT - DISK_IN)) * (BANDS - 1);
        const b0 = Math.min(BANDS - 2, Math.floor(pos));
        const fr = pos - b0;
        const t0 = this.bands[b0];
        const t1 = this.bands[b0 + 1];

        let i0 = Math.floor(((phi - t0.turns * turn) / TAU) * TAB) % TAB;
        if (i0 < 0) i0 += TAB;
        let i1 = Math.floor(((phi - t1.turns * turn) / TAU) * TAB) % TAB;
        if (i1 < 0) i1 += TAB;

        const gas = t0.tab[i0] + (t1.tab[i1] - t0.tab[i0]) * fr;
        const logR = Math.log(r / DISK_IN);
        const flowPhase = phi - Math.pow(r / DISK_IN, -1.5) * ph * 1.4;
        const streak =
          0.74 +
          0.26 * Math.sin(36 * logR + 1.1 * Math.sin(flowPhase + 3 * logR)) +
          0.16 * Math.sin((r - DISK_IN) * 2.4 - ph * 2.2 + phi * 3);

        // 3 comet-shaped relativistic pulses orbiting disk and leaping over lensed halo
        let cometSum = 0;
        if (pulseOn > 0.01 && crossings < 2) {
          let d1 = (phi - (0.0 + 1.15 * t) + Math.PI) % TAU;
          if (d1 < 0) d1 += TAU;
          d1 -= Math.PI;
          const c1 = d1 > 0 ? Math.exp(-Math.pow(d1 / 0.19, 2)) : Math.exp(d1 / 0.95);
          cometSum += c1 * Math.exp(-Math.pow((logR - LOG_C1) / 0.085, 2));

          let d2 = (phi - (2.1 + 0.88 * t) + Math.PI) % TAU;
          if (d2 < 0) d2 += TAU;
          d2 -= Math.PI;
          const c2 = d2 > 0 ? Math.exp(-Math.pow(d2 / 0.21, 2)) : Math.exp(d2 / 0.95);
          cometSum += c2 * Math.exp(-Math.pow((logR - LOG_C2) / 0.09, 2));

          let d3 = (phi - (4.2 + 0.65 * t) + Math.PI) % TAU;
          if (d3 < 0) d3 += TAU;
          d3 -= Math.PI;
          const c3 = d3 > 0 ? Math.exp(-Math.pow(d3 / 0.24, 2)) : Math.exp(d3 / 1.0);
          cometSum += c3 * Math.exp(-Math.pow((logR - LOG_C3) / 0.1, 2));
        }

        const weight = light * edge * beam * Math.pow(DISK_IN / r, 1.3);
        const val = weight * (gas * streak + 2.35 * pulseOn * cometSum);

        if (ca > 0 && crossings === 0) near += val;
        else far += val;

        if (val > domWeight) {
          domWeight = val;
          domFlowPhase = flowPhase;
          domLogR = logR;
        }
        dopAccum += doppler * val;
        dopWeight += val;
        light *= 0.46;
      }
      crossings++;
    }

    // Razor-sharp photon ring right around b = B_CRIT
    let ring = 0;
    const bDiff = b - B_CRIT;
    if (bDiff > -0.14 && bDiff < 0.65) {
      const core = Math.exp(-Math.pow(bDiff / 0.08, 2));
      const halo = Math.exp(-Math.pow((bDiff - 0.14) / 0.24, 2)) * 0.36;
      const ringDir = dx * cam.Rx;
      const ringBias = 1 - 0.28 * clamp(ringDir * 6, -1, 1);
      ring = (core + halo) * ringBias;
    }

    let sky = 0;
    let skyTint = 0;
    if (!hitHorizon) {
      const caE = Math.cos(aEsc);
      const saE = Math.sin(aEsc);
      const sx = caE * cam.r0x + saE * tx;
      const sy = caE * cam.r0y + saE * ty;
      const sz = caE * cam.r0z + saE * tz;
      const skySample = this.sampleSky(sx, sy, sz, t);
      const einsteinBoost = 1 + 1.55 * Math.exp(-Math.pow((b - B_CRIT) / 0.45, 2));
      sky = skySample.v * einsteinBoost;
      skyTint = skySample.tint;
    }

    out.near = near;
    out.far = far;
    out.dop = dopWeight > 1e-6 ? dopAccum / dopWeight : 1.0;
    out.ring = ring;
    out.sky = sky;
    out.skyTint = skyTint;
    out.hitHorizon = hitHorizon;
    out.flowPhase = domFlowPhase;
    out.logR = domLogR;
    return out;
  }

  sampleSky(dx, dy, dz, t) {
    const out = this.skyOut;
    let u = (Math.atan2(dz, dx) / TAU + 0.5) % 1;
    if (u < 0) u += 1;
    const v = Math.acos(clamp(dy, -1, 1)) / Math.PI;
    const ix = clamp(Math.floor(u * SKY_W), 0, SKY_W - 1);
    const iy = clamp(Math.floor(v * SKY_H), 0, SKY_H - 1);
    const idx = iy * SKY_W + ix;
    const base = this.sky.val[idx];
    if (base < 0.015) {
      out.v = 0; out.tint = 0;
      return out;
    }

    const ph = this.sky.phase[idx];
    const twinkle = 0.62 + 0.38 * Math.sin(t * (1.2 + (idx % 7) * 0.22) + ph);
    out.v = base * twinkle;
    out.tint = this.sky.tint[idx];
    return out;
  }

  // Opening choreography: counter-clockwise genesis ring, breathing aura, shockwaves
  atmosphere(x, y, t) {
    const R0 = this.R0;
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const rr = r / R0;
    let heat = 0;

    // 1. Genesis circle drawn counter-clockwise out of nothing
    if (t < 5.0) {
      const sweep = smooth((t - 0.3) / 2.1) * TAU;
      if (sweep > 0) {
        let d = (ang - 1.05) % TAU;
        if (d < 0) d += TAU;
        if (d <= sweep) {
          const radius = R0 * (1.92 - 0.78 * smooth((t - 0.25) / 2.5));
          const width = 0.007 + 0.005 * smooth((t - 0.25) / 2.0);
          const band = Math.exp(-Math.pow((r - radius) / width, 2));
          const trail = 1 - 0.5 * (d / Math.max(sweep, 1e-3));
          const spark = 0.72 + 0.28 * Math.sin(ang * 43 - t * 8.0);
          heat += band * trail * spark * (1 - smooth((t - 3.4) / 1.4));
        }
      }
    }

    // 2. Soft breathing red/amber aura before disk ignition
    const auraK = smooth((t - 2.0) / 1.7) * (1 - 0.75 * smooth((t - 5.4) / 2.4));
    if (auraK > 0.01 && rr > 0.98) {
      const puff = 0.5 + 0.5 * Math.sin(2 * ang + 0.9 * Math.sin(5 * r - 0.5 * t));
      const reach = 0.38 * (0.7 + 0.6 * puff);
      heat += auraK * Math.exp(-Math.pow((rr - 1.0) / reach, 1.5)) * (0.55 + 0.45 * puff);
    }

    // 3. Relativistic shockwaves on ignition
    heat += this.ripple((t - 2.85) / 1.45, rr, 4.9, 1.75);
    heat += this.ripple((t - 6.2) / 1.7, rr, 5.8, 1.35);
    if (t > 11.5) {
      const u = ((t - 11.5) % 7.2) / 3.0;
      heat += this.ripple(u, rr, 6.2, 0.5);
    }

    heat *= 1 + 0.3 * Math.exp(-Math.pow((t - 2.85) / 0.22, 2));
    return heat;
  }

  ripple(u, rr, reach, strength) {
    if (u < 0 || u > 1) return 0;
    const rad = 1.12 + (reach - 1.12) * Math.pow(u, 0.62);
    const w = 0.14 + 0.09 * u * u;
    const env = smooth(u * 8) * Math.pow(1 - u, 2.5);
    return Math.exp(-Math.pow((rr - rad) / w, 2)) * env * strength;
  }

  // Directional tangent glyph (/ | \ -) along circular arcs
  tangentGlyph(x, y) {
    // Tangent vector to circle (x, y) is (-y, x)
    let deg = ((Math.atan2(-x, -y) * 180) / Math.PI) % 180;
    if (deg < 0) deg += 180;
    if (deg < 22.5 || deg >= 157.5) return AT.get("-");
    if (deg < 67.5) return AT.get("/");
    if (deg < 112.5) return AT.get("|");
    return AT.get("\\");
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

  // Composite ASCII buffer with motion trails + 2-tier GPU bilinear bloom
  compositeBloom() {
    const { W, H, ctx, rawCtx, rawCanvas, trailCtx, trailCanvas, bloomA, bloomACtx, bloomB, bloomBCtx } = this;
    if (!rawCtx || typeof ctx.drawImage !== "function") {
      ctx.putImageData(this.img, 0, 0);
      return;
    }

    rawCtx.putImageData(this.img, 0, 0);

    // 1. Motion trail: fade previous frame (~50% retention), then max-blend current crisp frame
    trailCtx.globalCompositeOperation = "source-over";
    trailCtx.fillStyle = "rgba(0, 0, 0, 0.50)";
    trailCtx.fillRect(0, 0, W, H);
    trailCtx.globalCompositeOperation = "lighten";
    trailCtx.drawImage(rawCanvas, 0, 0);
    trailCtx.globalCompositeOperation = "source-over";

    // 2. Bilinear downsampled bloom passes (works natively on iOS Safari & desktop)
    bloomACtx.imageSmoothingEnabled = true;
    bloomACtx.clearRect(0, 0, bloomA.width, bloomA.height);
    bloomACtx.drawImage(trailCanvas, 0, 0, bloomA.width, bloomA.height);

    bloomBCtx.imageSmoothingEnabled = true;
    bloomBCtx.clearRect(0, 0, bloomB.width, bloomB.height);
    bloomBCtx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);

    // 3. Present sharp trails + tight inner glow + wide outer corona
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(trailCanvas, 0, 0);

    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(bloomA, 0, 0, W, H);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(bloomB, 0, 0, W, H);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  draw(t) {
    const {
      cols, rows, cw, ch, ox, oy, buf, ux, vy, R0,
      front, back, frontShown, frontSmooth, shown, smoothField, glow,
      dopplerMap, skyHeat, skyTintCell, ringMap, shadowMask,
      flowPhaseMap, logRMap, cellSeed,
    } = this;
    buf.fill(0xff000000);

    const cam = this.cameraState(t);
    const S = B_CRIT / (CAM * R0 * cam.zoom);

    const ph = this.spinPhase(t);
    const turn = TAU * ((ph % LOOP) / LOOP);

    const diskOn = smooth((t - 4.2) / 2.2);
    const grow = smooth((t - 4.3) / 2.6);
    const ignite = smooth((t - 4.6) / 1.4);
    const pulseOn = smooth((t - 6.0) / 1.1);
    const ringOn = smooth((t - 2.3) / 1.1);
    const shadowOn = smooth((t - 2.0) / 1.2);
    const glowOn = smooth((t - 4.8) / 2.0);
    const flash = 1 + 0.72 * Math.exp(-Math.pow((t - 6.1) / 0.55, 2));
    const breathe = 1 + 0.045 * Math.sin(t * 0.38) + 0.02 * Math.sin(t * 0.91 + 1.5);
    const glowPulse = 1 + 0.08 * Math.sin(t * 0.6);
    const reach = (0.16 + 1.05 * grow) * cam.zoom;

    const dxW = cw / this.H;
    const dyW = ch / this.H;

    // 1. Per-frame 3D Schwarzschild ray tracing
    for (let row = 0; row < rows; row++) {
      const y0 = vy[row] - cam.cyOffset;
      for (let col = 0; col < cols; col++) {
        const x0 = ux[col];
        const k = row * cols + col;
        const rScreen = Math.hypot(x0, y0);
        const hiDetail = rScreen < R0 * 3.4 * cam.zoom;

        let near = 0;
        let far = 0;
        let dop = 0;
        let ring = 0;
        let sky = 0;
        let skyTint = 0;
        let shadowHits = 0;
        let flowPhase = 0;
        let logR = 0;

        if (hiDetail) {
          let wDop = 0;
          let maxSeg = -1;
          for (let sy = 0; sy < 2; sy++) {
            const y = y0 + (sy === 0 ? -0.25 : 0.25) * dyW;
            for (let sx = 0; sx < 2; sx++) {
              const x = x0 + (sx === 0 ? -0.25 : 0.25) * dxW;
              const res = this.traceRay(x, y, S, cam, ph, turn, pulseOn, t);
              near += res.near * 0.25;
              far += res.far * 0.25;
              const tot = res.near + res.far;
              dop += res.dop * tot;
              wDop += tot;
              if (tot > maxSeg) {
                maxSeg = tot;
                flowPhase = res.flowPhase;
                logR = res.logR;
              }
              ring += res.ring * 0.25;
              sky += res.sky * 0.25;
              if (res.sky > 0.12) skyTint = res.skyTint;
              if (res.hitHorizon) shadowHits += 0.25;
            }
          }
          dop = wDop > 1e-6 ? dop / wDop : 1.0;
        } else {
          const res = this.traceRay(x0, y0, S, cam, ph, turn, pulseOn, t);
          near = res.near;
          far = res.far;
          dop = res.dop;
          ring = res.ring;
          sky = res.sky;
          skyTint = res.skyTint;
          shadowHits = res.hitHorizon ? 1 : 0;
          flowPhase = res.flowPhase;
          logR = res.logR;
        }

        const gate = smooth((reach - rScreen * 0.8) / 0.16) * diskOn * ignite;
        front[k] = near;
        back[k] = far;
        shown[k] = (near + far) * gate;
        frontShown[k] = near * gate;
        dopplerMap[k] = dop;
        ringMap[k] = ring;
        skyHeat[k] = sky;
        skyTintCell[k] = skyTint;
        shadowMask[k] = shadowHits;
        flowPhaseMap[k] = flowPhase;
        logRMap[k] = logR;
      }
    }

    // 2. Screen-space plasma smoothing & corona
    this.blur(shown, smoothField, 1);
    this.blur(smoothField, glow, 2);
    this.blur(frontShown, frontSmooth, 1);

    // 3. Shade cells with flowing glyph pools & directional tangent ring letters
    const beat = t > 11.5 ? Math.exp(-Math.pow((((t - 11.5) % 7.2) / 7.2) / 0.08, 2)) : 0;
    let letters = 0;

    for (let row = 0; row < rows; row++) {
      const y0 = vy[row] - cam.cyOffset;
      const py = oy + row * ch;

      for (let col = 0; col < cols; col++) {
        const x = ux[col];
        const k = row * cols + col;
        const px = ox + col * cw;

        const outside = 1 - shadowMask[k];
        const atmos = this.atmosphere(x, y0, t);
        const sheen = 1 + 0.1 * Math.sin(x * 12 + y0 * 8 - t * 2.8);
        const photonGlow = ringMap[k] * 1.65 * (1 + 0.45 * beat) * sheen * ringOn;

        let heat =
          (atmos +
            smoothField[k] * 2.2 * flash * breathe +
            glow[k] * 1.15 * glowOn * glowPulse) *
            outside +
          photonGlow +
          frontSmooth[k] * 2.4 * flash * breathe * (1 - outside);

        heat = 1 - Math.exp(-1.68 * heat);

        if (heat >= 0.03) {
          const grain = hash2(col * 1.7 + 0.3, row * 2.3 + 0.1);
          const scaled = Math.pow(clamp01(heat), 1 / 1.14);
          let level = Math.floor(scaled * (INK_FIRE.length - 1) + grain * 0.35);
          if (level >= INK_FIRE.length) level = INK_FIRE.length - 1;
          if (level < 0) level = 0;

          const dop = dopplerMap[k];
          let tint = 1;
          if (dop > 1.12 || (photonGlow > 0.65 && heat > 0.58)) tint = 2;
          else if ((dop < 0.89 || heat < 0.24) && level < INK_FIRE.length - 3) tint = 0;

          // Directional tangent glyph (/ | \ -) on the sharp ring rim;
          // flowing glyph pools along the accretion disk
          const isSharpRing = photonGlow > 0.62 && photonGlow > smoothField[k] * 1.25;
          const isGenesisArc = t < 4.5 && atmos > 0.48;
          let glyph;
          if (isSharpRing || isGenesisArc) {
            glyph = this.tangentGlyph(x, y0);
          } else {
            const tier = clamp(Math.floor(scaled * 3.85), 0, 3);
            let slot = (cellSeed[k] + Math.floor(flowPhaseMap[k] * 2.2 + logRMap[k] * 6.0)) % 12;
            if (slot < 0) slot += 12;
            glyph = FILL[tier][slot];
          }

          this.blit(glyph, this.inks[level][tint], px, py, true);
          letters++;
          continue;
        }

        // Lensed 3D background stars (hidden inside shadow)
        if (shadowMask[k] > 0.45 && shadowOn > 0.4) continue;
        const sv = skyHeat[k];
        if (sv < 0.04) continue;

        const tier = sv < 0.14 ? 0 : sv < 0.36 ? 1 : sv < 0.72 ? 2 : 3;
        const lut = this.starInks[skyTintCell[k]][tier];
        const glyph =
          sv < 0.12
            ? AT.get(".")
            : sv < 0.32
              ? AT.get(":")
              : sv < 0.65
                ? AT.get("+")
                : AT.get("*");
        this.blit(glyph, lut, px, py, false);
      }
    }

    // 4. 3D spiraling relativistic embers
    const tanHalfFov = B_CRIT / (CAM * cam.zoom);
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      const cycle = ((t * e.infall + e.phase) % 10) / 10;
      const r = e.r0 * (1 - 0.58 * cycle) + DISK_IN * 0.58 * cycle;
      const phi = e.phi0 - t * e.speed * (1 + cycle * 0.8);
      const wx = r * Math.cos(phi);
      const wy = e.y0 * (1 - 0.5 * cycle);
      const wz = r * Math.sin(phi);

      const rx = wx - CAM * cam.r0x;
      const ry = wy - CAM * cam.r0y;
      const rz = wz - CAM * cam.r0z;
      const depth = rx * cam.fx + ry * cam.fy + rz * cam.fz;
      if (depth <= 1.5) continue;

      const projScale = R0 / (tanHalfFov * depth);
      const sx = (rx * cam.Rx + ry * cam.Ry + rz * cam.Rz) * projScale;
      const sy = (rx * cam.Ux + ry * cam.Uy + rz * cam.Uz) * projScale + cam.cyOffset;

      const col = Math.floor(((sx + this.W / (2 * this.H)) / (this.W / this.H)) * cols);
      const row = Math.floor((0.5 - sy) * rows);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const idx = row * cols + col;
      if (depth > CAM && shadowMask[idx] > 0.35) continue;
      if (front[idx] + back[idx] > 0.08) continue;

      const fade = Math.sin(cycle * Math.PI) * (0.45 + 0.55 * Math.sin(t * e.twinkle + e.phase));
      if (fade < 0.2) continue;

      const glyph = fade > 0.72 ? AT.get("*") : AT.get(".");
      const lut = this.starInks[1][fade > 0.65 ? 2 : 1];
      this.blit(glyph, lut, ox + col * cw, oy + row * ch, false);
    }

    this.compositeBloom();
    return letters;
  }
}
