"""Small, provider-backed Copilot planning endpoint for the modeling POC.

The provider is never allowed to mutate a model.  It can only propose the two
low-level operations supported by this POC; the browser validates and commits
the returned transaction through CommandGateway.
"""

from __future__ import annotations

import os
import json
import ipaddress
import asyncio
from urllib.parse import urlparse
from uuid import uuid4
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from provider_rate_limit import ProviderQueueTimeout, ProviderRateGovernor, estimate_request_tokens


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


class ConversationMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ClientToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    description: str = Field(max_length=500)
    input_schema: dict[str, Any] = Field(alias="inputSchema")


class ClientToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: str = Field(alias="toolCallId", min_length=1, max_length=200)
    tool: str = Field(min_length=1, max_length=64)
    ok: bool
    content: dict[str, Any]


class CopilotTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(alias="requestId", min_length=8, max_length=200)
    conversation_id: str = Field(alias="conversationId", min_length=8, max_length=200)
    prompt: str = Field(min_length=1, max_length=4000)
    mode: Literal["Inspect", "Edit", "Modeling", "Generate", "Agent"]
    context: dict[str, Any]
    history: list[ConversationMessage] = Field(default_factory=list, max_length=20)
    tools: list[ClientToolDefinition] = Field(default_factory=list, max_length=40)
    tool_results: list[ClientToolResult] = Field(default_factory=list, alias="toolResults", max_length=40)
    connection_id: str | None = Field(default=None, alias="connectionId")
    model: str | None = Field(default=None, min_length=1, max_length=200)


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal[
        "openai", "deepseek", "anthropic", "gemini", "openrouter", "nvidia", "groq",
        "compatible", "ollama", "lmstudio", "local",
    ]
    api_key: str = Field(default="", max_length=1000, alias="apiKey")
    label: str | None = Field(default=None, max_length=100)
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=500)
    model_ids: list[str] = Field(default_factory=list, alias="modelIds", max_length=100)
    rate_limit: "RateLimitSettings | None" = Field(default=None, alias="rateLimit")

    @model_validator(mode="after")
    def _require_cloud_api_key(self) -> "ConnectionRequest":
        if self.provider not in LOCAL_PROVIDERS and not self.api_key.strip():
            raise ValueError("apiKey is required for cloud providers")
        return self


class RateLimitSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    mode: Literal["auto", "manual", "disabled"] = "auto"
    max_concurrent: int = Field(default=2, alias="maxConcurrent", ge=1, le=10)
    rpm: int | None = Field(default=None, ge=1, le=100_000)
    tpm: int | None = Field(default=None, ge=1, le=100_000_000)
    safety_factor: float = Field(default=0.8, alias="safetyFactor", ge=0.1, le=1.0)
    max_wait_seconds: float = Field(default=30, alias="maxWaitSeconds", ge=0, le=300)
    max_retries: int = Field(default=2, alias="maxRetries", ge=0, le=5)


class ProviderConnection(BaseModel):
    id: str
    provider: str
    label: str
    api_key: str
    base_url: str
    models: list[str]
    rate_limit: RateLimitSettings


PROVIDER_DEFAULTS = {
    "openai": ("OpenAI", "https://api.openai.com/v1"),
    "deepseek": ("DeepSeek", "https://api.deepseek.com"),
    "anthropic": ("Anthropic", "https://api.anthropic.com/v1"),
    "gemini": ("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1"),
    "nvidia": ("NVIDIA NIM", "https://integrate.api.nvidia.com/v1"),
    "groq": ("GroqCloud", "https://api.groq.com/openai/v1"),
}
# Local runtimes (Ollama, LM Studio, vLLM, llama.cpp server, ...) speak the
# OpenAI-compatible chat API but are reached over plain http loopback/private
# addresses, so they follow a separate allow-list and validation branch.
LOCAL_PROVIDERS = {"ollama", "lmstudio", "local"}
LOCAL_PROVIDER_LABELS = {
    "ollama": "Ollama (local)",
    "lmstudio": "LM Studio (local)",
    "local": "Local runtime",
}
LOCAL_PRESET_BASE_URLS = {
    "ollama": "http://localhost:11434/v1",
    "lmstudio": "http://localhost:1234/v1",
    "local": "",
}
connections: dict[tuple[str, str], ProviderConnection] = {}
rate_governors: dict[tuple[str, str], ProviderRateGovernor] = {}


def _default_rate_limit(provider: str) -> RateLimitSettings:
    return RateLimitSettings()


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


def _local_providers_allowed() -> bool:
    if os.getenv("COPILOT_ALLOW_LOCAL_PROVIDERS", "").strip().lower() in {"1", "true", "yes"}:
        return True
    return os.environ.get("ENVIRONMENT", "development").strip().lower() != "production"


