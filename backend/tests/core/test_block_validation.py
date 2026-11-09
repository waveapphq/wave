"""
Test Suite for Block Validation (REQ-3.1.2.4)

This test suite defines the contract for block validation before save/publication.

Validation dimensions covered:
1. Component Reference Validation - verify plugin/child block references exist
2. Version Constraint Satisfaction - ensure version constraints can be satisfied
3. Parameter Binding Validation - check type compatibility and completeness
4. Execution Flow Consistency - verify execution flow metadata is well-formed
5. Circular Dependency Detection - detect circular dependency chains
6. Block Completeness Warnings - warnings for incomplete blocks
7. Validation Feedback Reporting - comprehensive error/warning reports
8. Integration with Publishing Workflow - automatic validation before publish
"""

import pytest

from tests.conftest import create_test_block, create_test_plugin
from wavecore.core.blocks.validator import (
    BlockValidator,
    ValidationError,
    ValidationFeedback,
    ValidationIssue,
    ValidationSeverity,
)
from wavecore.models.blocks import Block, BlockChild, BlockDependency, BlockParameter, ExecutionFlow
from wavecore.models.plugins import BlockPlugin, PluginParameter


class TestComponentReferenceValidation:
    """Test validation of plugin and child block references."""

    def test_valid_plugin_reference_passes(self) -> None:
        """Valid plugin references should pass validation."""
        # Register test plugins
        validator = BlockValidator()
        plugin1 = create_test_plugin(
            id="shell-script-plugin",
            name="Shell Script Plugin",
            version="1.0.0",
            category="system",
            description="Executes shell scripts",
            parameters=[
                PluginParameter(name="command", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin1)

        # Create block with valid plugin reference
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="shell-script-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"command": "echo hello"},
                ),
            ],
        )

        # Should not raise any validation errors
        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_missing_plugin_reference_fails(self) -> None:
        """Missing plugin references should fail validation."""
        validator = BlockValidator()

        # Create block with non-existent plugin reference
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="non-existent-plugin",
                    plugin_version="1.0.0",
                    order=1,
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "plugin:non-existent-plugin"
        assert (
            feedback.errors[0].message == "Plugin 'non-existent-plugin' version '1.0.0' not found"
        )

    def test_valid_child_block_reference_passes(self) -> None:
        """Valid child block references should pass validation."""
        validator = BlockValidator()

        # Register a published child block
        child_block = create_test_block(
            id="child-block",
            name="Child Block",
            version="2.1.0",
            type="validation",
            is_published=True,
        )
        validator.register_block(child_block)

        # Create parent block with valid child reference
        parent_block = create_test_block(
            id="parent-block",
            name="Parent Block",
            version="1.0.0",
            type="action",
            child_blocks=[
                BlockChild(
                    block_id="child-block",
                    block_version="2.1.0",
                    order=1,
                ),
            ],
        )

        feedback = validator.validate(parent_block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_missing_child_block_reference_fails(self) -> None:
        """Missing child block references should fail validation."""
        validator = BlockValidator()

        block = create_test_block(
            id="parent-block",
            name="Parent Block",
            version="1.0.0",
            type="action",
            child_blocks=[
                BlockChild(
                    block_id="missing-child",
                    block_version="1.0.0",
                    order=1,
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "child_block:missing-child"
        assert feedback.errors[0].message == "Child block 'missing-child' version '1.0.0' not found"


class TestVersionConstraintSatisfaction:
    """Test validation of version constraints for dependencies."""

    def test_exact_version_constraint_satisfied(self) -> None:
        """Exact version constraints should be satisfied when version exists."""
        validator = BlockValidator()

        # Register dependency blocks
        dep_block = create_test_block(
            id="dep-block",
            name="Dependency Block",
            version="1.2.3",
            type="data",
            is_published=True,
        )
        validator.register_block(dep_block)

        # Create block with exact version dependency
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint="1.2.3"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_caret_version_constraint_satisfied(self) -> None:
        """Caret version constraints should be satisfied within major version."""
        validator = BlockValidator()

        # Register multiple versions
        for version in ["1.0.0", "1.2.3", "1.5.0", "2.0.0"]:
            dep_block = create_test_block(
                id="dep-block",
                name="Dependency Block",
                version=version,
                type="data",
                is_published=True,
            )
            validator.register_block(dep_block)

        # Create block with caret constraint
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint="^1.2.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_tilde_version_constraint_satisfied(self) -> None:
        """Tilde version constraints should be satisfied within minor version."""
        validator = BlockValidator()

        # Register multiple versions
        for version in ["1.2.0", "1.2.3", "1.2.9", "1.3.0"]:
            dep_block = create_test_block(
                id="dep-block",
                name="Dependency Block",
                version=version,
                type="data",
                is_published=True,
            )
            validator.register_block(dep_block)

        # Create block with tilde constraint
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint="~1.2.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_range_version_constraint_satisfied(self) -> None:
        """Range version constraints should be satisfied for versions >= specified."""
        validator = BlockValidator()

        # Register multiple versions
        for version in ["1.0.0", "1.5.0", "2.0.0", "3.1.0"]:
            dep_block = create_test_block(
                id="dep-block",
                name="Dependency Block",
                version=version,
                type="data",
                is_published=True,
            )
            validator.register_block(dep_block)

        # Create block with range constraint
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint=">=1.5.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_unsatisfiable_version_constraint_fails(self) -> None:
        """Unsatisfiable version constraints should fail validation."""
        validator = BlockValidator()

        # Register only old versions
        dep_block = create_test_block(
            id="dep-block",
            name="Dependency Block",
            version="1.0.0",
            type="data",
            is_published=True,
        )
        validator.register_block(dep_block)

        # Create block requiring newer version
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint="^2.0.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "dependency:dep-block"
        assert (
            feedback.errors[0].message
            == "Version constraint '^2.0.0' for block 'dep-block' cannot be satisfied"
        )


def _validate_sql_block(
    parameters: list[PluginParameter], given: dict[str, object]
) -> ValidationFeedback:
    """Validate a composite Block whose one plugin declares ``parameters``."""
    validator = BlockValidator()
    validator.register_plugin(
        create_test_plugin(
            id="sql-plugin",
            name="SQL Plugin",
            version="1.0.0",
            category="data",
            description="Executes SQL queries",
            parameters=parameters,
        )
    )
    block = create_test_block(
        id="test-block",
        name="Test Block",
        version="1.0.0",
        type="data",
        plugins=[
            BlockPlugin(plugin_id="sql-plugin", plugin_version="1.0.0", order=1, parameters=given)
        ],
    )
    return validator.validate(block)


class TestParameterBindingValidation:
    """Test validation of parameter bindings for type compatibility and completeness."""

    def test_all_required_plugin_parameters_provided(self) -> None:
        """All required plugin parameters must be provided."""
        validator = BlockValidator()

        # Register plugin with required parameters
        plugin = create_test_plugin(
            id="sql-plugin",
            name="SQL Plugin",
            version="1.0.0",
            category="data",
            description="Executes SQL queries",
            parameters=[
                PluginParameter(name="query", type="string", required=True),
                PluginParameter(name="database", type="string", required=True),
                PluginParameter(name="timeout", type="integer", required=False, default=30),
            ],
        )
        validator.register_plugin(plugin)

        # Create block providing all required parameters
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="data",
            plugins=[
                BlockPlugin(
                    plugin_id="sql-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "query": "SELECT * FROM users",
                        "database": "test_db",
                    },
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_missing_required_plugin_parameter_fails(self) -> None:
        """Missing required plugin parameters should fail validation."""
        validator = BlockValidator()

        # Register plugin with required parameters
        plugin = create_test_plugin(
            id="sql-plugin",
            name="SQL Plugin",
            version="1.0.0",
            category="data",
            description="Executes SQL queries",
            parameters=[
                PluginParameter(name="query", type="string", required=True),
                PluginParameter(name="database", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block missing required parameter
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="data",
            plugins=[
                BlockPlugin(
                    plugin_id="sql-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"query": "SELECT * FROM users"},  # Missing 'database'
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "plugin:sql-plugin:parameter:database"
        assert feedback.errors[0].message == "Required parameter 'database' is missing"

    def test_a_required_parameter_with_a_declared_default_is_not_reported(self) -> None:
        """The run fills a declared default, so leaving the parameter out is not an error."""
        feedback = _validate_sql_block(
            [
                PluginParameter(name="query", type="string", required=True),
                PluginParameter(name="database", type="string", required=True, default="main"),
            ],
            {"query": "SELECT 1"},
        )

        assert feedback.errors == []
        assert feedback.is_valid is True

    def test_a_conditionally_required_parameter_is_reported_only_when_its_condition_holds(
        self,
    ) -> None:
        parameters = [
            PluginParameter(name="mode", type="string", default="run"),
            PluginParameter(
                name="table",
                type="string",
                required_when={"field": "mode", "values": ["load"]},
            ),
        ]

        loading = _validate_sql_block(parameters, {"mode": "load"})
        running = _validate_sql_block(parameters, {"mode": "run"})

        assert [(e.component, e.message) for e in loading.errors] == [
            ("plugin:sql-plugin:parameter:table", "Required parameter 'table' is missing")
        ]
        assert running.errors == []

    def test_a_condition_on_an_unset_field_reads_its_declared_default(self) -> None:
        feedback = _validate_sql_block(
            [
                PluginParameter(name="mode", type="string", default="load"),
                PluginParameter(
                    name="table",
                    type="string",
                    required_when={"field": "mode", "values": ["load"]},
                ),
            ],
            {},
        )

        assert [(e.component, e.message) for e in feedback.errors] == [
            ("plugin:sql-plugin:parameter:table", "Required parameter 'table' is missing")
        ]

    def test_a_parameter_required_by_every_condition_is_reported_when_all_hold(self) -> None:
        parameters = [
            PluginParameter(name="mode", type="string", default="load"),
            PluginParameter(name="scoped", type="boolean", default=False),
            PluginParameter(
                name="schema",
                type="string",
                required_when_all=[
                    {"field": "mode", "values": ["load"]},
                    {"field": "scoped", "values": ["true"]},
                ],
            ),
        ]

        all_hold = _validate_sql_block(parameters, {"scoped": True})
        one_fails = _validate_sql_block(parameters, {"scoped": False})

        assert [(e.component, e.message) for e in all_hold.errors] == [
            ("plugin:sql-plugin:parameter:schema", "Required parameter 'schema' is missing")
        ]
        assert one_fails.errors == []

    def test_parameter_type_mismatch_fails(self) -> None:
        """Parameter type mismatches should fail validation."""
        validator = BlockValidator()

        # Register plugin with typed parameters
        plugin = create_test_plugin(
            id="math-plugin",
            name="Math Plugin",
            version="1.0.0",
            category="system",
            description="Performs math operations",
            parameters=[
                PluginParameter(name="value", type="integer", required=True),
                PluginParameter(name="operation", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with type mismatch
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="math-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "value": "not-a-number",  # String instead of number
                        "operation": "square",
                    },
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "plugin:math-plugin:parameter:value"
        assert (
            feedback.errors[0].message
            == "Type mismatch for parameter 'value': expected 'integer', got 'string'"
        )

    def test_block_parameter_binding_to_plugin(self) -> None:
        """Block parameters can be bound to plugin parameters via expressions."""
        validator = BlockValidator()

        # Register plugin
        plugin = create_test_plugin(
            id="echo-plugin",
            name="Echo Plugin",
            version="1.0.0",
            category="system",
            description="Echoes input",
            parameters=[
                PluginParameter(name="message", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with parameter binding
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="input_message", type="string", required=True),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="echo-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"message": "block.input_message"},  # Binding expression
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_invalid_parameter_binding_expression_fails(self) -> None:
        """Invalid parameter binding expressions should fail validation."""
        validator = BlockValidator()

        # Register plugin
        plugin = create_test_plugin(
            id="echo-plugin",
            name="Echo Plugin",
            version="1.0.0",
            category="system",
            description="Echoes input",
            parameters=[
                PluginParameter(name="message", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with invalid binding expression
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="input_message", type="string", required=True),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="echo-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"message": "block.nonexistent_param"},  # Non-existent parameter
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "plugin:echo-plugin:parameter:message"
        assert (
            feedback.errors[0].message
            == "Invalid binding expression: parameter 'nonexistent_param' not found in block"
        )

    def test_plugin_with_extra_parameters_allowed(self) -> None:
        """Test that extra parameters not defined in plugin are allowed."""
        validator = BlockValidator()

        # Register plugin with specific parameters
        plugin = create_test_plugin(
            id="test-plugin",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="required_param", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with extra parameters (not defined in plugin)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="test-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "required_param": "value",
                        "extra_param": "extra_value",  # Not defined in plugin
                        "another_extra": 123,  # Another extra parameter
                    },
                )
            ],
        )

        # Should validate successfully (extra params are allowed)
        feedback = validator.validate(block)
        assert feedback.is_valid is True

    def test_parameter_type_detection_edge_cases(self) -> None:
        """Test parameter type detection for various edge cases."""
        validator = BlockValidator()

        # Register plugin with different parameter types
        plugin = create_test_plugin(
            id="type-test-plugin",
            name="Type Test Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="table_param", type="table", required=True),
                PluginParameter(name="unknown_param", type="string", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with table type and unknown type values
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="type-test-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "table_param": [{"col1": "val1"}, ["row2"]],  # Mixed table
                        "unknown_param": None,  # Will be detected as unknown type
                    },
                )
            ],
        )

        # Validate - should fail due to type mismatch for unknown_param
        feedback = validator.validate(block)
        assert feedback.is_valid is False
        # Find the type mismatch error
        type_errors = [e for e in feedback.errors if "Type mismatch" in e.message]
        assert len(type_errors) == 1
        assert "unknown" in type_errors[0].message

    def test_type_compatibility_number_variations(self) -> None:
        """Test type compatibility for number type with integer/float."""
        validator = BlockValidator()

        # Test internal method directly
        assert validator._types_compatible("integer", "integer") is True
        assert validator._types_compatible("float", "float") is True
        assert validator._types_compatible("float", "integer") is True
        assert validator._types_compatible("string", "integer") is False
        assert validator._types_compatible("boolean", "string") is False

    def test_parameter_type_all_branches(self) -> None:
        """Test all branches of parameter type detection."""
        validator = BlockValidator()

        # Register plugin with various parameter types
        plugin = create_test_plugin(
            id="all-types-plugin",
            name="All Types Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="bool_param", type="boolean", required=True),
                PluginParameter(name="num_param", type="integer", required=True),
                PluginParameter(name="str_param", type="string", required=True),
                PluginParameter(name="array_param", type="array", required=True),
                PluginParameter(name="map_param", type="map", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create block with all parameter types (correctly typed)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="all-types-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "bool_param": True,  # boolean
                        "num_param": 42.5,  # number (float)
                        "str_param": "hello",  # string
                        "array_param": [1, 2, 3],  # array (not a table)
                        "map_param": {"key": "value"},  # map
                    },
                )
            ],
        )

        # Should validate successfully
        feedback = validator.validate(block)
        assert feedback.is_valid is True

        # Also test with integer for number type
        block2 = create_test_block(
            id="test-block-2",
            name="Test Block 2",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="all-types-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "bool_param": False,
                        "num_param": 42,  # integer (also valid for number)
                        "str_param": "",
                        "array_param": [],  # empty array
                        "map_param": {},  # empty map
                    },
                )
            ],
        )

        feedback2 = validator.validate(block2)
        assert feedback2.is_valid is True

    @staticmethod
    def _validate_list_typed(value: object) -> list[ValidationIssue]:
        """One value for a parameter declared as a list of types."""
        validator = BlockValidator()
        plugin = create_test_plugin(
            id="query-plugin",
            name="Query Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="query", type=["string", "map"], required=True),
                PluginParameter(name="limit", type=["float", "boolean"], required=True),
            ],
        )
        validator.register_plugin(plugin)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="query-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"query": value, "limit": 10},
                )
            ],
        )
        return validator.validate(block).errors

    @pytest.mark.parametrize("value", ["log.level: ERROR", {"term": {"log.level": "ERROR"}}])
    def test_a_list_typed_parameter_accepts_any_listed_type(self, value: object) -> None:
        assert self._validate_list_typed(value) == []

    def test_a_list_typed_parameter_refuses_an_unlisted_type(self) -> None:
        errors = self._validate_list_typed(42)
        assert [(error.component, error.message) for error in errors] == [
            (
                "plugin:query-plugin:parameter:query",
                "Type mismatch for parameter 'query': expected 'string' or 'map', got 'integer'",
            )
        ]


class TestExecutionFlowConsistency:
    """Test validation of execution flow metadata."""

    def test_sequential_execution_flow_valid(self) -> None:
        """Sequential execution flow should be valid."""
        validator = BlockValidator()

        # Register plugins
        for i in range(3):
            plugin = create_test_plugin(
                id=f"plugin-{i}",
                name=f"Plugin {i}",
                version="1.0.0",
                category="system",
                description=f"Test plugin {i}",
                parameters=[],
            )
            validator.register_plugin(plugin)

        # Create block with sequential execution
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(plugin_id=f"plugin-{i}", plugin_version="1.0.0", order=i + 1)
                for i in range(3)
            ],
            execution_flow=ExecutionFlow(mode="sequential"),
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_parallel_execution_flow_valid(self) -> None:
        """Parallel execution flow with valid groups should be valid."""
        validator = BlockValidator()

        # Register plugins
        for i in range(4):
            plugin = create_test_plugin(
                id=f"plugin-{i}",
                name=f"Plugin {i}",
                version="1.0.0",
                category="system",
                description=f"Test plugin {i}",
                parameters=[],
            )
            validator.register_plugin(plugin)

        # Create block with parallel execution groups
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(plugin_id=f"plugin-{i}", plugin_version="1.0.0", order=i)
                for i in range(4)
            ],
            execution_flow=ExecutionFlow(
                mode="parallel",
                parallel_groups=[[0, 1], [2, 3]],  # Two parallel groups
            ),
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_invalid_parallel_group_indices_fail(self) -> None:
        """Invalid indices in parallel groups should fail validation."""
        validator = BlockValidator()

        # Register plugins
        for i in range(2):
            plugin = create_test_plugin(
                id=f"plugin-{i}",
                name=f"Plugin {i}",
                version="1.0.0",
                category="system",
                description=f"Test plugin {i}",
                parameters=[],
            )
            validator.register_plugin(plugin)

        # Create block with invalid parallel group indices
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(plugin_id=f"plugin-{i}", plugin_version="1.0.0", order=i)
                for i in range(2)
            ],
            execution_flow=ExecutionFlow(
                mode="parallel",
                parallel_groups=[[0, 1], [2, 3]],  # Indices 2,3 don't exist
            ),
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "execution_flow:parallel_groups"
        assert (
            feedback.errors[0].message
            == "Invalid parallel group indices: [2, 3] reference non-existent components"
        )

    def test_overlapping_parallel_groups_fail(self) -> None:
        """Overlapping parallel groups should fail validation."""
        validator = BlockValidator()

        # Register plugins
        for i in range(4):
            plugin = create_test_plugin(
                id=f"plugin-{i}",
                name=f"Plugin {i}",
                version="1.0.0",
                category="system",
                description=f"Test plugin {i}",
                parameters=[],
            )
            validator.register_plugin(plugin)

        # Create block with overlapping parallel groups
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(plugin_id=f"plugin-{i}", plugin_version="1.0.0", order=i)
                for i in range(4)
            ],
            execution_flow=ExecutionFlow(
                mode="parallel",
                parallel_groups=[[0, 1, 2], [2, 3]],  # Index 2 is in both groups
            ),
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "execution_flow:parallel_groups"
        assert (
            feedback.errors[0].message
            == "Overlapping parallel groups: component 2 appears in multiple groups"
        )


