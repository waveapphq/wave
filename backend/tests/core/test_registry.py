"""
Mock component registry for dependency resolution tests.

This module provides test infrastructure that should NOT be in production code.
"""

from typing import Any

from wavecore.core.dependencies import ComponentRegistry
from wavecore.models.blocks import BlockDependency


class MockComponentRegistry(ComponentRegistry):
    """Mock registry for testing dependency resolution."""

    def __init__(self, data: dict[str, dict[str, Any]] | None = None) -> None:
        """Initialize mock registry with test data."""
        self._data = data or get_default_test_data()

    def get_component(self, component_id: str, version: str) -> dict[str, Any] | None:
        """Get component metadata."""
        if component_id not in self._data:
            return None
        if version not in self._data[component_id]:
            return None
        return self._data[component_id][version]

    def get_available_versions(self, component_id: str) -> list[str]:
        """Get available versions for a component."""
        if component_id not in self._data:
            return []
        return list(self._data[component_id].keys())

    def get_all_components(self) -> list[tuple[str, str]]:
        """Get all components in registry."""
        result = []
        for comp_id, versions in self._data.items():
            for version in versions.keys():
                result.append((comp_id, version))
        return result

    def update(self, updates: dict[str, dict[str, Any]]) -> None:
        """Update registry with new data (test helper)."""
        for comp_id, versions in updates.items():
            if comp_id not in self._data:
                self._data[comp_id] = {}
            self._data[comp_id].update(versions)


def get_default_test_data() -> dict[str, dict[str, Any]]:
    """Get default test data for comprehensive test scenarios."""
    return {
        "block-a": {
            "0.9.0": {"dependencies": []},
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-b",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                    BlockDependency(
                        component_id="block-c",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                ]
            },
            "2.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-b",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                ]
            },
        },
        "block-b": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-c",
                        component_type="block",
                        version_constraint="^1.0.0",
                    )
                ]
            }
        },
        "block-c": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-d",
                        component_type="block",
                        version_constraint="^1.0.0",
                    )
                ]
            }
        },
        "block-d": {"1.0.0": {"dependencies": []}},
        "workflow-block": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="util-block",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                    BlockDependency(
                        component_id="logger-plugin",
                        component_type="plugin",
                        version_constraint="^1.0.0",
                    ),
                ]
            }
        },
        "util-block": {"1.0.0": {"dependencies": []}},
        "logger-plugin": {
            "1.0.0": {"dependencies": []},
            "1.5.0": {"dependencies": []},
            "2.1.0": {"dependencies": []},
        },
        "shared-dep-block": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-b",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                    BlockDependency(
                        component_id="block-c",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                ]
            }
        },
        "workflow-branch-1": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="logger-plugin",
                        component_type="plugin",
                        version_constraint="1.5.0",
                    )
                ]
            }
        },
        "workflow-branch-2": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="logger-plugin",
                        component_type="plugin",
                        version_constraint="2.1.0",
                    )
                ]
            }
        },
        "complex-workflow": {
            "1.0.0": {
                "dependencies": [
                    BlockDependency(
                        component_id="block-a",
                        component_type="block",
                        version_constraint="^1.0.0",
                    ),
                ]
            }
        },
        "conflict-block": {"1.0.0": {"dependencies": []}},
    }
