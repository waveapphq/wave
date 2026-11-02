"""
Plugin Registry for execution engine (REQ-3.2.1.1).

Provides plugin lookup and registration for normal execution mode.
Production code uses this to find and execute plugin implementations.
"""

from wavecore.plugins.base import PluginBase, declared_proxy_support


class PluginRegistry:
    """
    Registry for plugin implementations.

    Allows registration and lookup of plugin instances by ID and version.
    Used by execution engine to find plugin implementations during execution.
    """

    def __init__(self) -> None:
        """Initialize empty plugin registry."""
        self._plugins: dict[str, dict[str, PluginBase]] = {}

    def register(self, plugin: PluginBase) -> None:
        """
        Register a plugin implementation.

        Args:
            plugin: Plugin instance to register

        Raises:
            ValueError: If plugin metadata is invalid
        """
        metadata = plugin.metadata
        plugin_id = metadata["id"]
        version = metadata["version"]
        # A proxy_support outside the three values raises here (REQ-3.4.2.10).
        declared_proxy_support(metadata)

        if plugin_id not in self._plugins:
            self._plugins[plugin_id] = {}

        self._plugins[plugin_id][version] = plugin

    def get(self, plugin_id: str, version: str) -> PluginBase | None:
        """
        Look up plugin by ID and version.

        Args:
            plugin_id: Plugin identifier
            version: Plugin version

        Returns:
            Plugin instance if found, None otherwise
        """
        if plugin_id not in self._plugins:
            return None
        return self._plugins[plugin_id].get(version)

    def list_plugins(self) -> list[PluginBase]:
        """All registered plugin instances, latest registration per plugin id."""
        return [
            next(reversed(versions.values())) for versions in self._plugins.values() if versions
        ]

    def clear(self) -> None:
        """Clear all registered plugins."""
        self._plugins.clear()


# Global registry instance
_registry = PluginRegistry()


def register_plugin(plugin: PluginBase) -> None:
    """
    Register a plugin in the global registry.

    Args:
        plugin: Plugin instance to register
    """
    _registry.register(plugin)


def get_plugin(plugin_id: str, version: str) -> PluginBase | None:
    """
    Get plugin from global registry.

    Args:
        plugin_id: Plugin identifier
        version: Plugin version

    Returns:
        Plugin instance if found, None otherwise
    """
    return _registry.get(plugin_id, version)


def list_plugins() -> list[PluginBase]:
    """List all plugin instances in the global registry (latest per id)."""
    return _registry.list_plugins()


def clear_registry() -> None:
    """Clear global registry."""
    _registry.clear()
