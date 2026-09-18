import asyncio
import json

import mcp_tools


class ViewportConnection:
    def __init__(self, response):
        self.response = response
        self.sent = []

    async def send_text(self, raw):
        payload = json.loads(raw)
        self.sent.append(payload)
        mcp_tools.messages.append({"id": payload["id"], **self.response})


def test_list_ai_tools_uses_the_live_viewport_registry():
    async def scenario():
        connection = ViewportConnection({"success": True, "tools": [{"name": "query_entities"}]})
        previous = mcp_tools.client_connection
        mcp_tools.client_connection = connection
        try:
            result = await mcp_tools.list_ai_tools("Agent")
            assert result["tools"] == [{"name": "query_entities"}]
            assert connection.sent[0]["message"] == "list_ai_tools"
            assert connection.sent[0]["data"] == {"mode": "Agent"}
        finally:
            mcp_tools.client_connection = previous
            mcp_tools.messages.clear()

    asyncio.run(scenario())


def test_call_ai_tool_preserves_stable_call_id_and_arguments():
    async def scenario():
        connection = ViewportConnection({"success": True, "result": {"ok": True}})
        previous = mcp_tools.client_connection
        mcp_tools.client_connection = connection
        try:
            result = await mcp_tools.call_ai_tool(
                "delete_entities", {"entities": [{"collection": "members", "id": 8}]},
                "stable-call-8", "Agent",
            )
            assert result["result"] == {"ok": True}
            assert connection.sent[0]["data"] == {
                "name": "delete_entities",
                "arguments": {"entities": [{"collection": "members", "id": 8}]},
                "callId": "stable-call-8",
                "mode": "Agent",
            }
        finally:
            mcp_tools.client_connection = previous
            mcp_tools.messages.clear()

    asyncio.run(scenario())
