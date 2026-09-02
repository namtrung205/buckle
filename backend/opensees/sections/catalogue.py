"""
Canonical polygon outline builders (ported from Stabileo's
engine/src/section/catalogue.rs). Each builder returns exact section outlines
with authoritative fillets / flange taper, so that integrating the outline
reproduces the published A / Iy / Iz to table rounding.

Rolled I/H (IPE/HEA/HEB/W) carry a root fillet; tapered families (IPN 14 %,
UPN 8 %) carry flange slope + root/toe radii as rules; RHS/CHS carry rounded
corners (R = 2t) and exact annulus; angles carry root + toe radii.

Coordinates: [y, z], y = width direction, z = height direction.
"""

from __future__ import annotations

import math
from typing import List, Tuple

from .geometry import Polygon, arc_points

DEFAULT_ARC_SEGMENTS = 16


def _pos(name: str, v: float) -> float:
    if not math.isfinite(v) or v <= 0.0:
        raise ValueError(f"{name} must be a positive finite dimension (got {v})")
    return v


def _nonneg(name: str, v: float) -> float:
    if not math.isfinite(v) or v < 0.0:
        raise ValueError(f"{name} must be finite and non-negative (got {v})")
    return v


# --------------------------------------------------------------------------- #
# Solid rectangle / circle
# --------------------------------------------------------------------------- #
def rectangle(b: float, h: float) -> List[Polygon]:
    b = _pos("b", b)
    h = _pos("h", h)
    hb, hh = b / 2.0, h / 2.0
    return [Polygon([(-hb, -hh), (hb, -hh), (hb, hh), (-hb, hh)])]


def solid_circle(d: float, arc_segments: int = DEFAULT_ARC_SEGMENTS) -> List[Polygon]:
    d = _pos("d", d)
    n = max(arc_segments, 4) * 4
    r = d / 2.0
    verts = arc_points(0.0, 0.0, r, 0.0, 2.0 * math.pi, n)
    verts.pop()  # drop the duplicated closing point
    return [Polygon(verts)]


def circular_hollow(d: float, t: float, arc_segments: int = DEFAULT_ARC_SEGMENTS) -> List[Polygon]:
    d = _pos("d", d)
    t = _pos("t", t)
    r = d / 2.0
    if t >= r:
        raise ValueError(f"wall thickness {t} must be smaller than radius {r}")
    n = max(arc_segments, 4) * 4
    outer = arc_points(0.0, 0.0, r, 0.0, 2.0 * math.pi, n); outer.pop()
    inner = arc_points(0.0, 0.0, r - t, 0.0, 2.0 * math.pi, n); inner.pop()
    return [Polygon(outer), Polygon(inner, is_void=True)]


