"""
Control registry for runtime version lookup.

Requirements implemented:
- REQ-3.5.0.11: Control registry for runtime version lookup
- REQ-3.5.0.12: Control registration at application startup
"""

import re
from typing import TYPE_CHECKING, Any

from wavecore.models.controls.metadata import SEMVER_PATTERN
from wavecore.models.controls.registry import _parse_semver, _version_matches_constraint
from wavecore.models.controls.versioning import VersionNotFoundError
from wavecore.models.enums import ControlId

if TYPE_CHECKING:
    from wavecore.controls.base import ControlBase

# Valid control categories
VALID_CATEGORIES = {"conditional", "loop", "flow", "timing", "misc"}

# Required metadata fields
REQUIRED_METADATA_FIELDS = {
    "id",
    "version",
    "name",
    "description",
    "category",
    "icon_name",
    "parameter_schema",
    "structure_hints",
}


def _get_param_name(param: Any) -> str:
    """Extract parameter name from a ControlParameter model or raw dict."""
    if hasattr(param, "name"):
        return str(param.name)
    if isinstance(param, dict):
        result = param.get("name", "")
        return str(result)
    return ""


def _validate_metadata(metadata: dict[str, Any]) -> None:
    """Validate control metadata fields, version, category, and parameter schema.

    Raises:
        InvalidControlMetadataError: If any validation fails.
    """
    # Validate required metadata fields
    missing = REQUIRED_METADATA_FIELDS - set(metadata.keys())
    if missing:
        raise InvalidControlMetadataError(
            f"Missing required metadata fields: {', '.join(sorted(missing))}"
        )

    # Validate semantic version
    version = metadata["version"]
    if not re.match(SEMVER_PATTERN, version):
        raise InvalidControlMetadataError(f"Invalid semantic version: {version}")

    # Validate category
    category = metadata["category"]
    if category not in VALID_CATEGORIES:
        valid_cats = ", ".join(sorted(VALID_CATEGORIES))
        raise InvalidControlMetadataError(
            f"Invalid category: {category}. Must be one of: {valid_cats}"
        )

    # Validate parameter schema
    for param in metadata.get("parameter_schema", []):
        param_name = _get_param_name(param)
        if not param_name or (isinstance(param_name, str) and not param_name.strip()):
            raise InvalidControlMetadataError("Invalid parameter schema: empty parameter name")


class DuplicateControlVersionError(Exception):
    """
    Exception raised when registering a duplicate version (REQ-3.5.0.12).

    Raised when attempting to register a control version that already exists.
    """

    def __init__(self, control_id: ControlId, version: str) -> None:
        self.control_id = control_id
        self.version = version
        super().__init__(f"Version '{version}' already registered for control '{control_id.value}'")


class InvalidControlMetadataError(Exception):
    """
    Exception raised when control metadata is invalid (REQ-3.5.0.12).

    Raised when a control's metadata fails validation during registration.
    """

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ControlImplementationRegistry:
    """
    Registry for control implementation classes (REQ-3.5.0.11).

    Maintains all registered control versions for runtime resolution.
    Supports version constraint resolution (exact pins, caret, tilde, ranges).
    Indexed structures provide constant-time lookup by control identifier and version.
    Immutable-after-startup design enables concurrent read access.
    """

    def __init__(self) -> None:
        """Initialize an empty control implementation registry."""
        self._implementations: dict[ControlId, dict[str, type[ControlBase]]] = {}
        self._deprecated: dict[ControlId, set[str]] = {}
        self._frozen = False

    def register(
        self,
        control_class: type["ControlBase"],
        deprecated: bool = False,
    ) -> None:
        """
        Register a control implementation class (REQ-3.5.0.11, REQ-3.5.0.12).

        Args:
            control_class: The control implementation class to register
            deprecated: Whether this version is deprecated

        Raises:
            RuntimeError: If registry is frozen
            DuplicateControlVersionError: If version already registered
            InvalidControlMetadataError: If metadata is invalid
        """
        if self._frozen:
            raise RuntimeError("Registry is frozen")

        # Instantiate to get metadata
        instance = control_class()
        metadata = instance.metadata

        _validate_metadata(metadata)

        control_id = metadata["id"]
        version = metadata["version"]

        # Initialize control ID entry if needed
        if control_id not in self._implementations:
            self._implementations[control_id] = {}
            self._deprecated[control_id] = set()

        # Check for duplicate version
        if version in self._implementations[control_id]:
            raise DuplicateControlVersionError(control_id, version)

        # Register the implementation
        self._implementations[control_id][version] = control_class
        if deprecated:
            self._deprecated[control_id].add(version)

    def get(self, control_id: ControlId, version: str) -> type["ControlBase"] | None:
        """
        Get control implementation for exact version (REQ-3.5.0.11).

        Args:
            control_id: The control identifier
            version: The exact version string

        Returns:
            Control implementation class, or None if not found
        """
        if control_id not in self._implementations:
            return None
        return self._implementations[control_id].get(version)

    def resolve(self, control_id: ControlId, constraint: str) -> type["ControlBase"]:
        """
        Resolve version constraint to implementation (REQ-3.5.0.11).

        Supports:
        - Exact version: "1.0.0"
        - Caret range: "^1.0.0" (highest 1.x compatible)
        - Tilde range: "~1.0.0" (highest 1.0.x compatible)
        - Range: ">=1.0.0,<2.0.0"

        Prefers non-deprecated versions when multiple candidates match.

        Args:
            control_id: The control identifier
            constraint: Version constraint string

        Returns:
            Control implementation class

        Raises:
            VersionNotFoundError: If no matching version found
        """
        if control_id not in self._implementations:
            raise VersionNotFoundError(control_id, constraint)

        versions = self._implementations[control_id]

        # Find all matching versions
        matching: list[str] = []
        for version in versions:
            if _version_matches_constraint(version, constraint):
                matching.append(version)

        if not matching:
            raise VersionNotFoundError(control_id, constraint)

        # For exact version constraint, return exact match
        if re.match(SEMVER_PATTERN, constraint) and constraint in matching:
            return versions[constraint]

        # Prefer non-deprecated versions
        deprecated = self._deprecated.get(control_id, set())
        non_deprecated = [v for v in matching if v not in deprecated]

        if non_deprecated:
            best = max(non_deprecated, key=_parse_semver)
        else:
            # Fall back to deprecated if that's all we have
            best = max(matching, key=_parse_semver)

        return versions[best]

    def list_versions(self, control_id: ControlId) -> list[str]:
        """
        List all registered versions for a control (REQ-3.5.0.11).

        Args:
            control_id: The control identifier

        Returns:
            List of version strings (empty if control not registered)
        """
        if control_id not in self._implementations:
            return []
        return list(self._implementations[control_id].keys())

    def list_control_ids(self) -> list[ControlId]:
        """
        List all registered control IDs (REQ-3.5.0.11).

        Returns:
            List of registered control IDs (empty if none registered)
        """
        return list(self._implementations.keys())

    def freeze(self) -> None:
        """
        Freeze registry to prevent modifications (REQ-3.5.0.11).

        After freezing, register() will raise RuntimeError.
        Enables immutable-after-startup design for concurrent read access.
        """
        self._frozen = True

    def clear(self) -> None:
        """
        Clear all registrations and unfreeze (REQ-3.5.0.11).

        Removes all registered implementations and unfreezes the registry.
        Used primarily for testing.
        """
        self._implementations.clear()
        self._deprecated.clear()
        self._frozen = False