class TestCircularDependencyDetection:
    """Test detection of circular dependency chains."""

    def test_no_circular_dependencies_passes(self) -> None:
        """Blocks without circular dependencies should pass validation."""
        validator = BlockValidator()

        # Register a chain of blocks A -> B -> C
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            is_published=True,
        )
        validator.register_block(block_c)

        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        feedback = validator.validate(block_a)
        assert feedback.is_valid is True
        assert len(feedback.errors) == 0

    def test_direct_circular_dependency_fails(self) -> None:
        """Direct circular dependencies (A -> A) should fail validation."""
        validator = BlockValidator()

        # Create block that depends on itself
        block = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "dependency:circular"
        assert "Circular dependency detected: block-a -> block-a" in feedback.errors[0].message

    def test_indirect_circular_dependency_fails(self) -> None:
        """Indirect circular dependencies (A -> B -> C -> A) should fail validation."""
        validator = BlockValidator()

        # Register blocks with circular dependency chain
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_c)

        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "dependency:circular"
        assert "Circular dependency detected" in feedback.errors[0].message
        assert "block-a -> block-b -> block-c -> block-a" in feedback.errors[0].message

    def test_complex_circular_dependency_with_multiple_paths(self) -> None:
        """Complex circular dependencies with multiple paths should be detected."""
        validator = BlockValidator()

        # Register blocks with multiple dependency paths
        block_d = create_test_block(
            id="block-d",
            name="Block D",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_d)

        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-d", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_c)

        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="block-d", component_type="block", version_constraint="1.0.0"
                ),
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1
        assert feedback.errors[0].component == "dependency:circular"
        assert "Circular dependency detected" in feedback.errors[0].message

    def test_circular_dependency_complex_paths_coverage(self) -> None:
        """Test circular dependency detection with complex branching paths."""
        validator = BlockValidator()

        # Create a more complex dependency graph to exercise copy operations
        # A -> B -> C
        #   \-> D -> E -> A (circular)

        block_e = create_test_block(
            id="block-e",
            name="Block E",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_e)

        block_d = create_test_block(
            id="block-d",
            name="Block D",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-e", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_d)

        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            is_published=True,
        )
        validator.register_block(block_c)

        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        # Create block A with multiple dependencies
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="block-d", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Should detect circular dependency through D -> E -> A
        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) == 1

    def test_circular_dependency_through_current_block(self) -> None:
        """Test circular dependency detection when checking current block being validated."""
        validator = BlockValidator()

        # This tests the branch where block_id == block.id in check_circular
        # and the current block has dependencies that form a cycle

        # Create blocks that will form a cycle through the block being validated
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_c)

        # Create the block being validated with a dependency that leads to a cycle
        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Should detect the circular dependency
        feedback = validator.validate(block_b)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) >= 1

    def test_circular_dependency_traversing_registered_blocks(self) -> None:
        """Test circular dependency detection traversing through registered blocks."""
        validator = BlockValidator()

        # Create a dependency chain that exercises the registered block traversal
        # A -> B -> C -> A (where B and C are already registered)

        # First register block C that depends on A (creating the cycle)
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_c)

        # Register block B that depends on C
        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        # Now validate block A that depends on B, completing the cycle
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        # Should detect circular dependency A -> B -> C -> A
        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) == 1
        assert "block-a -> block-b -> block-c -> block-a" in circular_errors[0].message

    def test_circular_dependency_multiple_versions_of_same_block(self) -> None:
        """Test circular dependency detection with multiple versions of same block."""
        validator = BlockValidator()

        # Register multiple versions of block-b, only one creates a cycle
        block_b_v1 = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="data",
            dependencies=[],  # No dependencies, no cycle
            is_published=True,
        )
        validator.register_block(block_b_v1)

        block_b_v2 = create_test_block(
            id="block-b",
            name="Block B",
            version="2.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],  # Creates cycle
            is_published=True,
        )
        validator.register_block(block_b_v2)

        # Create block A depending on block B v2
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="2.0.0"
                )
            ],
        )

        # Should detect the circular dependency through v2.0.0
        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) == 1

    def test_circular_dependency_complex_chain_through_current_block(self) -> None:
        """Test circular dependency requiring checking current block's dependencies."""
        validator = BlockValidator()

        # Create a complex dependency scenario:
        # block-d -> block-c -> block-b -> block-a (being validated)
        # block-a -> block-d (creates cycle)
        # This forces check_circular to reach block-a during traversal and check its dependencies

        # Register block-b that depends on block-a
        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_b)

        # Register block-c that depends on block-b
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_c)

        # Register block-d that depends on block-c
        block_d = create_test_block(
            id="block-d",
            name="Block D",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                )
            ],
            is_published=True,
        )
        validator.register_block(block_d)

        # Create block-a that depends on block-d, creating a cycle
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-d", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        # The traversal will be: block-a -> block-d -> block-c -> block-b -> block-a (cycle)
        # When reaching block-a during traversal, it will check block-a's dependencies recursively
        feedback = validator.validate(block_a)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) == 1
        assert "block-a" in circular_errors[0].message
        assert "block-d" in circular_errors[0].message

    def test_circular_dependency_current_block_in_traversal(self) -> None:
        """Test circular dependency where current block appears during recursive traversal."""
        validator = BlockValidator()

        # Create scenario where the current block being validated appears
        # during recursive dependency traversal. This tests the branch where
        # we need to check the current block's own dependencies

        # Register block-x that depends on block-z (the current block we'll validate later)
        block_x = create_test_block(
            id="block-x",
            name="Block X",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-z", component_type="block", version_constraint="1.0.0"
                ),
            ],
            is_published=True,
        )
        validator.register_block(block_x)

        # Register block-y (another block to ensure we have multiple dependencies)
        block_y = create_test_block(
            id="block-y",
            name="Block Y",
            version="1.0.0",
            type="data",
            dependencies=[],
            is_published=True,
        )
        validator.register_block(block_y)

        # Create block-z with multiple dependencies to ensure
        # the recursive dependency checking loop executes properly
        block_z = create_test_block(
            id="block-z",
            name="Block Z",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-x", component_type="block", version_constraint="1.0.0"
                ),  # Creates cycle
                BlockDependency(
                    component_id="block-y", component_type="block", version_constraint="1.0.0"
                ),  # Additional dependency
            ],
        )

        # When checking block-z -> block-x, it finds block-x -> block-z
        # This calls _check_circular_dependency with block_id="block-z" and current_block=block_z
        # The condition block_id == current_block.id is true, looping through dependencies
        feedback = validator.validate(block_z)
        assert feedback.is_valid is False
        circular_errors = [e for e in feedback.errors if "circular" in e.component]
        assert len(circular_errors) >= 1
        # The cycle should be detected
        assert any(
            "block-z" in error.message and "block-x" in error.message for error in circular_errors
        )

    def test_circular_dependency_current_block_method_coverage(self) -> None:
        """Test to ensure _check_circular_dependency method covers current block branch."""
        validator = BlockValidator()

        # Register a block that will create a dependency back to the current block
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                ),
            ],
            is_published=True,
        )
        validator.register_block(block_a)

        # Create the current block with a dependency that leads to itself
        current_block = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                ),  # Extra dep
            ],
        )

        # Test the method directly to ensure coverage
        has_cycle, cycle_path = validator._check_circular_dependency(
            "block-b", current_block, set(), []
        )

        # The method should detect that block-b depends on block-a which depends back on block-b
        assert has_cycle is True
        assert "block-b" in cycle_path
        assert "block-a" in cycle_path


