"""Small, provider-backed Copilot planning endpoint for the modeling POC.

The provider is never allowed to mutate a model.  It can only propose the two
low-level operations supported by this POC; the browser validates and commits
the returned transaction through CommandGateway.
"""

from __future__ import annotations

import os
import json
import ipaddress
from urllib.parse import urlparse
from uuid import uuid4
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field


router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class ModelContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    node_count: int = Field(ge=0, alias="nodeCount")
    member_count: int = Field(ge=0, alias="memberCount")
    node_ids: list[int] = Field(default_factory=list, alias="nodeIds")
    sections: list[dict[str, Any]] = Field(default_factory=list)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    context: ModelContext
    connection_id: str | None = Field(default=None, alias="connectionId")
    model: str | None = Field(default=None, min_length=1, max_length=200)


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["openai", "deepseek", "anthropic", "gemini", "openrouter", "compatible"]
    api_key: str = Field(min_length=1, max_length=1000, alias="apiKey")
    label: str | None = Field(default=None, max_length=100)
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=500)
    model_ids: list[str] = Field(default_factory=list, alias="modelIds", max_length=100)


class ProviderConnection(BaseModel):
    id: str
    provider: str
    label: str
    api_key: str
    base_url: str
    models: list[str]


PROVIDER_DEFAULTS = {
    "openai": ("OpenAI", "https://api.openai.com/v1"),
    "deepseek": ("DeepSeek", "https://api.deepseek.com"),
    "anthropic": ("Anthropic", "https://api.anthropic.com/v1"),
    "gemini": ("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1"),
}
connections: dict[tuple[str, str], ProviderConnection] = {}


class PlannedNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alias: str = Field(min_length=1, max_length=80)
    name: str | None = Field(default=None, max_length=160)
    x: float
    y: float
    z: float


class PlannedMember(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alias: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=160)
    node_i: int | str
    node_j: int | str
    section_id: int = Field(gt=0)


class TransactionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=500)
    nodes: list[PlannedNode] = Field(max_length=10_000)
    members: list[PlannedMember] = Field(max_length=10_000)


COPILOT_TOOL = {
    "name": "execute_structural_transaction",
    "description": "Create nodes and straight 1D members in one atomic transaction.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["alias", "x", "y", "z"],
                    "properties": {
                        "alias": {"type": "string"},
                        "name": {"type": "string"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "z": {"type": "number"},
                    },
                },
            },
            "members": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["alias", "node_i", "node_j", "section_id"],
                    "properties": {
                        "alias": {"type": "string"},
                        "label": {"type": "string"},
                        "node_i": {"oneOf": [{"type": "integer"}, {"type": "string"}]},
                        "node_j": {"oneOf": [{"type": "integer"}, {"type": "string"}]},
                        "section_id": {"type": "integer"},
                    },
                },
            },
        },
        "required": ["summary", "nodes", "members"],
    },
}


SYSTEM_PROMPT = """You are a structural-modeling command planner.
Use execute_structural_transaction only when the request can be satisfied by
creating nodes and straight 1D members. Coordinates are metres in canonical
Z-up engineering coordinates: X/Y horizontal and Z vertical. Use short unique
aliases for new nodes and reference those aliases in member node_i/node_j.
Use only a section_id present in the supplied context. Never invent IDs.
If coordinates, connectivity, or a required section are ambiguous, respond
with one concise clarification question and do not call the tool.
Do not create loads, supports, grids, shells, or parametric objects."""


