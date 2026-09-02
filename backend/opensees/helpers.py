"""
Helpers for structural model construction (section properties, geometry).
"""
import math
from typing import Dict

from .sections import catalogue as cat
from .sections import geometry as geo
from .sections.geometry import analyze_section
from .materials import resolve_elastic_moduli

mm = 1E-3


# Aliases that section type strings can take in the JSON payload.
_TYPE_ALIASES = {
    "rectangular": "rectangular",
    "rectangle": "rectangular",
    "rect": "rectangular",
    "circular": "circular",
    "circle": "circular",
    "solidcircular": "circular",
    "hollowcircular": "hollow_circular",
    "circularhollow": "hollow_circular",
    "pipe": "hollow_circular",
    "chs": "hollow_circular",
    "i": "i",
    "isection": "i",
    "h": "i",
    "hsection": "i",
    "w": "i",
    "wshape": "i",
    "he": "i",
    "ipe": "i",
    "ipn": "ipn",
    "rectangularhollow": "rectangular_hollow",
    "box": "rectangular_hollow",
    "squarehollow": "rectangular_hollow",
    "rhs": "rectangular_hollow",
    "shs": "rectangular_hollow",
    "hss": "rectangular_hollow",
    "channel": "channel",
    "c": "channel",
    "upn": "upn",
    "upe": "channel",
    "angle": "angle",
    "l": "angle",
    "tee": "tee",
    "t": "tee",
    "tsection": "tee",
    "t_section": "tee",
}


def _canonical_type(type_str: str) -> str:
    return _TYPE_ALIASES.get((type_str or "").lower(), (type_str or "").lower())


def compute_section_properties(section: Dict) -> Dict[str, float]:
    """
    Compute the section properties for an elastic beam-column section.

    The section dict must carry a ``type`` and a ``material`` dict (either
    full elastic constants or a library ``preset`` key). Dimensions are in
    millimetres in the schema and converted to metres here.

    Returns a dict with keys: E, G_mod, nu, rho, A, Iz, Iy, Jxx, Sy, Sz, ry, rz.
    """
    kind = _canonical_type(section["type"])
    material = section.get("material") or {}
    mat = resolve_elastic_moduli(material)
    E = mat["E"]
    G_mod = mat["G"]

    # ---- build the canonical polygon outline and integrate it ----
    j = 0.0  # torsion constant (computed alongside each shape)
    if kind == "rectangular":
        b = section["width"] * mm
        h = section["height"] * mm
        polys = cat.rectangle(b, h)
        j = geo.rect_torsion(b, h)
    elif kind == "circular":
        d = section["diameter"] * mm
        polys = cat.solid_circle(d)
        j = geo.circle_torsion(d)
    elif kind == "hollow_circular":
        d = section["diameter"] * mm
        t = section["thickness"] * mm
        polys = cat.circular_hollow(d, t)
        j = geo.annulus_torsion(d, t)
    elif kind == "i":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        polys = cat.i_section(h, b, tw, tf, r)
        j = geo.open_thin_strip([
            (h - 2.0 * tf, tw),
            (2.0 * b, tf),
        ]) * (1.25 if r > 0 else 1.0)  # filleted rolled profile ~1.25x thin-strip
    elif kind == "ipn":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        polys = cat.ipn_section(h, b, tw, tf)
        j = geo.open_thin_strip([(h - 2.0 * tf, tw), (2.0 * b, tf)]) * 1.29
    elif kind == "rectangular_hollow":
        h = section["height"] * mm
        b = section["width"] * mm
        t = section["thickness"] * mm
        if "height" not in section and "depth" in section:
            h = section["depth"] * mm
        ri = (section.get("ri") or section.get("r", 0.0)) * mm
        polys = cat.rectangular_hollow_rounded(b, h, t, ri)
        j = geo.bredt_rrhs(b, h, t)
    elif kind == "channel":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        polys = cat.channel_section(h, b, tw, tf) if r <= 0 else cat.channel_section(h, b, tw, tf)
        j = geo.open_thin_strip([(h - 2.0 * tf, tw), (2.0 * b, tf)])
    elif kind == "upn":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        polys = cat.upn_section(h, b, tw, tf)
        j = geo.open_thin_strip([(h - 2.0 * tf, tw), (2.0 * b, tf)])
    elif kind == "angle":
        b = section["width"] * mm
        t = section["thickness"] * mm
        r = section.get("r", 0.0) * mm
        polys = (cat.angle_section_filleted(b, b, t, r, r * 0.5)
                 if r > 0 else cat.angle_section(b, b, t))
        j = geo.open_thin_strip([(2.0 * b - t, t)]) / 1.0  # thin rectangles
    elif kind == "tee":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        polys = (cat.tee_section_filleted(h, b, tw, tf, r, r * 0.5)
                 if r > 0 else cat.tee_section(h, b, tw, tf))
        j = geo.open_thin_strip([(h - tf, tw), (b, tf)])
    else:
        raise ValueError(f"Unknown section type: {section.get('type')}")

    p = analyze_section(polys, j)

    return {
        "E": E,
        "G_mod": G_mod,
        "nu": mat["nu"],
        "rho": mat["rho"],
        "A": p.a,
        "Iy": p.iy,
        "Iz": p.iz,
        "Jxx": p.j,
        "Sy": p.sy_top,
        "Sz": p.sz_right,
        "ry": p.ry,
        "rz": p.rz,
    }


def distance_between_points(point1: tuple, point2: tuple) -> float:
    """
    Calculate the Euclidean distance between two points in 3D space.

    Args:
        point1: Tuple of (x, y, z) coordinates for the first point
        point2: Tuple of (x, y, z) coordinates for the second point

    Returns:
        float: The distance between the two points
    """
    x1, y1, z1 = point1
    x2, y2, z2 = point2
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2)