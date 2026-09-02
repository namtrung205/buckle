"""
Hollow circular (pipe) section — analytic wrapper around the shared
section-properties engine.
"""
from .properties import hollow_circular as _hc


class HollowCircularSection:
    def __init__(self, diameter: float, thickness: float) -> None:
        if diameter <= 0:
            raise ValueError("Diameter must be positive")
        if thickness <= 0 or thickness >= diameter / 2.0:
            raise ValueError("Thickness must be positive and less than the radius")
        self.diameter = diameter
        self.thickness = thickness
        self.radius = diameter / 2.0
        self.inner_radius = self.radius - thickness
        self._p = _hc(diameter, thickness)

    def geometric_properties(self):
        """Return (A, Iz, Iy, Jxx)."""
        return self._p.A, self._p.Iz, self._p.Iy, self._p.J

    def section_modulus(self):
        return self._p.Sy, self._p.Sz

    def radius_of_gyration(self):
        return self._p.ry, self._p.rz