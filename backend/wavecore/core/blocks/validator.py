"""
Block Validator Implementation (REQ-3.1.2.4)

This module provides comprehensive validation for blocks before save/publication.
It validates structural integrity, references, dependencies, and completeness.

Validation dimensions:
1. Component Reference Validation - verify plugin/child block references exist
2. Version Constraint Satisfaction - ensure version constraints can be satisfied
3. Parameter Binding Validation - check type compatibility and completeness
4. Execution Flow Consistency - verify execution flow metadata is well-formed
5. Circular Dependency Detection - detect circular dependency chains
6. Block Completeness Warnings - warnings for incomplete blocks
7. Validation Feedback Reporting - comprehensive error/warning reports
8. Integration with Publishing Workflow - automatic validation before publish
"""

import time
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.core.execution.field_checks import required_findings
from wavecore.models.blocks import Block
from wavecore.models.plugins import ParamType, Plugin

_PREFIX_BLOCK = "block."


class ValidationSeverity(Enum):
    """Severity levels for validation issues."""

    ERROR = "error"  # Blocks execution
    WARNING = "warning"  # Doesn't block execution


class ValidationIssue:
    """Represents a single validation issue."""

    def __init__(self, severity: ValidationSeverity, component: str, message: str) -> None:
        """
        Initialize a validation issue.

        Args:
            severity: Issue severity level
            component: Component identifier where issue occurred
            message: Human-readable description of the issue
        """
        self.severity = severity
        self.component = component
        self.message = message

    def __repr__(self) -> str:
        """String representation of the issue."""
        return f"ValidationIssue({self.severity.value}, {self.component}: {self.message})"


class ValidationFeedback:
    """Comprehensive validation feedback containing errors and warnings."""

    def __init__(self) -> None:
        """Initialize empty feedback."""
        self.errors: list[ValidationIssue] = []
        self.warnings: list[ValidationIssue] = []
        self.is_valid = True
        self.validation_time_ms = 0.0
        self.dimension_times: dict[str, float] = {}

    def add_error(self, component: str, message: str) -> None:
        """Add an error to the feedback."""
        self.errors.append(ValidationIssue(ValidationSeverity.ERROR, component, message))
        self.is_valid = False

    def add_warning(self, component: str, message: str) -> None:
        """Add a warning to the feedback."""
        self.warnings.append(ValidationIssue(ValidationSeverity.WARNING, component, message))

    def get_summary(self) -> str:
        """
        Generate a summary of validation results.

        Returns:
            Human-readable summary of validation feedback
        """
        status = "valid" if self.is_valid else "invalid"
        error_count = f"{len(self.errors)} error{'s' if len(self.errors) != 1 else ''}"
        warning_count = f"{len(self.warnings)} warning{'s' if len(self.warnings) != 1 else ''}"
        return f"Validation {status}: {error_count}, {warning_count}"


class ValidationError(Exception):
    """Exception raised when validation fails during publishing."""

    pass


