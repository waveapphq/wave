"""
Block Version Manager

Service for managing block version lifecycle (REQ-3.1.2.2):
- Publishing blocks (immutability enforcement)
- Version retrieval and discovery
- Deprecation management
- Version constraint resolution
- Dependency validation
"""

import re
from copy import deepcopy
from datetime import UTC, datetime

from wavecore.models.blocks import Block


class BlockVersionManager:
    """
    Manages block version lifecycle and metadata (REQ-3.1.2.2).

    Provides version control capabilities including:
    - Publishing blocks to make them immutable
    - Retrieving specific versions
    - Discovering blocks by metadata
    - Resolving version constraints
    - Managing deprecation
    - Validating dependencies
    """

    def __init__(self) -> None:
        """Initialize the version manager with empty storage."""
        # In-memory storage: {block_id: {version: Block}}
        self._storage: dict[str, dict[str, Block]] = {}

    def publish(self, block: Block) -> Block:
        """
        Publish a block version, making it immutable (REQ-3.1.2.2).

        Args:
            block: Block to publish

        Returns:
            Published block with is_published=True (deep copy for immutability)

        Raises:
            ValueError: If block is already published
        """
        # Check if already published
        if block.id in self._storage and block.version in self._storage[block.id]:
            raise ValueError(f"Block {block.id} version {block.version} is already published")

        # Create immutable copy with publish metadata
        published_block = deepcopy(block)
        published_block.is_published = True
        if published_block.publish_date is None:
            published_block.publish_date = datetime.now(UTC)

        # Store the published block
        if block.id not in self._storage:
            self._storage[block.id] = {}
        self._storage[block.id][block.version] = published_block

        # Return a deep copy to prevent caller from modifying stored version
        return deepcopy(published_block)

    def get(self, block_id: str, version: str) -> Block | None:
        """
        Retrieve a specific published block version (REQ-3.1.2.2).

        Args:
            block_id: Block identifier
            version: Semantic version string

        Returns:
            Block if found and published, None otherwise
        """
        if block_id not in self._storage:
            return None
        block = self._storage[block_id].get(version)
        # Return deep copy to enforce immutability
        return deepcopy(block) if block is not None else None

    def list_versions(self, block_id: str) -> list[str]:
        """
        List all published versions of a block in descending order (REQ-3.1.2.2).

        Args:
            block_id: Block identifier

        Returns:
            List of version strings sorted in descending order
        """
        if block_id not in self._storage:
            return []

        # Sort by semantic version in descending order
        return sorted(self._storage[block_id].keys(), key=self._parse_semver, reverse=True)

    def get_latest(self, block_id: str, include_deprecated: bool = False) -> Block | None:
        """
        Get the latest version of a block (REQ-3.1.2.2).

        Args:
            block_id: Block identifier
            include_deprecated: Whether to include deprecated versions

        Returns:
            Latest block version, or None if not found
        """
        if block_id not in self._storage:
            return None

        # Get all versions sorted descending
        versions = self.list_versions(block_id)

        for version in versions:
            block = self._storage[block_id][version]
            if include_deprecated or not block.is_deprecated:
                return block

        return None

    def deprecate(
        self, block_id: str, version: str, reason: str, replacement_version: str | None = None
    ) -> Block:
        """
        Deprecate a published block version (REQ-3.1.2.2).

        Args:
            block_id: Block identifier
            version: Version to deprecate
            reason: Deprecation reason
            replacement_version: Optional recommended replacement version

        Returns:
            Deprecated block

        Raises:
            ValueError: If block not found, already deprecated, or validation fails
        """
        # Validate reason
        if not reason or not reason.strip():
            raise ValueError("Deprecation reason is required")

        # Validate replacement version if provided
        if replacement_version is not None and not re.match(
            r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
            r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
            r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$",
            replacement_version,
        ):
            raise ValueError(f"Invalid replacement version: {replacement_version}")

        # Get block from storage directly (not via get() to avoid deep copy)
        if block_id not in self._storage or version not in self._storage[block_id]:
            raise ValueError(f"Block {block_id} version {version} not found")

        block = self._storage[block_id][version]

        if block.is_deprecated:
            raise ValueError(f"Block {block_id} version {version} is already deprecated")

        # Update block with deprecation metadata (modifies in storage)
        block.is_deprecated = True
        block.deprecation_reason = reason
        block.replacement_version = replacement_version
        block.deprecation_date = datetime.now(UTC)

        # Return a deep copy to maintain immutability for caller
        return deepcopy(block)

    def find(
        self,
        name: str | None = None,
        author: str | None = None,
        tags: list[str] | None = None,
        include_deprecated: bool = False,
    ) -> list[Block]:
        """
        Find blocks by metadata (REQ-3.1.2.2).

        Args:
            name: Block name to match
            author: Author to match
            tags: Tags to match (block must have all specified tags)
            include_deprecated: Whether to include deprecated blocks

        Returns:
            List of matching blocks
        """
        results: list[Block] = []

        for _block_id, versions in self._storage.items():
            for _version, block in versions.items():
                if self._matches_filter(block, name, author, tags, include_deprecated):
                    results.append(block)

        return results

    @staticmethod
    def _matches_filter(
        block: Block,
        name: str | None,
        author: str | None,
        tags: list[str] | None,
        include_deprecated: bool,
    ) -> bool:
        """Check if a block matches the given filter criteria."""
        if not include_deprecated and block.is_deprecated:
            return False
        if name is not None and block.name != name:
            return False
        if author is not None and block.author != author:
            return False
        if tags is not None and not all(tag in block.tags for tag in tags):
            return False
        return True

    def resolve_version(
        self, block_id: str, constraint: str, include_deprecated: bool = False
    ) -> Block | None:
        """
        Resolve a version constraint to a specific block version (REQ-3.1.2.2).

        Supports version constraints:
        - Exact: "1.0.0"
        - Caret: "^1.0.0" (>=1.0.0, <2.0.0)
        - Tilde: "~1.2.0" (>=1.2.0, <1.3.0)
        - Range: ">=1.0.0" (>=1.0.0)

        Args:
            block_id: Block identifier
            constraint: Version constraint string
            include_deprecated: Whether to include deprecated versions

        Returns:
            Latest block version matching constraint, or None if no match
        """
        if block_id not in self._storage:
            return None

        # Get all versions sorted descending
        versions = self.list_versions(block_id)

        for version in versions:
            block = self._storage[block_id][version]

            # Skip deprecated if not requested
            if not include_deprecated and block.is_deprecated:
                continue

            # Check if version matches constraint
            if self._matches_constraint(version, constraint):
                return block

        return None

    def validate_dependencies(self, block: Block) -> dict[str, bool | list[dict[str, str]]]:
        """
        Validate that all block dependencies can be satisfied (REQ-3.1.2.2).

        Args:
            block: Block to validate

        Returns:
            Dict with:
                - valid: bool indicating if all dependencies satisfied
                - satisfied: list of satisfied dependencies
                - unsatisfied: list of unsatisfied dependencies
        """
        satisfied: list[dict[str, str]] = []
        unsatisfied: list[dict[str, str]] = []

        for dep in block.dependencies:
            # Only validate block dependencies (skip plugin dependencies)
            if dep.component_type != "block":
                continue
            resolved = self.resolve_version(dep.component_id, dep.version_constraint)
            if resolved is not None:
                satisfied.append({"block_id": dep.component_id, "version": resolved.version})
            else:
                unsatisfied.append(
                    {"block_id": dep.component_id, "constraint": dep.version_constraint}
                )

        return {
            "valid": len(unsatisfied) == 0,
            "satisfied": satisfied,
            "unsatisfied": unsatisfied,
        }

    def _parse_semver(self, version: str) -> tuple[int, int, int]:
        """
        Parse semantic version string to tuple for comparison.

        Args:
            version: Semantic version string (e.g., "1.2.3")

        Returns:
            Tuple of (major, minor, patch) as integers
        """
        match = re.match(r"^(\d+)\.(\d+)\.(\d+)", version)
        if not match:
            return (0, 0, 0)
        return (int(match.group(1)), int(match.group(2)), int(match.group(3)))

    def _matches_constraint(self, version: str, constraint: str) -> bool:
        """
        Check if a version matches a constraint.

        Args:
            version: Version string to check
            constraint: Constraint string

        Returns:
            True if version matches constraint
        """
        v_major, v_minor, v_patch = self._parse_semver(version)

        # Caret (^): >=version, <next major
        if constraint.startswith("^"):
            c_major, c_minor, c_patch = self._parse_semver(constraint[1:])
            if v_major != c_major:
                return False
            if v_major == 0 and v_minor != c_minor:
                return False
            return (v_major, v_minor, v_patch) >= (c_major, c_minor, c_patch)

        # Tilde (~): >=version, <next minor
        elif constraint.startswith("~"):
            c_major, c_minor, c_patch = self._parse_semver(constraint[1:])
            if v_major != c_major or v_minor != c_minor:
                return False
            return v_patch >= c_patch

        # Range (>=): >=version
        elif constraint.startswith(">="):
            c_major, c_minor, c_patch = self._parse_semver(constraint[2:])
            return (v_major, v_minor, v_patch) >= (c_major, c_minor, c_patch)

        # Exact match (no prefix)
        else:
            return version == constraint
