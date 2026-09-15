import os
import sys
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("ENVIRONMENT", "test")

import copilot  # noqa: E402
from main import app  # noqa: E402


SESSION_HEADERS = {"X-Copilot-Session": "test-session-0000000000000001"}


@pytest.fixture(scope="module")
def client():
    # Deliberately NOT entered as a context manager: the app lifespan (MCP
    # StreamableHTTPSessionManager.run) may start only once per process, so a
    # second TestClient context (e.g. test_api.py in the same pytest run)
    # crashes startup with RuntimeError. Copilot routes do not depend on the
    # lifespan — the CORS middleware and router need no startup hooks.
    return TestClient(app)


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


def test_nvidia_preset_needs_only_an_api_key(client, monkeypatch):
    async def fake_models(provider, base_url, api_key):
        assert provider == "nvidia"
        assert base_url == "https://integrate.api.nvidia.com/v1"
        assert api_key == "nvapi-user-key"
        return ["meta/llama-3.3-70b-instruct"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "nvidia", "apiKey": "nvapi-user-key",
    })
    assert response.status_code == 201
    assert response.json()["label"] == "NVIDIA NIM"
    assert response.json()["models"] == ["meta/llama-3.3-70b-instruct"]


def test_groq_preset_needs_only_an_api_key(client, monkeypatch):
    async def fake_models(provider, base_url, api_key):
        assert provider == "groq"
        assert base_url == "https://api.groq.com/openai/v1"
        assert api_key == "gsk-user-key"
        return ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "groq", "apiKey": "gsk-user-key",
    })
    assert response.status_code == 201
    assert response.json()["provider"] == "groq"
    assert response.json()["label"] == "GroqCloud"
    assert response.json()["baseUrl"] == "https://api.groq.com/openai/v1"
    assert response.json()["models"] == ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]
    assert response.json()["keyHint"] == "••••-key"
    assert response.json()["rateLimit"] == {
        "mode": "auto", "maxConcurrent": 2, "rpm": None, "tpm": None,
        "safetyFactor": 0.8, "maxWaitSeconds": 30.0, "maxRetries": 2,
    }


