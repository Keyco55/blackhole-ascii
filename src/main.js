import { BlackHole } from "./blackhole.js";
import { PY_SOURCE } from "./code.js";

const FIRST_LINE = 141; // pick up inside trace_ray(), so the final print lands around 20s
const LINE_RATE = 4.3;
const START_LINES = 7;

const skyEl = document.querySelector(".sky");
const canvas = document.getElementById("sky");
const consoleEl = document.getElementById("console");
const codeEl = document.getElementById("code");
const clockEl = document.getElementById("clock");
const spinEl = document.getElementById("spin");
const heatEl = document.getElementById("heat");
const tiltEl = document.getElementById("tilt");
const lettersEl = document.getElementById("letters");
const hintEl = document.getElementById("hint");

const bh = new BlackHole(canvas);

/* ------------------------------------------------------------------ */
/* 3D interactive orbit & zoom                                         */
/* ------------------------------------------------------------------ */

const pointers = new Map();
let lastPinchDist = null;
let lastTapTime = 0;

function hideHint() {
  if (hintEl && !hintEl.classList.contains("hidden")) {
    hintEl.classList.add("hidden");
  }
}

function pinchDist() {
  const pts = Array.from(pointers.values());
  if (pts.length < 2) return null;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  bh.setDragging(true);
  hideHint();
  lastPinchDist = pinchDist();

  const now = performance.now();
  if (pointers.size === 1 && now - lastTapTime < 280) {
    bh.resetOrbit();
  }
  lastTapTime = now;
});

canvas.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1) {
    bh.orbitBy(-dx * 0.0075, dy * 0.0065);
  } else if (pointers.size === 2) {
    const dist = pinchDist();
    if (dist && lastPinchDist) {
      bh.zoomBy(dist / lastPinchDist);
    }
    lastPinchDist = dist;
  }
});

function releasePointer(e) {
  pointers.delete(e.pointerId);
  lastPinchDist = pinchDist();
  if (pointers.size === 0) bh.setDragging(false);
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    hideHint();
    bh.zoomBy(Math.exp(-e.deltaY * 0.0012));
  },
  { passive: false },
);

/* ------------------------------------------------------------------ */
/* clock                                                               */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const seek = params.has("t") ? Math.max(0, Number(params.get("t")) || 0) : null;
const frozen = params.get("hold") === "1";
const started = performance.now();

function sceneTime() {
  const elapsed = (performance.now() - started) / 1000;
  if (frozen && seek !== null) return seek;
  return (seek ?? 0) + elapsed;
}

/* ------------------------------------------------------------------ */
/* code pane                                                           */
/* ------------------------------------------------------------------ */

const source = PY_SOURCE.replace(/\n$/, "").split("\n").slice(FIRST_LINE - 1);
const lineEls = [];
const cursor = document.createElement("span");
cursor.className = "cursor";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(src) {
  const re =
    /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|with|lambda|is|None|True|False|break|continue|try|except|finally)\b|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\()/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const text = esc(m[0]);
    if (m[1]) out += `<span class="tok-c">${text}</span>`;
    else if (m[2]) out += `<span class="tok-s">${text}</span>`;
    else if (m[3]) out += `<span class="tok-k">${text}</span>`;
    else if (m[4]) out += `<span class="tok-n">${text}</span>`;
    else out += `<span class="tok-f">${text}</span>`;
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return out || " ";
}

const lineHeight = 13;
let activeEl = null;
let activeIdx = -1;
let typedKey = "";

for (let i = 0; i < source.length; i++) {
  const row = document.createElement("div");
  row.className = "ln";
  const no = document.createElement("span");
  no.className = "no";
  no.textContent = String(FIRST_LINE + i);
  const src = document.createElement("span");
  src.className = "src";
  src.innerHTML = highlight(source[i]);
  row.append(no, src);
  row.style.display = "none";
  codeEl.append(row);
  lineEls.push(row);
}

function measure() {
  bh.resize();
  codeEl.style.transform = "translate3d(0,0,0)";
}

new ResizeObserver(measure).observe(skyEl);
window.addEventListener("resize", measure);

/* ------------------------------------------------------------------ */
/* frame loop (60 fps target)                                          */
/* ------------------------------------------------------------------ */

const frameStep = 1000 / 62;
let prev = performance.now();
let acc = 0;

function tick(now) {
  requestAnimationFrame(tick);
  acc += Math.min(100, now - prev);
  prev = now;
  if (acc < frameStep) return;
  acc = acc % frameStep;

  const t = sceneTime();
  const letters = bh.draw(t);
  updateHud(t, letters);
  updateCode(t);
}

function updateHud(t, letters) {
  clockEl.textContent = `t ${t.toFixed(2).padStart(5, "0")}s`;

  const spin =
    0.3 + 0.34 * Math.max(0, t - 6.5) + 0.1 + 0.02 * Math.sin(t * 0.7);
  spinEl.textContent = spin.toFixed(2);

  const heat =
    0.86 +
    0.75 * smooth((t - 4) / 2) +
    0.85 * smooth((t - 8) / 6) +
    0.4 * Math.exp(-Math.pow((t - 6.4) / 0.9, 2));
  heatEl.textContent = heat.toFixed(2);

  if (tiltEl) {
    tiltEl.textContent = `${bh.currentTiltDeg.toFixed(1)}°`;
  }

  lettersEl.textContent = formatLetters(letters);
}

function smooth(x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}

function formatLetters(n) {
  const s = String(n).padStart(4, "0");
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function updateCode(t) {
  const progress = Math.min(
    source.length - 0.001,
    START_LINES + Math.max(0, t - 1) * LINE_RATE,
  );
  const count = Math.floor(progress) + 1;
  const last = Math.max(0, Math.min(source.length - 1, count - 1));
  const frac = progress - Math.floor(progress);

  for (let i = 0; i < lineEls.length; i++) {
    const el = lineEls[i];
    el.style.display = i <= last ? "flex" : "none";
  }

  if (activeEl !== lineEls[last]) {
    if (activeEl) {
      activeEl.classList.remove("active");
      activeEl.querySelector(".src").innerHTML = highlight(source[activeIdx]);
    }
    activeEl = lineEls[last];
    activeIdx = last;
    activeEl.classList.add("active");
    activeEl.querySelector(".src").append(cursor);
    typedKey = "";
  }

  const upto = Math.ceil(frac * source[last].length);
  const srcEl = activeEl.querySelector(".src");
  const key = last + ":" + upto;
  if (key !== typedKey) {
    typedKey = key;
    const text = source[last].slice(0, upto);
    srcEl.innerHTML = highlight(text);
    srcEl.append(cursor);
  }

  const panelH = consoleEl.clientHeight;
  const offset = Math.max(0, last * lineHeight - panelH * 0.62);
  codeEl.style.transform = `translate3d(0, ${-offset}px, 0)`;
}

requestAnimationFrame(tick);
