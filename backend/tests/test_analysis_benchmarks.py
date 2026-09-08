"""Golden checks that isolate the solver from section-catalogue approximation."""

from copy import deepcopy

from opensees.main import run_analysis
from test_case1_simply_supported import (
    analytic_expected,
    max_abs_deflection_mm,
    max_reaction_kN,
    midspan_moment_kNm,
    model as simply_supported_model,
)


def test_simply_supported_beam_matches_euler_bernoulli_solution():
    expected = analytic_expected()
    output = run_analysis(deepcopy(simply_supported_model))

    displacement_mm = max_abs_deflection_mm(output)
    expected_mm = expected["delta_max_m"] * 1000.0
    reaction_kn = max_reaction_kN(output)
    expected_reaction_kn = expected["R_N"] / 1000.0
    moment_knm = midspan_moment_kNm(output)
    expected_moment_knm = expected["M_max_Nm"] / 1000.0

    assert abs(displacement_mm - expected_mm) / expected_mm <= 0.02
    assert abs(reaction_kn - expected_reaction_kn) / expected_reaction_kn <= 0.02
    assert abs(moment_knm - expected_moment_knm) / expected_moment_knm <= 0.06

    reactions = output["reactions"]
    assert len(reactions) == 2
    assert abs(sum(item["Fz"] for item in reactions) - 0.1) <= 1e-6