class TestBlockCompletenessWarnings:
    """Test generation of warnings for incomplete blocks."""

    def test_empty_block_generates_warning(self) -> None:
        """Empty blocks with no plugins or child blocks should generate warnings."""
        validator = BlockValidator()

        # Create empty block
        block = create_test_block(
            id="empty-block",
            name="Empty Block",
            version="1.0.0",
            type="action",
            # No plugins or child_blocks
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True  # Warnings don't invalidate
        assert len(feedback.warnings) == 1
        assert feedback.warnings[0].component == "block:empty-block"
        assert feedback.warnings[0].message == "Block is empty (no plugins or child blocks)"

    def test_unused_block_parameters_generate_warning(self) -> None:
        """Block parameters that are never referenced should generate warnings."""
        validator = BlockValidator()

        # Register plugin
        plugin = create_test_plugin(
            id="test-plugin",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[PluginParameter(name="value", type="string", required=True)],
        )
        validator.register_plugin(plugin)

        # Create block with unused parameters
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="used_param", type="string", required=True),
                BlockParameter(name="unused_param", type="string", required=False),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="test-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={"value": "block.used_param"},  # Only uses used_param
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.warnings) == 1
        assert feedback.warnings[0].component == "parameter:unused_param"
        assert (
            feedback.warnings[0].message
            == "Parameter 'unused_param' is declared but never referenced"
        )

    def test_complete_block_no_warnings(self) -> None:
        """Complete blocks should not generate warnings."""
        validator = BlockValidator()

        # Register plugin
        plugin = create_test_plugin(
            id="test-plugin",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="value1", type="string", required=True),
                PluginParameter(name="value2", type="integer", required=True),
            ],
        )
        validator.register_plugin(plugin)

        # Create complete block with all parameters used
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="param1", type="string", required=True),
                BlockParameter(name="param2", type="integer", required=True),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="test-plugin",
                    plugin_version="1.0.0",
                    order=1,
                    parameters={
                        "value1": "block.param1",
                        "value2": "block.param2",
                    },
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True
        assert len(feedback.warnings) == 0


