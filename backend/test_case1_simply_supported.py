"""
Test Case 1 — Simply supported beam (dầm giản đơn)
================================================================
Geometry  : 1 beam, L = 10 m, along +X, at y = z = 0
Supports  : left  = fixed  (Dx,Dy,Dz,Rx fixed, Ry,Rz free)  — "gối cố định"
            right = roller (Dy,Dz,Rx fixed, Dx,Ry,Rz free)  — "gối di động"
Load      : uniformly distributed 10 N/m (applied in -Z = gravity, Z is vertical)
            NOTE: Backend interprets load `value` in kN/m -> 10 N/m = 0.01 kN/m

Analytical solution (Euler-Bernoulli, simply supported, UDL w):
  R                    = w L / 2
  M_max (mid-span)     = w L^2 / 8
  delta_max (mid-span) = 5 w L^4 / (384 E I)

Units: OpenSees base units are N, mm. The section is computed in mm by the
backend (compute_section_properties multiplies the I-section dims by 1e-3 m/mm),
so E is in N/mm^2 and I in mm^4. Bending is in the vertical x-y plane, governed
by the strong-axis moment of inertia (Iz in the OpenSees 3D beam-column).
"""

import json
import os
import sys

import numpy as np

# Force UTF-8 output so backend log glyphs (e.g. "✓") never crash on Windows
# consoles/files that default to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from opensees.main import run_analysis  # noqa: E402


L = 10.0            # m
NODE_I = 1
NODE_J = 2

nodes = [
    {"id": NODE_I, "x": -5.0, "y": 0.0, "z": 0.0, "name": "Node i"},
    {"id": NODE_J, "x": 5.0, "y": 0.0, "z": 0.0, "name": "Node j"},
]

SECTION = {
    "id": 1,
    "name": "IPE 300",
    "type": "I",
    "depth": 300, "width": 150, "tw": 7.1, "tf": 10.7, "r": 15,
    "material": {"id": 2, "name": "Steel", "E": 210000000000, "nu": 0.3},
}

# UDL: 10 N/m acting downward (Z is "up", so negative z = gravity)
w = 10.0
w_per_m = w / 1000.0  # kN/m as the backend expects

members = [
    {
        "id": 10, "label": "Member 1",
        "nodei": {"id": NODE_I, "x": -5.0, "y": 0.0, "z": 0.0},
        "nodej": {"id": NODE_J, "x": 5.0, "y": 0.0, "z": 0.0},
        "section": SECTION["id"], "vecxz": [0, 0, 1], "release": "",
    }
]

# Fixed support (gối cố định): translations + torsion Rx fixed, bending Ry,Rz free
bc_left = {
    "id": 100, "name": "Fixed support", "type": "custom", "targets": [NODE_I],
    "dx": 1, "dy": 1, "dz": 1, "rx": 1, "ry": 0, "rz": 0,
}

# Roller support (gối di động): vertical (dy,dz) + torsion Rx fixed, slide in X
bc_right = {
    "id": 101, "name": "Roller support", "type": "custom", "targets": [NODE_J],
    "dx": 0, "dy": 1, "dz": 1, "rx": 1, "ry": 0, "rz": 0,
}

loads = [
    {
        "id": 200, "type": "linear", "targets": [members[0]["id"]],
        "name": "UDL 10 N/m", "value": {"x": 0.0, "y": 0.0, "z": -w_per_m},
    }
]

model = {
    "nodes": nodes, "members": members,
    "materials": [SECTION["material"]], "sections": [SECTION],
    "loads": loads, "boundary_conditions": [bc_left, bc_right],
    "shells": [],
}


def analytic_expected():
    mm = 1e-3
    h = SECTION["depth"] * mm
    b = SECTION["width"] * mm
    tw = SECTION["tw"] * mm
    tf = SECTION["tf"] * mm

    A = 2 * b * tf + (h - 2 * tf) * tw
    d_web = h - 2 * tf
    I_strong = 2 * (b * tf ** 3 / 12 + b * tf * ((h / 2 - tf / 2) ** 2)) + tw * d_web ** 3 / 12
    I_weak = 2 * (tf * b ** 3 / 12) + d_web * tw ** 3 / 12

    E = SECTION["material"]["E"]  # N/m^2
    E_mm = E / 1e6                # N/mm^2
    I_strong_mm = I_strong / (1e-3) ** 4
    I_weak_mm = I_weak / (1e-3) ** 4

    L_m = L
    w_m = w
    R = w_m * L_m / 2.0
    M_max = w_m * L_m ** 2 / 8.0
    delta_max = 5 * w_m * L_m ** 4 / (384 * E * I_strong)

    return {
        "A_m2": A, "I_strong_m4": I_strong, "I_weak_m4": I_weak,
        "I_strong_mm4": I_strong_mm, "I_weak_mm4": I_weak_mm,
        "R_N": R, "M_max_Nm": M_max, "delta_max_m": delta_max,
    }


def max_abs_deflection_mm(output):
    """Absolute max vertical deflection (mm) across all output nodes.

    A load applied in -Z (gravity) produces vertical deflection in Z, which the
    backend exposes as node['displacements']['uz'] (disp[2]).
    """
    val = 0.0
    for node in output["nodes"]:
        d = node.get("displacements")
        if d:
            val = max(val, abs(d["uz"]))
    return val * 1000.0


