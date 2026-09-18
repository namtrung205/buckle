"""Contract checks for committed examples, OpenAPI, and generated JSON Schema."""

from __future__ import annotations

import json
from pathlib import Path

from schemas import Model
from scripts.export_schema import canonical_schema


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPOSITORY_ROOT / "frontend" / "public" / "examples"


def test_exported_schema_is_current():
    committed = json.loads((REPOSITORY_ROOT / "input_schema.json").read_text(encoding="utf-8"))
    assert committed == canonical_schema()


def test_every_example_round_trips_through_canonical_contract():
    examples = sorted(EXAMPLES_DIR.glob("*.json"))
    assert examples, "No example models were found"

    for path in examples:
        source = json.loads(path.read_text(encoding="utf-8"))
        model = Model.model_validate(source)
        exported = model.model_dump(mode="json", by_alias=True, exclude_none=True)
        reparsed = Model.model_validate(exported)

        assert reparsed.model_dump(mode="json", by_alias=True, exclude_none=True) == exported
        assert [node.id for node in reparsed.nodes] == [node["id"] for node in source["nodes"]]
        assert [member.id for member in reparsed.members] == [
            member["id"] for member in source["members"]
        ]
        assert [(member.nodei.id, member.nodej.id) for member in reparsed.members] == [
            (member["nodei"]["id"], member["nodej"]["id"]) for member in source["members"]
        ]
        assert [(node.x, node.y, node.z) for node in reparsed.nodes] == [
            (node["x"], node["y"], node["z"]) for node in source["nodes"]
        ]
        assert [member.vecxz for member in reparsed.members] == [
            member.get("vecxz") for member in source["members"]
        ]
        assert [load.value.model_dump() for load in reparsed.loads] == [
            load["value"] for load in source["loads"]
        ]
