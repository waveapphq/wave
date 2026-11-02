"""
Execution context for managing runtime state and dependencies.

Provides context management for block execution including dependency injection,
variable scoping, and execution state tracking.
"""

from typing import Any


class ExecutionContext:
    """
    Execution context for managing runtime state.

    Provides dependency injection storage and access for blocks during execution.
    """

    def __init__(self) -> None:
        """Initialize execution context with empty dependency storage."""
        self._dependencies: dict[str, dict[str, Any]] = {}

    def get_dependencies(self, block_key: str) -> dict[str, Any]:
        """
        Get dependencies for a specific block instance.

        Args:
            block_key: Block identifier (format: "block-id@version")

        Returns:
            Dictionary of dependencies for the block
        """
        return self._dependencies.get(block_key, {})

    def set_dependencies(self, block_key: str, dependencies: dict[str, Any]) -> None:
        """
        Set dependencies for a specific block instance.

        Args:
            block_key: Block identifier (format: "block-id@version")
            dependencies: Dictionary of dependency instances
        """
        self._dependencies[block_key] = dependencies