def _safe_local_base_url(request: ConnectionRequest) -> tuple[str, str]:
    if not _local_providers_allowed():
        raise HTTPException(
            status_code=422,
            detail="Local provider URLs are disabled in production; set COPILOT_ALLOW_LOCAL_PROVIDERS=1 to enable them",
        )
    label = request.label or LOCAL_PROVIDER_LABELS[request.provider]
    if not request.base_url:
        preset = LOCAL_PRESET_BASE_URLS[request.provider]
        if not preset:
            raise HTTPException(status_code=422, detail="baseUrl is required for the custom local provider")
        return label, preset
    parsed = urlparse(request.base_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Local provider baseUrl must be an http(s) URL without credentials")
    hostname = parsed.hostname.lower()
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None
    if hostname == "host.docker.internal":
        return label, request.base_url.rstrip("/")
    if ip is None:
        if hostname != "localhost":
            raise HTTPException(status_code=422, detail="Local provider baseUrl must point at localhost or a private network address")
    elif ip.is_link_local or not (ip.is_loopback or ip.is_private):
        # Link-local also blocks the cloud metadata endpoint (169.254.169.254).
        raise HTTPException(status_code=422, detail="Local provider baseUrl must point at localhost or a private network address")
    return label, request.base_url.rstrip("/")


def _safe_base_url(request: ConnectionRequest) -> tuple[str, str]:
    if request.provider in LOCAL_PROVIDERS:
        return _safe_local_base_url(request)
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
    if not api_key:
        return {}
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


async def _provider_post(
    client: httpx.AsyncClient,
    connection: ProviderConnection,
    session_id: str,
    path: str,
    payload: dict[str, Any],
) -> httpx.Response:
    key = (session_id, connection.id)
    governor = rate_governors.get(key)
    if governor is None:
        governor = ProviderRateGovernor(connection.rate_limit)
        rate_governors[key] = governor
    return await governor.execute(
        lambda: client.post(
            f"{connection.base_url}/{path.lstrip('/')}",
            headers={**_headers(connection.provider, connection.api_key), "content-type": "application/json"},
            json=payload,
        ),
        estimate_request_tokens(payload),
    )


def _parse_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse OpenAI-compatible tool calls, accepting string or object arguments.

    Local runtimes (Ollama, LM Studio, vLLM) sometimes return already-parsed
    argument objects instead of the documented JSON string, so both shapes are
    normalized here.
    """
    tool_calls: list[dict[str, Any]] = []
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        raw_arguments = function.get("arguments")
        if isinstance(raw_arguments, str):
            try:
                arguments = json.loads(raw_arguments or "{}")
            except json.JSONDecodeError as error:
                raise RuntimeError("Provider returned invalid tool arguments") from error
        elif isinstance(raw_arguments, dict):
            arguments = raw_arguments
        else:
            arguments = {}
        tool_calls.append({
            "id": str(call.get("id") or uuid4()), "name": function.get("name"),
            "arguments": arguments,
        })
    return tool_calls


def _raise_provider_error(response: httpx.Response) -> None:
    if response.status_code == 429:
        retry_after = response.headers.get("retry-after")
        suffix = f"; retry after {retry_after}s" if retry_after else ""
        raise ProviderQueueTimeout(f"Provider rate limit exceeded after configured retries{suffix}")
    if response.status_code >= 400:
        raise RuntimeError(f"Provider request failed ({response.status_code})")


def _public_connection(connection: ProviderConnection) -> dict[str, Any]:
    return {
        "id": connection.id,
        "provider": connection.provider,
        "label": connection.label,
        "baseUrl": connection.base_url,
        "models": connection.models,
        "keyHint": f"••••{connection.api_key[-4:]}" if connection.api_key else "local",
        "rateLimit": connection.rate_limit.model_dump(by_alias=True),
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
        rate_limit=request.rate_limit or _default_rate_limit(request.provider),
    )
    connections[(x_copilot_session, connection.id)] = connection
    rate_governors[(x_copilot_session, connection.id)] = ProviderRateGovernor(connection.rate_limit)
    return _public_connection(connection)


@router.patch("/connections/{connection_id}/rate-limit")
async def update_connection_rate_limit(
    connection_id: str,
    settings: RateLimitSettings,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    key = (x_copilot_session, connection_id)
    connection = connections.get(key)
    if not connection:
        raise HTTPException(status_code=404, detail="Provider connection not found")
    connection.rate_limit = settings
    rate_governors[key] = ProviderRateGovernor(settings)
    return _public_connection(connection)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    connections.pop((x_copilot_session, connection_id), None)
    rate_governors.pop((x_copilot_session, connection_id), None)
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
            rate_limit=_default_rate_limit("anthropic"),
        )
        model = connection.models[0]

    context = request.context.model_dump(by_alias=True)
    user_content = f"Model context:\n{context}\n\nUser request:\n{request.prompt}"
    async with httpx.AsyncClient(timeout=60) as client:
        if connection.provider == "anthropic":
            response = await _provider_post(
                client, connection, session_id, "messages", {
                    "model": model, "max_tokens": 1800, "temperature": 0,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": user_content}],
                    "tools": [COPILOT_TOOL],
                },
            )
            _raise_provider_error(response)
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
            response = await _provider_post(
                client, connection, session_id, "chat/completions", {
                    "model": model, "temperature": 0,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    "tools": [openai_tool], "tool_choice": "auto",
                },
            )
            _raise_provider_error(response)
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
    except ProviderQueueTimeout as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    except RuntimeError as error:
        status = 503 if "connection" in str(error).lower() else 502
        raise HTTPException(status_code=status, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Copilot provider failed: {error}") from error


QUERY_TOOL_NAMES = {
    "get_model_summary", "get_selection", "resolve_targets", "remember_targets", "get_entities", "query_entities",
    "get_connected_entities", "get_nearby_nodes", "get_sections", "get_materials", "get_parametric_templates",
    "validate_model",
}
MUTATION_TOOL_NAMES = {
    "create_nodes", "create_members", "move_nodes", "update_members", "change_section",
    "change_material", "transform_entities", "update_entity_properties",
    "delete_entities", "set_selection", "hide_entities", "show_entities",
    "execute_transaction", "preview_transaction", "undo_last_ai_change",
    "create_grid", "create_portal_frame", "create_frame_array", "create_truss",
    "create_warehouse", "create_tower", "update_parametric_object", "generate_parametric",
}
ALLOWED_TOOL_NAMES = QUERY_TOOL_NAMES | MUTATION_TOOL_NAMES
cancelled_requests: set[tuple[str, str]] = set()

TOOL_SYSTEM_PROMPT = """You are Buckle AI, a structural-model assistant.
Use only the supplied tools. Tool outputs are authoritative; never invent IDs, counts,
sections, materials or mutation success. Coordinates and lengths are metres in canonical
Z-up coordinates, forces are kN. Ask one concise clarification question when targets,
coordinates, units or section are ambiguous.

Mode rules are security boundaries:
- Inspect: query only.
- Edit: mutate only selected entities.
- Modeling: low-level create/update tools.
- Generate: prefer the matching high-level create_grid/create_portal_frame/create_frame_array/
  create_truss/create_warehouse/create_tower tool. Use update_parametric_object for changes to an
  existing generated object. Never use low-level geometry tools when a semantic generator exists.
- Agent: multi-step tools within the supplied budget.

Prefer batch calls. Query before using unknown IDs. For a user request such as finding
members by length/material, call query_entities and then set_selection if requested.
Use get_parametric_templates when defaults or engineering parameter names are needed; defaults
returned by that tool are authoritative and must be stated in the generation preview.
For edits, resolve exact targets first, reject zero or ambiguous matches, then call the
edit tool with preview=true. Apply only after user approval. Prefer transform_entities for
move/copy/rotate/mirror/array, change_material for member material, and
update_entity_properties for batch release/load/support/metadata edits.
Destructive tools may return a preview and approval token: explain the preview and stop;
never fabricate approval. Do not expose chain-of-thought. Keep final answers concise and
state exact affected counts/IDs from tool results."""


def _turn_connection(request: CopilotTurnRequest, session_id: str) -> tuple[ProviderConnection, str]:
    if request.connection_id:
        connection = connections.get((session_id, request.connection_id))
        if not connection:
            raise RuntimeError("Selected provider connection no longer exists")
        if not request.model or request.model not in connection.models:
            raise RuntimeError("Selected model is not allowed for this connection")
        return connection, request.model
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("Configure a provider connection before chatting")
    model = os.getenv("COPILOT_MODEL", "claude-sonnet-4-5")
    return ProviderConnection(
        id="environment", provider="anthropic", label="Anthropic (environment)",
        api_key=api_key, base_url="https://api.anthropic.com/v1", models=[model],
        rate_limit=_default_rate_limit("anthropic"),
    ), model


def _validate_turn_tools(request: CopilotTurnRequest) -> None:
    names = [tool.name for tool in request.tools]
    if len(names) != len(set(names)):
        raise RuntimeError("Duplicate tool definitions")
    unknown = set(names) - ALLOWED_TOOL_NAMES
    if unknown:
        raise RuntimeError(f"Unsupported tool definitions: {', '.join(sorted(unknown))}")
    if request.mode == "Inspect" and set(names) - QUERY_TOOL_NAMES:
        raise RuntimeError("Inspect mode cannot expose mutation tools")
    serialized_size = len(json.dumps(request.model_dump(by_alias=True), separators=(",", ":")))
    if serialized_size > 250_000:
        raise RuntimeError("Copilot turn context exceeds 250 KB")


def _turn_user_content(request: CopilotTurnRequest) -> str:
    payload = {
        "conversationId": request.conversation_id,
        "mode": request.mode,
        "modelContext": request.context,
        "recentConversation": [message.model_dump() for message in request.history[-12:]],
        "userRequest": request.prompt,
        "toolResults": [result.model_dump(by_alias=True) for result in request.tool_results],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


async def run_copilot_turn(request: CopilotTurnRequest, session_id: str) -> dict[str, Any]:
    _validate_turn_tools(request)
    connection, model = _turn_connection(request, session_id)
    user_content = _turn_user_content(request)
    system_prompt = TOOL_SYSTEM_PROMPT if request.tools else (
        TOOL_SYSTEM_PROMPT + "\nNo more tools are available for this turn. Answer the user's request now "
        "using the supplied tool results. Mention any unresolved limitation concisely."
    )
    async with httpx.AsyncClient(timeout=60) as client:
        if connection.provider == "anthropic":
            payload = {
                "model": model, "max_tokens": 2200, "temperature": 0,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_content}],
            }
            if request.tools:
                payload["tools"] = [{"name": tool.name, "description": tool.description, "input_schema": tool.input_schema} for tool in request.tools]
            response = await _provider_post(
                client, connection, session_id, "messages", payload,
            )
            _raise_provider_error(response)
            content = response.json().get("content", [])
            text = "\n".join(str(block.get("text", "")) for block in content if block.get("type") == "text").strip()
            tool_calls = [{
                "id": str(block.get("id") or uuid4()), "name": block.get("name"),
                "arguments": block.get("input") or {},
            } for block in content if block.get("type") == "tool_use"]
        else:
            payload = {
                "model": model, "temperature": 0,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
            }
            if request.tools:
                payload["tools"] = [{"type": "function", "function": {
                    "name": tool.name, "description": tool.description,
                    "parameters": tool.input_schema,
                }} for tool in request.tools]
                payload["tool_choice"] = "auto"
            response = await _provider_post(
                client, connection, session_id, "chat/completions", payload,
            )
            _raise_provider_error(response)
            message = response.json().get("choices", [{}])[0].get("message", {})
            text = str(message.get("content") or "").strip()
            tool_calls = _parse_tool_calls(message)
    if len(tool_calls) > 10:
        raise RuntimeError("Provider exceeded the 10 tool-call turn budget")
    allowed = {tool.name for tool in request.tools}
    if any(call["name"] not in allowed for call in tool_calls):
        raise RuntimeError("Provider returned a tool that is not available in this mode")
    return {
        "message": text,
        "toolCalls": tool_calls,
        "contextRevision": request.context.get("revision"),
        "finishReason": "tool_calls" if tool_calls else "stop",
    }


@router.post("/turn")
async def copilot_turn(
    request: CopilotTurnRequest,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    try:
        key = (x_copilot_session, request.request_id)
        if key in cancelled_requests:
            cancelled_requests.discard(key)
            return {"message": "", "toolCalls": [], "finishReason": "cancelled", "contextRevision": request.context.get("revision")}
        return await run_copilot_turn(request, x_copilot_session)
    except ProviderQueueTimeout as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    except RuntimeError as error:
        status = 503 if "connection" in str(error).lower() else 502
        raise HTTPException(status_code=status, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Copilot provider failed: {error}") from error


@router.post("/turn/stream")
async def copilot_turn_stream(
    request: CopilotTurnRequest,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    async def events():
        key = (x_copilot_session, request.request_id)
        yield "event: status\ndata: {\"status\":\"planning\"}\n\n"
        try:
            result = await run_copilot_turn(request, x_copilot_session)
            if key in cancelled_requests:
                yield "event: cancelled\ndata: {}\n\n"
                return
            message = result.get("message") or ""
            for start in range(0, len(message), 80):
                yield f"event: text\ndata: {json.dumps({'text': message[start:start + 80]}, ensure_ascii=False)}\n\n"
            yield f"event: result\ndata: {json.dumps(result, ensure_ascii=False)}\n\n"
        except Exception as error:
            yield f"event: error\ndata: {json.dumps({'message': str(error)})}\n\n"
        finally:
            cancelled_requests.discard(key)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/cancel/{request_id}", status_code=202)
async def cancel_copilot_turn(
    request_id: str,
    x_copilot_session: str = Header(min_length=20, max_length=200),
):
    cancelled_requests.add((x_copilot_session, request_id))
    asyncio.get_running_loop().call_later(60, cancelled_requests.discard, (x_copilot_session, request_id))
    return {"cancelled": True, "requestId": request_id}
