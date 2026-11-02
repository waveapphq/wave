"""
WAVE Control Registry

Registry for control versions with semver resolution support.
"""

import re
from datetime import UTC, datetime

from wavecore.models.controls.metadata import CORE_CONTROLS
from wavecore.models.controls.versioning import (
    ControlVersionMetadata,
    DuplicateVersionError,
    VersionNotFoundError,
)
from wavecore.models.enums import ControlId

# Semantic versioning regex pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


def _parse_semver(version: str) -> tuple[int, int, int]:
    """Parse a semantic version string into (major, minor, patch) tuple."""
    match = re.match(SEMVER_PATTERN, version)
    if not match:
        raise ValueError(f"Invalid semantic version: {version}")
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _compare_versions(v1: str, v2: str) -> int:
    """
    Compare two semantic versions.

    Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2.
    """
    p1 = _parse_semver(v1)
    p2 = _parse_semver(v2)
    if p1 < p2:
        return -1
    elif p1 > p2:
        return 1
    return 0


def _version_matches_constraint(version: str, constraint: str) -> bool:
    """
    Check if a version matches a version constraint.

    Supports:
    - Exact version: 1.2.3
    - Caret range: ^1.2.3
    - Tilde range: ~1.2.3
    - Comparison operators: >=, >, <, <=
    - Range combinations: >=1.0.0 <2.0.0
    """
    v_parts = _parse_semver(version)
    constraint = constraint.strip()

    # Exact version
    if re.match(SEMVER_PATTERN, constraint):
        return version == constraint

    # Caret constraint: ^X.Y.Z
    if constraint.startswith("^"):
        c_parts = _parse_semver(constraint[1:])
        # For ^0.Y.Z, only match 0.Y.x (minor is significant)
        if c_parts[0] == 0:
            return v_parts[0] == 0 and v_parts[1] == c_parts[1] and v_parts >= c_parts
        # For ^X.Y.Z (X > 0), match X.x.x
        return v_parts[0] == c_parts[0] and v_parts >= c_parts

    # Tilde constraint: ~X.Y.Z
    if constraint.startswith("~"):
        c_parts = _parse_semver(constraint[1:])
        # ~X.Y.Z matches X.Y.x
        return v_parts[0] == c_parts[0] and v_parts[1] == c_parts[1] and v_parts >= c_parts

    # Combined range: >=X.Y.Z <A.B.C or >=X.Y.Z,<A.B.C (space or comma separated)
    combined_match = re.match(
        r"^(>=?|<=?)\s*(\d+\.\d+\.\d+)[,\s]+(>=?|<=?)\s*(\d+\.\d+\.\d+)$", constraint
    )
    if combined_match:
        op1, ver1, op2, ver2 = combined_match.groups()
        return _check_single_constraint(version, op1, ver1) and _check_single_constraint(
            version, op2, ver2
        )

    # Single comparison operator: >=X.Y.Z, >X.Y.Z, <X.Y.Z, <=X.Y.Z
    single_match = re.match(r"^(>=?|<=?)\s*(\d+\.\d+\.\d+)$", constraint)
    if single_match:
        op, ver = single_match.groups()
        return _check_single_constraint(version, op, ver)

    return False


def _check_single_constraint(version: str, op: str, constraint_version: str) -> bool:
    """Check if version satisfies a single comparison constraint."""
    cmp = _compare_versions(version, constraint_version)
    if op == ">=":
        return cmp >= 0
    elif op == ">":
        return cmp > 0
    elif op == "<=":
        return cmp <= 0
    elif op == "<":
        return cmp < 0
    return False