def max_reaction_kN(output):
    """Max support reaction (kN) from member end shear forces.

    The vertical reaction appears as the shear force `Vz` at the supported
    member ends (backend unit for shear is kN). Magnitude is identical at
    both supports for a symmetric UDL.
    """
    vals = []
    for ne in output["members"][0]["node_efforts"]:
        v = ne.get("efforts", {}).get("Vz")
        if v is not None:
            vals.append(abs(v["value"]))
    return max(vals) if vals else 0.0


def midspan_moment_kNm(output):
    """Bending moment (kN.m) at mid-span from the member station closest to x=0.

    Bending of a horizontal member under a vertical (-Z) load is about the
    local y-axis, hence the `My` force component. Backend unit for bending
    moment is kN.m.
    """
    sts = output["members"][0].get("stations", [])
    if not sts:
        return 0.0
    mid = min(sts, key=lambda s: abs(s["coord"][0]))
    return abs(mid["values"].get("My", 0.0))


def main():
    exp = analytic_expected()

    print("=" * 72)
    print("TEST CASE 1 — Simply supported beam, UDL 10 N/m")
    print("=" * 72)
    print(f"  L          = {L} m")
    print(f"  w          = {w} N/m")
    print(f"  E          = {SECTION['material']['E']:.3e} Pa")
    print(f"  I_strong   = {exp['I_strong_mm4']:.1f} mm^4")
    print()
    print("  Analytical (simply supported, UDL):")
    print(f"    R         = {exp['R_N']:.4f} N")
    print(f"    M_max     = {exp['M_max_Nm']:.4f} N.m")
    print(f"    delta_max = {exp['delta_max_m']*1000:.4f} mm")
    print()

    output = run_analysis(model)
    reactions = output.get("reactions", [])

    mid_mm = max_abs_deflection_mm(output)
    expected_mm = exp["delta_max_m"] * 1000.0

    R_kN = max_reaction_kN(output)
    R_exp_kN = exp["R_N"] / 1000.0
    M_kNm = midspan_moment_kNm(output)
    M_exp_kNm = exp["M_max_Nm"] / 1000.0

    print("-" * 72)
    print("RESULTS (OpenSees):")
    print(f"  nodes in output = {len(output['nodes'])}")
    print(f"  |uz| max        = {mid_mm:.4f} mm   (expected {expected_mm:.4f} mm)")
    print(f"  reaction R      = {R_kN:.4f} kN    (expected {R_exp_kN:.4f} kN)")
    print(f"  moment M_mid    = {M_kNm:.4f} kN.m  (expected {M_exp_kNm:.4f} kN.m)")

    print(f"  reactions payload: {len(reactions)} support node(s)")
    for r in reactions:
        print(
            f"    node {r['id']}: Fx={r['Fx']:.4f} Fy={r['Fy']:.4f} Fz={r['Fz']:.4f} kN | "
            f"Mx={r['Mx']:.4f} My={r['My']:.4f} Mz={r['Mz']:.4f} kN.m"
        )
    print(f"  sum Fz          = {sum(r['Fz'] for r in reactions):.4f} kN   (applied load = {-w * L / 1000.0:.4f} kN)")

    rel_d = abs(mid_mm - expected_mm) / expected_mm
    print(f"  deflection rel err = {rel_d*100:.3f} %")

    # --- deflection check -------------------------------------------------
    # The backend rounds nodal displacement to 5 decimal places of *metres*
    # (= 0.01 mm). For expected deflection ~0.0775 mm this quantises to 0.08 mm,
    # i.e. up to ~3-4% apparent error. Allow 5% to absorb this rounding plus
    # Timoshenko shear/discretisation effects.
    tol_d = 0.05
    ok_d = rel_d <= tol_d

    # --- reaction check ---------------------------------------------------
    # Shear is stored to 2 decimal places of kN; 50 N -> 0.05 kN is exact.
    tol_r = 0.02
    ok_r = abs(R_kN - R_exp_kN) <= abs(R_exp_kN) * tol_r

    # --- reactions payload check (ops.nodeReaction via extract_node_reactions)
    ok_rx = len(reactions) == 2 and all(
        abs(abs(r["Fz"]) - R_exp_kN) <= abs(R_exp_kN) * tol_r for r in reactions
    )

    # --- moment check -----------------------------------------------------
    # Mid-span moment is also quantised to 2 decimal places of kN.m: 0.125
    # kN.m -> 0.12/0.13 (5% bin). Allow 6% to absorb the 2-dp rounding.
    tol_m = 0.06
    ok_m = abs(M_kNm - M_exp_kNm) <= abs(M_exp_kNm) * tol_m

    ok = ok_d and ok_r and ok_m and ok_rx

    print("-" * 72)
    print(f"  deflection {'PASS' if ok_d else 'FAIL'}  (tol {tol_d*100:.0f}%)")
    print(f"  reaction   {'PASS' if ok_r else 'FAIL'}  (tol {tol_r*100:.0f}%)")
    print(f"  reactions payload {'PASS' if ok_rx else 'FAIL'}")
    print(f"  moment     {'PASS' if ok_m else 'FAIL'}  (tol {tol_m*100:.0f}%)")
    print("-" * 72)
    print(f"{'PASS' if ok else 'FAIL'}: all simply-supported beam checks vs analytical solution")
    print("=" * 72)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())