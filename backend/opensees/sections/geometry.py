"""
Polygon-outline cross-section engine (ported from the geometry rules validated
in the Stabileo project, https://github.com/lambdaclass/stabileo).

The core idea, unlike analytic per-shape formulas, is that every section is
turned into one or more closed polygon outlines, and ALL geometric properties
(area, centroid, moments of inertia, product of inertia, principal axes,
section moduli, radii of gyration, perimeter, bounding box) are computed from
those outlines by the shoelace formula plus the parallel-axis theorem. One
geometry therefore drives properties, drawing and (in a full engine) meshing,
so they cannot drift apart.

Rolled profiles carry authoritative root/corner fillets and flange taper — the
difference between a sharp-cornered outline (2.4-6.0 % light on area) and the
published table. Tapered rolled families (IPN 14 %, UPN 8 %) are built from
rules on the profile's own dimensions, not from an extra recalled table.

Local section coordinates: y = width direction, z = height direction.
All lengths are in consistent units (metres, in the Buckle pipeline).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Sequence, Tuple


# --------------------------------------------------------------------------- #
# Polygon primitives
# --------------------------------------------------------------------------- #
Y, Z = 0, 1


def arc_points(cy: float, cz: float, r: float, a0: float, a1: float, n: int) -> List[Tuple[float, float]]:
    """Discretise an arc [a0, a1] with n segments (n+1 points), all angles in radians."""
    n = max(n, 1)
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * (i / n)
        pts.append((cy + r * math.cos(a), cz + r * math.sin(a)))
    return pts


@dataclass
class Polygon:
    """A closed polygon region. ``is_void`` marks a hole (subtracted)."""
    vertices: List[Tuple[float, float]]
    is_void: bool = False


DEFAULT_ARC_SEGMENTS = 16


# --------------------------------------------------------------------------- #
# Integration (mirrors engine/src/section/mod.rs `analyze_section` + helpers)
# --------------------------------------------------------------------------- #
@dataclass
class PolygonBasic:
    area: float
    yc: float
    zc: float
    y_min: float
    y_max: float
    z_min: float
    z_max: float


def _polygon_basic(verts: Sequence[Tuple[float, float]]) -> PolygonBasic:
    n = len(verts)
    area = 0.0
    cy = 0.0
    cz = 0.0
    y_min = z_min = float("inf")
    y_max = z_max = float("-inf")
    for i in range(n):
        j = (i + 1) % n
        yi, zi = verts[i]
        yj, zj = verts[j]
        cross = yi * zj - yj * zi
        area += cross
        cy += (yi + yj) * cross
        cz += (zi + zj) * cross
        y_min = min(y_min, yi)
        y_max = max(y_max, yi)
        z_min = min(z_min, zi)
        z_max = max(z_max, zi)
    area *= 0.5
    a_abs = abs(area)
    if a_abs > 1e-20:
        yc = cy / (6.0 * area)
        zc = cz / (6.0 * area)
    else:
        yc = zc = 0.0
    return PolygonBasic(a_abs, yc, zc, y_min, y_max, z_min, z_max)


def _polygon_inertia_y(verts: Sequence[Tuple[float, float]], zc: float) -> float:
    n = len(verts)
    iy = 0.0
    for i in range(n):
        j = (i + 1) % n
        zi = verts[i][Z] - zc
        zj = verts[j][Z] - zc
        cross = verts[i][Y] * verts[j][Z] - verts[j][Y] * verts[i][Z]
        iy += cross * (zi * zi + zi * zj + zj * zj)
    return abs(iy / 12.0)


def _polygon_inertia_z(verts: Sequence[Tuple[float, float]], yc: float) -> float:
    n = len(verts)
    iz = 0.0
    for i in range(n):
        j = (i + 1) % n
        yi = verts[i][Y] - yc
        yj = verts[j][Y] - yc
        cross = verts[i][Y] * verts[j][Z] - verts[j][Y] * verts[i][Z]
        iz += cross * (yi * yi + yi * yj + yj * yj)
    return abs(iz / 12.0)


def _polygon_product_inertia(verts: Sequence[Tuple[float, float]], yc: float, zc: float) -> float:
    n = len(verts)
    iyz = 0.0
    for i in range(n):
        j = (i + 1) % n
        yi = verts[i][Y] - yc
        zi = verts[i][Z] - zc
        yj = verts[j][Y] - yc
        zj = verts[j][Z] - zc
        cross = verts[i][Y] * verts[j][Z] - verts[j][Y] * verts[i][Z]
        iyz += cross * (yi * zj + 2.0 * yi * zi + 2.0 * yj * zj + yj * zi)
    return iyz / 24.0


def _polygon_perimeter(verts: Sequence[Tuple[float, float]]) -> float:
    n = len(verts)
    p = 0.0
    for i in range(n):
        j = (i + 1) % n
        p += math.hypot(verts[j][Y] - verts[i][Y], verts[j][Z] - verts[i][Z])
    return p


@dataclass
class SectionProperties:
    a: float
    yc: float
    zc: float
    iy: float
    iz: float
    iyz: float
    i1: float
    i2: float
    theta_p: float
    sy_top: float
    sy_bot: float
    sz_left: float
    sz_right: float
    ry: float
    rz: float
    j: float  # St. Venant torsion (thin-wall analytic — see below)
    bbox: Tuple[float, float, float, float]
    perimeter: float

    def to_dict(self) -> dict:
        return {
            "A": self.a,
            "Iy": self.iy,
            "Iz": self.iz,
            "Iyz": self.iyz,
            "I1": self.i1,
            "I2": self.i2,
            "theta_p": self.theta_p,
            "J": self.j,
            "Sy": self.sy_top,   # strong-axis modulus (both faces for symmetric)
            "Sz": self.sz_right,
            "ry": self.ry,
            "rz": self.rz,
            "yc": self.yc,
            "zc": self.zc,
            "perimeter": self.perimeter,
        }


def analyze_section(polygons: List[Polygon], j: float = 0.0) -> SectionProperties:
    """Compute full geometric properties from polygons; ``j`` is an externally
    supplied torsion constant (analytic), since closed-form polygon torsion
    (Prandtl PDE) is out of scope for the Python properties path."""
    if not polygons:
        raise ValueError("No polygons defined")

    props: List[PolygonBasic] = []
    total_a = total_ay = total_az = 0.0
    for poly in polygons:
        if len(poly.vertices) < 3:
            raise ValueError("Polygon must have at least 3 vertices")
        b = _polygon_basic(poly.vertices)
        sign = -1.0 if poly.is_void else 1.0
        total_a += sign * b.area
        total_ay += sign * b.area * b.yc
        total_az += sign * b.area * b.zc
        props.append(b)

    if abs(total_a) < 1e-20:
        raise ValueError("Section has zero area")

    yc = total_ay / total_a
    zc = total_az / total_a

    iy = iz = iyz = 0.0
    for poly, b in zip(polygons, props):
        sign = -1.0 if poly.is_void else 1.0
        iy_c = _polygon_inertia_y(poly.vertices, b.zc)
        iz_c = _polygon_inertia_z(poly.vertices, b.yc)
        iyz_c = _polygon_product_inertia(poly.vertices, b.yc, b.zc)
        dy = b.yc - yc
        dz = b.zc - zc
        iy += sign * (iy_c + b.area * dz * dz)
        iz += sign * (iz_c + b.area * dy * dy)
        iyz += sign * (iyz_c + b.area * dy * dz)

    avg = (iy + iz) / 2.0
    diff = (iy - iz) / 2.0
    r = math.sqrt(diff * diff + iyz * iyz)
    i1 = avg + r
    i2 = avg - r
    if abs(iyz) < 1e-15 and abs(diff) < 1e-15:
        theta_p = 0.0
    else:
        theta_p = 0.5 * math.atan2(-2.0 * iyz, iy - iz)

    y_min = z_min = float("inf")
    y_max = z_max = float("-inf")
    for poly, b in zip(polygons, props):
        if poly.is_void:
            continue
        y_min = min(y_min, b.y_min); y_max = max(y_max, b.y_max)
        z_min = min(z_min, b.z_min); z_max = max(z_max, b.z_max)

    dz_top = z_max - zc
    dz_bot = zc - z_min
    dy_right = y_max - yc
    dy_left = yc - y_min
    sy_top = iy / dz_top if dz_top > 1e-15 else 0.0
    sy_bot = iy / dz_bot if dz_bot > 1e-15 else 0.0
    sz_right = iz / dy_right if dy_right > 1e-15 else 0.0
    sz_left = iz / dy_left if dy_left > 1e-15 else 0.0

    ry = math.sqrt(iy / total_a)
    rz = math.sqrt(iz / total_a)

    perimeter = sum(_polygon_perimeter(p.vertices) for p in polygons if not p.is_void)

    return SectionProperties(
        a=total_a, yc=yc, zc=zc, iy=iy, iz=iz, iyz=iyz,
        i1=i1, i2=i2, theta_p=theta_p,
        sy_top=sy_top, sy_bot=sy_bot, sz_left=sz_left, sz_right=sz_right,
        ry=ry, rz=rz, j=j,
        bbox=(y_min, z_min, y_max, z_max), perimeter=perimeter,
    )


# --------------------------------------------------------------------------- #
# Torsion constants (analytic — St. Venant / Bredt), matching the buckled
# references above for the shapes where a closed form exists.
# --------------------------------------------------------------------------- #
def rect_torsion(a: float, b: float) -> float:
    """Saint-Venant series for a solid rectangle (a >= b)."""
    a, b = (max(a, b), min(a, b))
    return a * b ** 3 * (1.0 / 3.0 - 0.21 * (b / a) * (1.0 - b ** 4 / (12.0 * a ** 4)))


def circle_torsion(d: float) -> float:
    return math.pi * (d / 2.0) ** 4 / 2.0


def annulus_torsion(d: float, t: float) -> float:
    """CHS / closed tube: J = pi/2 (ro^4 - ri^4)."""
    ro = d / 2.0
    ri = ro - t
    return math.pi / 2.0 * (ro ** 4 - ri ** 4)


def bredt_rrhs(b: float, h: float, t: float) -> float:
    """Bredt's thin-walled formula for a closed rectangular cell:
    J = 4 A_m^2 / integral(ds/t), with A_m the wall-centreline enclosed area."""
    am = (b - t) * (h - t)
    perim = 2.0 * ((b - t) + (h - t))
    return 4.0 * am * am / (perim / t)


def open_thin_strip(parts: List[Tuple[float, float]]) -> float:
    """Sum of ht^3/3 for a set of (length, thickness) plate segments (open)."""
    return sum(L * t ** 3 / 3.0 for L, t in parts)