"""
Validation of the polygon-geometry section engine against published tables.

Reference data (A in cm2, Iy/Iz in cm4, dimensions in mm, root radius r in mm)
is reproduced from the Stabileo project's ``steel-profiles.ts``, itself sourced
from eurocodepy / EN 10365 / DIN 1025 (MIT, with attribution). The engine must
reproduce A, Iy and Iz to within table rounding (a few tenths of a percent).
"""
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, ".."))
sys.path.insert(0, _BACKEND)

from opensees.sections import geometry as geo  # noqa: E402
from opensees.sections import catalogue as cat  # noqa: E402


def rel(a, b):
    return abs(a - b) / abs(b)


# (name, family, h, b, tw, tf, r, A_cm2, Iy_cm4, Iz_cm4)
ROLLED = [
    # IPE
    ("IPE 80", "ipe", 80, 46, 3.8, 5.2, 5, 7.64, 80.1, 8.49),
    ("IPE 100", "ipe", 100, 55, 4.1, 5.7, 7, 10.3, 171, 15.9),
    ("IPE 120", "ipe", 120, 64, 4.4, 6.3, 7, 13.2, 318, 27.7),
    ("IPE 140", "ipe", 140, 73, 4.7, 6.9, 7, 16.4, 541, 44.9),
    ("IPE 160", "ipe", 160, 82, 5.0, 7.4, 9, 20.1, 869, 68.3),
    ("IPE 180", "ipe", 180, 91, 5.3, 8.0, 9, 23.9, 1317, 101),
    ("IPE 200", "ipe", 200, 100, 5.6, 8.5, 12, 28.5, 1943, 142),
    ("IPE 220", "ipe", 220, 110, 5.9, 9.2, 12, 33.4, 2772, 205),
    ("IPE 240", "ipe", 240, 120, 6.2, 9.8, 15, 39.1, 3892, 284),
    ("IPE 270", "ipe", 270, 135, 6.6, 10.2, 15, 45.9, 5790, 420),
    ("IPE 300", "ipe", 300, 150, 7.1, 10.7, 15, 53.8, 8356, 604),
    ("IPE 330", "ipe", 330, 160, 7.5, 11.5, 18, 62.6, 11770, 788),
    ("IPE 360", "ipe", 360, 170, 8.0, 12.7, 18, 72.7, 16270, 1043),
    ("IPE 400", "ipe", 400, 180, 8.6, 13.5, 21, 84.5, 23130, 1318),
    ("IPE 450", "ipe", 450, 190, 9.4, 14.6, 21, 98.8, 33740, 1676),
    ("IPE 500", "ipe", 500, 200, 10.2, 16.0, 21, 116, 48200, 2142),
    ("IPE 550", "ipe", 550, 210, 11.1, 17.2, 24, 134, 67120, 2668),
    ("IPE 600", "ipe", 600, 220, 12.0, 19.0, 24, 156, 92080, 3387),
    # HEB
    ("HEB 100", "heb", 100, 100, 6.0, 10.0, 12, 26.0, 450, 167),
    ("HEB 140", "heb", 140, 140, 7.0, 12.0, 12, 43.0, 1509, 550),
    ("HEB 200", "heb", 200, 200, 9.0, 15.0, 18, 78.1, 5696, 2003),
    ("HEB 240", "heb", 240, 240, 10.0, 17.0, 21, 106, 11260, 3923),
    ("HEB 300", "heb", 300, 300, 11.0, 19.0, 27, 149, 25170, 8563),
    ("HEB 400", "heb", 400, 300, 13.5, 24.0, 27, 198, 57680, 10820),
    ("HEB 500", "heb", 500, 300, 14.5, 28.0, 27, 239, 107200, 12620),
    ("HEB 600", "heb", 600, 300, 15.5, 30.0, 27, 270, 171000, 13530),
    # HEA
    ("HEA 100", "hea", 96, 100, 5.0, 8.0, 12, 21.2, 349, 134),
    ("HEA 160", "hea", 152, 160, 6.0, 9.0, 15, 38.8, 1673, 616),
    ("HEA 200", "hea", 190, 200, 6.5, 10.0, 18, 53.8, 3692, 1336),
    ("HEA 300", "hea", 290, 300, 8.5, 14.0, 27, 113, 18260, 6310),
    ("HEA 400", "hea", 390, 300, 11.0, 19.0, 27, 159, 45070, 8564),
    ("HEA 600", "hea", 590, 300, 13.0, 25.0, 27, 226, 141200, 11270),
]

