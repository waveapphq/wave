"""Unit tests for the plugin registry."""

from wavecore.core.plugin_registry import clear_registry, get_plugin, register_plugin
from wavecore.plugins.shell_script import ShellScriptPlugin


class TestPluginRegistry:
    """Plugins are registered and looked up by id and version."""

    def test_clear_removes_every_registered_plugin(self) -> None:
        register_plugin(ShellScriptPlugin())
        assert get_plugin("shell-script", "1.0.0") is not None

        clear_registry()

        assert get_plugin("shell-script", "1.0.0") is None
