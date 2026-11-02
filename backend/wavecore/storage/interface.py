"""
Storage Interface Definition

Abstract base class defining the storage contract for WAVE.
"""

from abc import ABC, abstractmethod
from typing import Any, Literal

from wavecore.models.blocks import Block
from wavecore.models.entities import Regression, Suite, Test
from wavecore.models.plugins import Plugin


class StorageInterface(ABC):
    """Abstract storage interface for WAVE components."""

    # Plugin operations
    @abstractmethod
    def save_plugin(
        self, plugin: Plugin, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save a plugin to storage."""
        pass  # pragma: no cover

    @abstractmethod
    def load_plugin(
        self,
        plugin_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Plugin:
        """Load a plugin from storage. If version is None, load latest version."""
        pass  # pragma: no cover

    @abstractmethod
    def list_plugins(self, category: str | None = None) -> list[Plugin]:
        """List all plugins, optionally filtered by category."""
        pass  # pragma: no cover

    @abstractmethod
    def delete_plugin(self, plugin_id: str, version: str) -> None:
        """Delete a specific plugin version."""
        pass  # pragma: no cover

    # Block operations
    @abstractmethod
    def save_block(
        self, block: Block, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save a block to storage."""
        pass  # pragma: no cover

    @abstractmethod
    def load_block(
        self, block_id: str, version: str | None = None, format: Literal["yaml", "json"] = "yaml"
    ) -> Block:
        """Load a block from storage. If version is None, load latest version."""
        pass  # pragma: no cover

    @abstractmethod
    def list_blocks(self) -> list[Block]:
        """List all blocks."""
        pass  # pragma: no cover

    @abstractmethod
    def delete_block(self, block_id: str, version: str) -> None:
        """Delete a specific block version."""
        pass  # pragma: no cover

    # Test operations
    @abstractmethod
    def save_test(
        self,
        test: Test,
        format: Literal["yaml", "json"] = "yaml",
        allow_overwrite: bool = True,
    ) -> None:
        """Save a test to storage."""
        pass  # pragma: no cover

    @abstractmethod
    def load_test(
        self,
        test_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Test:
        """Load a test from storage. If version is None, load latest version."""
        pass  # pragma: no cover

    @abstractmethod
    def list_tests(self) -> list[Test]:
        """List all tests."""
        pass  # pragma: no cover

    @abstractmethod
    def delete_test(self, test_id: str, version: str) -> None:
        """Delete a specific test version."""
        pass  # pragma: no cover

    # Suite operations
    @abstractmethod
    def save_suite(
        self, suite: Suite, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save a suite to storage."""
        pass  # pragma: no cover

    @abstractmethod
    def load_suite(
        self, suite_id: str, version: str | None = None, format: Literal["yaml", "json"] = "yaml"
    ) -> Suite:
        """Load a suite from storage. If version is None, load latest version."""
        pass  # pragma: no cover

    @abstractmethod
    def list_suites(self) -> list[Suite]:
        """List all suites."""
        pass  # pragma: no cover

    @abstractmethod
    def delete_suite(self, suite_id: str, version: str) -> None:
        """Delete a specific suite version."""
        pass  # pragma: no cover

    # Regression operations
    @abstractmethod
    def save_regression(
        self,
        regression: Regression,
        format: Literal["yaml", "json"] = "yaml",
        allow_overwrite: bool = True,
    ) -> None:
        """Save a regression to storage."""
        pass  # pragma: no cover

    @abstractmethod
    def load_regression(
        self,
        regression_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Regression:
        """Load a regression from storage. If version is None, load latest version."""
        pass  # pragma: no cover

    @abstractmethod
    def list_regressions(self) -> list[Regression]:
        """List all regressions."""
        pass  # pragma: no cover

    @abstractmethod
    def delete_regression(self, regression_id: str, version: str) -> None:
        """Delete a specific regression version."""
        pass  # pragma: no cover

    # Configuration operations
    @abstractmethod
    def save_config(self, config_path: str, config: dict[str, Any]) -> None:
        """Save configuration to specified path."""
        pass  # pragma: no cover

    @abstractmethod
    def load_config(self, config_path: str) -> dict[str, Any]:
        """Load configuration from specified path."""
        pass  # pragma: no cover

    @abstractmethod
    def resolve_config(self, config_path: str) -> dict[str, Any]:
        """Resolve configuration with hierarchy (merge with parent configs)."""
        pass  # pragma: no cover
