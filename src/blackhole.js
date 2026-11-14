// 3D Gargantua ASCII Black Hole — Real-Time Schwarzschild Ray Tracer
// Precomputes exact RK4 photon geodesics u(a) and asymptotic deflection angles
// in Schwarzschild spacetime, then traces 3D camera rays every frame with:
//   - Full 3D orbital camera (cinematic fly-by + interactive drag/zoom)
//   - Primary, secondary (over/under shadow), and photon-ring disk crossings
//   - Relativistic Doppler beaming & blackbody temperature color shifts
//   - Gravitationally lensed 3D starfield & galactic band (real Einstein arcs)
//   - 3D spiraling accretion embers projected into screen space

const TAU = Math.PI * 2;
const RAMP = " .:-=+<~i!lI?][}{1)(tfjrxnuvcz*#%@";

// 18-level blackbody ink ramp (warm amber-gold core)
const INK_GOLD = [
  [12, 7, 4],
  [28, 15, 7],
  [48, 25, 11],
  [72, 38, 16],
  [98, 53, 22],
  [126, 70, 30],
  [154, 89, 39],
  [180, 110, 50],
  [202, 132, 63],
  [220, 154, 78],
  [234, 176, 98],
  [244, 196, 120],
  [250, 213, 146],
  [253, 228, 174],
  [255, 240, 204],
  [255, 248, 226],
  [255, 252, 240],
  [255, 255, 252],
];

// Optics in Schwarzschild units (r_s = 1, photon sphere = 1.5)
const CAM = 28;
const DISK_IN = 2.6;
const DISK_OUT = 12.4;
const BMAX = 20.0;
const NB = 2000;
const STEP = 0.018;
const B_CRIT = (3 * Math.sqrt(3)) / 2;

// Gas turbulence & harmonic rings
const BANDS = 12;
const LOOP = 42;
const SPIN = 9;
const TAB = 256;

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

// Precompute Schwarzschild photon geodesics:
//   us[n]          -> radial inverse 1/r at step index q (a = q * STEP)
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

// Gas harmonics per radial ring (periodic so seams never appear)
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

