"""Export the canonical structural-model schema consumed by every boundary."""

from __future__ import annotations

import json
import argparse
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from schemas import Model  # noqa: E402


def canonical_schema() -> dict:
    schema = Model.model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "Buckle Structural Model v1"
    schema["description"] = (
        "Engineering Z-up transport contract. Coordinates and shell thickness are metres; "
        "section dimensions are millimetres; material modulus/strength are pascals; "
        "nodal loads are kN, line loads kN/m, pressure loads kN/m², and angles degrees."
    )
    return schema


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the committed schema differs without rewriting it.",
    )
    args = parser.parse_args()
    target = REPOSITORY_ROOT / "input_schema.json"
    generated = json.dumps(canonical_schema(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        committed = target.read_text(encoding="utf-8") if target.exists() else None
        if committed != generated:
            raise SystemExit(
                f"{target} is stale; run backend/scripts/export_schema.py and commit it"
            )
    else:
        target.write_text(generated, encoding="utf-8")
    print(target)


if __name__ == "__main__":
    main()