class TestValidationFeedbackReporting:
    """Test comprehensive validation feedback reporting."""

    def test_multiple_errors_accumulated(self) -> None:
        """Multiple validation errors should be accumulated in a single report."""
        validator = BlockValidator()

        # Create block with multiple issues
        block = create_test_block(
            id="problematic-block",
            name="Problematic Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="missing-plugin-1",
                    plugin_version="1.0.0",
                    order=1,
                ),
                BlockPlugin(
                    plugin_id="missing-plugin-2",
                    plugin_version="2.0.0",
                    order=2,
                ),
            ],
            child_blocks=[
                BlockChild(
                    block_id="missing-child",
                    block_version="1.0.0",
                    order=1,
                ),
            ],
            dependencies=[
                BlockDependency(
                    component_id="missing-dep", component_type="block", version_constraint="^1.0.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 4  # 2 plugins, 1 child, 1 dependency

        # Check all error components are different
        components = [error.component for error in feedback.errors]
        assert "plugin:missing-plugin-1" in components
        assert "plugin:missing-plugin-2" in components
        assert "child_block:missing-child" in components
        assert "dependency:missing-dep" in components

    def test_errors_and_warnings_separated(self) -> None:
        """Errors and warnings should be clearly separated in feedback."""
        validator = BlockValidator()

        # Create block with both errors and warnings
        block = create_test_block(
            id="mixed-issues-block",
            name="Mixed Issues Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="unused_param", type="string", required=False),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="missing-plugin",
                    plugin_version="1.0.0",
                    order=1,
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert len(feedback.errors) == 1  # Missing plugin
        assert len(feedback.warnings) == 1  # Unused parameter

        # Check severity levels
        assert all(error.severity == ValidationSeverity.ERROR for error in feedback.errors)
        assert all(warning.severity == ValidationSeverity.WARNING for warning in feedback.warnings)

    def test_feedback_includes_actionable_guidance(self) -> None:
        """Validation feedback should include actionable guidance for resolution."""
        validator = BlockValidator()

        # Register a deprecated block
        dep_block = create_test_block(
            id="dep-block",
            name="Deprecated Block",
            version="1.0.0",
            type="data",
            is_deprecated=True,
            deprecation_reason="Use version 2.0.0 instead",
            replacement_version="2.0.0",
            is_published=True,
        )
        validator.register_block(dep_block)

        # Create block using deprecated dependency
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="dep-block", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is True  # Deprecated dependencies are warnings
        assert len(feedback.warnings) == 1
        assert feedback.warnings[0].component == "dependency:dep-block"
        assert "deprecated" in feedback.warnings[0].message.lower()
        assert "2.0.0" in feedback.warnings[0].message  # Includes replacement version

    def test_validation_summary_generation(self) -> None:
        """Validation should generate a clear summary of all issues."""
        validator = BlockValidator()

        # Create block with multiple issues
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            # Empty block
        )

        feedback = validator.validate(block)
        summary = feedback.get_summary()

        assert "valid" in summary or "invalid" in summary
        assert str(len(feedback.errors)) in summary or "0 errors" in summary
        assert str(len(feedback.warnings)) in summary or "1 warning" in summary

    def test_validation_issue_repr(self) -> None:
        """Test ValidationIssue string representation."""
        issue = ValidationIssue(ValidationSeverity.ERROR, "test-component", "Test error message")
        repr_str = repr(issue)
        assert "error" in repr_str
        assert "test-component" in repr_str
        assert "Test error message" in repr_str


class TestIntegrationWithPublishingWorkflow:
    """Test automatic validation during block publishing."""

    def test_valid_block_publishes_successfully(self) -> None:
        """Valid blocks should publish successfully after validation."""
        validator = BlockValidator()

        # Create valid block
        block = create_test_block(
            id="valid-block",
            name="Valid Block",
            version="1.0.0",
            type="action",
        )

        # Publish should validate first
        result = validator.publish(block)
        assert result.is_published is True
        assert result.publish_date is not None

    def test_invalid_block_fails_to_publish(self) -> None:
        """Invalid blocks should fail to publish with validation errors."""
        validator = BlockValidator()

        # Create invalid block with non-existent dependencies
        block = create_test_block(
            id="invalid-block",
            name="Invalid Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="non-existent", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Publish should fail with validation error
        with pytest.raises(ValidationError) as exc_info:
            validator.publish(block)

        assert "Validation failed" in str(exc_info.value)
        assert "non-existent" in str(exc_info.value)

    def test_publish_with_force_flag_bypasses_warnings(self) -> None:
        """Publishing with force flag should bypass warnings but not errors."""
        validator = BlockValidator()

        # Create block with warnings only
        block = create_test_block(
            id="warning-block",
            name="Warning Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="unused", type="string", required=False),
            ],
            # Empty block will generate warning
        )

        # Publish with force flag should succeed despite warnings
        result = validator.publish(block, _force=True)
        assert result.is_published is True

        # Create block with errors
        error_block = create_test_block(
            id="error-block",
            name="Error Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="missing", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Force flag should not bypass errors
        with pytest.raises(ValidationError):
            validator.publish(error_block, _force=True)


class TestValidationExtensibility:
    """Test the modular validation architecture for extensibility."""

    def test_custom_validation_rule_registration(self) -> None:
        """Custom validation rules can be registered and executed."""
        validator = BlockValidator()

        # Define custom validation rule
        def validate_naming_convention(block: Block) -> list[ValidationIssue]:
            """Custom rule: block IDs must be kebab-case."""
            issues = []
            if "_" in block.id or block.id != block.id.lower():
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        component=f"block:{block.id}",
                        message="Block ID must be kebab-case (lowercase with hyphens)",
                    )
                )
            return issues

        # Register custom validation
        validator.register_custom_validation(validate_naming_convention)

        # Test with invalid naming
        block = create_test_block(
            id="Invalid_Block_ID",
            name="Test Block",
            version="1.0.0",
            type="action",
        )

        feedback = validator.validate(block)
        assert feedback.is_valid is False
        assert any("kebab-case" in error.message for error in feedback.errors)

        # Test with valid naming
        valid_block = create_test_block(
            id="valid-block-id",
            name="Valid Block",
            version="1.0.0",
            type="action",
        )

        feedback = validator.validate(valid_block)
        assert feedback.is_valid is True

    def test_validation_dimension_independence(self) -> None:
        """Validation dimensions should execute independently."""
        validator = BlockValidator()

        # Create block with issues in multiple dimensions
        block = create_test_block(
            id="multi-issue-block",
            name="Multi Issue Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(plugin_id="missing-plugin", plugin_version="1.0.0", order=1),
            ],
            dependencies=[
                BlockDependency(
                    component_id="circular-dep", component_type="block", version_constraint="1.0.0"
                ),
            ],
            execution_flow=ExecutionFlow(
                mode="parallel",
                parallel_groups=[[0, 1]],  # Invalid indices
            ),
        )

        # Register circular dependency
        circular_block = create_test_block(
            id="circular-dep",
            name="Circular Dep",
            version="1.0.0",
            type="data",
            dependencies=[
                BlockDependency(
                    component_id="multi-issue-block",
                    component_type="block",
                    version_constraint="1.0.0",
                ),
            ],
            is_published=True,
        )
        validator.register_block(circular_block)

        feedback = validator.validate(block)
        assert feedback.is_valid is False

        # Should have errors from multiple validation dimensions
        error_components = [error.component for error in feedback.errors]
        assert any("plugin" in comp for comp in error_components)  # Component validation
        assert any("circular" in comp for comp in error_components)  # Circular dependency
        assert any("execution_flow" in comp for comp in error_components)  # Flow consistency

    def test_validation_performance_metrics(self) -> None:
        """Validation should track performance metrics for optimization."""
        validator = BlockValidator()

        # Create complex block for performance testing
        block = create_test_block(
            id="perf-test-block",
            name="Performance Test Block",
            version="1.0.0",
            type="action",
        )

        # Validate and check metrics
        feedback = validator.validate(block)

        # Check that performance metrics are available
        assert hasattr(feedback, "validation_time_ms")
        assert feedback.validation_time_ms >= 0

        # Check per-dimension metrics
        assert hasattr(feedback, "dimension_times")
        assert "component_reference" in feedback.dimension_times
        assert "version_constraint" in feedback.dimension_times
        assert "parameter_binding" in feedback.dimension_times
        assert "execution_flow" in feedback.dimension_times
        assert "circular_dependency" in feedback.dimension_times
        assert "completeness" in feedback.dimension_times

    def test_already_published_block_registration(self) -> None:
        """Test registering an already published block doesn't raise error."""
        validator = BlockValidator()

        # Create and register a published block twice
        block = create_test_block(
            id="test-block", name="Test Block", version="1.0.0", type="action", is_published=True
        )

        # First registration should work
        validator.register_block(block)

        # Second registration should handle ValueError gracefully
        validator.register_block(block)  # Should not raise

    def test_custom_validation_with_warnings(self) -> None:
        """Test custom validation that returns warnings."""
        validator = BlockValidator()

        # Define custom validation that returns warnings
        def validate_with_warnings(block: Block) -> list[ValidationIssue]:
            """Custom validation that generates warnings."""
            issues = []
            if "test" in block.id.lower():
                issues.append(
                    ValidationIssue(
                        ValidationSeverity.WARNING,
                        f"block:{block.id}",
                        "Block ID contains 'test' which may not be suitable for production",
                    )
                )
            return issues

        # Register custom validation
        validator.register_custom_validation(validate_with_warnings)

        # Create block that triggers warning
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],  # Add an empty plugin to avoid empty block warning
        )

        # Validate - should have warning from custom validation
        feedback = validator.validate(block)
        assert feedback.is_valid is True
        warnings = [w for w in feedback.warnings if "production" in w.message]
        assert len(warnings) == 1


