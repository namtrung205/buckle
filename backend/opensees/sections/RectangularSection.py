"""
Rectangular (solid) section — analytic wrapper around the shared
section-properties engine.
"""
from .properties import rectangular as _rect


class RectangularSection:
    def __init__(self, width: float, height: float) -> None:
        if width <= 0 or height <= 0:
            raise ValueError("Width and height must be positive")
        self.width = width
        self.height = height
        self._p = _rect(width, height)

    def geometric_properties(self):
        """Return (A, Iz, Iy, Jxx)."""
        return self._p.A, self._p.Iz, self._p.Iy, self._p.J

    def section_modulus(self):
        return self._p.Sy, self._p.Sz

    def radius_of_gyration(self):
        return self._p.ry, self._p.rz