def test_rate_limit_policy_can_be_set_and_updated_per_connection(client, monkeypatch):
    async def fake_models(_provider, _base_url, _api_key):
        return ["test-model"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    created = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "openai", "apiKey": "openai-user-key", "rateLimit": {
            "mode": "manual", "maxConcurrent": 1, "rpm": 12, "tpm": 5000,
            "safetyFactor": 0.75, "maxWaitSeconds": 15, "maxRetries": 1,
        },
    })
    assert created.status_code == 201
    connection_id = created.json()["id"]
    assert created.json()["rateLimit"]["rpm"] == 12

    updated = client.patch(
        f"/api/copilot/connections/{connection_id}/rate-limit",
        headers=SESSION_HEADERS,
        json={
            "mode": "auto", "maxConcurrent": 3, "rpm": 20, "tpm": 9000,
            "safetyFactor": 0.8, "maxWaitSeconds": 25, "maxRetries": 2,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["rateLimit"]["maxConcurrent"] == 3
    assert updated.json()["rateLimit"]["tpm"] == 9000
    assert (SESSION_HEADERS["X-Copilot-Session"], connection_id) in copilot.rate_governors


def _turn_request(mode="Inspect", tools=None):
    return {
        "requestId": "request-00000001",
        "conversationId": "conversation-00000001",
        "prompt": "Find short steel members",
        "mode": mode,
        "context": {"revision": 7, "counts": {"members": 2}},
        "history": [{"role": "user", "content": "Inspect the model"}],
        "tools": tools if tools is not None else [{
            "name": "query_entities",
            "description": "Query entities",
            "inputSchema": {"type": "object", "properties": {}},
        }],
        "toolResults": [],
        "connectionId": "connection-for-turn",
        "model": "test-model",
    }


def test_finalization_turn_omits_empty_tool_configuration(monkeypatch):
    session_id = SESSION_HEADERS["X-Copilot-Session"]
    connection_id = "finalization-connection"
    connection = copilot.ProviderConnection(
        id=connection_id, provider="openai", label="OpenAI", api_key="test-key",
        base_url="https://api.openai.com/v1", models=["test-model"],
        rate_limit=copilot.RateLimitSettings(mode="disabled"),
    )
    copilot.connections[(session_id, connection_id)] = connection
    captured = {}

    async def fake_provider_post(_client, _connection, _session_id, path, payload):
        captured.update(payload)
        assert path == "chat/completions"
        return httpx.Response(200, json={"choices": [{"message": {"content": "Final answer"}}]})

    monkeypatch.setattr(copilot, "_provider_post", fake_provider_post)
    payload = _turn_request(tools=[])
    payload["connectionId"] = connection_id
    payload["toolResults"] = [{
        "toolCallId": "query-1", "tool": "get_model_summary", "ok": True,
        "content": {"ok": True, "data": {"members": 3}},
    }]
    try:
        request = copilot.CopilotTurnRequest.model_validate(payload)
        result = asyncio.run(copilot.run_copilot_turn(request, session_id))
    finally:
        copilot.connections.pop((session_id, connection_id), None)
        copilot.rate_governors.pop((session_id, connection_id), None)

    assert result["message"] == "Final answer"
    assert result["finishReason"] == "stop"
    assert "tools" not in captured
    assert "tool_choice" not in captured
    assert "No more tools are available" in captured["messages"][0]["content"]


def test_generic_turn_returns_provider_neutral_tool_calls(client, monkeypatch):
    async def fake_turn(request, session_id):
        assert request.mode == "Inspect"
        assert request.context["revision"] == 7
        assert session_id == SESSION_HEADERS["X-Copilot-Session"]
        return {
            "message": "Looking up exact members",
            "toolCalls": [{"id": "tool-1", "name": "query_entities", "arguments": {"collection": "members"}}],
            "contextRevision": 7,
            "finishReason": "tool_calls",
        }

    monkeypatch.setattr(copilot, "run_copilot_turn", fake_turn)
    response = client.post("/api/copilot/turn", json=_turn_request(), headers=SESSION_HEADERS)
    assert response.status_code == 200
    assert response.json()["toolCalls"][0]["name"] == "query_entities"


def test_goal17_provider_neutral_tools_are_accepted_by_backend_contract():
    tools = [{
        "name": name, "description": f"Goal 17 {name}",
        "inputSchema": {"type": "object", "properties": {}},
    } for name in ["resolve_targets", "remember_targets", "change_material", "transform_entities", "update_entity_properties"]]
    request = copilot.CopilotTurnRequest.model_validate(_turn_request(mode="Agent", tools=tools))
    copilot._validate_turn_tools(request)


def test_catalogue_creation_tools_are_accepted_by_backend_contract():
    tools = [{
        "name": name, "description": f"Catalogue {name}",
        "inputSchema": {"type": "object", "properties": {}},
    } for name in ["create_material", "create_section"]]
    request = copilot.CopilotTurnRequest.model_validate(_turn_request(mode="Generate", tools=tools))
    copilot._validate_turn_tools(request)
    assert "Never claim that create_material or create_section is unavailable" in copilot.TOOL_SYSTEM_PROMPT
    assert "Modeling, Generate or" in copilot.TOOL_SYSTEM_PROMPT


def test_exhausted_provider_rate_limit_is_preserved_as_429(client, monkeypatch):
    async def rate_limited(_request, _session_id):
        raise copilot.ProviderQueueTimeout("Provider rate limit exceeded; retry after 2s")

    monkeypatch.setattr(copilot, "run_copilot_turn", rate_limited)
    response = client.post("/api/copilot/turn", json=_turn_request(), headers=SESSION_HEADERS)
    assert response.status_code == 429
    assert "retry after 2s" in response.json()["detail"]


def test_turn_stream_emits_text_and_final_revision(client, monkeypatch):
    async def fake_turn(_request, _session_id):
        return {"message": "Found two members", "toolCalls": [], "contextRevision": 7, "finishReason": "stop"}

    monkeypatch.setattr(copilot, "run_copilot_turn", fake_turn)
    response = client.post("/api/copilot/turn/stream", json=_turn_request(), headers=SESSION_HEADERS)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: text" in response.text
    assert "Found two members" in response.text
    assert '"contextRevision": 7' in response.text


def test_inspect_mode_rejects_exposed_mutation_tools(client):
    payload = _turn_request(tools=[{
        "name": "create_nodes",
        "description": "Create nodes",
        "inputSchema": {"type": "object", "properties": {}},
    }])
    response = client.post("/api/copilot/turn", json=payload, headers=SESSION_HEADERS)
    assert response.status_code == 502
    assert "Inspect mode" in response.json()["detail"]


def test_cancelled_turn_does_not_call_provider(client, monkeypatch):
    called = False

    async def fake_turn(_request, _session_id):
        nonlocal called
        called = True
        return {"message": "unexpected", "toolCalls": [], "contextRevision": 7, "finishReason": "stop"}

    monkeypatch.setattr(copilot, "run_copilot_turn", fake_turn)
    client.post("/api/copilot/cancel/request-00000001", headers=SESSION_HEADERS)
    response = client.post("/api/copilot/turn", json=_turn_request(), headers=SESSION_HEADERS)
    assert response.status_code == 200
    assert response.json()["finishReason"] == "cancelled"
    assert called is False


def test_provider_connections_are_isolated_by_browser_session(client):
    other_headers = {"X-Copilot-Session": "other-session-0000000000000002"}
    own = client.get("/api/copilot/connections", headers=SESSION_HEADERS).json()
    other = client.get("/api/copilot/connections", headers=other_headers).json()
    assert any(connection["provider"] == "deepseek" for connection in own)
    assert other == []


def test_local_provider_connection_works_without_api_key(client):
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "ollama", "modelIds": ["llama3.2:3b"],
    })
    assert response.status_code == 201
    connection = response.json()
    assert connection["provider"] == "ollama"
    assert connection["baseUrl"] == "http://localhost:11434/v1"
    assert connection["keyHint"] == "local"