class TestBlockValidatorEdgeCases:
    """Test edge cases for complete coverage, including line 502."""

    def test_circular_dependency_unregistered_block_with_plugins(self) -> None:
        """
        Test circular dependency when validating an unregistered block with plugin deps.

        This specifically targets line 502 in block_validator.py which is only hit when:
        1. Validating an unregistered block
        2. That block has plugin dependencies
        3. During circular dependency checking, we recurse back to the same block ID
        """
        validator = BlockValidator()

        # Register block-b that depends on block-a
        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )
        validator.register_block(block_b)
        validator._version_manager.publish(block_b)

        # Create block-a (NOT registered) with both plugin and block dependencies
        # When checking for cycles, it will recurse back to block-a and need to
        # skip the plugin dependencies (line 502)
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                # These plugin dependencies will trigger line 502
                BlockDependency(
                    component_id="auth-plugin", component_type="plugin", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="cache-plugin", component_type="plugin", version_constraint="2.0.0"
                ),
                # This creates the circular dependency
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Validate the unregistered block
        result = validator.validate(block_a)

        # Should detect circular dependency
        assert result.is_valid is False
        assert any("circular" in str(e.message).lower() for e in result.errors)

    def test_line_502_direct_call(self) -> None:
        """
        Direct test to cover line 502.

        This line is only hit during _check_circular_dependency when:
        1. block_id == current_block.id (line 498 condition)
        2. current_block has plugin dependencies that need to be skipped
        3. The block is not found in self._blocks registry
        """
        validator = BlockValidator()

        # Create a block with plugin dependencies first, then a block dependency
        current_block = create_test_block(
            id="target-block",
            name="Target Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="some-plugin",
                    component_type="plugin",  # This will trigger line 502
                    version_constraint="1.0.0",
                ),
                BlockDependency(
                    component_id="other-block", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Call the private method directly with conditions that trigger line 502
        # block_id matches current_block.id and block is not in registry
        visited = set()
        path = []
        has_cycle, cycle_path = validator._check_circular_dependency(
            "target-block",  # block_id == current_block.id
            current_block,  # current_block with plugin deps
            visited,
            path,
        )

        # The function should return False (no cycle) since other-block doesn't exist
        assert has_cycle is False
        assert cycle_path == []


class TestParameterTypeDetectionDecimal:
    """A Decimal parameter value is detected as the "float" type (REQ-3.1.3.14)."""

    def test_decimal_detected_as_float(self) -> None:
        from decimal import Decimal

        validator = BlockValidator()
        assert validator._get_parameter_type(Decimal("1.5")) == "float"

    def test_decimal_is_compatible_with_float_parameter(self) -> None:
        from decimal import Decimal

        validator = BlockValidator()
        actual = validator._get_parameter_type(Decimal("1.5"))
        assert validator._types_compatible("float", actual) is True
