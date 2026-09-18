from mcp.server.fastmcp import FastMCP
from typing import Any, Optional, List
from schemas import Model, Node, MemberCreate, BoundaryCondition, ClientResponse, LinearLoad
import asyncio
import time
import uuid
import json
import random
import os

# Load tool descriptions
TOOLS_DESCRIPTIONS_PATH = os.path.join(os.path.dirname(__file__), "utils", "tools_descriptions.json")
with open(TOOLS_DESCRIPTIONS_PATH, "r", encoding="utf-8") as f:
    TOOL_DESCRIPTIONS = json.load(f)

mcp_server = FastMCP(name="buckle-mcp-server", stateless_http=True)

# WebSocket connection and message storage
client_connection: Optional[Any] = None
messages: list = []

@mcp_server.tool(description=TOOL_DESCRIPTIONS["get_scene_info"])
async def get_scene_info() -> Model:
    """Contact WebSocket client and retrieve scene state with Model schema"""
    global client_connection, messages
    
    if not client_connection:
        raise Exception("No WebSocket client connected")
    
    try:
        # Generate a unique ID for the message
        msg_id = str(uuid.uuid4())
        payload = { "id": msg_id, "message": "get_scene_info", "type": "get_scene_info"}
        
        await client_connection.send_text(json.dumps(payload))
        timeout = 10.0  # 10 seconds timeout
        start_time = time.time()
        answer = None
        
        while not answer and (time.time() - start_time) < timeout:
            # Check if we have a response
            answer = next((msg for msg in messages if msg.get("id") == msg_id), None)

            if not answer:
                # Wait a bit before checking again (non-blocking)
                await asyncio.sleep(0.1)
        
        if answer is None:
            raise TimeoutError(f"Timeout waiting for response (ID: {msg_id})")

        messages.remove(answer)
        data = answer.get("data", {})

        return Model(**data)
        
    except Exception as error:
        raise Exception(f"Failed to get scene: {error}")

@mcp_server.tool(description=TOOL_DESCRIPTIONS["add_nodes"])
async def add_nodes(nodes: List[Node]) -> ClientResponse:
    try:
      msg_id = str(uuid.uuid4())
      payload = {
          "id": msg_id,
          "message": "add_nodes",
          "type": "add_nodes",
          "data": [node.model_dump() for node in nodes]
      }
      answer = await _send_request(payload)
      return ClientResponse(**answer)
        
    except Exception as error:
        raise Exception(f"Failed to add nodes: {error}")

@mcp_server.tool(description=TOOL_DESCRIPTIONS["add_members"])
async def add_members(members: List[MemberCreate]) -> ClientResponse:
    try:
        # Generate a unique ID for the message
        msg_id = str(uuid.uuid4())
        payload = {
          "id": msg_id,
          "message": "add_members",
          "type": "add_members",
          "data": [member.model_dump() for member in members]
        }
        
        answer = await _send_request(payload)
        return ClientResponse(**answer)       
    except Exception as error:
        raise Exception(f"Failed to add members: {error}")

@mcp_server.tool(description=TOOL_DESCRIPTIONS["add_bc"])
async def add_bc(bcs: List[BoundaryCondition]) -> ClientResponse:
    try:
      # Generate a unique ID for the message
      msg_id = str(uuid.uuid4())
      payload = {
        "id": msg_id,
        "message": "add_bc",
        "type": "add_bc",
        "data": [bc.model_dump() for bc in bcs]
      }
        
      answer = await _send_request(payload)
      return ClientResponse(**answer)
        
    except Exception as error:
      raise Exception(f"Failed to add boundary conditions: {error}")

@mcp_server.tool(description=TOOL_DESCRIPTIONS["add_linear_load"])
async def add_linear_load(loads: List[LinearLoad]) -> ClientResponse:
    try:
      # Generate a unique ID for the message
      msg_id = str(uuid.uuid4())
      payload = {
        "id": msg_id,
        "message": "add_linear_load",
        "type": "add_linear_load",
        "data": [load.model_dump() for load in loads]
      }
        
      answer = await _send_request(payload)
      return ClientResponse(**answer)
        
    except Exception as error:
        raise Exception(f"Failed to add linear loads: {error}")
        
async def _wait_for_response(msg_id: str, timeout: float = 10.0) -> dict:
    """Wait for WebSocket response with timeout"""
    start_time = time.time()
    
    while (time.time() - start_time) < timeout:
        answer = next((msg for msg in messages if msg.get("id") == msg_id), None)
        if answer:
            messages.remove(answer)  # Cleanup
            return answer
        await asyncio.sleep(0.1)
    
    raise Exception(f"Timeout waiting for response (ID: {msg_id})")

async def _send_request(payload: dict) -> dict:
    """Send request and wait for response"""
    global client_connection
    
    if not client_connection:
        raise Exception("No WebSocket client connected")
    
    await client_connection.send_text(json.dumps(payload))
    return await _wait_for_response(payload["id"])


@mcp_server.tool(description="Discover the current Buckle AI registry and JSON schemas from the connected viewport. Mode defaults to Inspect; Agent exposes all available tools including analysis results.")
async def list_ai_tools(mode: str = "Inspect") -> dict:
    return await _send_ai_request("list_ai_tools", {"mode": mode})


@mcp_server.tool(description="Execute a tool discovered by list_ai_tools through the shared Buckle executor. Supply a stable call_id for retry idempotency. Destructive changes return previews with bound approval tokens; apply only after user approval. Analysis can take time; this bridge has no elapsed-time cutoff.")
async def call_ai_tool(name: str, arguments: dict, call_id: str, mode: str = "Inspect") -> dict:
    if not call_id.strip():
        raise ValueError("call_id is required")
    return await _send_ai_request("call_ai_tool", {"name": name, "arguments": arguments, "callId": call_id, "mode": mode})


async def _send_ai_request(message: str, data: dict) -> dict:
    connection = client_connection
    if connection is None:
        raise RuntimeError("No WebSocket client connected")
    msg_id = str(uuid.uuid4())
    await connection.send_text(json.dumps({"id": msg_id, "message": message, "data": data}))
    while client_connection is connection:
        answer = next((item for item in messages if item.get("id") == msg_id), None)
        if answer is not None:
            messages.remove(answer)
            return answer
        await asyncio.sleep(0.1)
    raise RuntimeError("Viewport disconnected while executing the AI tool")
