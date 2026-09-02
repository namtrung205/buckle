"""
Analytic geometric/section properties for common structural cross-sections.

This module computes cross-sectional properties using closed-form (analytic)
formulas rather than a finite-element mesher (`sectionproperties`). That makes
the calculation deterministic, fast, and trivially unit-tested, and it removes
the external `sectionproperties` dependency.

Local axes convention (OpenSees / engineering, Z-up):
    * The section lies in the local y-z plane (local x is the member axis).
    * y  -> strong axis  (major bending, "d" / depth direction)
    * z  -> weak axis    (minor bending, "b" / width direction)
    * A  -> cross-sectional area
    * Iy -> second moment of area about the local y axis (strong axis)
    * Iz -> second moment of area about the local z axis (weak axis)
    * J  -> St. Venant torsional constant
    * Sy, Sz -> elastic section moduli (I / c) about y and z
    * ry, rz  -> radii of gyration

Units: all lengths are passed in consistent units (the caller passes metres;
values are returned in metres^k). Formula correctness is therefore
unit-independent.

Reference: Roark's Formulas for Stress and Strain (Table A.1); AISC Steel
Construction Manual; European EN 10210/10219 section tables.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import pi


@dataclass
class SectionProperties:
    """Container for computed section properties."""
    A: float = 0.0
    Iy: float = 0.0   # strong axis
    Iz: float = 0.0   # weak axis
    J: float = 0.0    # torsional constant
    Sy: float = 0.0   # elastic section modulus about y
    Sz: float = 0.0   # elastic section modulus about z
    ry: float = 0.0   # radius of gyration about y
    rz: float = 0.0   # radius of gyration about z
    cy_max: float = 0.0  # max fibre distance along strong axis (h/2 for symmetric)
    cz_max: float = 0.0  # max fibre distance along weak axis (b/2 for symmetric)

    def to_dict(self) -> dict:
        return {
            "A": self.A,
            "Iy": self.Iy,
            "Iz": self.Iz,
            "J": self.J,
            "Sy": self.Sy,
            "Sz": self.Sz,
            "ry": self.ry,
            "rz": self.rz,
        }


# --------------------------------------------------------------------------- #
# Rectangular (solid)
# --------------------------------------------------------------------------- #
def rectangular(b: float, h: float) -> SectionProperties:
    """Solid rectangle: b = width (z direction), h = height (y direction)."""
    if b <= 0 or h <= 0:
        raise ValueError("Rectangle dimensions must be positive")
    A = b * h
    Iy = b * h ** 3 / 12.0        # bending about the strong (horizontal) axis
    Iz = h * b ** 3 / 12.0        # bending about the weak (vertical) axis
    J = _rect_torsion(b, h)
    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / (h / 2.0), Sz=Iz / (b / 2.0),
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=h / 2.0, cz_max=b / 2.0,
    )


def _rect_torsion(b: float, h: float) -> float:
    """St. Venant torsion constant for a solid rectangle (a >= b)."""
    a = max(b, h)
    b_ = min(b, h)
    return (a * b_ ** 3) * (
        1.0 / 3.0
        - 0.21 * (b_ / a) * (1.0 - (b_ / a) ** 4 / 12.0)
    )


# --------------------------------------------------------------------------- #
# Solid circular
# --------------------------------------------------------------------------- #
def circular(d: float) -> SectionProperties:
    """Solid circle of diameter d."""
    if d <= 0:
        raise ValueError("Diameter must be positive")
    r = d / 2.0
    A = pi * r ** 2
    Iy = Iz = pi * d ** 4 / 64.0
    J = pi * d ** 4 / 32.0
    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / r, Sz=Iz / r,
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=r, cz_max=r,
    )


# --------------------------------------------------------------------------- #
# Hollow circular (pipe / CHS)
# --------------------------------------------------------------------------- #
def hollow_circular(d: float, t: float) -> SectionProperties:
    """Hollow circular (pipe) section: outer diameter d, wall thickness t."""
    if d <= 0:
        raise ValueError("Diameter must be positive")
    if t <= 0 or t >= d / 2.0:
        raise ValueError("Thickness must be positive and less than the radius")
    ro = d / 2.0
    ri = ro - t
    A = pi * (ro ** 2 - ri ** 2)
    Iy = Iz = pi * (ro ** 4 - ri ** 4) / 4.0
    J = pi * (ro ** 4 - ri ** 4) / 2.0
    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / ro, Sz=Iz / ro,
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=ro, cz_max=ro,
    )


# --------------------------------------------------------------------------- #
# I / H section (rolled I, HEA, HEB, IPE, W-shape, welded plate I)
# --------------------------------------------------------------------------- #
def i_section(h: float, b: float, tf: float, tw: float, r: float = 0.0) -> SectionProperties:
    """
    Symmetric I/H section.
        h  = overall depth   (strong axis, y)
        b  = flange width    (weak axis, z)
        tf = flange thickness
        tw = web thickness
        r  = root fillet radius (0 for a sharp-cornered / welded section)
    """
    if h <= 0 or b <= 0 or tf <= 0 or tw <= 0:
        raise ValueError("I-section dimensions must be positive")
    if 2 * tf > h or tw > b:
        raise ValueError("Invalid I-section proportions (2*tf > h or tw > b)")

    d_web = h - 2.0 * tf          # web clear depth

    # --- areas ---
    A_web = tw * d_web
    A_flange = 2.0 * b * tf
    # fillet region (only present when r > 0): approximated as two small
    # squares of side r per flange-web junction -> 4 junctions total
    # Using the standard approximation A_fillet = 4 * r^2 * (1 - pi/4)
    A_fillet = 4.0 * r * r * (1.0 - pi / 4.0) if r > 0 else 0.0
    A = A_web + A_flange + A_fillet

    # --- strong axis (y) ---
    # web: rectangle b=tw, h=d_web, about centroid
    Iy_web = tw * d_web ** 3 / 12.0
    # flanges: two rectangles b x tf, displaced to +/- (h/2 - tf/2)
    Iy_flange = 2.0 * (b * tf ** 3 / 12.0 + b * tf * ((h - tf) / 2.0) ** 2)
    # fillets: small radius improves Iy slightly; approximate as points at
    # the centroid of the fillet region. Negligible for typical sections and
    # equivalent to the "sharp corner" assumption used by many programs.
    Iy_fillet = 0.0
    if r > 0:
        # centroid of each fillet ~ (h/2 - tf) from axis (between web and flange)
        y_f = h / 2.0 - tf
        Iy_fillet = A_fillet * y_f ** 2
    Iy = Iy_web + Iy_flange + Iy_fillet

    # --- weak axis (z) ---
    # Fillets sit adjacent to the web, so their contribution to Iz is
    # negligible for rolled sections (matches tabulated values).
    Iz_web = d_web * tw ** 3 / 12.0
    Iz_flange = 2.0 * tf * b ** 3 / 12.0
    Iz = Iz_web + Iz_flange

    # --- torsion --- (sum of thin rectangles)
    J = (2.0 * b * tf ** 3 + d_web * tw ** 3) / 3.0

    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / (h / 2.0), Sz=Iz / (b / 2.0),
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=h / 2.0, cz_max=b / 2.0,
    )


# --------------------------------------------------------------------------- #
# Rectangular hollow section (RHS / box / HSS rectangular)
# --------------------------------------------------------------------------- #
def rectangular_hollow(h: float, b: float, t: float, ri: float | None = None) -> SectionProperties:
    """
    Rectangular hollow section.
        h  = overall depth (strong axis)   [outer]
        b  = overall width (weak axis)     [outer]
        t  = wall thickness
        ri = inner corner radius; if None, assumes sharp inner corners which
             over-estimates A/I slightly (acceptable, standard approximation).
    """
    if h <= 0 or b <= 0 or t <= 0:
        raise ValueError("Hollow rectangular dimensions must be positive")
    if 2 * t >= min(h, b):
        raise ValueError("Wall thickness too large for hollow rectangular section")

    ri = ri if ri is not None else 0.0
    # Use the standard "square tube" model: outer rectangle minus inner rectangle,
    # corrected for the corner radii (adds a little material back).
    ho, bo = h, b
    hi = h - 2.0 * t
    bi = b - 2.0 * t

    # corner correction: outer corners have radius ri, inner corners have
    # radius ri - t. The net corner area per corner = (1 - pi/4)*(ri^2 - (ri-t)^2)
    # (material present in the corner). This reduces area slightly vs sharp model.
    corner = (1.0 - pi / 4.0) * (ri ** 2 - max(ri - t, 0.0) ** 2) if ri > 0 else 0.0

    A = (ho * bo - hi * bi) - 4.0 * corner

    Iy = (bo * ho ** 3 - bi * hi ** 3) / 12.0
    Iz = (ho * bo ** 3 - hi * bi ** 3) / 12.0
    # correction for rounded corners (small, subtract corner material I)
    if ri > 0:
        # approximate corner centroid distance
        Iy -= 4.0 * corner * (ho / 2.0 - ri) ** 2
        Iz -= 4.0 * corner * (bo / 2.0 - ri) ** 2

    # torsion: closed thin-walled section (Bredt's formula):
    # t_m = mean perimeter thickness; A_m = enclosed area at mid-thickness
    h_m = h - t
    b_m = b - t
    # account for corner radius in perimeter/area
    if ri > 0:
        r_m = ri - t / 2.0
        A_m = h_m * b_m - (4.0 - pi) * r_m ** 2
        perim = 2.0 * (h_m + b_m) - (8.0 - 2.0 * pi) * r_m
        J = 4.0 * A_m ** 2 * t / perim
    else:
        A_m = h_m * b_m
        perim = 2.0 * (h_m + b_m)
        J = 4.0 * A_m ** 2 * t / perim

    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / (h / 2.0), Sz=Iz / (b / 2.0),
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=h / 2.0, cz_max=b / 2.0,
    )


# --------------------------------------------------------------------------- #
# Channel (C / UPN) — takes centroid offset into account
# --------------------------------------------------------------------------- #
def channel(h: float, b: float, tf: float, tw: float, r: float = 0.0) -> SectionProperties:
    """
    Channel section (C / UPN / UPE).
        h  = depth
        b  = flange width
        tf = flange thickness
        tw = web thickness
        r  = fillet radius (approximate)
    Returns properties about the centroidal axes (the channel is NOT doubly
    symmetric, so the shear-centre/centroid offset matters for real analysis;
    here we return area moments about the centroidal principal axes, which are
    parallel to y/z for a channel).
    """
    if h <= 0 or b <= 0 or tf <= 0 or tw <= 0:
        raise ValueError("Channel dimensions must be positive")

    d_web = h - 2.0 * tf
    A_web = tw * d_web
    A_flange = 2.0 * b * tf
    A = A_web + A_flange

    # centroid along z (weak axis): flanges are offset to one side
    # web centroid at z = tw/2; flanges centroid at z = b/2 (measured from back)
    # Use the back of the web as z = 0.
    z_web = tw / 2.0
    z_flange = b / 2.0
    z_c = (A_web * z_web + A_flange * z_flange) / A

    # --- strong axis Iy (about horizontal centroidal axis) ---
    Iy_web = tw * d_web ** 3 / 12.0
    Iy_flange = 2.0 * (b * tf ** 3 / 12.0 + b * tf * ((h - tf) / 2.0) ** 2)
    Iy = Iy_web + Iy_flange

    # --- weak axis Iz (about centroidal vertical axis) ---
    Iz_web = d_web * tw ** 3 / 12.0 + A_web * (z_web - z_c) ** 2
    each_flange_Iz = tf * b ** 3 / 12.0
    each_flange_area = b * tf
    Iz_flange = 2.0 * (each_flange_Iz + each_flange_area * (z_flange - z_c) ** 2)
    Iz = Iz_web + Iz_flange

    # torsion (open thin-wall)
    J = (2.0 * b * tf ** 3 + d_web * tw ** 3) / 3.0

    # max fibre distances
    cy_max = h / 2.0
    cz_max = max(z_c, b - z_c)

    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / cy_max, Sz=Iz / cz_max,
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=cy_max, cz_max=cz_max,
    )


# --------------------------------------------------------------------------- #
# Equal-leg angle (L)
# --------------------------------------------------------------------------- #
def angle(b: float, t: float) -> SectionProperties:
    """
    Equal-leg angle section.
        b = leg length, t = leg thickness.
    Returns properties about the centroidal axes parallel to the legs. True
    principal axes are at 45 deg for an equal-leg angle, but the values about
    the parallel axes (uv axes) are the common tabulated convention and suffice
    for section-property display.
    """
    if b <= 0 or t <= 0 or t >= b / 2.0:
        raise ValueError("Angle dimensions invalid")

    A = t * (2.0 * b - t)
    # centroid measured from the heel (corner) along each leg
    x_c = (b * t * (t / 2.0) + (b - t) * t * ((b + t) / 2.0)) / A

    # I about the heel corner (parallel to legs), then shift to centroid
    # Use standard formulas:
    # Ix (about x-axis through corner) = ...
    # Simpler: sum of two rectangles.
    # leg along vertical: rectangle b x t
    # leg along horizontal: rectangle t x (b - t)
    Iy_corner = t * b ** 3 / 3.0 + (b - t) * t ** 3 / 3.0  # about tip axis
    # about centroidal axis parallel to the legs (same for x and y for equal leg)
    Iy = Iz = Iy_corner - A * x_c ** 2

    J = 2.0 * b * t ** 3 / 3.0  # open thin-wall

    cy_max = b - x_c
    cz_max = x_c

    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / cy_max, Sz=Iz / cz_max,
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=cy_max, cz_max=cz_max,
    )


# --------------------------------------------------------------------------- #
# Tee section (T) — split from an I
# --------------------------------------------------------------------------- #
def tee(h: float, b: float, tf: float, tw: float, r: float = 0.0) -> SectionProperties:
    """
    Tee section (half of an I-section).
        h  = overall depth
        b  = flange width
        tf = flange thickness
        tw = web (stem) thickness
        r  = fillet radius (approx)
    Flange at top (y = + side).
    """
    if h <= 0 or b <= 0 or tf <= 0 or tw <= 0 or tf >= h:
        raise ValueError("Tee dimensions invalid")

    d_stem = h - tf
    A_flange = b * tf
    A_stem = tw * d_stem
    A = A_flange + A_stem

    # centroid from top (flange outer face) = y=0 at top, +y downward
    y_flange = tf / 2.0
    y_stem = tf + d_stem / 2.0
    y_c = (A_flange * y_flange + A_stem * y_stem) / A

    # strong axis I (about horizontal axis through centroid)
    Iy = b * tf ** 3 / 12.0 + A_flange * (y_flange - y_c) ** 2 \
        + tw * d_stem ** 3 / 12.0 + A_stem * (y_stem - y_c) ** 2

    # weak axis Iz
    Iz = tf * b ** 3 / 12.0 + d_stem * tw ** 3 / 12.0

    J = (b * tf ** 3 + d_stem * tw ** 3) / 3.0

    cy_top = y_c
    cy_bot = h - y_c
    cy_max = max(cy_top, cy_bot)
    cz_max = b / 2.0

    return SectionProperties(
        A=A, Iy=Iy, Iz=Iz, J=J,
        Sy=Iy / cy_max, Sz=Iz / cz_max,
        ry=(Iy / A) ** 0.5, rz=(Iz / A) ** 0.5,
        cy_max=cy_max, cz_max=cz_max,
    )


# --------------------------------------------------------------------------- #
# Dispatcher
# --------------------------------------------------------------------------- #
def compute(kind: str, **kwargs) -> SectionProperties:
    """Compute SectionProperties for the given section kind."""
    kind_l = kind.lower()
    if kind_l in ("rectangular", "rectangle", "rect"):
        return rectangular(kwargs["width"], kwargs["height"])
    if kind_l in ("circular", "circle", "solid_circular"):
        return circular(kwargs["diameter"])
    if kind_l in ("hollowcircular", "hollow_circular", "circular_hollow", "pipe", "chs"):
        return hollow_circular(kwargs["diameter"], kwargs["thickness"])
    if kind_l in ("i", "isection", "h", "hsection", "i_section"):
        return i_section(
            kwargs["depth"], kwargs["width"], kwargs["tf"], kwargs["tw"],
            kwargs.get("r", 0.0),
        )
    if kind_l in ("rectangular_hollow", "box", "rhs", "square_hollow", "rectangularhollow"):
        return rectangular_hollow(
            kwargs["height"], kwargs["width"], kwargs["thickness"], kwargs.get("ri"),
        )
    if kind_l in ("channel", "c", "upn", "upe"):
        return channel(
            kwargs["depth"], kwargs["width"], kwargs["tf"], kwargs["tw"],
            kwargs.get("r", 0.0),
        )
    if kind_l in ("angle", "l", "equal_angle"):
        return angle(kwargs["width"], kwargs["thickness"])
    if kind_l in ("tee", "t", "t_section"):
        return tee(
            kwargs["depth"], kwargs["width"], kwargs["tf"], kwargs["tw"],
            kwargs.get("r", 0.0),
        )
    raise ValueError(f"Unknown section type: {kind}")