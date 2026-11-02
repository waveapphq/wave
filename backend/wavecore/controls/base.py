"""
Control base class with metadata declaration.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
"""

import re
from abc import ABC, abstractmethod
from typing import Any

from wavecore.models.controls.metadata import SEMVER_PATTERN, ControlMetadata


class ControlBase(ABC):
    """
    Abstract base class for all control implementations (REQ-3.5.0.10).

    Controls implement a common abstract interface declaring identity and capabilities.
    The base class requires:
    - Metadata declaration (control id, semver, parameter schema, structure hints)
    - Execution contract (execute method receiving context)
    - Lifecycle hooks for initialization/cleanup
    - Validation interface for parameter checking

    Concrete controls extend this base, enabling introspection without instantiation.
    """

    @property
    @abstractmethod
    def metadata(self) -> dict[str, Any]:
        """
        Return control metadata (REQ-3.5.0.10).

        Metadata must include:
        - id: ControlId enum value
        - version: Semantic version string (e.g., "1.0.0")
        - name: Human-readable control name
        - description: Control description
        - category: Control category (conditional, loop, flow, timing)
        - icon_name: Icon identifier for UI display
        - parameter_schema: List of ControlParameter definitions
        - output_schema: List of output field definitions (dicts).
                    Required for all controls. Use [] for controls with no outputs.
        - structure_hints: Dict with structural information for rendering
        """
        ...

    @abstractmethod
    async def execute(self, context: dict[str, Any]) -> Any:
        """
        Execute the control logic (REQ-3.5.0.10).

        Args:
            context: Execution context containing variables, parameters, and runtime state

        Returns:
            Control execution result (type varies by control)
        """
        ...

    @abstractmethod
    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate control parameters (REQ-3.5.0.10).

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: If parameters are invalid
        """
        ...

    async def initialize(self, context: dict[str, Any]) -> None:  # noqa: B027
        """
        Initialize control before execution (REQ-3.5.0.10).

        Optional lifecycle hook for setup operations. Default implementation
        does nothing. Override for custom initialization logic.

        Args:
            context: Execution context for initialization
        """

    async def cleanup(self) -> None:  # noqa: B027
        """
        Clean up control after execution (REQ-3.5.0.10).

        Optional lifecycle hook for cleanup operations. Default implementation
        does nothing. Override for custom cleanup logic.
        """

    def get_control_metadata(self) -> ControlMetadata:
        """
        Get validated Pydantic metadata model (REQ-3.5.0.10).

        Converts the metadata dict to a validated ControlMetadata Pydantic model.

        Returns:
            Validated ControlMetadata model

        Raises:
            ValueError: If metadata is invalid (e.g., invalid semantic version)
        """
        meta = self.metadata

        # Enforce output_schema presence
        if "output_schema" not in meta:
            raise ValueError(
                f"Control '{meta.get('id', 'unknown')}' missing required"
                " 'output_schema' in metadata"
            )

        # Validate semantic version before creating model
        version = meta.get("version", "")
        if not re.match(SEMVER_PATTERN, version):
            raise ValueError(f"Invalid semantic version: {version}")

        return ControlMetadata(
            id=meta["id"],
            version=meta["version"],
            name=meta["name"],
            description=meta["description"],
            category=meta["category"],
            icon_name=meta["icon_name"],
        )