// 3D sky map: crisp pinpoint stars + sparse galactic star clusters on pure void
let SKY_MAP = null;
function skyMap() {
  if (SKY_MAP) return SKY_MAP;
  const val = new Float32Array(SKY_W * SKY_H);
  const tint = new Uint8Array(SKY_W * SKY_H);
  const phase = new Float32Array(SKY_W * SKY_H);
  const rand = mulberry32(20261114);

  // Scatter 2,400 crisp stars across the 3D sphere (denser along an inclined galactic band)
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

    // Concentrate faint stars slightly toward the galactic plane
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
      tint[idx] = cRoll < 0.28 ? 2 : cRoll < 0.64 ? 0 : 1; // 0: cool white, 1: gold, 2: ice blue
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
    this.rayOut = { near: 0, far: 0, dop: 1, ring: 0, sky: 0, skyTint: 0, hitHorizon: false };
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

    // Cell size in device pixels (crisp high-density ASCII grid)
    const targetCols = Math.max(64, Math.min(126, Math.round(rect.width / 3.5)));
    this.cw = Math.max(5, Math.floor(W / targetCols));
    this.cols = Math.max(1, Math.floor(W / this.cw));
    this.ch = Math.max(8, Math.round(this.cw * 1.58));
    this.rows = Math.max(1, Math.floor(H / this.ch));
    this.ox = Math.floor((W - this.cols * this.cw) / 2);
    this.oy = Math.floor((H - this.rows * this.ch) / 2);

    this.R0 = 0.098 * (W / H);
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

    this.img = this.ctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.buf.fill(0xff000000);

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

    this.chars = RAMP.split("");
    this.index = new Map();
    this.masks = [];

    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      this.index.set(c, i);
      g.clearRect(0, 0, cw, ch);
      if (c !== " ") {
        g.fillStyle = "#fff";
        g.fillText(c, cw / 2, ch / 2 + 0.2);
        g.fillText(c, cw / 2 + 0.5, ch / 2 + 0.6);
      }
      const data = g.getImageData(0, 0, cw, ch).data;
      const mask = new Uint8Array(cw * ch);
      for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3];
      this.masks.push(mask);
    }

    // 3 blackbody temperature tints per luminance level:
    //   0: deep receding amber/copper
    //   1: incandescent Gargantua gold
    //   2: relativistic Doppler white-gold / ice-blue highlight
    this.inks = [];
    for (let l = 0; l < INK_GOLD.length; l++) {
      const base = INK_GOLD[l];
      const frac = l / (INK_GOLD.length - 1);

      const coolRecede = [
        clamp(Math.round(base[0] * 1.05), 0, 255),
        clamp(Math.round(base[1] * 0.72), 0, 255),
        clamp(Math.round(base[2] * 0.52), 0, 255),
      ];
      const hotBlue = [
        clamp(Math.round(base[0] * 0.92 + frac * 35), 0, 255),
        clamp(Math.round(base[1] * 0.96 + frac * 42), 0, 255),
        clamp(Math.round(Math.min(255, base[2] * 1.24 + 46 * frac)), 0, 255),
      ];
      this.inks.push([lutFor(coolRecede), lutFor(base), lutFor(hotBlue)]);
    }

    // Star & nebula inks: [coolWhite, warmGold, iceBlue]
    this.starInks = [
      [lutFor([70, 72, 76]), lutFor([125, 128, 134]), lutFor([185, 190, 198]), lutFor([236, 240, 246])],
      [lutFor([78, 52, 28]), lutFor([132, 88, 44]), lutFor([186, 134, 72]), lutFor([232, 184, 118])],
      [lutFor([58, 76, 108]), lutFor([96, 132, 182]), lutFor([146, 186, 232]), lutFor([206, 228, 255])],
    ];
  }

  buildEmbers() {
    const rand = mulberry32(20261224);
    this.embers = [];
    for (let i = 0; i < 64; i++) {
      const r = 3.2 + rand() * 8.5;
      this.embers.push({
        r0: r,
        y0: (rand() - 0.5) * (0.55 + r * 0.14),
        phi0: rand() * TAU,
        speed: (0.45 + rand() * 0.55) * (DISK_IN / r) ** 1.2,
        phase: rand() * TAU,
        twinkle: 0.4 + rand() * 1.2,
        infall: 0.08 + rand() * 0.22,
      });
    }
  }

  // Smoothly evolving 3D camera basis (yaw, pitch, roll, zoom)
  cameraState(t) {
    const nowSec = performance.now() / 1000;
    if (!this.dragging) {
      this.userYaw += this.velYaw;
      this.userPitch = clamp(this.userPitch + this.velPitch, -1.28, 1.28);
      this.velYaw *= 0.91;
      this.velPitch *= 0.91;

      // Gently relax user pitch back toward auto-orbit after 7s idle
      const idle = nowSec - this.lastInteract;
      if (idle > 7) {
        this.userPitch *= 0.985;
        this.userZoom += (1 - this.userZoom) * 0.015;
      }
    }

    // Cinematic 3D fly-by: begins near edge-on Gargantua silhouette, then orbits in 3D
    const fly = smooth((t - 4.8) / 3.8);
    const autoYaw = fly * (0.24 * (t - 4.8) + 0.35 * Math.sin((t - 4.8) * 0.17));
    const pitchWave = 0.5 - 0.5 * Math.cos((t - 4.8) * 0.22);
    const autoPitch = 0.075 + fly * (0.04 + 0.36 * pitchWave);
    const roll = fly * 0.075 * Math.sin((t - 4.8) * 0.19);
    const autoZoom = 1 + 0.06 * Math.sin(t * 0.23) - 0.08 * smooth((t - 5.2) / 3.5) * (1 - smooth((t - 10.5) / 5.0));

    const yaw = autoYaw + this.userYaw;
    const pitch = clamp(autoPitch + this.userPitch, -1.36, 1.36);
    const zoom = clamp(autoZoom * this.userZoom, 0.55, 2.0);
    this.currentTiltDeg = (pitch * 180) / Math.PI;

    // Camera position unit vector r0 = C / CAM
    const cP = Math.cos(pitch);
    const sP = Math.sin(pitch);
    const cY = Math.cos(yaw);
    const sY = Math.sin(yaw);

    const r0x = cP * sY;
    const r0y = sP;
    const r0z = cP * cY;

    // Forward points from camera to black hole origin
    const fx = -r0x;
    const fy = -r0y;
    const fz = -r0z;

    // World up = (0, 1, 0) -> Right = normalize(F x Up)
    let rx = -fz; // fy*0 - fz*1
    let ry = 0;
    let rz = fx; // fx*1 - fy*0
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    rz /= rLen;

    // True camera Up = R x F
    const ux0 = ry * fz - rz * fy;
    const uy0 = rz * fx - rx * fz;
    const uz0 = rx * fy - ry * fx;

    // Apply subtle cinematic roll
    const cR = Math.cos(roll);
    const sR = Math.sin(roll);
    const Rx = cR * rx + sR * ux0;
    const Ry = cR * ry + sR * uy0;
    const Rz = cR * rz + sR * uz0;

    const Ux = -sR * rx + cR * ux0;
    const Uy = -sR * ry + cR * uy0;
    const Uz = -sR * rz + cR * uz0;

    // Slightly lower screen center when edge-on so the towering lensed arch shines
    const cyOffset = -0.055 * Math.cos(pitch * 1.6) * clamp01(1 - Math.abs(pitch) / 0.7);

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
    if (t <= 4.4) return t * 0.16;
    const since = t - 4.4;
    return 4.4 * 0.16 + since * 1.18 - 2.8 * (1 - Math.exp(-since / 2.8));
  }

  // Trace one 3D ray through Schwarzschild spacetime (writes into this.rayOut)
  traceRay(x, y, S, cam, ph, turn, knotA, knotB, knotC, pulse, t) {
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
      return out;
    }

    const invSide = 1 / side;
    const tx = t0x * invSide;
    const ty = t0y * invSide;
    const tz = t0z * invSide;

    const b = CAM * side;
    const bi = Math.floor((b / BMAX) * NB);
    const { usTable, escapeAngle } = this.geo;

    // Fast path outside exact table (weak gravity outer starfield)
    if (bi >= NB) {
      const skySample = this.sampleSky(dx, dy, dz, t);
      out.near = 0; out.far = 0; out.dop = 1; out.ring = 0;
      out.sky = skySample.v; out.skyTint = skySample.tint; out.hitHorizon = false;
      return out;
    }

    const us = usTable[bi];
    const aEsc = escapeAngle[bi];
    const hitHorizon = aEsc < 0;
    const end = (us.length - 1) * STEP;

    // Intersect equatorial accretion disk plane (y = 0): cos(a)*r0y + sin(a)*ty = 0
    let near = 0;
    let far = 0;
    let dopAccum = 0;
    let dopWeight = 0;

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

        // Relativistic Doppler beaming from 3D gas velocity vs 3D photon direction
        // Photon tangent from disk toward camera: w * p_hat - u * q_hat
        const wSlope = (us[q + 1] - us[q]) / STEP;
        const qx = -sa * cam.r0x + ca * tx;
        const qy = -sa * cam.r0y + ca * ty;
        const qz = -sa * cam.r0z + ca * tz;
        const kx = wSlope * hx - uVal * qx;
        const ky = -uVal * qy;
        const kz = wSlope * hz - uVal * qz;
        const kInv = 1 / (Math.hypot(kx, ky, kz) || 1);

        // Gas orbits counter-clockwise in x-z so left side approaches viewer: v_dir = (hz, 0, -hx)
        const vDotK = (hz * kx - hx * kz) * kInv;
        const beta = Math.min(0.48, Math.sqrt(0.48 / Math.max(1.25, r - 1)));
        const gamma = 1 / Math.sqrt(1 - beta * beta);
        const doppler = 1 / (gamma * (1 - beta * vDotK));
        const beam = Math.pow(doppler, 1.75);

        // Radial emissivity profile: blazing inner ISCO edge, wide graceful outer fade
        const edge =
          Math.min(1, (r - DISK_IN) / 0.5) *
          Math.pow(DISK_IN / r, 1.05) *
          (1 - smooth((r - 5.8) / 6.6));

        // Sample harmonic gas bands + spiral shear filaments + 3 orbiting knots
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
        const spiral =
          1 +
          0.22 * Math.sin((r - DISK_IN) * 2.4 - ph * 2.1 + phi * 3) +
          0.12 * Math.sin((r - DISK_IN) * 5.2 + ph * 1.4 - phi * 2);

        const da = angDiff(phi, knotA) / 0.34;
        const db = angDiff(phi, knotB) / 0.44;
        const dc = angDiff(phi, knotC) / 0.55;
        const ra = (r - 3.55) / 0.65;
        const rb = (r - 5.4) / 0.9;
        const rc = (r - 7.5) / 1.1;
        const knot =
          4.4 * Math.exp(-da * da - ra * ra) +
          3.1 * Math.exp(-db * db - rb * rb) +
          2.0 * Math.exp(-dc * dc - rc * rc);

        const weight = light * edge * beam * Math.pow(DISK_IN / r, 1.35);
        const val = weight * (gas * spiral + knot * pulse);

        // Crossings with ca > 0 and first intersection lie between camera and shadow
        if (ca > 0 && crossings === 0) near += val;
        else far += val;

        dopAccum += doppler * val;
        dopWeight += val;
        light *= 0.44;
      }
      crossings++;
    }

    // Razor-sharp relativistic photon ring right around b = B_CRIT
    let ring = 0;
    const bDiff = b - B_CRIT;
    if (bDiff > -0.14 && bDiff < 0.65) {
      const core = Math.exp(-Math.pow(bDiff / 0.085, 2));
      const halo = Math.exp(-Math.pow((bDiff - 0.14) / 0.24, 2)) * 0.34;
      // Photon ring also receives subtle Doppler spin asymmetry
      const ringDir = dx * cam.Rx;
      const ringBias = 1 - 0.28 * clamp(ringDir * 6, -1, 1);
      ring = (core + halo) * ringBias;
    }

    // Gravitationally lensed 3D sky & Einstein ring magnification
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

    // Star twinkling vs smooth galactic nebula
    if (base > 0.16) {
      const ph = this.sky.phase[idx];
      const twinkle = 0.62 + 0.38 * Math.sin(t * (1.2 + (idx % 7) * 0.22) + ph);
      out.v = base * twinkle; out.tint = this.sky.tint[idx];
      return out;
    }
    out.v = base; out.tint = this.sky.tint[idx];
    return out;
  }

  // Opening choreography + shockwaves + horizon pulse
  atmosphere(x, y, t) {
    const R0 = this.R0;
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const rr = r / R0;
    let heat = 0;

    // 1. Genesis circle drawn counter-clockwise out of the void
    if (t < 5.0) {
      const sweep = smooth((t - 0.3) / 2.1) * TAU;
      if (sweep > 0) {
        let d = (ang - 1.05) % TAU;
        if (d < 0) d += TAU;
        if (d <= sweep) {
          const radius = R0 * (1.98 - 0.82 * smooth((t - 0.25) / 2.5));
          const width = 0.007 + 0.005 * smooth((t - 0.25) / 2.0);
          const band = Math.exp(-Math.pow((r - radius) / width, 2));
          const trail = 1 - 0.5 * (d / Math.max(sweep, 1e-3));
          const spark = 0.72 + 0.28 * Math.sin(ang * 43 - t * 8.0);
          heat += band * trail * spark * (1 - smooth((t - 3.3) / 1.4));
        }
      }
    }

    // 2. Relativistic shockwaves thrown outward when Gargantua ignites
    heat += this.ripple((t - 2.85) / 1.45, rr, 4.9, 1.75);
    heat += this.ripple((t - 6.3) / 1.75, rr, 5.5, 1.15);
    if (t > 11.5) {
      const u = ((t - 11.5) % 7.2) / 3.0;
      heat += this.ripple(u, rr, 6.2, 0.45);
    }

    heat *= 1 + 0.28 * Math.exp(-Math.pow((t - 2.85) / 0.22, 2));
    return heat;
  }

  ripple(u, rr, reach, strength) {
    if (u < 0 || u > 1) return 0;
    const rad = 1.12 + (reach - 1.12) * Math.pow(u, 0.62);
    const w = 0.14 + 0.09 * u * u;
    const env = smooth(u * 8) * Math.pow(1 - u, 2.5);
    return Math.exp(-Math.pow((rr - rad) / w, 2)) * env * strength;
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

  draw(t) {
    const {
      cols, rows, cw, ch, ox, oy, buf, ux, vy, R0,
      front, back, frontShown, frontSmooth, shown, smoothField, glow,
      dopplerMap, skyHeat, skyTintCell, ringMap, shadowMask,
    } = this;
    buf.fill(0xff000000);

    const cam = this.cameraState(t);
    const S = B_CRIT / (CAM * R0 * cam.zoom);

    const ph = this.spinPhase(t);
    const turn = TAU * ((ph % LOOP) / LOOP);
    const knotA = ph * 0.72 + 1.1;
    const knotB = -ph * 0.45 + 3.9;
    const knotC = ph * 0.28 + 5.2;
    const pulse = 0.8 + 0.2 * Math.sin(t * 1.25);

    const diskOn = smooth((t - 4.3) / 2.2);
    const grow = smooth((t - 4.4) / 2.6);
    const ignite = smooth((t - 4.7) / 1.4);
    const ringOn = smooth((t - 2.5) / 1.1);
    const shadowOn = smooth((t - 2.1) / 1.2);
    const glowOn = smooth((t - 4.9) / 2.0);
    const flash = 1 + 0.55 * Math.exp(-Math.pow((t - 6.0) / 0.65, 2));
    const breathe = 1 + 0.045 * Math.sin(t * 0.38) + 0.02 * Math.sin(t * 0.91 + 1.5);
    const glowPulse = 1 + 0.08 * Math.sin(t * 0.6);
    const reach = (0.16 + 0.98 * grow) * cam.zoom;

    const dxW = cw / this.H;
    const dyW = ch / this.H;

    // 1. Per-frame 3D Schwarzschild geodesic ray tracing
    for (let row = 0; row < rows; row++) {
      const y0 = vy[row] - cam.cyOffset;
      for (let col = 0; col < cols; col++) {
        const x0 = ux[col];
        const k = row * cols + col;
        const rScreen = Math.hypot(x0, y0);

        // Adaptive 2x2 supersampling inside the Gargantua disk/photon-ring zone
        const hiDetail = rScreen < R0 * 5.8 * cam.zoom;
        let near = 0;
        let far = 0;
        let dop = 0;
        let ring = 0;
        let sky = 0;
        let skyTint = 0;
        let shadowHits = 0;

        if (hiDetail) {
          let wDop = 0;
          for (let sy = 0; sy < 2; sy++) {
            const y = y0 + (sy === 0 ? -0.25 : 0.25) * dyW;
            for (let sx = 0; sx < 2; sx++) {
              const x = x0 + (sx === 0 ? -0.25 : 0.25) * dxW;
              const res = this.traceRay(x, y, S, cam, ph, turn, knotA, knotB, knotC, pulse, t);
              near += res.near * 0.25;
              far += res.far * 0.25;
              const tot = res.near + res.far;
              dop += res.dop * tot;
              wDop += tot;
              ring += res.ring * 0.25;
              sky += res.sky * 0.25;
              if (res.sky > 0.12) skyTint = res.skyTint;
              if (res.hitHorizon) shadowHits += 0.25;
            }
          }
          dop = wDop > 1e-6 ? dop / wDop : 1.0;
        } else {
          const res = this.traceRay(x0, y0, S, cam, ph, turn, knotA, knotB, knotC, pulse, t);
          near = res.near;
          far = res.far;
          dop = res.dop;
          ring = res.ring;
          sky = res.sky;
          skyTint = res.skyTint;
          shadowHits = res.hitHorizon ? 1 : 0;
        }

        const gate = smooth((reach - rScreen * 0.85) / 0.16) * diskOn * ignite;
        front[k] = near;
        back[k] = far;
        shown[k] = (near + far) * gate;
        frontShown[k] = near * gate;
        dopplerMap[k] = dop;
        ringMap[k] = ring;
        skyHeat[k] = sky;
        skyTintCell[k] = skyTint;
        shadowMask[k] = shadowHits;
      }
    }

    // 2. Screen-space bloom for incandescent accretion gas
    this.blur(shown, smoothField, 1);
    this.blur(smoothField, glow, 2);
    this.blur(frontShown, frontSmooth, 1);

    // 3. Shade & composite ASCII cells
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
            smoothField[k] * 2.15 * flash * breathe +
            glow[k] * 1.12 * glowOn * glowPulse) *
            outside +
          photonGlow +
          frontSmooth[k] * 3.1 * flash * breathe * (1 - outside);

        // Soft rolloff preserves highlights without flat clipping
        heat = 1 - Math.exp(-1.62 * heat);

        if (heat >= 0.028) {
          const grain = hash2(col * 1.7 + 0.3, row * 2.3 + 0.1);
          const scaled = Math.pow(clamp01(heat), 1 / 1.16);
          let level = Math.floor(scaled * (INK_GOLD.length - 1) + grain * 0.38);
          if (level >= INK_GOLD.length) level = INK_GOLD.length - 1;
          if (level < 0) level = 0;

          // Relativistic color temperature:
          //   dop > 1.12 or peak photon ring -> hot white-gold / ice-blue tint (2)
          //   dop < 0.88                     -> deep receding copper-amber (0)
          //   otherwise                      -> classic Gargantua gold (1)
          const dop = dopplerMap[k];
          let tint = 1;
          if (dop > 1.12 || (photonGlow > 0.65 && heat > 0.6)) tint = 2;
          else if (dop < 0.89 && level < INK_GOLD.length - 3) tint = 0;

          this.blit(this.glyphFor(level, grain), this.inks[level][tint], px, py, true);
          letters++;
          continue;
        }

        // Lensed 3D background stars & galactic nebula (occluded inside event horizon)
        if (shadowMask[k] > 0.45 && shadowOn > 0.4) continue;
        const sv = skyHeat[k];
        if (sv < 0.04) continue;

        const tier = sv < 0.14 ? 0 : sv < 0.36 ? 1 : sv < 0.72 ? 2 : 3;
        const lut = this.starInks[skyTintCell[k]][tier];
        const glyph =
          sv < 0.12
            ? this.index.get(".")
            : sv < 0.32
              ? this.index.get(":")
              : sv < 0.65
                ? this.index.get("+")
                : this.index.get("*");
        this.blit(glyph, lut, px, py, false);
      }
    }

    // 4. 3D spiraling relativistic embers projected through camera basis
    const tanHalfFov = B_CRIT / (CAM * cam.zoom);
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      const cycle = ((t * e.infall + e.phase) % 10) / 10;
      const r = e.r0 * (1 - 0.58 * cycle) + DISK_IN * 0.58 * cycle;
      const phi = e.phi0 - t * e.speed * (1 + cycle * 0.8);
      const wx = r * Math.cos(phi);
      const wy = e.y0 * (1 - 0.5 * cycle);
      const wz = r * Math.sin(phi);

      // Relative to camera position C = CAM * r0
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
      // Don't draw embers behind the black hole shadow
      if (depth > CAM && shadowMask[idx] > 0.35) continue;
      if (front[idx] + back[idx] > 0.08) continue;

      const fade = Math.sin(cycle * Math.PI) * (0.45 + 0.55 * Math.sin(t * e.twinkle + e.phase));
      if (fade < 0.2) continue;

      const glyph = fade > 0.72 ? this.index.get("*") : this.index.get(".");
      const lut = this.starInks[1][fade > 0.65 ? 2 : 1];
      this.blit(glyph, lut, ox + col * cw, oy + row * ch, false);
    }

    this.ctx.putImageData(this.img, 0, 0);
    return letters;
  }

  glyphFor(level, grain) {
    const span = this.chars.length - 1;
    let idx = Math.round((level / (INK_GOLD.length - 1)) * span);
    if (grain > 0.92) idx += 1;
    else if (grain < 0.08) idx -= 1;
    if (idx < 0) idx = 0;
    if (idx > span) idx = span;
    return idx;
  }
}