def test_local_provider_auto_discovers_models(client, monkeypatch):
    async def fake_models(provider, base_url, api_key):
        assert provider == "ollama"
        assert base_url == "http://localhost:11434/v1"
        assert api_key == ""
        return ["llama3.2:3b", "llama3.2:3b", "qwen2.5:7b-instruct"]

    monkeypatch.setattr(copilot, "discover_models", fake_models)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={"provider": "ollama"})
    assert response.status_code == 201
    assert response.json()["models"] == ["llama3.2:3b", "qwen2.5:7b-instruct"]


def test_local_provider_requires_opt_in_in_production(client, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("COPILOT_ALLOW_LOCAL_PROVIDERS", raising=False)
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "lmstudio", "modelIds": ["qwen2.5-7b-instruct"],
    })
    assert response.status_code == 422
    assert "COPILOT_ALLOW_LOCAL_PROVIDERS" in response.json()["detail"]
    monkeypatch.setenv("COPILOT_ALLOW_LOCAL_PROVIDERS", "1")
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "lmstudio", "modelIds": ["qwen2.5-7b-instruct"],
    })
    assert response.status_code == 201
    assert response.json()["baseUrl"] == "http://localhost:1234/v1"


def test_local_provider_rejects_public_or_metadata_base_urls(client):
    for base_url in ("http://8.8.8.8/v1", "http://169.254.169.254/v1", "http://user:pass@localhost:11434/v1"):
        response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
            "provider": "local", "baseUrl": base_url, "modelIds": ["llama3.2:3b"],
        })
        assert response.status_code == 422


def test_local_provider_accepts_loopback_and_private_base_urls(client):
    for base_url in ("http://127.0.0.1:8000/v1", "http://192.168.1.10:1234/v1", "http://host.docker.internal:11434/v1"):
        response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
            "provider": "local", "baseUrl": base_url, "modelIds": ["llama3.2:3b"],
        })
        assert response.status_code == 201


def test_local_provider_requires_base_url_for_custom_local(client):
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "local", "modelIds": ["llama3.2:3b"],
    })
    assert response.status_code == 422
    assert "baseUrl" in response.json()["detail"]


def test_cloud_provider_still_requires_an_api_key(client):
    response = client.post("/api/copilot/connections", headers=SESSION_HEADERS, json={
        "provider": "openai", "modelIds": ["test-model"],
    })
    assert response.status_code == 422


def test_local_headers_omit_authorization():
    assert copilot._headers("ollama", "") == {}
    assert copilot._headers("openai", "key")["Authorization"] == "Bearer key"
    assert copilot._headers("anthropic", "key")["x-api-key"] == "key"


def test_parse_tool_calls_accepts_string_and_object_arguments():
    parsed = copilot._parse_tool_calls({"tool_calls": [{
        "id": "call-1", "type": "function",
        "function": {"name": "query_entities", "arguments": "{\"collection\": \"members\"}"},
    }]})
    assert parsed[0]["arguments"] == {"collection": "members"}
    parsed = copilot._parse_tool_calls({"tool_calls": [{
        "id": "call-2", "type": "function",
        "function": {"name": "query_entities", "arguments": {"collection": "nodes"}},
    }]})
    assert parsed[0]["arguments"] == {"collection": "nodes"}
    parsed = copilot._parse_tool_calls({"tool_calls": [{"id": "call-3", "function": {"name": "x"}}]})
    assert parsed[0]["arguments"] == {}
    with pytest.raises(RuntimeError):
        copilot._parse_tool_calls({"tool_calls": [{"id": "call-4", "function": {"name": "x", "arguments": "{bad"}}]})
