// The terminal pane in the video is a running Python renderer.
// This is the source we print underneath the picture, line by line.

export const PY_SOURCE = String.raw`# black hole, drawn in characters
# keyco / 2026
#
# 108 x 60 cells, 30 frames a second. the disk is sampled in
# screen space, lit by a turbulence field, and then quantised
# down to a small ramp of ink.

import math
import sys
import time

COLS   = 108
ROWS   = 60
FPS    = 30
GAMMA  = 1.35

R0     = 0.092        # photon sphere, in sky heights
R_IN   = 1.04 * R0    # inner edge of the disk
R_HALO = 1.30 * R0    # lensed far side of the disk
TILT   = 0.055        # the disk sits a little high on the right
FLASH  = 6.2          # ignition

RAMP = " .:-=+<~i!lI?][}{1)(tfjrxnuvcz*#%@"
INK = (
    ( 10,   7,   4), ( 32,  21,  12), ( 54,  35,  19),
    ( 78,  51,  27), (102,  67,  36), (126,  84,  46),
    (150, 102,  56), (174, 122,  69), (196, 143,  84),
    (214, 163, 102), (228, 184, 124), (238, 204, 148),
    (248, 226, 186),
)
PAPER = "\x1b[48;2;0;0;0m"
HOME  = "\x1b[H"


def clamp(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def smooth(x):
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def fract(x):
    return x - math.floor(x)


def hash2(x, y):
    return fract(math.sin(x * 127.1 + y * 311.7) * 43758.5453)


def noise(x, y):
    """value noise - cheap, and smooth enough for a galaxy"""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    ux = fx * fx * (3.0 - 2.0 * fx)
    uy = fy * fy * (3.0 - 2.0 * fy)
    a = hash2(ix, iy)
    b = hash2(ix + 1, iy)
    c = hash2(ix, iy + 1)
    d = hash2(ix + 1, iy + 1)
    top = a + (b - a) * ux
    bot = c + (d - c) * ux
    return top + (bot - top) * uy


def fbm(x, y):
    return (0.60 * noise(x, y) +
            0.28 * noise(x * 2.3 + 11.0, y * 2.3 + 7.0) +
            0.12 * noise(x * 5.1 + 3.0, y * 5.1 + 9.0))


def spin(t):
    return 0.30 + 0.34 * max(0.0, t - 6.5) + 0.10 * smooth((t - 4.2) / 1.8)


def cell(col, row, cols, rows, aspect):
    u = (col + 0.5) / cols - 0.5
    v = 0.5 - (row + 0.5) / rows
    return u * aspect, v


def first_circle(t, r, ang):
    """the first circle, drawn counter-clockwise out of nothing"""
    sweep = smooth((t - 0.35) / 2.2) * 6.283185
    if sweep <= 0.0:
        return 0.0

    d = (ang - 1.05) % 6.283185
    if d > sweep:
        return 0.0

    radius = R0 * (1.95 - 0.78 * smooth((t - 0.30) / 2.60))
    width = 0.007 + 0.005 * smooth((t - 0.30) / 2.0)
    band = math.exp(-((r - radius) / width) ** 2)

    trail = 1.0 - 0.50 * (d / max(sweep, 1e-3))
    spark = 0.70 + 0.30 * math.sin(ang * 41.0 - t * 7.5)
    return band * trail * spark * (1.0 - smooth((t - 3.4) / 1.4))


def photon_ring(t, r):
    """the thin bright edge of the shadow"""
    edge = math.exp(-((r - R0 * 1.025) / 0.0055) ** 2)
    glow = math.exp(-((r - R0 * 1.065) / 0.020) ** 2) * 0.30
    hug = math.exp(-((r - R0 * 1.17) / 0.035) ** 2) * 0.55
    hug *= smooth((t - 3.2) / 1.4) * (1.0 - smooth((t - 7.2) / 2.4))
    return (edge + glow) * smooth((t - 2.8) / 1.2) + hug


def accretion_disk(t, x, y):
    """the flat thing we are looking at almost edge on"""
    grow = smooth((t - 4.7) / 2.7)
    ignite = smooth((t - 5.2) / 1.7)
    if grow <= 0.0 or ignite <= 0.0:
        return 0.0

    mid = TILT * x - 0.004
    yy = y - mid
    thick = (0.055 + 0.020 * math.exp(-(x / 0.28) ** 2)
             - 0.018 * min(1.0, abs(x) / 0.45))
    band = math.exp(-((abs(yy) / thick) ** 2.2))

    reach = 0.10 + 0.86 * grow
    band *= smooth((reach - abs(x)) / 0.12)
    band *= 0.55 + 0.75 * math.exp(-((abs(x) - 0.10) / 0.36) ** 2)

    lanes = math.sin(19.0 * yy / thick +
                     2.1 * math.sin(x * 9.0 - t * 0.45) - t * 0.55)
    band *= 0.88 + 0.14 * lanes

    dust = fbm(x * 7.0 + t * 0.05, yy * 24.0 - t * 0.10)
    band *= 0.68 + 0.50 * dust

    flash = math.exp(-((t - FLASH) / 0.70) ** 2)
    return band * ignite * 1.00 * (1.0 + 1.05 * flash)


def lensed_halo(t, r, ang, y):
    """light from the far side, bent up over the shadow"""
    on = smooth((t - 5.9) / 1.6)
    if on <= 0.0:
        return 0.0

    width = 0.038 + 0.006 * min(2.0, abs(x) / R0)
    band = math.exp(-((r - R_HALO) / width) ** 2)
    up = smooth((y / R0 + 0.35) / 1.10)
    band *= 0.30 + 0.70 * up
    band *= 0.74 + 0.26 * math.sin(ang * 6.0 + t * 0.35)

    flash = math.exp(-((t - 6.6) / 0.9) ** 2)
    fill = math.exp(-((r - R0 * 1.14) / 0.14) ** 2)
    above = smooth((y / R0 + 0.6) / 1.4)
    band += fill * above * 0.42
    return band * on * (1.35 + 0.45 * flash)


def shade(t, col, row, cols, rows, aspect):
    x, y = cell(col, row, cols, rows, aspect)
    y += 0.115                        # the hole sits below centre

    r = math.hypot(x, y)
    ang = math.atan2(y, x)

    heat = first_circle(t, r, ang)
    heat += photon_ring(t, r)
    heat += lensed_halo(t, r, ang, y)
    heat += accretion_disk(t, x, y)

    if r < R0 * 0.995:                # the shadow
        heat = 0.0
    return min(heat, 1.35)


def frame(t, cols, rows, aspect):
    chars = []
    for row in range(rows):
        line = []
        for col in range(cols):
            heat = shade(t, col, row, cols, rows, aspect)
            if heat < 0.012:
                line.append(" ")
                continue
            grain = hash2(col * 1.7 + 0.3, row * 2.3 + 0.1)
            scaled = clamp(heat) ** (1.0 / GAMMA)
            level = int(scaled * (len(RAMP) - 1) + grain * 0.85)
            line.append(RAMP[min(level, len(RAMP) - 1)])
        chars.append(line)
    return chars


def hud(t, chars):
    """the small print under the picture"""
    letters = sum(1 for row in chars for c in row if c != " ")
    heat = 0.86 + 0.75 * smooth((t - 4.0) / 2.0)
    return "  spin %.2f  heat %.2f  letters %s" % (spin(t), heat, f"{letters:,}")


def draw(chars, t):
    out = [PAPER, HOME]
    for row in chars:
        out.append("".join(row))
        out.append("\n")
    out.append(hud(t, chars))
    sys.stdout.write("".join(out))
    sys.stdout.flush()


def main():
    cols, rows = COLS, ROWS
    aspect = 0.90
    start = time.perf_counter()
    step = 1.0 / FPS

    while True:
        t = time.perf_counter() - start
        chars = frame(t, cols, rows, aspect)
        draw(chars, t)
        time.sleep(max(0.0, step - (time.perf_counter() - start - t)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stdout.write("\x1b[0m\n")
`;
