import asyncio
import json

import httpx

from copilot_streaming import provider_stream


class EventStream(httpx.AsyncByteStream):
    def __init__(self, events):
        self.events = events

    async def __aiter__(self):
        for event in self.events:
            await asyncio.sleep(0)
            yield f"data: {json.dumps(event)}\n\n".encode()


def test_openai_stream_forwards_text_and_reconstructs_tool_arguments():
    events = [
        {"choices": [{"index": 0, "delta": {"content": "Đang "}}]},
        {"choices": [{"index": 0, "delta": {"content": "kiểm tra"}}]},
        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call-1", "function": {"name": "query_", "arguments": "{\"col"}}]}}]},
        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"name": "entities", "arguments": "lection\":\"members\"}"}}]}, "finish_reason": "tool_calls"}]},
    ]

    async def scenario():
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            200, headers={"content-type": "text/event-stream"}, stream=EventStream(events)))
        chunks = []
        async with httpx.AsyncClient(transport=transport) as client:
            response = await provider_stream(client, "https://provider.test/chat", {}, {}, "openai", chunks.append)
        message = response.json()["choices"][0]["message"]
        assert chunks == ["Đang ", "kiểm tra"]
        assert message["content"] == "Đang kiểm tra"
        assert message["tool_calls"][0]["function"] == {
            "name": "query_entities", "arguments": '{"collection":"members"}'
        }

    asyncio.run(scenario())


def test_anthropic_stream_forwards_text_and_reconstructs_tool_input():
    events = [
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Reviewing"}},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tool-1", "name": "get_analysis_summary", "input": {}}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"analysis"}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "RunId\":\"run-1\"}"}},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}},
    ]

    async def scenario():
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            200, headers={"content-type": "text/event-stream"}, stream=EventStream(events)))
        chunks = []
        async with httpx.AsyncClient(transport=transport) as client:
            response = await provider_stream(client, "https://provider.test/messages", {}, {}, "anthropic", chunks.append)
        content = response.json()["content"]
        assert chunks == ["Reviewing"]
        assert content[0]["text"] == "Reviewing"
        assert content[1]["input"] == {"analysisRunId": "run-1"}

    asyncio.run(scenario())


def test_non_stream_provider_response_is_preserved():
    async def scenario():
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            429, headers={"content-type": "application/json", "retry-after": "2"}, json={"error": {"code": "rate_limit"}}))
        async with httpx.AsyncClient(transport=transport) as client:
            response = await provider_stream(client, "https://provider.test/chat", {}, {}, "openai", lambda _chunk: None)
        assert response.status_code == 429
        assert response.headers["retry-after"] == "2"
        assert response.json()["error"]["code"] == "rate_limit"

    asyncio.run(scenario())
