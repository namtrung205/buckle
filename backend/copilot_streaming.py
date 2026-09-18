"""Reconstruct provider-neutral replies while forwarding real provider text deltas."""
from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx


async def provider_stream(client: httpx.AsyncClient, url: str, headers: dict,
                          payload: dict, provider: str, on_text: Callable[[str], None]) -> httpx.Response:
    async with client.stream("POST", url, headers=headers, json={**payload, "stream": True}) as response:
        if response.status_code != 200 or "text/event-stream" not in response.headers.get("content-type", ""):
            return httpx.Response(response.status_code, headers=response.headers, content=await response.aread())
        text = ""
        calls: dict[int, dict[str, Any]] = {}
        blocks: dict[int, dict[str, Any]] = {}
        stop_reason = "stop"
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            if event.get("error"):
                raise RuntimeError(f"Provider stream failed: {event['error']}")
            if provider == "anthropic":
                kind = event.get("type")
                index = event.get("index", 0)
                if kind == "content_block_start":
                    blocks[index] = {**event.get("content_block", {})}
                    initial = blocks[index].get("text", "")
                    if initial:
                        on_text(initial)
                elif kind == "content_block_delta":
                    delta = event.get("delta", {})
                    block = blocks.setdefault(index, {})
                    if delta.get("type") == "text_delta":
                        chunk = delta.get("text", "")
                        block["text"] = block.get("text", "") + chunk
                        on_text(chunk)
                    elif delta.get("type") == "input_json_delta":
                        block["partial_json"] = block.get("partial_json", "") + delta.get("partial_json", "")
                elif kind == "message_delta":
                    stop_reason = event.get("delta", {}).get("stop_reason") or stop_reason
            else:
                for choice in event.get("choices", []):
                    if choice.get("index", 0) != 0:
                        continue
                    stop_reason = choice.get("finish_reason") or stop_reason
                    delta = choice.get("delta", {})
                    chunk = delta.get("content")
                    if isinstance(chunk, str):
                        text += chunk
                        on_text(chunk)
                    for part in delta.get("tool_calls") or []:
                        call = calls.setdefault(part.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                        if part.get("id"):
                            call["id"] = part["id"]
                        function = part.get("function", {})
                        for key in ("name", "arguments"):
                            if function.get(key):
                                call["function"][key] += function[key]
        if provider == "anthropic":
            for block in blocks.values():
                partial = block.pop("partial_json", None)
                if partial is not None:
                    block["input"] = json.loads(partial)
            body = {"content": [blocks[index] for index in sorted(blocks)], "stop_reason": stop_reason}
        else:
            body = {"choices": [{"message": {"content": text, "tool_calls": [calls[index] for index in sorted(calls)]}, "finish_reason": stop_reason}]}
        return httpx.Response(200, headers={"content-type": "application/json"}, json=body)
