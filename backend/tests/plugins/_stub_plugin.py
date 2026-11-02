"""A test-only plugin with no settings and no outputs: a block that is not built yet."""

from typing import Any

import pytest

from wavecore.core.plugin_registry import register_plugin
from wavecore.plugins.base import PluginBase

STUB_PLUGIN_ID = "test-stub"


class StubPlugin(PluginBase):
    """A registered block with nothing behind it."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": STUB_PLUGIN_ID,
            "name": "Test Stub",
            "version": "0.0.1",
            "category": "system",
            "description": "A block that is not built yet.",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """The block takes no settings, so there is nothing to check."""

    async def execute(self, context: dict[str, Any]) -> Any:
        raise NotImplementedError("Test Stub is not built yet")


def register_stub_plugin() -> str:
    """Add the stub to the live plugin registry; the seeding fixture clears it again."""
    register_plugin(StubPlugin())
    return STUB_PLUGIN_ID


def let_saved_tests_use_the_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    """The test save checks accept only the block ids they list, so the stub joins them."""
    from wavecore.api.services.tests import service as test_service

    monkeypatch.setattr(
        test_service, "KNOWN_PLUGIN_IDS", test_service.KNOWN_PLUGIN_IDS | {STUB_PLUGIN_ID}
    )
