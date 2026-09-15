"""CORS preflight regression tests — the Copilot panel sends the custom
`X-Copilot-Session` header and a PATCH (rate limit); both must survive the
browser preflight or every copilot call dies with a 400 before reaching the
route."""

import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("ENVIRONMENT", "test")

from main import app  # noqa: E402

# Deliberately NOT entered as a context manager: the app lifespan (MCP
# StreamableHTTPSessionManager.run) may only start once per process, and
# test_copilot.py's module-scoped client already runs it. CORS preflight
# handling happens in middleware and needs no lifespan.
client = TestClient(app)


def test_copilot_preflight_allows_session_header():
    response = client.options("/api/copilot/connections", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-copilot-session",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "x-copilot-session" in response.headers["access-control-allow-headers"].lower()


def test_copilot_preflight_allows_patch_for_rate_limit():
    response = client.options("/api/copilot/connections/x/rate-limit", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type, x-copilot-session",
    })
    assert response.status_code == 200
    assert "patch" in response.headers["access-control-allow-methods"].lower()


def test_copilot_preflight_from_127_0_0_1_is_allowed():
    response = client.options("/api/copilot/connections", headers={
        "Origin": "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-copilot-session",
    })
    assert response.status_code == 200


def test_copilot_preflight_rejects_unknown_origin():
    response = client.options("/api/copilot/connections", headers={
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-copilot-session",
    })
    assert response.status_code == 400
