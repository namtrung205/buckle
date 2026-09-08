import os
import sys

import pytest
from fastapi.testclient import TestClient


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("ENVIRONMENT", "test")

import copilot  # noqa: E402
from main import app  # noqa: E402


SESSION_HEADERS = {"X-Copilot-Session": "test-session-0000000000000001"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _request():
    return {
        "prompt": "Create two nodes and connect them",
        "context": {
            "revision": 4,
            "nodeCount": 0,
            "memberCount": 0,
            "nodeIds": [],
            "sections": [{"id": 7, "name": "I200", "type": "I"}],
        },
    }


def test_copilot_plan_returns_provider_neutral_transaction(client, monkeypatch):
    async def fake_plan(request, session_id):
        assert request.context.revision == 4
        assert session_id == SESSION_HEADERS["X-Copilot-Session"]
        return {
            "kind": "transaction",
            "message": "Created a beam",
            "plan": {
                "summary": "Created a beam",
                "nodes": [
                    {"alias": "a", "x": 0, "y": 0, "z": 0},
                    {"alias": "b", "x": 5, "y": 0, "z": 0},
                ],
                "members": [{"alias": "beam", "node_i": "a", "node_j": "b", "section_id": 7}],
            },
        }

    monkeypatch.setattr(copilot, "plan_copilot_request", fake_plan)
    response = client.post("/api/copilot/plan", json=_request(), headers=SESSION_HEADERS)
    assert response.status_code == 200
    assert response.json()["plan"]["members"][0]["node_i"] == "a"


def test_copilot_rejects_empty_prompt_before_provider_call(client):
    payload = _request()
    payload["prompt"] = ""
    response = client.post("/api/copilot/plan", json=payload, headers=SESSION_HEADERS)
    assert response.status_code == 422


def test_byok_connection_never_returns_secret(client, monkeypatch):
    async def fake_models(provider, base_url, api_key):
        assert provider == "deepseek"
        assert api_key == "secret-user-key"
        return ["deepseek-chat", "deepseek-reasoner"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "deepseek", "apiKey": "secret-user-key",
    })
    assert response.status_code == 201
    connection = response.json()
    assert connection["keyHint"] == "••••-key"
    assert "api_key" not in connection and "apiKey" not in connection
    listed = client.get("/api/copilot/connections", headers=SESSION_HEADERS).json()
    assert listed[0]["models"] == ["deepseek-chat", "deepseek-reasoner"]
    assert "secret-user-key" not in str(listed)


def test_custom_provider_rejects_private_or_insecure_urls(client):
    for base_url in ("http://provider.example/v1", "https://127.0.0.1:9000/v1"):
        response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
            "provider": "compatible", "apiKey": "test-key", "baseUrl": base_url,
            "modelIds": ["custom-model"],
        })
        assert response.status_code == 422


def test_gemini_preset_needs_only_an_api_key(client, monkeypatch):
    async def fake_models(provider, base_url, api_key):
        assert provider == "gemini"
        assert base_url == "https://generativelanguage.googleapis.com/v1beta/openai"
        assert api_key == "gemini-user-key"
        return ["gemini-model"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "gemini", "apiKey": "gemini-user-key",
    })
    assert response.status_code == 201
    assert response.json()["label"] == "Google Gemini"
    assert response.json()["models"] == ["gemini-model"]