def _safe_base_url(request: ConnectionRequest) -> tuple[str, str]:
    if request.provider in PROVIDER_DEFAULTS:
        label, base_url = PROVIDER_DEFAULTS[request.provider]
        return request.label or label, base_url
    if not request.base_url:
        raise HTTPException(status_code=422, detail="baseUrl is required for an OpenAI-compatible provider")
    parsed = urlparse(request.base_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Custom baseUrl must be an HTTPS origin without credentials")
    if parsed.hostname.lower() == "localhost":
        raise HTTPException(status_code=422, detail="Local/private provider URLs are disabled in BYOK mode")
    try:
        if ipaddress.ip_address(parsed.hostname).is_private:
            raise HTTPException(status_code=422, detail="Local/private provider URLs are disabled in BYOK mode")
    except ValueError:
        pass
    return request.label or parsed.hostname, request.base_url.rstrip("/")


def _headers(provider: str, api_key: str) -> dict[str, str]:
    if provider == "anthropic":
        return {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    return {"Authorization": f"Bearer {api_key}"}


async def discover_models(provider: str, base_url: str, api_key: str) -> list[str]:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{base_url}/models", headers=_headers(provider, api_key))
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Provider connection failed while listing models ({response.status_code})")
    values = response.json().get("data", [])
    return sorted({str(value["id"]) for value in values if isinstance(value, dict) and value.get("id")})


def _public_connection(connection: ProviderConnection) -> dict[str, Any]:
    return {
        "id": connection.id,
        "provider": connection.provider,
        "label": connection.label,
        "baseUrl": connection.base_url,
        "models": connection.models,
        "keyHint": f"••••{connection.api_key[-4:]}",
    }


@router.get("/connections")
async def list_connections(x_copilot_session: str = Header(min_length=20, max_length=200)):
    return [
        _public_connection(connection)
        for (session_id, _), connection in connections.items()
        if session_id == x_copilot_session
    ]


@router.post("/connections", status_code=201)
async def create_connection(
    request: ConnectionRequest,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    label, base_url = _safe_base_url(request)
    models = request.model_ids
    if not models:
        models = await discover_models(request.provider, base_url, request.api_key)
    if not models:
        raise HTTPException(status_code=400, detail="Provider returned no models; enter model IDs manually")
    connection = ProviderConnection(
        id=str(uuid4()), provider=request.provider, label=label, api_key=request.api_key,
        base_url=base_url, models=sorted(set(models)),
    )
    connections[(x_copilot_session, connection.id)] = connection
    return _public_connection(connection)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    connections.pop((x_copilot_session, connection_id), None)
    return Response(status_code=204)


def _validate_plan(raw_plan: Any, context: ModelContext) -> dict[str, Any]:
    if not isinstance(raw_plan, dict):
        raise RuntimeError("Provider returned an invalid tool payload")
    try:
        plan = TransactionPlan.model_validate(raw_plan)
    except Exception as error:
        raise RuntimeError(f"Provider returned an invalid transaction: {error}") from error
    aliases = [node.alias for node in plan.nodes]
    if len(aliases) != len(set(aliases)):
        raise RuntimeError("Provider returned duplicate node aliases")
    all_aliases = set(aliases)
    existing_nodes = set(context.node_ids)
    section_ids = {int(section["id"]) for section in context.sections if "id" in section}
    for member in plan.members:
        for endpoint in (member.node_i, member.node_j):
            if isinstance(endpoint, str) and endpoint not in all_aliases:
                raise RuntimeError(f"Provider referenced unknown node alias {endpoint}")
            if isinstance(endpoint, int) and endpoint not in existing_nodes:
                raise RuntimeError(f"Provider referenced unknown node id {endpoint}")
        if member.section_id not in section_ids:
            raise RuntimeError(f"Provider referenced unknown section id {member.section_id}")
    normalized = plan.model_dump()
    return {"kind": "transaction", "message": plan.summary, "plan": normalized}


async def plan_copilot_request(request: PlanRequest, session_id: str) -> dict[str, Any]:
    if request.connection_id:
        connection = connections.get((session_id, request.connection_id))
        if not connection:
            raise RuntimeError("Selected provider connection no longer exists")
        model = request.model
        if not model or model not in connection.models:
            raise RuntimeError("Selected model is not allowed for this connection")
    else:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("Configure a provider connection before chatting")
        connection = ProviderConnection(
            id="environment", provider="anthropic", label="Anthropic (environment)",
            api_key=api_key, base_url="https://api.anthropic.com/v1",
            models=[os.getenv("COPILOT_MODEL", "claude-sonnet-4-5")],
        )
        model = connection.models[0]

    context = request.context.model_dump(by_alias=True)
    user_content = f"Model context:\n{context}\n\nUser request:\n{request.prompt}"
    async with httpx.AsyncClient(timeout=60) as client:
        if connection.provider == "anthropic":
            response = await client.post(
                f"{connection.base_url}/messages",
                headers={**_headers(connection.provider, connection.api_key), "content-type": "application/json"},
                json={
                    "model": model, "max_tokens": 1800, "temperature": 0,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": user_content}],
                    "tools": [COPILOT_TOOL],
                },
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Provider request failed ({response.status_code})")
            content = response.json().get("content", [])
            tools = [block for block in content if block.get("type") == "tool_use"]
            if not tools:
                text = "\n".join(block.get("text", "") for block in content if block.get("type") == "text").strip()
                return {"kind": "clarification", "message": text or "Please clarify the geometry."}
            if len(tools) != 1 or tools[0].get("name") != COPILOT_TOOL["name"]:
                raise RuntimeError("Provider returned an unsupported tool plan")
            raw_plan = tools[0].get("input")
        else:
            openai_tool = {
                "type": "function",
                "function": {
                    "name": COPILOT_TOOL["name"],
                    "description": COPILOT_TOOL["description"],
                    "parameters": COPILOT_TOOL["input_schema"],
                },
            }
            response = await client.post(
                f"{connection.base_url}/chat/completions",
                headers={**_headers(connection.provider, connection.api_key), "content-type": "application/json"},
                json={
                    "model": model, "temperature": 0,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    "tools": [openai_tool], "tool_choice": "auto",
                },
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Provider request failed ({response.status_code})")
            message = response.json().get("choices", [{}])[0].get("message", {})
            tools = message.get("tool_calls") or []
            if not tools:
                return {"kind": "clarification", "message": message.get("content") or "Please clarify the geometry."}
            if len(tools) != 1 or tools[0].get("function", {}).get("name") != COPILOT_TOOL["name"]:
                raise RuntimeError("Provider returned an unsupported tool plan")
            try:
                raw_plan = json.loads(tools[0]["function"]["arguments"])
            except (KeyError, TypeError, json.JSONDecodeError) as error:
                raise RuntimeError("Provider returned invalid tool arguments") from error
    return _validate_plan(raw_plan, request.context)


@router.post("/plan")
async def create_plan(
    request: PlanRequest,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    try:
        return await plan_copilot_request(request, x_copilot_session)
    except RuntimeError as error:
        status = 503 if "connection" in str(error).lower() else 502
        raise HTTPException(status_code=status, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Copilot provider failed: {error}") from error
