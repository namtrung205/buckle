"""Named solver regressions covering v1 geometry/load adapter combinations.

These are finite-result regression cases, not independently certified references;
the certification boundary is recorded in ADR 0001.
"""

from __future__ import annotations

import math
from copy import deepcopy

import pytest

from opensees.main import run_analysis
from schemas import Model


MATERIAL = {"id": 1, "name": "Steel", "E": 210e9, "nu": 0.3, "rho": 7850}
SECTION = {
    "id": 1,
    "name": "R300x500",
    "type": "Rectangular",
    "width": 300,
    "height": 500,
    "material": MATERIAL,
}


def node(identifier: int, x: float, y: float, z: float) -> dict:
    return {"id": identifier, "name": f"N{identifier}", "x": x, "y": y, "z": z}


def member(identifier: int, ni: dict, nj: dict, release: str = "") -> dict:
    return {
        "id": identifier,
        "label": f"M{identifier}",
        "nodei": deepcopy(ni),
        "nodej": deepcopy(nj),
        "section": 1,
        "release": release,
    }


def base(nodes: list[dict], members: list[dict]) -> dict:
    return {
        "schemaVersion": "1.0",
        "nodes": nodes,
        "members": members,
        "materials": [MATERIAL],
        "sections": [SECTION] if members else [],
        "loads": [],
        "boundary_conditions": [],
        "shells": [],
    }


def portal_frame() -> dict:
    n1, n2 = node(1, 0, 0, 0), node(2, 6, 0, 0)
    n3, n4 = node(3, 0, 0, 4), node(4, 6, 0, 4)
    model = base([n1, n2, n3, n4], [member(1, n1, n3), member(2, n3, n4), member(3, n4, n2)])
    model["boundary_conditions"] = [{"id": 1, "type": "fixed", "targets": [1, 2], "dx": 1, "dy": 1, "dz": 1, "rx": 1, "ry": 1, "rz": 1}]
    model["loads"] = [{"id": 1, "type": "nodal", "targets": [3], "value": {"x": 10, "y": 0, "z": 0}}]
    return model


def inclined_cantilever() -> dict:
    n1, n2 = node(1, 0, 0, 0), node(2, 3, 0, 4)
    model = base([n1, n2], [member(1, n1, n2)])
    model["boundary_conditions"] = [{"id": 1, "type": "fixed", "targets": [1], "dx": 1, "dy": 1, "dz": 1, "rx": 1, "ry": 1, "rz": 1}]
    model["loads"] = [{"id": 1, "type": "nodal", "targets": [2], "value": {"x": 0, "y": 0, "z": -5}}]
    return model


def released_beam() -> dict:
    n1, n2 = node(1, 0, 0, 0), node(2, 6, 0, 0)
    model = base([n1, n2], [member(1, n1, n2, "pinned-pinned")])
    model["boundary_conditions"] = [
        {"id": 1, "type": "custom", "targets": [1], "dx": 1, "dy": 1, "dz": 1, "rx": 1, "ry": 0, "rz": 1},
        {"id": 2, "type": "custom", "targets": [2], "dx": 0, "dy": 1, "dz": 1, "rx": 1, "ry": 0, "rz": 1},
    ]
    model["loads"] = [{"id": 1, "type": "linear", "targets": [1], "value": {"x": 0, "y": 0, "z": -10}}]
    return model


def shell_pressure(mixed: bool = False) -> dict:
    nodes = [node(1, 0, 0, 0), node(2, 2, 0, 0), node(3, 2, 2, 0), node(4, 0, 2, 0)]
    members: list[dict] = []
    if mixed:
        nodes.append(node(5, 0, 0, 3))
        members.append(member(1, nodes[0], nodes[4]))
    model = base(nodes, members)
    model["shells"] = [{"id": 10, "name": "S10", "nodes": [1, 2, 3, 4], "thickness": 0.02, "material": MATERIAL}]
    model["boundary_conditions"] = [{"id": 1, "type": "fixed", "targets": [1, 2, 3], "dx": 1, "dy": 1, "dz": 1, "rx": 1, "ry": 1, "rz": 1}]
    model["loads"] = [{"id": 10, "type": "pressure", "targets": [10], "magnitude": 2.5, "value": {"x": 0, "y": 0, "z": 0}}]
    if mixed:
        model["loads"].append({"id": 11, "type": "nodal", "targets": [5], "value": {"x": 1, "y": 0, "z": 0}})
    return model


@pytest.mark.parametrize(
    ("case_name", "factory"),
    [
        ("portal-frame", portal_frame),
        ("released-beam", released_beam),
        ("inclined-member", inclined_cantilever),
        ("shell-pressure", shell_pressure),
        ("mixed-beam-shell", lambda: shell_pressure(mixed=True)),
    ],
)
def test_v1_regression_case_produces_finite_results(case_name, factory):
    validated = Model.model_validate(factory()).model_dump(mode="json", by_alias=True)
    output = run_analysis(validated)

    assert output["nodes"], case_name
    assert output["reactions"], case_name
    displacement_values = [
        value
        for result_node in output["nodes"]
        for value in (result_node.get("displacements") or {}).values()
    ]
    assert displacement_values and all(math.isfinite(value) for value in displacement_values), case_name


def test_inclined_member_local_axis_force_signs():
    """A -5 kN global-Z tip load resolves to -4 axial and +3 local-z kN."""
    model = Model.model_validate(inclined_cantilever()).model_dump(mode="json", by_alias=True)
    station = run_analysis(model)["members"][0]["stations"][0]["values"]

    assert station["N"] == pytest.approx(-4.0, abs=1e-6)
    assert station["Vz"] == pytest.approx(3.0, abs=1e-6)
    assert station["My"] == pytest.approx(15.0, abs=1e-6)


def test_released_beam_has_zero_end_moments():
    model = Model.model_validate(released_beam()).model_dump(mode="json", by_alias=True)
    stations = run_analysis(model)["members"][0]["stations"]

    assert stations[0]["values"]["My"] == pytest.approx(0.0, abs=1e-6)
    assert stations[-1]["values"]["My"] == pytest.approx(0.0, abs=1e-6)


def test_shell_pressure_reactions_balance_applied_load():
    model = Model.model_validate(shell_pressure()).model_dump(mode="json", by_alias=True)
    reactions = run_analysis(model)["reactions"]

    assert sum(reaction["Fz"] for reaction in reactions) == pytest.approx(-10.0, abs=2e-3)
