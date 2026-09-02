"""
Unit tests for the analytic section-properties engine and the material library.

These tests load the modules directly (bypassing the ``opensees`` package
__init__, which requires the openseespy solver) so they run in any environment.
"""
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SECTIONS_DIR = os.path.join(_HERE, "..", "opensees", "sections")
_MATERIALS_DIR = os.path.join(_HERE, "..", "opensees", "materials")
sys.path.insert(0, os.path.abspath(_SECTIONS_DIR))
sys.path.insert(0, os.path.abspath(_MATERIALS_DIR))

import properties as sp  # noqa: E402
from library import MATERIAL_LIBRARY, resolve_elastic_moduli  # noqa: E402


def rel(a, b):
    return abs(a - b) / abs(b)


class TestRectangular:
    def test_rect_300x500(self):
        p = sp.rectangular(0.300, 0.500)
        assert rel(p.A, 0.150) < 1e-9
        assert rel(p.Iy, 0.300 * 0.500 ** 3 / 12) < 1e-9
        assert rel(p.Iz, 0.500 * 0.300 ** 3 / 12) < 1e-9

    def test_rect_rejects_nonpositive(self):
        try:
            sp.rectangular(0, 1)
            assert False
        except ValueError:
            pass


class TestCircular:
    def test_circle_100(self):
        p = sp.circular(100.0)
        assert rel(p.A, math.pi * 50 ** 2) < 1e-12
        assert rel(p.Iy, math.pi * 100 ** 4 / 64) < 1e-12
        assert rel(p.J, math.pi * 100 ** 4 / 32) < 1e-12
        # for a circle, polar I = Iy + Iz = 2*I
        assert rel(p.Iy, p.Iz) < 1e-12

    def test_hollow_circular(self):
        p = sp.hollow_circular(168.3, 6.3)
        ro, ri = 84.15, 77.85
        assert rel(p.A, math.pi * (ro ** 2 - ri ** 2)) < 1e-12
        assert rel(p.J, 2 * p.Iy) < 1e-12


class TestISection:
    # IPE300 (EN): A=53.8 cm2, Iy=8356 cm4, Iz=604 cm4
    def test_ipe300(self):
        p = sp.i_section(300.0, 150.0, 10.7, 7.1, 15.0)
        assert rel(p.A, 5380.0) < 0.02
        assert rel(p.Iy, 83.56e6) < 0.03
        assert rel(p.Iz, 6.04e6) < 0.05

    # IPE200: A=28.5cm2, Iy=1943cm4, Iz=142cm4
    def test_ipe200(self):
        p = sp.i_section(200.0, 100.0, 8.5, 5.6, 12.0)
        assert rel(p.A, 2850.0) < 0.02
        assert rel(p.Iy, 19.43e6) < 0.03
        assert rel(p.Iz, 1.42e6) < 0.05

    # W10x12 (AISC): A=3.54 in2 = 2284 mm2; Iy=53.4 in4 = 2.22e7 mm4
    def test_w10x12(self):
        p = sp.i_section(250.7, 100.6, 5.33, 4.83, 7.9)
        assert rel(p.A, 2284.0) < 0.05
        assert rel(p.Iy, 2.22e7) < 0.08

    def test_rejects_bad_proportions(self):
        try:
            sp.i_section(100.0, 100.0, 60.0, 10.0, 0.0)  # 2*tf > h
            assert False
        except ValueError:
            pass


class TestRectHollow:
    # RHS 100x50x4: outer 100x50, wall 4 -> inner 92x42
    def test_rhs(self):
        p = sp.rectangular_hollow(100.0, 50.0, 4.0, 0.0)
        assert rel(p.A, 100 * 50 - 92 * 42) < 1e-9
        assert rel(p.Iy, (50 * 100 ** 3 - 42 * 92 ** 3) / 12) < 1e-9
        assert rel(p.Iz, (100 * 50 ** 3 - 92 * 42 ** 3) / 12) < 1e-9


class TestChannelAngleTee:
    def test_channel_symmetric_iy(self):
        # UPN80: h=80 b=45 tw=6 tf=8 (approx). Area close to 11 cm2.
        p = sp.channel(80.0, 45.0, 8.0, 6.0, 0.0)
        # sanity: area in a sane range
        assert 1000 < p.A < 1300
        assert p.Iy > p.Iz  # channel is strong in y

    def test_angle(self):
        p = sp.angle(50.0, 5.0)
        assert rel(p.A, 50 * 50 - 45 * 45) < 1e-9  # b^2 - (b-t)^2
        assert p.Iy == p.Iz  # equal-leg angle symmetry

    def test_tee(self):
        p = sp.tee(100.0, 100.0, 10.0, 7.0, 0.0)
        assert p.A > 0
        assert p.Iy > 0 and p.Iz > 0


class TestDispatcher:
    def test_compute_all_types(self):
        cases = [
            ("rectangular", dict(width=300, height=500)),
            ("circular", dict(diameter=200)),
            ("hollow_circular", dict(diameter=168.3, thickness=6.3)),
            ("rectangular_hollow", dict(height=100, width=50, thickness=4, ri=0)),
            ("channel", dict(depth=80, width=45, tf=8, tw=6, r=0)),
            ("angle", dict(width=50, thickness=5)),
            ("tee", dict(depth=100, width=100, tf=10, tw=7, r=0)),
        ]
        for kind, kw in cases:
            p = sp.compute(kind, **kw)
            assert p.A > 0 and p.Iy > 0 and p.Iz > 0

    def test_unknown_type_raises(self):
        try:
            sp.compute("not_a_section", width=1)
            assert False
        except ValueError:
            pass


class TestMaterialLibrary:
    def test_library_populated(self):
        assert len(MATERIAL_LIBRARY) >= 30
        cats = {p.category for p in MATERIAL_LIBRARY.values()}
        assert {"steel", "concrete", "aluminum", "timber", "rebar"} <= cats

    def test_s355_resolve(self):
        r = resolve_elastic_moduli({"preset": "steel_s355"})
        assert r["E"] == 210e9
        assert abs(r["nu"] - 0.30) < 1e-12
        assert rel(r["G"], 210e9 / (2 * 1.3)) < 1e-12
        assert r["rho"] == 7850.0

    def test_manual_override(self):
        r = resolve_elastic_moduli({"E": 30e9, "nu": 0.2, "rho": 2400})
        assert r["E"] == 30e9
        assert r["nu"] == 0.2
        assert r["rho"] == 2400

    def test_missing_raises(self):
        try:
            resolve_elastic_moduli({})
            assert False
        except ValueError:
            pass