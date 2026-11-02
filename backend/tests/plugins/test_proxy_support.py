"""Every plugin declares how it relates to the Proxy setting (REQ-3.4.2.10).

A plugin states one of three values in its metadata, key ``proxy_support``: ``supported``
(it uses the proxy), ``unsupported`` (its traffic follows the WAVE host's own settings) or
``not_applicable`` (it makes no web requests). A plugin that states nothing is
``not_applicable``; that default lives once, on ``PluginBase.proxy_support``. Any other
value is a programming error, refused when the plugin is registered.
"""

import re
from typing import Any

import pytest

from wavecore import plugins
from wavecore.core.plugin_registry import PluginRegistry
from wavecore.plugins.base import PluginBase

USES_THE_PROXY = (
    "http-client",
    "opensearch",
    "k8s-apply",
    "k8s-connect",
    "k8s-copy",
    "k8s-delete",
    "k8s-events",
    "k8s-exec",
    "k8s-get",
    "k8s-logs",
    "k8s-rollout",
    "k8s-scale",
    "k8s-script",
    "k8s-top",
    "helm-install",
    "helm-rollback",
    "helm-status",
    "helm-test",
    "helm-uninstall",
    "helm-upgrade",
)
DOES_NOT_USE_THE_PROXY = ("shell-exec", "shell-script", "python")
OUTSIDE_THE_THREE = ["direct", "always"]
SAMPLE_ID = "sample-block"
SAMPLE_VERSION = "1.0.0"


class _SampleBlock(PluginBase):
    """A plugin whose metadata states the given ``proxy_support``, or nothing."""

    def __init__(self, stated: str | None = None) -> None:
        self._stated = stated

    @property
    def metadata(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "id": SAMPLE_ID,
            "name": "Sample Block",
            "version": SAMPLE_VERSION,
            "category": "network",
            "description": "A block that exists only in these tests",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }
        if self._stated is not None:
            metadata["proxy_support"] = self._stated
        return metadata

    async def execute(self, context: dict[str, Any]) -> Any:
        return {}

    async def validate(self, params: dict[str, Any]) -> None:
        return None


def _refused(value: str) -> str:
    """The anchored text for a sample block that declares ``value``."""
    text = (
        f"Plugin '{SAMPLE_ID}' declares proxy_support '{value}': "
        "it must be supported, unsupported or not_applicable"
    )
    return f"^{re.escape(text)}$"


@pytest.fixture(scope="module")
def registered() -> dict[str, PluginBase]:
    """Every plugin WAVE ships, registered in a registry of its own, by id."""
    registry = PluginRegistry()
    for name in plugins.__all__:
        exported = getattr(plugins, name)
        if isinstance(exported, type) and issubclass(exported, PluginBase):
            registry.register(exported())
    return {plugin.metadata["id"]: plugin for plugin in registry.list_plugins()}


class TestTheAccessor:
    """``PluginBase.proxy_support`` is the one reader of the declaration."""

    def test_a_plugin_that_states_nothing_is_not_applicable(self) -> None:
        assert _SampleBlock().proxy_support == "not_applicable"

    @pytest.mark.parametrize("stated", ["supported", "unsupported", "not_applicable"])
    def test_the_stated_value_is_returned(self, stated: str) -> None:
        assert _SampleBlock(stated).proxy_support == stated

    @pytest.mark.parametrize("stated", OUTSIDE_THE_THREE)
    def test_a_value_outside_the_three_raises(self, stated: str) -> None:
        plugin = _SampleBlock(stated)

        with pytest.raises(ValueError, match=_refused(stated)):
            _ = plugin.proxy_support


class TestRegistration:
    """A wrong declaration surfaces when the plugin is registered."""

    @pytest.mark.parametrize("stated", OUTSIDE_THE_THREE)
    def test_a_value_outside_the_three_is_refused(self, stated: str) -> None:
        registry = PluginRegistry()

        with pytest.raises(ValueError, match=_refused(stated)):
            registry.register(_SampleBlock(stated))

        assert registry.get(SAMPLE_ID, SAMPLE_VERSION) is None
        assert registry.list_plugins() == []


class TestWhatEachPluginDeclares:
    """The blocks whose web requests WAVE makes use the proxy; the script blocks do not."""

    @pytest.mark.parametrize("plugin_id", USES_THE_PROXY)
    def test_a_block_that_makes_web_requests_uses_the_proxy(
        self, registered: dict[str, PluginBase], plugin_id: str
    ) -> None:
        plugin = registered[plugin_id]

        assert plugin.proxy_support == "supported"
        assert plugin.metadata["proxy_support"] == "supported"

    @pytest.mark.parametrize("plugin_id", DOES_NOT_USE_THE_PROXY)
    def test_a_script_block_does_not_use_the_proxy(
        self, registered: dict[str, PluginBase], plugin_id: str
    ) -> None:
        plugin = registered[plugin_id]

        assert plugin.proxy_support == "unsupported"
        assert plugin.metadata["proxy_support"] == "unsupported"

    def test_every_other_plugin_states_nothing_and_is_not_applicable(
        self, registered: dict[str, PluginBase]
    ) -> None:
        stated = {*USES_THE_PROXY, *DOES_NOT_USE_THE_PROXY}
        others = {
            plugin_id: plugin for plugin_id, plugin in registered.items() if plugin_id not in stated
        }

        assert {"netcat", "ping", "sftp", "sql-client"} <= others.keys()
        assert {plugin_id: plugin.proxy_support for plugin_id, plugin in others.items()} == (
            dict.fromkeys(others, "not_applicable")
        )
        assert [
            plugin_id for plugin_id, plugin in others.items() if "proxy_support" in plugin.metadata
        ] == []