class BlockValidator:
    """
    Validates blocks for structural integrity and correctness (REQ-3.1.2.4).

    Provides comprehensive validation across multiple dimensions including
    component references, version constraints, parameter bindings, execution flow,
    circular dependencies, and completeness checks.
    """

    def __init__(self) -> None:
        """Initialize the block validator."""
        # Registries for validation
        self._plugins: dict[tuple[str, str], Plugin] = {}  # (id, version) -> Plugin
        self._blocks: dict[tuple[str, str], Block] = {}  # (id, version) -> Block
        self._custom_validations: list[Callable[[Block], list[ValidationIssue]]] = []

        # Use block version manager for version constraint resolution
        self._version_manager = BlockVersionManager()

    def register_plugin(self, plugin: Plugin) -> None:
        """
        Register a plugin for reference validation.

        Args:
            plugin: Plugin to register
        """
        key = (plugin.id, plugin.version)
        self._plugins[key] = plugin

    def register_block(self, block: Block) -> None:
        """
        Register a published block for reference validation.

        Args:
            block: Published block to register
        """
        key = (block.id, block.version)
        self._blocks[key] = block

        # Also register with version manager for constraint resolution
        if block.is_published:
            try:
                self._version_manager.publish(deepcopy(block))
            except ValueError:
                # Block already published in version manager
                pass

    def register_custom_validation(
        self, validation_func: Callable[[Block], list[ValidationIssue]]
    ) -> None:
        """
        Register a custom validation function.

        Args:
            validation_func: Function that validates a block and returns issues
        """
        self._custom_validations.append(validation_func)

    def validate(self, block: Block) -> ValidationFeedback:
        """
        Perform comprehensive validation of a block.

        Args:
            block: Block to validate

        Returns:
            ValidationFeedback containing all errors and warnings
        """
        start_time = time.time()
        feedback = ValidationFeedback()

        # Execute validation dimensions
        dimensions = [
            ("component_reference", self._validate_component_references),
            ("version_constraint", self._validate_version_constraints),
            ("parameter_binding", self._validate_parameter_bindings),
            ("execution_flow", self._validate_execution_flow),
            ("circular_dependency", self._validate_circular_dependencies),
            ("completeness", self._validate_completeness),
        ]

        for dimension_name, validation_func in dimensions:
            dim_start = time.time()
            issues = validation_func(block)

            for issue in issues:
                if issue.severity == ValidationSeverity.ERROR:
                    feedback.add_error(issue.component, issue.message)
                else:
                    feedback.add_warning(issue.component, issue.message)

            feedback.dimension_times[dimension_name] = (time.time() - dim_start) * 1000

        # Execute custom validations
        for custom_validation in self._custom_validations:
            issues = custom_validation(block)
            for issue in issues:
                if issue.severity == ValidationSeverity.ERROR:
                    feedback.add_error(issue.component, issue.message)
                else:
                    feedback.add_warning(issue.component, issue.message)

        feedback.validation_time_ms = (time.time() - start_time) * 1000
        return feedback

    def publish(self, block: Block, _force: bool = False) -> Block:
        """
        Publish a block after validation.

        Args:
            block: Block to publish
            _force: If True, publish despite warnings (but not errors)

        Returns:
            Published block

        Raises:
            ValidationError: If validation fails with errors
        """
        # Validate block first
        feedback = self.validate(block)

        # Check for errors (cannot be bypassed)
        if not feedback.is_valid:
            error_messages = [f"{e.component}: {e.message}" for e in feedback.errors]
            raise ValidationError(f"Validation failed: {'; '.join(error_messages)}")

        # Create published copy
        published_block = deepcopy(block)
        published_block.is_published = True
        if published_block.publish_date is None:
            published_block.publish_date = datetime.now(UTC)

        # Register the published block
        self.register_block(published_block)

        return published_block

    def _validate_component_references(self, block: Block) -> list[ValidationIssue]:
        """
        Validate that all plugin and child block references exist.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []

        # Validate plugin references
        for plugin_ref in block.plugins:
            key = (plugin_ref.plugin_id, plugin_ref.plugin_version)
            if key not in self._plugins:
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.ERROR,
                        f"plugin:{plugin_ref.plugin_id}",
                        f"Plugin '{plugin_ref.plugin_id}' version "
                        f"'{plugin_ref.plugin_version}' not found",
                    )
                )

        # Validate child block references
        for child_ref in block.child_blocks:
            key = (child_ref.block_id, child_ref.block_version)
            if key not in self._blocks:
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.ERROR,
                        f"child_block:{child_ref.block_id}",
                        f"Child block '{child_ref.block_id}' version "
                        f"'{child_ref.block_version}' not found",
                    )
                )

        return issues

    def _validate_version_constraints(self, block: Block) -> list[ValidationIssue]:
        """
        Validate that all version constraints can be satisfied.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []

        for dependency in block.dependencies:
            # Only validate block dependencies (skip plugin dependencies)
            if dependency.component_type != "block":
                continue

            # Skip self-dependencies (handled by circular dependency check)
            if dependency.component_id == block.id:
                continue

            # First check if any non-deprecated version satisfies the constraint
            resolved = self._version_manager.resolve_version(
                dependency.component_id, dependency.version_constraint, include_deprecated=False
            )

            if resolved is None:
                # Check if a deprecated version would satisfy it
                resolved_with_deprecated = self._version_manager.resolve_version(
                    dependency.component_id, dependency.version_constraint, include_deprecated=True
                )

                if resolved_with_deprecated is not None:
                    # The dependency can only be satisfied by a deprecated version - warn
                    replacement = (
                        f"Use version {resolved_with_deprecated.replacement_version} instead"
                        if resolved_with_deprecated.replacement_version
                        else ""
                    )
                    issues.append(
                        ValidationIssue(
                            ValidationSeverity.WARNING,
                            f"dependency:{dependency.component_id}",
                            f"Dependency '{dependency.component_id}' version "
                            f"'{resolved_with_deprecated.version}' is deprecated. "
                            f"{replacement}".strip(),
                        )
                    )
                else:
                    # No version at all can satisfy the constraint - error
                    issues.append(
                        ValidationIssue(
                            ValidationSeverity.ERROR,
                            f"dependency:{dependency.component_id}",
                            f"Version constraint '{dependency.version_constraint}' for block "
                            f"'{dependency.component_id}' cannot be satisfied",
                        )
                    )

        return issues

    def _validate_parameter_bindings(self, block: Block) -> list[ValidationIssue]:
        """
        Validate parameter bindings for type compatibility and completeness.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []
        block_param_names = {param.name for param in block.parameters}

        for plugin_ref in block.plugins:
            plugin_key = (plugin_ref.plugin_id, plugin_ref.plugin_version)
            if plugin_key not in self._plugins:
                continue  # Already reported in component validation

            plugin = self._plugins[plugin_key]
            self._check_required_params(plugin_ref, plugin, issues)
            self._check_param_types(plugin_ref, plugin, block_param_names, issues)

        return issues

    def _check_required_params(
        self, plugin_ref: Any, plugin: Plugin, issues: list[ValidationIssue]
    ) -> None:
        """
        Check that all required plugin parameters are provided.

        Args:
            plugin_ref: Plugin reference with bound parameters
            plugin: Plugin definition with parameter specs
            issues: List to append issues to
        """
        for finding in required_findings(
            plugin.parameters, plugin_ref.parameters, expression_fields=()
        ):
            # An empty value is the plugin's own concern here; only a missing one is reported.
            if finding.code != "REQUIRED_PARAM_MISSING":
                continue
            issues.append(
                ValidationIssue(
                    ValidationSeverity.ERROR,
                    f"plugin:{plugin_ref.plugin_id}:parameter:{finding.field}",
                    finding.message,
                )
            )

    def _check_param_types(
        self,
        plugin_ref: Any,
        plugin: Plugin,
        block_param_names: set[str],
        issues: list[ValidationIssue],
    ) -> None:
        """
        Check parameter types and binding expressions for a plugin reference.

        Args:
            plugin_ref: Plugin reference with bound parameters
            plugin: Plugin definition with parameter specs
            block_param_names: Set of declared block parameter names
            issues: List to append issues to
        """
        for param_name, param_value in plugin_ref.parameters.items():
            param_def = next((p for p in plugin.parameters if p.name == param_name), None)
            if param_def is None:
                continue  # Extra parameters are allowed

            if self._is_block_binding(param_value):
                self._validate_binding_reference(
                    plugin_ref.plugin_id, param_name, param_value, block_param_names, issues
                )
                continue

            self._validate_type_compatibility(
                plugin_ref.plugin_id, param_name, param_value, param_def.type, issues
            )

    @staticmethod
    def _is_block_binding(value: Any) -> bool:
        """Check if a parameter value is a block binding expression."""
        return isinstance(value, str) and value.startswith(_PREFIX_BLOCK)

    @staticmethod
    def _validate_binding_reference(
        plugin_id: str,
        param_name: str,
        param_value: str,
        block_param_names: set[str],
        issues: list[ValidationIssue],
    ) -> None:
        """
        Validate that a block binding references an existing block parameter.

        Args:
            plugin_id: Plugin identifier for error reporting
            param_name: Parameter name for error reporting
            param_value: Binding expression value
            block_param_names: Set of declared block parameter names
            issues: List to append issues to
        """
        bound_param = param_value[len(_PREFIX_BLOCK) :]
        if bound_param and bound_param not in block_param_names:
            issues.append(
                ValidationIssue(
                    ValidationSeverity.ERROR,
                    f"plugin:{plugin_id}:parameter:{param_name}",
                    f"Invalid binding expression: parameter '{bound_param}' not found in block",
                )
            )

    def _validate_type_compatibility(
        self,
        plugin_id: str,
        param_name: str,
        param_value: Any,
        expected_type: ParamType | list[ParamType],
        issues: list[ValidationIssue],
    ) -> None:
        """
        Validate type compatibility between a parameter value and its definition.

        Args:
            plugin_id: Plugin identifier for error reporting
            param_name: Parameter name for error reporting
            param_value: Actual parameter value
            expected_type: Expected type, or the list of types any of which is accepted
            issues: List to append issues to
        """
        expected_types = expected_type if isinstance(expected_type, list) else [expected_type]
        actual_type = self._get_parameter_type(param_value)
        if not any(self._types_compatible(item, actual_type) for item in expected_types):
            expected_label = " or ".join(f"'{item}'" for item in expected_types)
            issues.append(
                ValidationIssue(
                    ValidationSeverity.ERROR,
                    f"plugin:{plugin_id}:parameter:{param_name}",
                    f"Type mismatch for parameter '{param_name}': "
                    f"expected {expected_label}, got '{actual_type}'",
                )
            )

    def _validate_execution_flow(self, block: Block) -> list[ValidationIssue]:
        """
        Validate execution flow consistency.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        if block.execution_flow is None:
            return []

        if block.execution_flow.mode != "parallel" or not block.execution_flow.parallel_groups:
            return []

        total_components = len(block.plugins) + len(block.child_blocks)
        return self._validate_parallel_groups(
            block.execution_flow.parallel_groups, total_components
        )

    @staticmethod
    def _validate_parallel_groups(
        parallel_groups: list[list[int]], total_components: int
    ) -> list[ValidationIssue]:
        """
        Validate parallel group indices for validity and overlap.

        Args:
            parallel_groups: List of index groups
            total_components: Total number of components in the block

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []
        seen_indices: set[int] = set()

        for group in parallel_groups:
            invalid_indices = [i for i in group if i >= total_components]
            if invalid_indices:
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.ERROR,
                        "execution_flow:parallel_groups",
                        f"Invalid parallel group indices: {invalid_indices} "
                        f"reference non-existent components",
                    )
                )
                continue

            for index in group:
                if index in seen_indices:
                    issues.append(
                        ValidationIssue(
                            ValidationSeverity.ERROR,
                            "execution_flow:parallel_groups",
                            f"Overlapping parallel groups: component {index} "
                            f"appears in multiple groups",
                        )
                    )
                    break
                seen_indices.add(index)

        return issues

    def _check_circular_dependency(
        self, block_id: str, current_block: Block, visited: set[str], path: list[str]
    ) -> tuple[bool, list[str]]:
        """
        Recursively check for circular dependencies.

        Args:
            block_id: ID of block to check
            current_block: The block currently being validated
            visited: Set of already visited block IDs
            path: Current path of block IDs

        Returns:
            Tuple of (has_cycle, cycle_path)
        """
        if block_id in visited:
            cycle_start = path.index(block_id)
            return True, path[cycle_start:] + [block_id]

        visited.add(block_id)
        path.append(block_id)

        deps = self._collect_block_dependencies(block_id, current_block)
        return self._check_deps_for_cycles(deps, current_block, visited, path)

    def _collect_block_dependencies(self, block_id: str, current_block: Block) -> list[str]:
        """
        Collect all block-type dependency IDs for a given block ID.

        Checks both the registered block registry and the current block being validated.

        Args:
            block_id: Block ID to collect dependencies for
            current_block: The block currently being validated

        Returns:
            List of dependency component IDs
        """
        dep_ids: list[str] = []

        for block_key, block_obj in self._blocks.items():
            if block_key[0] == block_id:
                dep_ids.extend(
                    dep.component_id
                    for dep in block_obj.dependencies
                    if dep.component_type == "block"
                )

        if block_id == current_block.id:
            dep_ids.extend(
                dep.component_id
                for dep in current_block.dependencies
                if dep.component_type == "block"
            )

        return dep_ids

    def _check_deps_for_cycles(
        self,
        dep_ids: list[str],
        current_block: Block,
        visited: set[str],
        path: list[str],
    ) -> tuple[bool, list[str]]:
        """
        Check a list of dependency IDs for circular references.

        Args:
            dep_ids: Dependency component IDs to check
            current_block: The block currently being validated
            visited: Set of already visited block IDs
            path: Current path of block IDs

        Returns:
            Tuple of (has_cycle, cycle_path)
        """
        for dep_id in dep_ids:
            has_cycle, cycle_path = self._check_circular_dependency(
                dep_id, current_block, visited.copy(), path.copy()
            )
            if has_cycle:
                return has_cycle, cycle_path
        return False, []

    def _validate_circular_dependencies(self, block: Block) -> list[ValidationIssue]:
        """
        Detect circular dependency chains.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []

        # Check each dependency
        for dependency in block.dependencies:
            # Only check block dependencies for cycles (plugin dependencies can't create cycles)
            if dependency.component_type != "block":
                continue

            # Direct self-dependency
            if dependency.component_id == block.id:
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.ERROR,
                        "dependency:circular",
                        f"Circular dependency detected: {block.id} -> {block.id}",
                    )
                )
                continue

            # Indirect circular dependencies
            has_cycle, cycle_path = self._check_circular_dependency(
                dependency.component_id, block, {block.id}, [block.id]
            )
            if has_cycle:
                cycle_str = " -> ".join(cycle_path)
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.ERROR,
                        "dependency:circular",
                        f"Circular dependency detected: {cycle_str}",
                    )
                )
                break  # Only report first cycle found

        return issues

    def _validate_completeness(self, block: Block) -> list[ValidationIssue]:
        """
        Generate warnings for incomplete blocks.

        Args:
            block: Block to validate

        Returns:
            List of validation issues found
        """
        issues: list[ValidationIssue] = []
        self._check_empty_block(block, issues)
        self._check_unused_parameters(block, issues)
        return issues

    @staticmethod
    def _check_empty_block(block: Block, issues: list[ValidationIssue]) -> None:
        """
        Check if a block is empty (no plugins, child blocks, or dependencies).

        Args:
            block: Block to check
            issues: List to append warnings to
        """
        if block.plugins or block.child_blocks or block.dependencies:
            return
        issues.append(
            ValidationIssue(
                ValidationSeverity.WARNING,
                f"block:{block.id}",
                "Block is empty (no plugins or child blocks)",
            )
        )

    @staticmethod
    def _collect_used_params(block: Block) -> set[str]:
        """
        Collect parameter names used in plugin bindings.

        Args:
            block: Block to scan

        Returns:
            Set of parameter names referenced in bindings
        """
        used: set[str] = set()
        for plugin_ref in block.plugins:
            for param_value in plugin_ref.parameters.values():
                if isinstance(param_value, str) and param_value.startswith(_PREFIX_BLOCK):
                    bound_param = param_value[len(_PREFIX_BLOCK) :]
                    if bound_param:
                        used.add(bound_param)
        return used

    @staticmethod
    def _check_unused_parameters(block: Block, issues: list[ValidationIssue]) -> None:
        """
        Check for declared but unused block parameters.

        Args:
            block: Block to check
            issues: List to append warnings to
        """
        if not block.parameters:
            return

        used_params = BlockValidator._collect_used_params(block)
        for param in block.parameters:
            if param.name not in used_params:
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.WARNING,
                        f"parameter:{param.name}",
                        f"Parameter '{param.name}' is declared but never referenced",
                    )
                )

    def _get_parameter_type(self, value: Any) -> str:
        """
        Determine the type of a parameter value.

        Args:
            value: Parameter value

        Returns:
            Type name as string
        """
        if isinstance(value, bool):
            return "boolean"
        elif isinstance(value, int):
            return "integer"
        elif isinstance(value, float | Decimal):
            return "float"
        elif isinstance(value, str):
            return "string"
        elif isinstance(value, list):
            # Check if it's a table (list of dicts/lists)
            if value and all(isinstance(item, dict | list) for item in value):
                return "table"
            return "array"
        elif isinstance(value, dict):
            return "map"
        else:
            return "unknown"

    def _types_compatible(self, expected: str, actual: str) -> bool:
        """
        Check if two types are compatible.

        Args:
            expected: Expected type
            actual: Actual type

        Returns:
            True if types are compatible
        """
        if expected == actual:
            return True

        # Special cases for type compatibility
        # Float parameters accept integer values
        if expected == "float" and actual == "integer":
            return True
        # Integer parameters accept float values (truncated at runtime)
        if expected == "integer" and actual == "float":
            return True

        return False
