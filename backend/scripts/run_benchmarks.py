"""Run certified analytical benchmarks and write a CI-friendly JSON artifact."""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from opensees.main import run_analysis
from test_case1_simply_supported import (
    analytic_expected,
    max_abs_deflection_mm,
    max_reaction_kN,
    midspan_moment_kNm,
    model,
)


def run() -> dict:
    expected = analytic_expected()
    output = run_analysis(deepcopy(model))
    values = {
        "displacement_mm": max_abs_deflection_mm(output),
        "reaction_kN": max_reaction_kN(output),
        "moment_kNm": midspan_moment_kNm(output),
    }
    references = {
        "displacement_mm": expected["delta_max_m"] * 1000.0,
        "reaction_kN": expected["R_N"] / 1000.0,
        "moment_kNm": expected["M_max_Nm"] / 1000.0,
    }
    tolerances = {"displacement_mm": 0.02, "reaction_kN": 0.02, "moment_kNm": 0.06}
    relative_errors = {
        key: abs(values[key] - references[key]) / abs(references[key]) for key in values
    }
    return {
        "schemaVersion": "1.0",
        "benchmark": "simply-supported-euler-bernoulli",
        "values": values,
        "references": references,
        "relativeErrors": relative_errors,
        "tolerances": tolerances,
        "passed": all(relative_errors[key] <= tolerances[key] for key in values),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("artifacts/benchmark.json"))
    args = parser.parse_args()
    result = run()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