class ControlRegistry:
    """
    Registry for control versions (REQ-3.5.0.5, REQ-3.5.0.6, REQ-3.5.0.7).

    Supports multiple versions of each control type concurrently.
    Different workflows can use different versions in the same session.
    """

    def __init__(self) -> None:
        """Initialize an empty control registry."""
        # Map: ControlId -> version -> ControlVersionMetadata
        self._registry: dict[ControlId, dict[str, ControlVersionMetadata]] = {
            control_id: {} for control_id in ControlId
        }

    def register_core_control(
        self,
        control_id: ControlId,
        version: str,
        deprecated: bool = False,
    ) -> None:
        """
        Register a control version (REQ-3.5.0.7).

        Creates version metadata from the base CORE_CONTROLS definition
        with the specified version and deprecation status.
        """
        if version in self._registry[control_id]:
            raise DuplicateVersionError(control_id, version)

        base = CORE_CONTROLS[control_id]
        metadata = ControlVersionMetadata(
            id=control_id,
            version=version,
            name=base.name,
            description=base.description,
            category=base.category,
            icon_name=base.icon_name,
            release_date=datetime.now(UTC),
            deprecated=deprecated,
            deprecation_date=datetime.now(UTC) if deprecated else None,
        )
        self._registry[control_id][version] = metadata

    def get_all_versions(self, control_id: ControlId) -> list[str]:
        """
        Get all registered versions for a control (REQ-3.5.0.7).

        Returns versions sorted by semantic version order.
        """
        return sorted(self._registry[control_id].keys(), key=_parse_semver)

    def get_version(self, control_id: ControlId, version: str) -> ControlVersionMetadata:
        """
        Get metadata for a specific version (REQ-3.5.0.7).

        Raises VersionNotFoundError if version doesn't exist.
        """
        if version not in self._registry[control_id]:
            raise VersionNotFoundError(control_id, version)
        return self._registry[control_id][version]

    def get_latest_version(self, control_id: ControlId, include_deprecated: bool = True) -> str:
        """
        Get the latest version for a control (REQ-3.5.0.7).

        Returns highest semver version, optionally excluding deprecated.
        """
        versions = self._registry[control_id]
        if not versions:
            return ""

        candidates = list(versions.keys())
        if not include_deprecated:
            candidates = [v for v in candidates if not versions[v].deprecated]

        if not candidates:
            return ""

        return max(candidates, key=_parse_semver)

    def resolve_version(self, control_id: ControlId, constraint: str) -> str:
        """
        Resolve a version constraint to a specific version (REQ-3.5.0.6).

        Returns the highest matching version, preferring non-deprecated.
        Raises VersionNotFoundError if no matching version exists.
        """
        versions = self._registry[control_id]
        constraint = constraint.strip()

        # Find all matching versions
        matching: list[str] = []
        for version in versions:
            if _version_matches_constraint(version, constraint):
                matching.append(version)

        if not matching:
            raise VersionNotFoundError(control_id, constraint)

        # For exact version pins, return the exact match
        if re.match(SEMVER_PATTERN, constraint):
            return constraint

        # For range constraints, prefer non-deprecated versions
        non_deprecated = [v for v in matching if not versions[v].deprecated]
        if non_deprecated:
            return max(non_deprecated, key=_parse_semver)

        # Fall back to deprecated if that's all we have
        return max(matching, key=_parse_semver)

    def resolve_version_with_warnings(
        self, control_id: ControlId, constraint: str
    ) -> tuple[str, list[str]]:
        """
        Resolve version with deprecation warnings (REQ-3.5.0.7).

        Returns tuple of (resolved_version, list_of_warnings).
        """
        resolved = self.resolve_version(control_id, constraint)
        warnings: list[str] = []

        if self._registry[control_id][resolved].deprecated:
            warnings.append(f"Control '{control_id.value}' version '{resolved}' is deprecated")

        return resolved, warnings

    def load_core_controls(self) -> None:
        """
        Load all 15 core controls at version 1.0.0 (REQ-3.5.0.7).

        Populates the registry with the initial version of each control.
        """
        for control_id in ControlId:
            if "1.0.0" not in self._registry[control_id]:
                self.register_core_control(control_id, "1.0.0")