# --------------------------------------------------------------------------- #
# I / H — parallel flanges, with optional root fillet
# --------------------------------------------------------------------------- #
def i_section(
    h: float, b: float, tw: float, tf: float,
    root_radius: float, arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    h = _pos("h", h)
    b = _pos("b", b)
    tw = _pos("tw", tw)
    tf = _pos("tf", tf)
    root_radius = _nonneg("root radius", root_radius)
    if 2.0 * tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw >= b:
        raise ValueError("web is wider than the flange")

    hb, bb, tb = h / 2.0, b / 2.0, tw / 2.0
    zb, zt = -hb + tf, hb - tf
    r = min(root_radius, (zt - zb) / 2.0, bb - tb)
    pi = math.pi
    n = max(arc_segments, 1)

    v: List[Tuple[float, float]] = [(-bb, -hb), (bb, -hb), (bb, zb)]
    if r > 0.0:
        # concave quarter fillets, tangent to flange underside and web face
        v += arc_points(tb + r, zb + r, r, -pi / 2.0, -pi, n)
        v += arc_points(tb + r, zt - r, r, pi, pi / 2.0, n)
    else:
        v += [(tb, zb), (tb, zt)]
    v += [(bb, zt), (bb, hb), (-bb, hb), (-bb, zt)]
    if r > 0.0:
        v += arc_points(-tb - r, zt - r, r, pi / 2.0, 0.0, n)
        v += arc_points(-tb - r, zb + r, r, 0.0, -pi / 2.0, n)
    else:
        v += [(-tb, zt), (-tb, zb)]
    v += [(-bb, zb)]
    return [Polygon(v)]


# --------------------------------------------------------------------------- #
# Tee — sharp and filleted
# --------------------------------------------------------------------------- #
def tee_section(h: float, b: float, tw: float, tf: float) -> List[Polygon]:
    h = _pos("h", h)
    b = _pos("b", b)
    tw = _pos("tw", tw)
    tf = _pos("tf", tf)
    if tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw > b:
        raise ValueError("web is wider than the flange")
    hb, bb, tb = h / 2.0, b / 2.0, tw / 2.0
    v = [
        (-tb, -hb), (tb, -hb), (tb, hb - tf), (bb, hb - tf),
        (bb, hb), (-bb, hb), (-bb, hb - tf), (-tb, hb - tf),
    ]
    return [Polygon(v)]


def tee_section_filleted(
    h: float, b: float, tw: float, tf: float,
    root_radius: float, toe_radius: float, arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    h = _pos("h", h); b = _pos("b", b); tw = _pos("tw", tw); tf = _pos("tf", tf)
    if tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw > b:
        raise ValueError("web is wider than the flange")
    root_radius = _nonneg("root radius", root_radius)
    toe_radius = _nonneg("toe radius", toe_radius)

    hb, bb, tb = h / 2.0, b / 2.0, tw / 2.0
    zf = hb - tf
    r1 = min(root_radius, bb - tb, zf + hb)
    r2 = min(toe_radius, tf, max(bb - tb - r1, 0.0))
    pi = math.pi
    n = max(arc_segments, 1)

    v = [(-tb, -hb), (tb, -hb)]
    if r1 > 0.0:
        v.append((tb, zf - r1))
        v += arc_points(tb + r1, zf - r1, r1, pi, pi / 2.0, n)
    else:
        v.append((tb, zf))
    if r2 > 0.0:
        v.append((bb - r2, zf))
        v += arc_points(bb - r2, zf + r2, r2, -pi / 2.0, 0.0, n)
    else:
        v.append((bb, zf))
    v += [(bb, hb), (-bb, hb)]
    if r2 > 0.0:
        v.append((-bb, zf + r2))
        v += arc_points(-bb + r2, zf + r2, r2, pi, pi + pi / 2.0, n)
    else:
        v.append((-bb, zf))
    if r1 > 0.0:
        v.append((-tb - r1, zf))
        v += arc_points(-tb - r1, zf - r1, r1, pi / 2.0, 0.0, n)
    else:
        v.append((-tb, zf))
    v.append((-tb, -hb))
    v.pop()
    return [Polygon(v)]


# --------------------------------------------------------------------------- #
# Channel — sharp, and tapered (UPN / American C)
# --------------------------------------------------------------------------- #
def channel_section(h: float, b: float, tw: float, tf: float) -> List[Polygon]:
    h = _pos("h", h); b = _pos("b", b); tw = _pos("tw", tw); tf = _pos("tf", tf)
    if 2.0 * tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw >= b:
        raise ValueError("web is thicker than the flange is wide")
    hh = h / 2.0
    v = [
        (0.0, -hh), (b, -hh), (b, -hh + tf), (tw, -hh + tf),
        (tw, hh - tf), (b, hh - tf), (b, hh), (0.0, hh),
    ]
    return [Polygon(v)]


def _tapered_flange_run(
    w_web: float, w_tip: float, m: float, c: float,
    r_root: float, r_toe: float, n: int,
) -> List[Tuple[float, float]]:
    pi = math.pi
    k = math.sqrt(1.0 + m * m)
    v: List[Tuple[float, float]] = []
    if r_toe > 0.0:
        cw = w_tip - r_toe
        cv = m * cw + c + r_toe * k
        v += arc_points(cw, cv, r_toe, 0.0, -(pi / 2.0 - math.atan(m)), n)
    else:
        v.append((w_tip, m * w_tip + c))
    if r_root > 0.0:
        cw = w_web + r_root
        cv = m * cw + c - r_root * k
        v += arc_points(cw, cv, r_root, pi / 2.0 + math.atan(m), pi, n)
    else:
        v.append((w_web, m * w_web + c))
    return v


def _mirrored(run: List[Tuple[float, float]], flip_w: bool, flip_v: bool, reverse: bool) -> List[Tuple[float, float]]:
    sw = -1.0 if flip_w else 1.0
    sv = -1.0 if flip_v else 1.0
    v = [(sw * p[0], sv * p[1]) for p in run]
    if reverse:
        v.reverse()
    return v


def ipn_section(
    h: float, b: float, tw: float, tf: float, arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    """IPN per DIN 1025-1: slope 14 %, r_root = tw, r_toe = 0.6 tw, tf at b/4."""
    h = _pos("h", h); b = _pos("b", b); tw = _pos("tw", tw); tf = _pos("tf", tf)
    if 2.0 * tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw >= b:
        raise ValueError("web is wider than the flange")
    hh, hb, tb = h / 2.0, b / 2.0, tw / 2.0
    m, r_root, r_toe = 0.14, tw, 0.6 * tw
    c = hh - tf - m * (b / 4.0)
    if m * tb + c <= 0.0:
        raise ValueError("flange taper leaves no web between the flanges")
    n = max(arc_segments, 1)

    q: List[Tuple[float, float]] = [(0.0, hh), (hb, hh)]
    q += _tapered_flange_run(tb, hb, m, c, r_root, r_toe, n)
    q.append((tb, 0.0))

    v = list(q)
    v += _mirrored(q, False, True, True)[1:]          # lower right
    v += _mirrored(q, True, True, False)[1:]          # lower left
    last = _mirrored(q, True, False, True)            # upper left
    v += last[1:len(last) - 1]
    return [Polygon(v)]


def tapered_channel(
    h: float, b: float, tw: float, tf: float, slope: float,
    r_root: float, r_toe: float, taper_ref: float, arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    h = _pos("h", h); b = _pos("b", b); tw = _pos("tw", tw); tf = _pos("tf", tf)
    if 2.0 * tf >= h:
        raise ValueError("flange thickness leaves no web")
    if tw >= b:
        raise ValueError("web is thicker than the flange is wide")
    if not math.isfinite(slope) or slope < 0.0:
        raise ValueError("flange slope must be finite and non-negative")
    hh = h / 2.0
    c = hh - tf - slope * taper_ref
    if slope * tw + c <= 0.0:
        raise ValueError("flange taper leaves no web between the flanges")
    tip_thickness = hh - (slope * b + c)
    r_root = min(max(r_root, 0.0), (b - tw) / 2.0, hh - tf)
    r_toe = min(max(r_toe, 0.0), (b - tw) / 2.0, max(tip_thickness, 0.0))
    n = max(arc_segments, 1)

    top: List[Tuple[float, float]] = [(0.0, hh), (b, hh)]
    top += _tapered_flange_run(tw, b, slope, c, r_root, r_toe, n)
    top.append((tw, 0.0))

    v = list(top)
    v += _mirrored(top, False, True, True)[1:]
    return [Polygon(v)]


def upn_section(
    h: float, b: float, tw: float, tf: float, arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    """UPN per DIN 1026-1: slope 8 %, r_root = tf, r_toe = 0.5 tf, tf at b/2."""
    return tapered_channel(h, b, tw, tf, 0.08, tf, 0.5 * tf, b / 2.0, arc_segments)


# --------------------------------------------------------------------------- #
# Angle — sharp and filleted (EN 10056-1)
# --------------------------------------------------------------------------- #
def angle_section(h: float, b: float, t: float) -> List[Polygon]:
    h = _pos("h", h); b = _pos("b", b); t = _pos("t", t)
    if t >= h or t >= b:
        raise ValueError("leg thickness must be smaller than both legs")
    return [Polygon([(0.0, 0.0), (b, 0.0), (b, t), (t, t), (t, h), (0.0, h)])]


def angle_section_filleted(
    h: float, b: float, t: float, r_root: float, r_toe: float,
    arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    h = _pos("h", h); b = _pos("b", b); t = _pos("t", t)
    if t >= h or t >= b:
        raise ValueError("leg thickness must be smaller than both legs")
    r_root = _nonneg("root radius", r_root); r_toe = _nonneg("toe radius", r_toe)
    r1 = min(r_root, h - t, b - t)
    r2 = min(r_toe, t, max(h - t - r1, 0.0), max(b - t - r1, 0.0))
    pi = math.pi
    n = max(arc_segments, 1)

    v = [(0.0, 0.0), (b, 0.0)]
    if r2 > 0.0:
        v.append((b, t - r2))
        v += arc_points(b - r2, t - r2, r2, 0.0, pi / 2.0, n)
    else:
        v.append((b, t))
    if r1 > 0.0:
        v.append((t + r1, t))
        v += arc_points(t + r1, t + r1, r1, -pi / 2.0, -pi, n)
    else:
        v.append((t, t))
    if r2 > 0.0:
        v.append((t, h - r2))
        v += arc_points(t - r2, h - r2, r2, 0.0, pi / 2.0, n)
    else:
        v.append((t, h))
    v.append((0.0, h))
    return [Polygon(v)]


# --------------------------------------------------------------------------- #
# RHS — sharp and rounded-corner (R = 2t)
# --------------------------------------------------------------------------- #
def rectangular_hollow(b: float, h: float, t: float) -> List[Polygon]:
    b = _pos("b", b); h = _pos("h", h); t = _pos("t", t)
    if 2.0 * t >= min(b, h):
        raise ValueError("wall thickness leaves no cavity")
    hb, hh = b / 2.0, h / 2.0
    ib, ih = hb - t, hh - t
    return [
        Polygon([(-hb, -hh), (hb, -hh), (hb, hh), (-hb, hh)]),
        Polygon([(-ib, -ih), (ib, -ih), (ib, ih), (-ib, ih)], is_void=True),
    ]


def rectangular_hollow_rounded(
    b: float, h: float, t: float, outer_radius: float,
    arc_segments: int = DEFAULT_ARC_SEGMENTS,
) -> List[Polygon]:
    b = _pos("b", b); h = _pos("h", h); t = _pos("t", t)
    if 2.0 * t >= min(b, h):
        raise ValueError("wall thickness leaves no cavity")
    outer_radius = _nonneg("corner radius", outer_radius)
    ro = min(outer_radius, min(b, h) / 2.0)
    ri = max(ro - t, 0.0)
    n = max(arc_segments, 1)
    pi = math.pi

    def ring(bb: float, hh: float, r: float) -> List[Tuple[float, float]]:
        hw, hd = bb / 2.0, hh / 2.0
        if r <= 0.0:
            return [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        v: List[Tuple[float, float]] = []
        for sw, sd, a0 in [(1.0, -1.0, -pi / 2.0), (1.0, 1.0, 0.0),
                           (-1.0, 1.0, pi / 2.0), (-1.0, -1.0, pi)]:
            v += arc_points(sw * (hw - r), sd * (hd - r), r, a0, a0 + pi / 2.0, n)
        return v

    return [
        Polygon(ring(b, h, ro)),
        Polygon(ring(b - 2.0 * t, h - 2.0 * t, ri), is_void=True),
    ]