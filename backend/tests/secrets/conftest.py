"""Shared fixtures for the secrets-at-rest test domain (REQ-4.5.1)."""

import base64
from collections.abc import Generator

import pytest

TEST_KEY_BYTES = bytes(range(32))
TEST_KEY_B64 = base64.b64encode(TEST_KEY_BYTES).decode()


@pytest.fixture(autouse=True)
def configured_secret_key(monkeypatch: pytest.MonkeyPatch) -> Generator[bytes, None, None]:
    """Provide a resolvable encryption key and an isolated config singleton."""
    from wavecore.api.config import loader

    monkeypatch.setenv("WAVE_SECRET_KEY", TEST_KEY_B64)
    original = loader._config_instance
    loader._config_instance = None
    yield TEST_KEY_BYTES
    loader._config_instance = original
