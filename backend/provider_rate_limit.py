from __future__ import annotations

import asyncio
import random
import re
import time
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

import httpx


class ProviderQueueTimeout(RuntimeError):
    pass


def _seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    matches = re.findall(r"([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)", value.lower())
    if not matches:
        return None
    scales = {"ms": 0.001, "s": 1.0, "m": 60.0, "h": 3600.0}
    return sum(float(amount) * scales[unit] for amount, unit in matches)


class ProviderRateGovernor:
    """Per-connection outbound governor for provider requests.

    Manual mode applies configured RPM/TPM over a rolling minute. Auto mode relies on
    provider quota headers instead of local token estimates, avoiding false-positive
    throttling between multi-round Copilot calls.
    """

    def __init__(self, settings: Any):
        self.settings = settings
        self._semaphore = asyncio.Semaphore(settings.max_concurrent)
        self._lock = asyncio.Lock()
        self._requests: deque[float] = deque()
        self._tokens: deque[tuple[float, int]] = deque()
        self._token_blocked_until = 0.0

    async def execute(
        self,
        send: Callable[[], Awaitable[httpx.Response]],
        estimated_tokens: int,
    ) -> httpx.Response:
        if self.settings.mode == "disabled":
            return await send()
        timeout = float(self.settings.max_wait_seconds)
        try:
            if self._semaphore.locked():
                await asyncio.wait_for(self._semaphore.acquire(), timeout=timeout)
            else:
                await self._semaphore.acquire()
        except TimeoutError as error:
            raise ProviderQueueTimeout("Provider queue wait exceeded the configured limit") from error
        try:
            await self._reserve(max(1, estimated_tokens), timeout)
            response = await send()
            retries = 0
            retry_started = time.monotonic()
            while response.status_code == 429 and retries < self.settings.max_retries:
                retry_after = _seconds(response.headers.get("retry-after"))
                delay = retry_after if retry_after is not None else min(2 ** retries, 8)
                delay += random.uniform(0, min(0.25, delay * 0.1))
                if delay > timeout - (time.monotonic() - retry_started):
                    break
                await asyncio.sleep(delay)
                retries += 1
                response = await send()
            self._learn(response)
            return response
        finally:
            self._semaphore.release()

    async def _reserve(self, estimated_tokens: int, max_wait: float) -> None:
        if self.settings.mode == "auto":
            wait = max(0.0, self._token_blocked_until - time.monotonic())
            if 0 < wait <= max_wait:
                await asyncio.sleep(wait)
            # A long learned reset must not become a Buckle-generated quota error.
            # Send and let the provider confirm with 429/Retry-After instead.
            return

        started = time.monotonic()
        while True:
            async with self._lock:
                now = time.monotonic()
                cutoff = now - 60.0
                while self._requests and self._requests[0] <= cutoff:
                    self._requests.popleft()
                while self._tokens and self._tokens[0][0] <= cutoff:
                    self._tokens.popleft()
                wait = 0.0
                rpm = self.settings.rpm
                if rpm:
                    request_budget = max(1, int(rpm * self.settings.safety_factor))
                    if len(self._requests) >= request_budget:
                        wait = max(wait, self._requests[0] + 60.0 - now)
                tpm = self.settings.tpm
                reservation = estimated_tokens
                if tpm:
                    token_budget = max(1, int(tpm * self.settings.safety_factor))
                    reservation = min(reservation, token_budget)
                    used = sum(tokens for _, tokens in self._tokens)
                    if used + reservation > token_budget and self._tokens:
                        wait = max(wait, self._tokens[0][0] + 60.0 - now)
                if wait <= 0:
                    self._requests.append(now)
                    self._tokens.append((now, reservation))
                    return
            remaining = max_wait - (time.monotonic() - started)
            if wait > remaining:
                raise ProviderQueueTimeout("Provider quota queue wait exceeded the configured limit")
            await asyncio.sleep(wait)

    def _learn(self, response: httpx.Response) -> None:
        if self.settings.mode != "auto":
            return
        remaining = response.headers.get("x-ratelimit-remaining-tokens")
        reset = _seconds(response.headers.get("x-ratelimit-reset-tokens"))
        try:
            exhausted = remaining is not None and int(float(remaining)) <= 0
        except ValueError:
            exhausted = False
        if exhausted and reset is not None:
            self._token_blocked_until = max(self._token_blocked_until, time.monotonic() + reset)


def estimate_request_tokens(payload: dict[str, Any]) -> int:
    import json

    input_estimate = max(1, len(json.dumps(payload, ensure_ascii=False)) // 4)
    output_reserve = int(payload.get("max_tokens") or payload.get("max_output_tokens") or 1024)
    return input_estimate + output_reserve
