import asyncio
from types import SimpleNamespace

import httpx
import pytest

from provider_rate_limit import ProviderQueueTimeout, ProviderRateGovernor, _seconds


def _settings(**overrides):
    values = {
        "mode": "auto", "max_concurrent": 1, "rpm": None, "tpm": None,
        "safety_factor": 0.8, "max_wait_seconds": 1, "max_retries": 2,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_provider_duration_headers_are_parsed():
    assert _seconds("2m59.5s") == 179.5
    assert _seconds("250ms") == 0.25
    assert _seconds("2") == 2


def test_429_respects_retry_after_and_retries_within_policy():
    calls = 0

    async def scenario():
        governor = ProviderRateGovernor(_settings(max_retries=1))

        async def send():
            nonlocal calls
            calls += 1
            return httpx.Response(429, headers={"retry-after": "0"}) if calls == 1 else httpx.Response(200)

        return await governor.execute(send, 100)

    response = asyncio.run(scenario())
    assert response.status_code == 200
    assert calls == 2


def test_manual_rpm_budget_fails_fast_when_queue_wait_is_exceeded():
    async def scenario():
        governor = ProviderRateGovernor(_settings(mode="manual", rpm=1, safety_factor=1, max_wait_seconds=0.01, max_retries=0))

        async def send():
            return httpx.Response(200)

        await governor.execute(send, 1)
        with pytest.raises(ProviderQueueTimeout):
            await governor.execute(send, 1)

    asyncio.run(scenario())


def test_auto_mode_does_not_apply_local_rpm_or_tpm_estimates():
    calls = 0

    async def scenario():
        governor = ProviderRateGovernor(_settings(mode="auto", rpm=1, tpm=1, max_wait_seconds=0.01))

        async def send():
            nonlocal calls
            calls += 1
            return httpx.Response(200)

        await governor.execute(send, 10_000)
        await governor.execute(send, 10_000)

    asyncio.run(scenario())
    assert calls == 2


def test_auto_mode_confirms_long_learned_reset_with_provider_instead_of_local_error():
    calls = 0

    async def scenario():
        governor = ProviderRateGovernor(_settings(mode="auto", max_wait_seconds=0.01))

        async def send():
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(200, headers={
                    "x-ratelimit-remaining-tokens": "0",
                    "x-ratelimit-reset-tokens": "60s",
                })
            return httpx.Response(200)

        await governor.execute(send, 100)
        return await governor.execute(send, 100)

    response = asyncio.run(scenario())
    assert response.status_code == 200
    assert calls == 2
