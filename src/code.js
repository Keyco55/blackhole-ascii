// The terminal pane is a running 3D Gargantua Python ray-tracer.
// This is the source printed underneath the picture, line by line.

export const PY_SOURCE = String.raw`# gargantua 3d — schwarzschild ray-tracer in characters
# keyco / 2026
#
# geodesics u'' = 1.5*u^2 - u are tabulated via rk4, then each
# frame casts 3d camera rays through bent space with relativistic
# doppler beaming, lensed background stars, and 3d accretion flow.

import math
import sys
import time

COLS   = 112
ROWS   = 62
FPS    = 60
GAMMA  = 1.16

CAM      = 28.0
DISK_IN  = 2.60       # inner isco edge, in schwarzschild radii
DISK_OUT = 10.60
B_CRIT   = 3.0 * math.sqrt(3.0) / 2.0
STEP     = 0.018

RAMP = " .:-=+<~i!lI?][}{1)(tfjrxnuvcz*#%@"
PAPER = "\x1b[48;2;0;0;0m"
HOME  = "\x1b[H"


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def smooth(x):
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def norm3(x, y, z):
    inv = 1.0 / max(1e-9, math.hypot(x, y, z))
    return x * inv, y * inv, z * inv


def trace_geodesic(b):
    """integrate photon orbit u'' = 1.5*u^2 - u via rk4"""
    u = 1.0 / CAM
    w = math.sqrt(max(0.0, 1.0 - (b / CAM) ** 2)) / b
    path = [u]
    for step in range(2400):
        f = lambda uu: 1.5 * uu * uu - uu
        k1, l1 = w, f(u)
        k2, l2 = w + 0.5 * STEP * l1, f(u + 0.5 * STEP * k1)
        k3, l3 = w + 0.5 * STEP * l2, f(u + 0.5 * STEP * k2)
        k4, l4 = w + STEP * l3, f(u + STEP * k3)
        u_next = u + (STEP / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        w_next = w + (STEP / 6.0) * (l1 + 2.0 * l2 + 2.0 * l3 + l4)
        if u_next >= 1.0:
            return path, -1.0
        if u_next <= 0.0 and w_next < 0.0:
            frac = u / max(1e-9, u - u_next)
            return path, (step + frac) * STEP
        u, w = u_next, w_next
        if u >= 0.04 or w > 0.0:
            path.append(u)
    return path, -1.0


def camera_basis(t):
    """cinematic 3d fly-by orbiting gargantua"""
    fly = smooth((t - 4.8) / 3.8)
    yaw = fly * (0.24 * (t - 4.8) + 0.35 * math.sin((t - 4.8) * 0.17))
    pitch = 0.075 + fly * (0.04 + 0.36 * (0.5 - 0.5 * math.cos((t - 4.8) * 0.22)))
    roll = fly * 0.075 * math.sin((t - 4.8) * 0.19)

    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    r0 = (cp * sy, sp, cp * cy)
    fwd = (-r0[0], -r0[1], -r0[2])
    right0 = norm3(-fwd[2], 0.0, fwd[0])
    up0 = (
        right0[1] * fwd[2] - right0[2] * fwd[1],
        right0[2] * fwd[0] - right0[0] * fwd[2],
        right0[0] * fwd[1] - right0[1] * fwd[0],
    )
    cr, sr = math.cos(roll), math.sin(roll)
    right = tuple(cr * right0[i] + sr * up0[i] for i in range(3))
    up = tuple(-sr * right0[i] + cr * up0[i] for i in range(3))
    return r0, fwd, right, up


def doppler_beam(r, hx, hz, qx, qy, qz, u_val, w_slope):
    """relativistic beaming: approaching limb shines white-gold"""
    kx = w_slope * hx - u_val * qx
    ky = -u_val * qy
    kz = w_slope * hz - u_val * qz
    inv = 1.0 / max(1e-9, math.hypot(kx, ky, kz))
    v_dot_k = (hz * kx - hx * kz) * inv
    beta = min(0.56, math.sqrt(0.55 / max(1.15, r - 1.0)))
    gamma = 1.0 / math.sqrt(1.0 - beta * beta)
    doppler = 1.0 / (gamma * (1.0 - beta * v_dot_k))
    return doppler ** 2.15


def spin_phase(t):
    if t <= 4.4:
        return t * 0.16
    since = t - 4.4
    return 4.4 * 0.16 + since * 1.18 - 2.8 * (1.0 - math.exp(-since / 2.8))


def disk_turbulence(r, phi, ph):
    """keplerian spiral shear filaments and orbiting hot knots"""
    omega = 9.0 * (DISK_IN / r) ** 1.5
    phase = phi - omega * ph * 0.15
    wisp = 0.72 + 0.28 * math.sin(phase * 3.0 + r * 1.9)
    spiral = 1.0 + 0.22 * math.sin((r - DISK_IN) * 2.4 - ph * 2.1 + phi * 3.0)
    knot_a = math.exp(-((phi - (ph * 0.72 + 1.1)) % 6.28 / 0.34) ** 2 - ((r - 3.55) / 0.65) ** 2)
    knot_b = math.exp(-((phi - (-ph * 0.45 + 3.9)) % 6.28 / 0.44) ** 2 - ((r - 5.40) / 0.90) ** 2)
    return wisp * spiral + 4.4 * knot_a + 3.1 * knot_b


def trace_ray(x, y, fov, cam, table, t):
    r0, fwd, right, up = cam
    dx, dy, dz = norm3(
        x * fov * right[0] + y * fov * up[0] + fwd[0],
        x * fov * right[1] + y * fov * up[1] + fwd[1],
        x * fov * right[2] + y * fov * up[2] + fwd[2],
    )
    dr = dx * r0[0] + dy * r0[1] + dz * r0[2]
    tx, ty, tz = dx - dr * r0[0], dy - dr * r0[1], dz - dr * r0[2]
    side = math.hypot(tx, ty, tz)
    if side < 1e-4:
        return 0.0

    tx, ty, tz = tx / side, ty / side, tz / side
    b = CAM * side
    us, a_esc = table(b)
    end = (len(us) - 1) * STEP

    a0 = math.atan2(-r0[1], ty) % math.pi
    heat, light, ph = 0.0, 1.0, spin_phase(t)

    for k in range(3):
        a = a0 + k * math.pi
        if a >= end:
            break
        q = int(a / STEP)
        if q + 1 >= len(us):
            break
        u_val = us[q] + (us[q + 1] - us[q]) * (a / STEP - q)
        if u_val <= 0.04:
            continue
        r = 1.0 / u_val
        if DISK_IN < r < DISK_OUT:
            ca, sa = math.cos(a), math.sin(a)
            hx, hz = ca * r0[0] + sa * tx, ca * r0[2] + sa * tz
            phi = math.atan2(hz, hx)
            qx, qy, qz = -sa * r0[0] + ca * tx, -sa * r0[1] + ca * ty, -sa * r0[2] + ca * tz
            beam = doppler_beam(r, hx, hz, qx, qy, qz, u_val, (us[q + 1] - us[q]) / STEP)
            edge = min(1.0, (r - DISK_IN) / 0.55) * (DISK_IN / r) ** 1.25
            heat += light * edge * beam * disk_turbulence(r, phi, ph)
            light *= 0.44

    # photon ring & gravitational lensing of background stars
    ring = math.exp(-((b - B_CRIT) / 0.085) ** 2) * 1.65 * smooth((t - 2.5) / 1.1)
    if a_esc < 0.0:
        return heat
    return heat + ring


def frame(t, cols, rows, aspect, table):
    cam = camera_basis(t)
    fov = B_CRIT / (CAM * 0.098 * aspect)
    ignite = smooth((t - 4.7) / 1.4)
    chars = []

    for row in range(rows):
        y = 0.5 - (row + 0.5) / rows
        line = []
        for col in range(cols):
            x = ((col + 0.5) / cols - 0.5) * aspect
            heat = 1.0 - math.exp(-1.62 * trace_ray(x, y, fov, cam, table, t) * ignite)
            if heat < 0.028:
                line.append(" ")
                continue
            scaled = clamp(heat) ** (1.0 / GAMMA)
            idx = min(int(scaled * (len(RAMP) - 1)), len(RAMP) - 1)
            line.append(RAMP[idx])
        chars.append(line)
    return chars


def hud(t, chars):
    letters = sum(1 for row in chars for c in row if c != " ")
    heat = 0.86 + 0.75 * smooth((t - 4.0) / 2.0)
    tilt = math.degrees(0.075 + 0.40 * smooth((t - 4.8) / 3.8))
    return "  spin %.2f  heat %.2f  tilt %.1f°  letters %s" % (spin_phase(t), heat, tilt, f"{letters:,}")


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
    geodesics = [trace_geodesic((i + 0.5) / 1800.0 * 20.0) for i in range(1800)]
    table = lambda b: geodesics[min(1799, int(b / 20.0 * 1800))]
    start = time.perf_counter()
    step = 1.0 / FPS

    while True:
        t = time.perf_counter() - start
        chars = frame(t, cols, rows, aspect, table)
        draw(chars, t)
        time.sleep(max(0.0, step - (time.perf_counter() - start - t)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stdout.write("\x1b[0m\n")
    finally:
        print("Cheering for all the good things to come in your season,")
`;
