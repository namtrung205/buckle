"""
Standard material library for steel, concrete, aluminum, timber and
reinforcement, indexed by design code (European EN / Eurocode and American
ACI / AISC / NDS).

Every preset carries the elastic constants needed by the linear-elastic solver
(E, nu) plus the code-characteristic values used for design (compressive
strength fy / fc', tensile strength fu / ft, density rho, thermal coefficient
alpha, and the design-code reference). Units are SI:

    E, G, fy, fc, fu, ft, sigma...  : Pa
    rho                             : kg/m^3
    alpha                           : 1/K (per degree Celsius)
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class MaterialPreset:
    key: str
    name: str
    category: str          # 'concrete' | 'steel' | 'aluminum' | 'timber' | 'rebar'
    code: str              # 'EN' | 'UNI' | 'ACI' | 'AISC' | 'NDS' | 'ASTM' | common
    E: float               # Young's modulus (Pa)
    nu: float              # Poisson ratio
    rho: float             # density (kg/m^3)
    alpha: float           # thermal expansion (1/K)
    # design-characteristic values (None when not applicable)
    fy: Optional[float] = None    # yield strength (steel/rebar) or characteristic strength
    fc: Optional[float] = None    # compressive design strength (concrete/timber)
    fu: Optional[float] = None    # ultimate tensile strength (steel)
    ft: Optional[float] = None    # tensile strength
    grade: Optional[str] = None   # e.g. 'S355', 'C30/37', 'Gr.60'
    note: Optional[str] = None


def _mk(key, name, category, code, E, nu, rho, alpha, **kw):
    return MaterialPreset(key=key, name=name, category=category, code=code,
                          E=E, nu=nu, rho=rho, alpha=alpha, **kw)


# --------------------------------------------------------------------------- #
# Structural steel (EN 10025 / AISC / ASTM)
# --------------------------------------------------------------------------- #
_STEEL = [
    # European (EN 10025)
    _mk('steel_s235', 'S235 (EN 10025)', 'steel', 'EN', 210e9, 0.30, 7850, 12e-6,
        fy=235e6, fu=360e6, grade='S235'),
    _mk('steel_s275', 'S275 (EN 10025)', 'steel', 'EN', 210e9, 0.30, 7850, 12e-6,
        fy=275e6, fu=430e6, grade='S275'),
    _mk('steel_s355', 'S355 (EN 10025)', 'steel', 'EN', 210e9, 0.30, 7850, 12e-6,
        fy=355e6, fu=510e6, grade='S355'),
    _mk('steel_s420', 'S420 (EN 10025)', 'steel', 'EN', 210e9, 0.30, 7850, 12e-6,
        fy=420e6, fu=520e6, grade='S420'),
    _mk('steel_s460', 'S460 (EN 10025)', 'steel', 'EN', 210e9, 0.30, 7850, 12e-6,
        fy=460e6, fu=540e6, grade='S460'),
    # American (AISC / ASTM) — nominal in ksi, converted to MPa
    _mk('steel_a36', 'A36 (ASTM)', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=250e6, fu=400e6, grade='A36'),                     # Fy=36 ksi, Fu=58 ksi
    _mk('steel_a572_50', 'A572 Gr.50', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=345e6, fu=450e6, grade='A572-50'),                  # Fy=50 ksi, Fu=65 ksi
    _mk('steel_a992', 'A992 (W-shapes)', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=345e6, fu=450e6, grade='A992'),                     # Fy=50 ksi
    _mk('steel_a500_grb', 'A500 Gr.B (HSS)', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=317e6, fu=400e6, grade='A500-B'),                   # Fy=46 ksi
    _mk('steel_a500_grc', 'A500 Gr.C (HSS)', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=345e6, fu=427e6, grade='A500-C'),                   # Fy=50 ksi
    _mk('steel_a913_65', 'A913 Gr.65', 'steel', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=448e6, fu=550e6, grade='A913-65'),                  # Fy=65 ksi
]

# --------------------------------------------------------------------------- #
# Concrete (EN 1992-1-1 / ACI 318)
# --------------------------------------------------------------------------- #
# Ecm per EN 1992-1-1 Table 3.1; fc' per ACI is cylinder strength.
_CONCRETE = [
    _mk('concrete_c20', 'C20/25 (EN 1992)', 'concrete', 'EN', 30.0e9, 0.20, 2400, 10e-6,
        fc=20e6, grade='C20/25'),
    _mk('concrete_c25', 'C25/30 (EN 1992)', 'concrete', 'EN', 31.0e9, 0.20, 2400, 10e-6,
        fc=25e6, grade='C25/30'),
    _mk('concrete_c30', 'C30/37 (EN 1992)', 'concrete', 'EN', 33.0e9, 0.20, 2400, 10e-6,
        fc=30e6, grade='C30/37'),
    _mk('concrete_c35', 'C35/45 (EN 1992)', 'concrete', 'EN', 34.0e9, 0.20, 2400, 10e-6,
        fc=35e6, grade='C35/45'),
    _mk('concrete_c40', 'C40/50 (EN 1992)', 'concrete', 'EN', 35.0e9, 0.20, 2400, 10e-6,
        fc=40e6, grade='C40/50'),
    _mk('concrete_c50', 'C50/60 (EN 1992)', 'concrete', 'EN', 37.0e9, 0.20, 2400, 10e-6,
        fc=50e6, grade='C50/60'),
    # ACI 318 (fc' in psi -> MPa)
    _mk('concrete_fc3000', 'fc=3000 psi (ACI)', 'concrete', 'ACI', 22.0e9, 0.20, 2320, 9.9e-6,
        fc=20.7e6, grade='3000psi'),                          # 3000 psi = 20.7 MPa
    _mk('concrete_fc4000', 'fc=4000 psi (ACI)', 'concrete', 'ACI', 24.9e9, 0.20, 2320, 9.9e-6,
        fc=27.6e6, grade='4000psi'),                          # 4000 psi = 27.6 MPa
    _mk('concrete_fc5000', 'fc=5000 psi (ACI)', 'concrete', 'ACI', 27.8e9, 0.20, 2320, 9.9e-6,
        fc=34.5e6, grade='5000psi'),                          # 5000 psi = 34.5 MPa
    _mk('concrete_fc6000', 'fc=6000 psi (ACI)', 'concrete', 'ACI', 29.9e9, 0.20, 2320, 9.9e-6,
        fc=41.4e6, grade='6000psi'),
    _mk('concrete_fc8000', 'fc=8000 psi (ACI)', 'concrete', 'ACI', 33.3e9, 0.20, 2320, 9.9e-6,
        fc=55.2e6, grade='8000psi'),
]

# --------------------------------------------------------------------------- #
# Aluminum (EN 1999 / AA)
# --------------------------------------------------------------------------- #
_ALUMINUM = [
    _mk('alu_en_5083', '5083-H111 / 5083-0 (EN 1999)', 'aluminum', 'EN', 71e9, 0.33, 2660, 23e-6,
        fy=125e6, fu=270e6, grade='5083'),
    _mk('alu_en_6061_t6', '6061-T6 (EN 1999)', 'aluminum', 'EN', 69e9, 0.33, 2700, 23.6e-6,
        fy=240e6, fu=260e6, grade='6061-T6'),
    _mk('alu_en_6063_t6', '6063-T6', 'aluminum', 'EN', 69e9, 0.33, 2700, 23.4e-6,
        fy=160e6, fu=195e6, grade='6063-T6'),
    _mk('alu_en_6082_t6', '6082-T6', 'aluminum', 'EN', 70e9, 0.33, 2700, 23.4e-6,
        fy=260e6, fu=310e6, grade='6082-T6'),
    _mk('alu_aa_6061', '6061-T6 (AA)', 'aluminum', 'AA', 69e9, 0.33, 2700, 23.6e-6,
        fy=240e6, fu=260e6, grade='6061-T6'),
]

# --------------------------------------------------------------------------- #
# Timber / glulam (EN 14080 / NDS)
# --------------------------------------------------------------------------- #
_TIMBER = [
    _mk('timber_c24', 'C24 softwood (EN 338)', 'timber', 'EN', 11.0e9, 0.30, 420, 5e-6,
        fc=21e6, ft=14e6, grade='C24'),
    _mk('timber_c30', 'C30 softwood (EN 338)', 'timber', 'EN', 12.0e9, 0.30, 460, 5e-6,
        fc=23e6, ft=18e6, grade='C30'),
    _mk('timber_d30', 'D30 hardwood (EN 338)', 'timber', 'EN', 10.0e9, 0.30, 640, 5e-6,
        fc=23e6, ft=18e6, grade='D30'),
    _mk('timber_gl24h', 'GL24h glulam (EN 14080)', 'timber', 'EN', 11.6e9, 0.30, 380, 5e-6,
        fc=24e6, ft=19.2e6, grade='GL24h'),
    _mk('timber_gl28h', 'GL28h glulam (EN 14080)', 'timber', 'EN', 12.6e9, 0.30, 420, 5e-6,
        fc=28e6, ft=22.4e6, grade='GL28h'),
    _mk('timber_dfl', 'Douglas Fir-Larch (NDS)', 'timber', 'NDS', 12.0e9, 0.30, 480, 5e-6,
        fc=14.5e6, ft=8.3e6, grade='D-Fir No.2'),
    _mk('timber_spf', 'Spruce-Pine-Fir (NDS)', 'timber', 'NDS', 10.0e9, 0.30, 420, 5e-6,
        fc=11.6e6, ft=5.5e6, grade='SPF No.2'),
]

# --------------------------------------------------------------------------- #
# Reinforcement / prestressing / other
# --------------------------------------------------------------------------- #
_REBAR = [
    _mk('rebar_b500_b', 'B500B rebar (EN 10080)', 'rebar', 'EN', 200e9, 0.30, 7850, 12e-6,
        fy=500e6, fu=552e6, grade='B500B'),
    _mk('rebar_b400_b', 'B400B rebar (EN 10080)', 'rebar', 'EN', 200e9, 0.30, 7850, 12e-6,
        fy=400e6, fu=432e6, grade='B400B'),
    _mk('rebar_gr40', 'Grade 40 (ASTM A615)', 'rebar', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=276e6, fu=414e6, grade='Gr.40'),
    _mk('rebar_gr60', 'Grade 60 (ASTM A615)', 'rebar', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=414e6, fu=620e6, grade='Gr.60'),
    _mk('rebar_gr75', 'Grade 75 (ASTM A615)', 'rebar', 'ASTM', 200e9, 0.30, 7850, 11.7e-6,
        fy=517e6, fu=689e6, grade='Gr.75'),
    _mk('rebar_prestress_1860', 'Prestressing strand 1860 fpk', 'rebar', 'EN', 195e9, 0.30, 7850, 12e-6,
        fy=1600e6, fu=1860e6, grade='Y1860'),
]

MATERIAL_LIBRARY: dict[str, MaterialPreset] = {}
for _p in _STEEL + _CONCRETE + _ALUMINUM + _TIMBER + _REBAR:
    MATERIAL_LIBRARY[_p.key] = _p

MATERIAL_CATEGORIES = {
    'steel': 'Steel / Structural steel',
    'concrete': 'Concrete',
    'aluminum': 'Aluminum',
    'timber': 'Timber / Glulam',
    'rebar': 'Rebar / Prestressing',
}


def get_material_preset(key: str) -> MaterialPreset:
    """Return a material preset by its library key (raises KeyError if absent)."""
    return MATERIAL_LIBRARY[key]


def resolve_elastic_moduli(material: dict) -> dict:
    """
    Resolve elastic constants from a material record (dict) that may come
    either from the UI (keys E, nu) or from a preset (key `preset`).

    Returns {'E': float, 'nu': float, 'G': float, 'rho': float}.
    """
    E = material.get('E')
    nu = material.get('nu')
    rho = material.get('rho')

    # If a preset library key is given and E/nu are missing, resolve them.
    preset_key = material.get('preset') or material.get('key')
    if (E is None or nu is None) and preset_key:
        preset = MATERIAL_LIBRARY.get(preset_key)
        if preset is not None:
            E = E if E is not None else preset.E
            nu = nu if nu is not None else preset.nu
            if rho is None:
                rho = preset.rho

    if E is None or nu is None:
        raise ValueError(
            "Material must define E and nu (or a valid library `preset` key)."
        )

    E = float(E)
    nu = float(nu)
    rho = float(rho) if rho is not None else 0.0
    G = E / (2.0 * (1.0 + nu))

    return {'E': E, 'nu': nu, 'G': G, 'rho': rho}