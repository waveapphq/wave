"""
Block Import/Export Implementation (REQ-3.1.2.5)

Provides functionality for serializing blocks to and deserializing from file formats.
Supports YAML and JSON formats with complete fidelity preservation.
"""

import json
from collections.abc import Callable
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import yaml

from wavecore.core.blocks.validator import BlockValidator
from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.models.blocks import Block

_EXT_YAML = ".yaml"
_TZ_UTC_SUFFIX = "+00:00"


class ExportError(Exception):
    """Exception raised when export operations fail."""

    pass


class ImportError(Exception):
    """Exception raised when import operations fail."""

    pass


class ImportConflict(Exception):
    """Exception raised when import conflicts with existing blocks."""

    pass


class ConflictResolution(Enum):
    """Strategies for handling import conflicts."""

    REJECT = "reject"  # Reject duplicate imports (default)
    CREATE_VERSION = "create_version"  # Create new version with auto-increment
    FORCE_OVERWRITE = "force_overwrite"  # Overwrite draft blocks only


class BatchExportResult:
    """Result of batch export operation."""

    def __init__(self) -> None:
        """Initialize batch export result."""
        self.success: bool = True
        self.exported_count: int = 0
        self.exported_blocks: dict[str, Block] = {}
        self.errors: list[str] = []
        self.warnings: list[str] = []


class BatchImportResult:
    """Result of batch import operation."""

    def __init__(self) -> None:
        """Initialize batch import result."""
        self.success: bool = True
        self.imported_count: int = 0
        self.imported_blocks: dict[str, Block] = {}
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.import_order: list[str] = []


class ImportValidationResult:
    """Result of import validation (dry run)."""

    def __init__(self, block: Block | None = None, is_valid: bool = False) -> None:
        """Initialize validation result."""
        self.block = block
        self.is_valid = is_valid
        self.errors: list[str] = []
        self.warnings: list[str] = []


class BlockExporter:
    """
    Exports blocks to YAML/JSON file formats (REQ-3.1.2.5).

    Provides serialization of blocks with complete fidelity preservation
    including metadata, parameters, composition structures, and lifecycle info.
    """

    def __init__(self) -> None:
        """Initialize block exporter."""
        pass

    def export_to_string(self, block: Block, file_format: str = "yaml") -> str:
        """
        Export a block to string representation.

        Args:
            block: Block to export
            file_format: Export format ('yaml' or 'json')

        Returns:
            String representation of the block

        Raises:
            ExportError: If export fails or format is unsupported
        """
        if file_format not in ("yaml", "json"):
            raise ExportError(f"Unsupported export format: {file_format}")

        # Convert block to dictionary, preserving all fields
        block_dict = self._block_to_dict(block)

        if file_format == "yaml":
            return yaml.dump(block_dict, default_flow_style=False, sort_keys=False)
        else:  # json
            return json.dumps(block_dict, indent=2, default=str)

    def export_to_file(self, block: Block, filepath: Path, file_format: str | None = None) -> None:
        """
        Export a block to a file.

        Args:
            block: Block to export
            filepath: Target file path
            file_format: Export format (auto-detected from extension if None)

        Raises:
            ExportError: If export fails
        """
        # Auto-detect format from file extension
        if file_format is None:
            if filepath.suffix.lower() in (_EXT_YAML, ".yml"):
                file_format = "yaml"
            elif filepath.suffix.lower() == ".json":
                file_format = "json"
            else:
                raise ExportError(f"Cannot auto-detect format from extension: {filepath.suffix}")

        # Export to string
        content = self.export_to_string(block, file_format)

        # Write to file
        try:
            filepath.write_text(content, encoding="utf-8")
        except Exception as e:
            raise ExportError(f"Failed to write file: {e}") from e

    def export_batch(
        self,
        blocks: list[Block],
        include_dependencies: bool = False,
        block_registry: dict[str, dict[str, Block]] | None = None,
    ) -> BatchExportResult:
        """
        Export multiple blocks with optional dependency inclusion.

        Args:
            blocks: List of blocks to export
            include_dependencies: Whether to include dependent blocks
            block_registry: Registry of available blocks for dependency resolution

        Returns:
            BatchExportResult with export status and details
        """
        result = BatchExportResult()
        exported_ids: set[tuple[str, str]] = set()

        def export_block_with_deps(block: Block) -> None:
            """Recursively export block and its dependencies."""
            block_key = (block.id, block.version)
            if block_key in exported_ids:
                return

            if include_dependencies:
                self._export_dependencies(block, block_registry, result, export_block_with_deps)

            result.exported_blocks[block.id] = block
            result.exported_count += 1
            exported_ids.add(block_key)

        # Export all blocks
        for block in blocks:
            try:
                export_block_with_deps(block)
            except Exception as e:
                result.errors.append(f"Failed to export block '{block.id}': {e}")
                result.success = False

        return result

    def _export_dependencies(
        self,
        block: Block,
        block_registry: dict[str, dict[str, Block]] | None,
        result: BatchExportResult,
        export_func: Callable[[Block], None],
    ) -> None:
        """
        Export dependencies for a single block.

        Args:
            block: Block whose dependencies to export
            block_registry: Registry of available blocks
            result: Batch result to accumulate warnings
            export_func: Recursive export function
        """
        for dep in block.dependencies:
            if dep.component_type != "block":
                continue
            dep_block = self._resolve_dependency(dep, block_registry)
            if dep_block is not None:
                export_func(dep_block)
            else:
                result.warnings.append(
                    f"Dependency '{dep.component_id}' version "
                    f"'{dep.version_constraint}' not found"
                )

    def _resolve_dependency(
        self,
        dep: Any,
        block_registry: dict[str, dict[str, Block]] | None,
    ) -> Block | None:
        """
        Resolve a single dependency from the block registry.

        Args:
            dep: Dependency to resolve
            block_registry: Registry of available blocks

        Returns:
            Resolved block or None if not found
        """
        if not block_registry or dep.component_id not in block_registry:
            return None
        for version, dep_block in block_registry[dep.component_id].items():
            if version == dep.version_constraint or dep.version_constraint.startswith("^"):
                return dep_block
        return None

    def _block_to_dict(self, block: Block) -> dict[str, Any]:
        """
        Convert block to dictionary representation.

        Args:
            block: Block to convert

        Returns:
            Dictionary representation of the block
        """
        # Use Pydantic's model_dump but convert datetime objects
        block_dict = block.model_dump(exclude_none=True)

        # Convert datetime fields to ISO format strings
        for field in ("created_at", "updated_at", "publish_date", "deprecation_date"):
            if field in block_dict and isinstance(block_dict[field], datetime):
                block_dict[field] = block_dict[field].isoformat().replace(_TZ_UTC_SUFFIX, "Z")

        return block_dict


