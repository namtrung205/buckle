"""
I-Section — analytic wrapper around the shared section-properties engine.
"""
from .properties import i_section as _i


class ISection:
    def __init__(self, h: float, b: float, t_f: float, t_w: float, r: float = 0.0) -> None:
        if h <= 0 or b <= 0 or t_f <= 0 or t_w <= 0:
            raise ValueError("I-section dimensions must be positive")
        self.h = h
        self.b = b
        self.t_f = t_f
        self.t_w = t_w
        self.r = r
        self._p = _i(h, b, t_f, t_w, r)

    def geometric_properties(self):
        """Return (A, Iz, Iy, Jxx)."""
        return self._p.A, self._p.Iz, self._p.Iy, self._p.J

    def section_modulus(self):
        return self._p.Sy, self._p.Sz

    def radius_of_gyration(self):
        return self._p.ry, self._p.rz