# IPN (tapered): h, b, tw, tf, A, Iy, Iz
IPN = [
    ("IPN 80", 80, 42, 3.9, 5.9, 7.57, 77.8, 6.29),
    ("IPN 120", 120, 58, 5.1, 7.7, 14.2, 328, 21.5),
    ("IPN 160", 160, 74, 6.3, 9.5, 22.8, 935, 54.7),
    ("IPN 200", 200, 90, 7.5, 11.3, 33.4, 2140, 117),
    ("IPN 240", 240, 106, 8.7, 13.1, 46.1, 4250, 221),
    ("IPN 300", 300, 125, 10.8, 16.2, 69.0, 9800, 451),
    ("IPN 400", 400, 155, 14.4, 21.6, 118, 29210, 1160),
    ("IPN 500", 500, 185, 18.0, 27.0, 179, 68740, 2480),
    ("IPN 600", 600, 215, 21.6, 32.4, 254, 139000, 4670),
]

# UPN (tapered channel): h, b, tw, tf, A, Iy, Iz
UPN = [
    ("UPN 80", 80, 45, 6.0, 8.0, 11.0, 106, 19.4),
    ("UPN 120", 120, 55, 7.0, 9.0, 17.0, 364, 43.2),
    ("UPN 160", 160, 65, 7.5, 10.5, 24.0, 925, 85.3),
    ("UPN 200", 200, 75, 8.5, 11.5, 32.2, 1910, 148),
    ("UPN 240", 240, 85, 9.5, 13.0, 42.3, 3600, 248),
    ("UPN 300", 300, 100, 10.0, 16.0, 58.8, 8030, 495),
]

# Equal-leg angles (filleted): h=b, t, r_root, A, Iy
ANGLES = [
    ("L 30x30x3", 30, 3, 5, 1.74, 1.41),
    ("L 50x50x5", 50, 5, 7, 4.80, 11.0),
    ("L 60x60x6", 60, 6, 8, 6.91, 22.8),
    ("L 80x80x8", 80, 8, 10, 12.3, 72.2),
    ("L 100x100x10", 100, 10, 12, 19.2, 177),
    ("L 150x150x15", 150, 15, 16, 43.0, 898),
]


def _m2(v_mm):
    return v_mm * 1e-3


def check(name, got_a, got_iy, got_iz, want_a, want_iy, want_iz, tol):
    errs = []
    ra = rel(got_a * 1e4, want_a)
    riy = rel(got_iy * 1e8, want_iy)
    riz = rel(got_iz * 1e8, want_iz)
    ok = ra < tol and riy < tol and riz < tol
    if not ok:
        errs.append(f"{name}: A {got_a*1e4:.2f}/{want_a} ({ra*100:+.2f}%) "
                    f"Iy {got_iy*1e8:.1f}/{want_iy} ({riy*100:+.2f}%) "
                    f"Iz {got_iz*1e8:.1f}/{want_iz} ({riz*100:+.2f}%)")
    return ok, errs


def run_validation():
    failures = []
    n_ok = 0
    # --- parallel-flange rolled I/H ---
    for (name, fam, h, b, tw, tf, r, a, iy, iz) in ROLLED:
        p = geo.analyze_section(cat.i_section(_m2(h), _m2(b), _m2(tw), _m2(tf), _m2(r)))
        ok, e = check(name, p.a, p.iy, p.iz, a, iy, iz, 0.012)
        if ok:
            n_ok += 1
        else:
            failures += e
    # --- tapered IPN ---
    for (name, h, b, tw, tf, a, iy, iz) in IPN:
        p = geo.analyze_section(cat.ipn_section(_m2(h), _m2(b), _m2(tw), _m2(tf)))
        ok, e = check(name, p.a, p.iy, p.iz, a, iy, iz, 0.015)
        if ok:
            n_ok += 1
        else:
            failures += e
    # --- tapered UPN ---
    for (name, h, b, tw, tf, a, iy, iz) in UPN:
        p = geo.analyze_section(cat.upn_section(_m2(h), _m2(b), _m2(tw), _m2(tf)))
        ok, e = check(name, p.a, p.iy, p.iz, a, iy, iz, 0.02)
        if ok:
            n_ok += 1
        else:
            failures += e
    # --- angles (Iy only; Iz symmetric) ---
    for (name, b, t, r, a, iy) in ANGLES:
        p = geo.analyze_section(cat.angle_section_filleted(_m2(b), _m2(b), _m2(t), _m2(r), _m2(r * 0.5)))
        ok, e = check(name, p.a, p.iy, p.iy, a, iy, iy, 0.01)
        if ok:
            n_ok += 1
        else:
            failures += e

    return n_ok, failures


if __name__ == "__main__":
    n_ok, failures = run_validation()
    total = len(ROLLED) + len(IPN) + len(UPN) + len(ANGLES)
    for f in failures:
        print("FAIL", f)
    print(f"\n{total - len(failures)}/{total} profiles within tolerance")
    sys.exit(1 if failures else 0)