class BlockImporter:
    """
    Imports blocks from YAML/JSON file formats (REQ-3.1.2.5).

    Provides deserialization with validation, conflict resolution,
    and dependency ordering for batch operations.
    """

    def __init__(
        self,
        validator: BlockValidator,
        version_manager: BlockVersionManager,
        validate_on_import: bool = False,
    ) -> None:
        """
        Initialize block importer.

        Args:
            validator: Block validator for structural validation
            version_manager: Version manager for version resolution
            validate_on_import: Whether to validate blocks during import
        """
        self._validator = validator
        self._version_manager = version_manager
        self._validate_on_import = validate_on_import
        self._block_registry: dict[tuple[str, str], Block] = {}

    def import_from_string(
        self,
        content: str,
        file_format: str = "yaml",
        conflict_resolution: ConflictResolution = ConflictResolution.REJECT,
    ) -> Block:
        """
        Import a block from string representation.

        Args:
            content: String content to import
            file_format: Import format ('yaml' or 'json')
            conflict_resolution: Strategy for handling conflicts

        Returns:
            Imported block

        Raises:
            ImportError: If import fails
            ImportConflict: If block conflicts with existing
        """
        block_dict = self._parse_content(content, file_format)
        self._convert_datetime_fields(block_dict)

        try:
            block = Block(**block_dict)
        except Exception as e:
            raise ImportError(f"Block validation error: {e}") from e

        block = self._resolve_conflict(block, conflict_resolution)
        self._run_import_validation(block)
        self._register_block(block)

        return block

    def _parse_content(self, content: str, file_format: str) -> Any:
        """
        Parse string content into a dictionary based on format.

        Args:
            content: String content to parse
            file_format: Format identifier ('yaml' or 'json')

        Returns:
            Parsed dictionary

        Raises:
            ImportError: If parsing fails or format is unsupported
        """
        try:
            if file_format == "yaml":
                return yaml.safe_load(content)
            if file_format == "json":
                return json.loads(content)
            raise ImportError(f"Unsupported import format: {file_format}")
        except yaml.YAMLError as e:
            raise ImportError(f"Failed to parse YAML: {e}") from e
        except json.JSONDecodeError as e:
            raise ImportError(f"Block validation error: Failed to parse JSON - {e}") from e

    def _resolve_conflict(self, block: Block, conflict_resolution: ConflictResolution) -> Block:
        """
        Check for conflicts with existing blocks and resolve them.

        Args:
            block: Block to check
            conflict_resolution: Strategy for handling conflicts

        Returns:
            Block (possibly with updated version)

        Raises:
            ImportConflict: If conflict cannot be resolved
            ImportError: If overwrite of published block is attempted
        """
        existing = self._get_existing_block(block.id, block.version)
        if not existing:
            return block

        # Allow re-importing the exact same unpublished block (idempotent)
        if not existing.is_published and conflict_resolution == ConflictResolution.REJECT:
            return block

        if conflict_resolution == ConflictResolution.REJECT:
            raise ImportConflict(f"Block '{block.id}' version '{block.version}' already exists")

        if conflict_resolution == ConflictResolution.CREATE_VERSION:
            return self._create_new_version(block)

        if conflict_resolution == ConflictResolution.FORCE_OVERWRITE and existing.is_published:
            raise ImportError(
                f"Cannot overwrite published block '{block.id}' version '{block.version}'"
            )

        return block

    def _run_import_validation(self, block: Block) -> None:
        """
        Validate a block if import validation is enabled.

        Args:
            block: Block to validate

        Raises:
            ImportError: If validation fails
        """
        if not self._validate_on_import:
            return
        feedback = self._validator.validate(block)
        if not feedback.is_valid:
            error_msgs = [f"{e.component}: {e.message}" for e in feedback.errors]
            raise ImportError(f"Validation failed: {'; '.join(error_msgs)}")

    def import_from_file(
        self,
        filepath: Path,
        file_format: str | None = None,
        conflict_resolution: ConflictResolution = ConflictResolution.REJECT,
    ) -> Block:
        """
        Import a block from a file.

        Args:
            filepath: Path to file to import
            file_format: Import format (auto-detected if None)
            conflict_resolution: Strategy for handling conflicts

        Returns:
            Imported block

        Raises:
            ImportError: If import fails
        """
        # Auto-detect format from file extension
        if file_format is None:
            if filepath.suffix.lower() in (_EXT_YAML, ".yml"):
                file_format = "yaml"
            elif filepath.suffix.lower() == ".json":
                file_format = "json"
            else:
                raise ImportError(f"Cannot auto-detect format from extension: {filepath.suffix}")

        # Read file content
        try:
            content = filepath.read_text(encoding="utf-8")
        except Exception as e:
            raise ImportError(f"Failed to read file: {e}") from e

        return self.import_from_string(content, file_format, conflict_resolution)

    def import_batch(
        self,
        filepaths: list[Path],
        stop_on_error: bool = True,
        conflict_resolution: ConflictResolution = ConflictResolution.REJECT,
    ) -> BatchImportResult:
        """
        Import multiple blocks from files with dependency ordering.

        Args:
            filepaths: List of file paths to import
            stop_on_error: Whether to stop on first error
            conflict_resolution: Strategy for handling conflicts

        Returns:
            BatchImportResult with import status and details
        """
        result = BatchImportResult()

        blocks_to_import = self._parse_batch_files(filepaths, result, stop_on_error)
        if result.errors and stop_on_error:
            return result

        if self._has_circular_dependency(blocks_to_import):
            result.errors.append("Circular dependency detected in batch import")
            result.success = False
            return result

        ordered_blocks = self._order_by_dependencies(blocks_to_import)
        self._import_ordered_blocks(ordered_blocks, result, stop_on_error, conflict_resolution)

        if result.errors:
            result.success = False

        return result

    def _parse_batch_files(
        self,
        filepaths: list[Path],
        result: BatchImportResult,
        stop_on_error: bool,
    ) -> list[Block]:
        """
        Parse all files in a batch import into Block objects.

        Args:
            filepaths: List of file paths to parse
            result: Batch result to accumulate errors
            stop_on_error: Whether to stop on first error

        Returns:
            List of parsed Block objects
        """
        blocks: list[Block] = []
        for filepath in filepaths:
            try:
                data = self._read_and_parse_file(filepath)
                self._collect_blocks_from_data(data, blocks)
            except Exception as e:
                result.errors.append(f"Failed to parse '{filepath}': {e}")
                if stop_on_error:
                    result.success = False
                    return blocks
        return blocks

    def _read_and_parse_file(self, filepath: Path) -> Any:
        """
        Read and parse a single file based on its extension.

        Args:
            filepath: Path to file

        Returns:
            Parsed data (dict or list)
        """
        content = filepath.read_text(encoding="utf-8")
        if filepath.suffix.lower() in (_EXT_YAML, ".yml"):
            return yaml.safe_load(content)
        return json.loads(content)

    def _collect_blocks_from_data(
        self,
        data: Any,
        blocks: list[Block],
    ) -> None:
        """
        Parse block data and append valid blocks to the list.

        For list data, successfully parsed blocks before a failure are kept.
        The failure is re-raised for the caller to handle.

        Args:
            data: Parsed file data (single dict or list of dicts)
            blocks: List to append parsed blocks to

        Raises:
            ValueError: If a block in a list fails to parse
        """
        if not isinstance(data, list):
            self._convert_datetime_fields(data)
            blocks.append(Block(**data))
            return

        for block_dict in data:
            try:
                self._convert_datetime_fields(block_dict)
                blocks.append(Block(**block_dict))
            except Exception as block_error:
                block_id = block_dict.get("id", "unknown")
                raise ValueError(
                    f"Error parsing block '{block_id}': {block_error}"
                ) from block_error

    def _import_ordered_blocks(
        self,
        ordered_blocks: list[Block],
        result: BatchImportResult,
        stop_on_error: bool,
        conflict_resolution: ConflictResolution,
    ) -> None:
        """
        Import blocks in dependency order, accumulating results.

        Args:
            ordered_blocks: Blocks in dependency-sorted order
            result: Batch result to accumulate
            stop_on_error: Whether to stop on first error
            conflict_resolution: Strategy for handling conflicts
        """
        for block in ordered_blocks:
            try:
                self._import_single_block(block, conflict_resolution)
                result.imported_blocks[block.id] = block
                result.imported_count += 1
                result.import_order.append(block.id)
            except Exception as e:
                result.errors.append(f"Failed to import block '{block.id}': {e}")
                if stop_on_error:
                    result.success = False
                    break

    def _import_single_block(self, block: Block, conflict_resolution: ConflictResolution) -> None:
        """
        Import a single block with conflict checking and validation.

        Args:
            block: Block to import
            conflict_resolution: Strategy for handling conflicts

        Raises:
            ImportConflict: If block conflicts and resolution is REJECT
            ImportError: If validation fails
        """
        existing = self._get_existing_block(block.id, block.version)
        if existing and conflict_resolution == ConflictResolution.REJECT:
            raise ImportConflict(f"Block '{block.id}' version '{block.version}' already exists")

        self._run_import_validation(block)
        self._register_block(block)

    def validate_import(self, content: str, file_format: str = "yaml") -> ImportValidationResult:
        """
        Validate import without modifying registry (dry run).

        Args:
            content: Content to validate
            file_format: Import format

        Returns:
            ImportValidationResult with validation status
        """
        result = ImportValidationResult()

        try:
            # Parse content
            if file_format == "yaml":
                block_dict = yaml.safe_load(content)
            else:
                block_dict = json.loads(content)

            self._convert_datetime_fields(block_dict)
            block = Block(**block_dict)

            # Validate block
            feedback = self._validator.validate(block)
            result.block = block
            result.is_valid = feedback.is_valid

            for error in feedback.errors:
                result.errors.append(f"{error.component}: {error.message}")
            for warning in feedback.warnings:
                result.warnings.append(f"{warning.component}: {warning.message}")

        except Exception as e:
            result.is_valid = False
            result.errors.append(str(e))

        return result

    def _convert_datetime_fields(self, block_dict: dict[str, Any]) -> None:
        """
        Convert ISO datetime strings to datetime objects.

        Args:
            block_dict: Block dictionary to process
        """
        # Block-level datetime fields
        block_datetime_fields = ["publish_date", "deprecation_date"]
        for field in block_datetime_fields:
            if field in block_dict and isinstance(block_dict[field], str):
                # Parse ISO format datetime
                dt_str = block_dict[field].replace("Z", _TZ_UTC_SUFFIX)
                block_dict[field] = datetime.fromisoformat(dt_str)

        # Metadata datetime fields
        metadata_datetime_fields = ["created_at", "updated_at"]
        if "metadata" in block_dict and isinstance(block_dict["metadata"], dict):
            for field in metadata_datetime_fields:
                if field in block_dict["metadata"] and isinstance(
                    block_dict["metadata"][field], str
                ):
                    dt_str = block_dict["metadata"][field].replace("Z", _TZ_UTC_SUFFIX)
                    block_dict["metadata"][field] = datetime.fromisoformat(dt_str)

    def _get_existing_block(self, block_id: str, version: str) -> Block | None:
        """
        Get existing block from registry.

        Args:
            block_id: Block ID
            version: Block version

        Returns:
            Existing block or None
        """
        # Check internal registry
        block_key = (block_id, version)
        if block_key in self._block_registry:
            return self._block_registry[block_key]

        # Check version manager
        try:
            return self._version_manager.get(block_id, version)
        except Exception:
            return None

    def _register_block(self, block: Block) -> None:
        """
        Register an imported block.

        Args:
            block: Block to register
        """
        block_key = (block.id, block.version)
        self._block_registry[block_key] = block

        # Also register with validator and version manager if published
        if block.is_published:
            self._validator.register_block(block)
            try:
                self._version_manager.publish(block)
            except Exception:
                pass  # Block may already be published

    def _create_new_version(self, block: Block) -> Block:
        """
        Create a new version of a block by incrementing patch version.

        Args:
            block: Original block

        Returns:
            Block with incremented version
        """
        # Parse current version
        parts = block.version.split(".")
        if len(parts) == 3:
            major, minor, patch = parts
            # Increment patch version
            new_version = f"{major}.{minor}.{int(patch) + 1}"
        else:
            # Fallback: append .1
            new_version = f"{block.version}.1"

        block.version = new_version
        return block

    def _has_circular_dependency(self, blocks: list[Block]) -> bool:
        """
        Check if blocks have circular dependencies.

        Args:
            blocks: List of blocks to check

        Returns:
            True if circular dependency exists
        """
        graph = self._build_dependency_graph(blocks)
        return self._graph_has_cycle(graph)

    @staticmethod
    def _build_dependency_graph(blocks: list[Block]) -> dict[str, set[str]]:
        """
        Build a dependency graph from a list of blocks.

        Args:
            blocks: List of blocks

        Returns:
            Adjacency set mapping block ID to its dependency IDs
        """
        graph: dict[str, set[str]] = {}
        for block in blocks:
            deps = {dep.component_id for dep in block.dependencies if dep.component_type == "block"}
            graph[block.id] = deps
        return graph

    @staticmethod
    def _graph_has_cycle(graph: dict[str, set[str]]) -> bool:
        """
        Detect if a directed graph contains a cycle using DFS.

        Args:
            graph: Adjacency set representation

        Returns:
            True if a cycle exists
        """
        visited: set[str] = set()
        rec_stack: set[str] = set()

        def dfs(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)
            for neighbor in graph.get(node, set()):
                if neighbor in rec_stack:
                    return True
                if neighbor not in visited and dfs(neighbor):
                    return True
            rec_stack.discard(node)
            return False

        for node_id in graph:
            if node_id not in visited and dfs(node_id):
                return True
        return False

    def _order_by_dependencies(self, blocks: list[Block]) -> list[Block]:
        """
        Order blocks by dependencies (topological sort).

        Args:
            blocks: List of blocks to order

        Returns:
            Ordered list of blocks
        """
        block_map = {block.id: block for block in blocks}
        graph, in_degree = self._build_topo_graph(blocks, block_map)
        return self._kahn_sort(graph, in_degree, block_map)

    @staticmethod
    def _build_topo_graph(
        blocks: list[Block], block_map: dict[str, Block]
    ) -> tuple[dict[str, set[str]], dict[str, int]]:
        """
        Build adjacency list and in-degree map for topological sorting.

        Args:
            blocks: List of blocks
            block_map: Mapping of block ID to block

        Returns:
            Tuple of (adjacency set, in-degree counts)
        """
        graph: dict[str, set[str]] = {block.id: set() for block in blocks}
        in_degree: dict[str, int] = {block.id: 0 for block in blocks}

        for block in blocks:
            for dep in block.dependencies:
                if dep.component_type != "block":
                    continue
                if dep.component_id in block_map:
                    graph[dep.component_id].add(block.id)
                    in_degree[block.id] += 1

        return graph, in_degree

    @staticmethod
    def _kahn_sort(
        graph: dict[str, set[str]],
        in_degree: dict[str, int],
        block_map: dict[str, Block],
    ) -> list[Block]:
        """
        Perform Kahn's topological sort algorithm.

        Args:
            graph: Adjacency set representation
            in_degree: In-degree counts per node
            block_map: Mapping of block ID to block

        Returns:
            Topologically sorted list of blocks
        """
        queue = [bid for bid, deg in in_degree.items() if deg == 0]
        ordered: list[Block] = []

        while queue:
            block_id = queue.pop(0)
            ordered.append(block_map[block_id])
            for neighbor in graph[block_id]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        return ordered
