"""
Helpers for structural model construction (section properties, geometry).
"""
import math
from typing import Dict

from .sections import properties as sp
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
    "rectangularhollow": "rectangular_hollow",
    "box": "rectangular_hollow",
    "squarehollow": "rectangular_hollow",
    "rhs": "rectangular_hollow",
    "shs": "rectangular_hollow",
    "hss": "rectangular_hollow",
    "channel": "channel",
    "c": "channel",
    "upn": "channel",
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

    # ---- dispatch to analytic formulas (dimensions in m) ----
    if kind == "rectangular":
        b = section["width"] * mm
        h = section["height"] * mm
        p = sp.rectangular(b, h)
    elif kind == "circular":
        d = section["diameter"] * mm
        p = sp.circular(d)
    elif kind == "hollow_circular":
        d = section["diameter"] * mm
        t = section["thickness"] * mm
        p = sp.hollow_circular(d, t)
    elif kind == "i":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        p = sp.i_section(h, b, tf, tw, r)
    elif kind == "rectangular_hollow":
        h = section["height"] * mm
        b = section["width"] * mm
        t = section["thickness"] * mm
        if "height" not in section and "depth" in section:
            h = section["depth"] * mm
        ri = (section.get("ri") or section.get("r", 0.0)) * mm
        p = sp.rectangular_hollow(h, b, t, ri)
    elif kind == "channel":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        p = sp.channel(h, b, tf, tw, r)
    elif kind == "angle":
        b = section["width"] * mm
        t = section["thickness"] * mm
        p = sp.angle(b, t)
    elif kind == "tee":
        h = section["depth"] * mm
        b = section["width"] * mm
        tf = section["tf"] * mm
        tw = section["tw"] * mm
        r = section.get("r", 0.0) * mm
        p = sp.tee(h, b, tf, tw, r)
    else:
        raise ValueError(f"Unknown section type: {section.get('type')}")

    return {
        "E": E,
        "G_mod": G_mod,
        "nu": mat["nu"],
        "rho": mat["rho"],
        "A": p.A,
        "Iy": p.Iy,
        "Iz": p.Iz,
        "Jxx": p.J,
        "Sy": p.Sy,
        "Sz": p.Sz,
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