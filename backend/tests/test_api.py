from copy import deepcopy
import json
import os
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("ENVIRONMENT", "test")

from main import app  # noqa: E402
from test_case1_simply_supported import model as simply_supported_model  # noqa: E402


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPOSITORY_ROOT / "frontend" / "public" / "examples"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


class TestAnalysisRoute:
    def test_analysis_uses_versioned_structural_contract(self, client):
        payload = deepcopy(simply_supported_model)
        payload["schemaVersion"] = "1.0"
        payload["metadata"] = {
            "modelName": "revisioned-core-snapshot",
            "modelRevision": 7,
            "snapshotHash": "fnv1a64:test",
        }

        response = client.post("/analysis", json=payload)

        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "Analysis completed successfully"
        assert len(result["output"]["members"]) == 1
        assert len(result["output"]["reactions"]) == 2

    def test_rejects_dangling_member_reference(self, client):
        payload = deepcopy(simply_supported_model)
        payload["members"][0]["nodej"]["id"] = 999

        response = client.post("/analysis", json=payload)

        assert response.status_code == 422
        assert "missing node 999" in response.text

    def test_rejects_endpoint_coordinate_drift(self, client):
        payload = deepcopy(simply_supported_model)
        payload["members"][0]["nodej"]["x"] += 0.1

        response = client.post("/analysis", json=payload)

        assert response.status_code == 422
        assert "coordinates do not match" in response.text

    @pytest.mark.parametrize(
        "example_name",
        [
            "simply-supported-beam.json",
            "steel-frame-nodal-load.json",
            "concrete-frame-linear-load.json",
        ],
    )
    def test_frontend_example_runs_end_to_end(self, client, example_name):
        payload = json.loads((EXAMPLES_DIR / example_name).read_text(encoding="utf-8"))

        response = client.post("/analysis", json=payload)

        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "Analysis completed successfully"
        assert len(result["output"]["members"]) == len(payload["members"])


class TestHealthRoutes:
    def test_health_endpoint(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "healthy"
        assert "timestamp" in result
        assert "version" in result

    def test_ready_endpoint(self, client):
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json()["status"] == "ready"


class TestErrorHandling:
    def test_invalid_json(self, client):
        response = client.post(
            "/analysis",
            content="invalid json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_missing_body(self, client):
        response = client.post("/analysis")
        assert response.status_code == 422

    def test_unknown_schema_version(self, client):
        payload = deepcopy(simply_supported_model)
        payload["schemaVersion"] = "999"
        response = client.post("/analysis", json=payload)
        assert response.status_code == 422
        error = response.json()["detail"][0]
        assert error["path"] == "schemaVersion"
        assert set(error) == {"path", "code", "expected", "received"}
        assert error["received"] == "999"

    def test_missing_schema_version(self, client):
        payload = deepcopy(simply_supported_model)
        payload.pop("schemaVersion")
        response = client.post("/analysis", json=payload)
        assert response.status_code == 422
        assert response.json()["detail"][0]["path"] == "schemaVersion"


class TestOpenApiContract:
    def test_analysis_request_references_structural_model(self, client):
        schema = client.get("/openapi.json").json()
        request_schema = schema["paths"]["/analysis"]["post"]["requestBody"]["content"][
            "application/json"
        ]["schema"]
        assert request_schema["$ref"].endswith("/Model")

        model_schema = schema["components"]["schemas"]["Model"]
        assert model_schema["properties"]["schemaVersion"]["const"] == "1.0"
        assert set(model_schema["required"]) >= {
            "schemaVersion",
            "nodes",
            "members",
            "sections",
        }