# Global registry instance
_registry = ControlImplementationRegistry()


def get_control_implementation(control_id: ControlId, version: str) -> type["ControlBase"] | None:
    """
    Get control implementation from global registry (REQ-3.5.0.11).

    Args:
        control_id: The control identifier
        version: The exact version string

    Returns:
        Control implementation class, or None if not found
    """
    return _registry.get(control_id, version)


def clear_control_registry() -> None:
    """
    Clear global control registry (REQ-3.5.0.11).

    Removes all registered implementations. Used primarily for testing.
    """
    _registry.clear()


def list_latest_control_metadata() -> list[dict[str, Any]]:
    """Each registered control's newest-version metadata dict."""
    entries: list[dict[str, Any]] = []
    for control_id in _registry.list_control_ids():
        versions = _registry.list_versions(control_id)
        newest = max(versions, key=_parse_semver)
        control_class = _registry.get(control_id, newest)
        if control_class is not None:
            entries.append(control_class().metadata)
    return entries


def register_all_core_controls(
    registry: ControlImplementationRegistry,
    freeze_after: bool = False,
) -> None:
    """
    Register all 15 core controls (REQ-3.5.0.12).

    Registers initial version (1.0.0) of each core control type.
    Registration completes synchronously before application accepts requests.

    This function is idempotent - it skips controls that are already registered
    with the same version to avoid DuplicateControlVersionError.

    Args:
        registry: The registry to populate
        freeze_after: Whether to freeze registry after registration
    """
    # Import control implementations
    from wavecore.controls.conditional import (
        AssertControl,
        IfElseControl,
        SwitchCaseControl,
    )
    from wavecore.controls.flow import (
        HaltControl,
        ParallelControl,
        TryCatchFinallyControl,
    )
    from wavecore.controls.loop import (
        BreakControl,
        ContinueControl,
        ForControl,
        ForEachControl,
        WhileControl,
    )
    from wavecore.controls.note import NoteControl
    from wavecore.controls.timing import DelayControl, WaitUntilControl
    from wavecore.controls.variable_setter import VariableSetterControl

    # Register all core controls
    controls: list[type[ControlBase]] = [
        # Conditional
        IfElseControl,
        SwitchCaseControl,
        AssertControl,
        # Loop
        ForControl,
        ForEachControl,
        WhileControl,
        BreakControl,
        ContinueControl,
        # Flow
        ParallelControl,
        TryCatchFinallyControl,
        HaltControl,
        VariableSetterControl,
        # Timing
        DelayControl,
        WaitUntilControl,
        # Misc
        NoteControl,
    ]

    for control_class in controls:
        # Get metadata to check if already registered
        instance = control_class()
        meta = instance.metadata
        control_id = meta["id"]
        version = meta["version"]

        # Skip if already registered (idempotent)
        if registry.get(control_id, version) is not None:
            continue

        registry.register(control_class)

    if freeze_after:
        registry.freeze()
