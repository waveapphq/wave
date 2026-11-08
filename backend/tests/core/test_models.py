"""
Comprehensive unit tests for WAVE data models.

This module tests all Pydantic data models according to these requirements:
- REQ-6.2.1: Plugin schema with parameters
- REQ-6.2.2: Block schema with dependencies
- REQ-6.3.1: Semantic versioning for components
- REQ-6.3.2: Version pinning capability
- REQ-6.3.3: Dependency resolution
- REQ-6.3.4: Version compatibility checks
"""

import pytest
from pydantic import ValidationError

from tests.conftest import create_test_block, create_test_plugin


class TestPluginModel:
    """Test suite for Plugin model (REQ-6.2.1)."""

    def test_plugin_minimal_valid(self):
        """Test plugin creation with minimal required fields."""

        plugin = create_test_plugin(
            id="shell-script",
            name="Shell Script",
            version="1.0.0",
            category="system",
            description="Execute shell scripts",
            parameters=[],
        )

        assert plugin.id == "shell-script"
        assert plugin.name == "Shell Script"
        assert plugin.version == "1.0.0"
        assert plugin.category == "system"

    def test_plugin_with_parameters(self):
        """Test plugin with parameter definitions."""
        from wavecore.models.plugins import PluginParameter

        plugin = create_test_plugin(
            id="http-client",
            name="HTTP Client",
            version="1.0.0",
            category="network",
            description="Make HTTP requests",
            parameters=[
                PluginParameter(
                    name="url", type="string", required=True, description="Request URL"
                ),
                PluginParameter(
                    name="method",
                    type="string",
                    required=False,
                    default="GET",
                    description="HTTP method",
                ),
            ],
        )

        assert len(plugin.parameters) == 2
        assert plugin.parameters[0].name == "url"
        assert plugin.parameters[0].required is True
        assert plugin.parameters[1].default == "GET"

    def test_plugin_categories(self):
        """Test valid plugin categories."""

        valid_categories = [
            "network",
            "remote",
            "database",
            "system",
            "kubernetes",
            "helm",
            "data",
            "custom",
        ]

        for category in valid_categories:
            plugin = create_test_plugin(
                id=f"test-{category}",
                name="Test Plugin",
                version="1.0.0",
                category=category,
                description="Test",
                parameters=[],
            )
            assert plugin.category == category

    def test_plugin_invalid_category(self):
        """Test that invalid categories are rejected."""
        from wavecore.models.plugins import Plugin

        with pytest.raises(ValidationError):
            Plugin(
                id="test",
                name="Test",
                version="1.0.0",
                category="invalid_category",
                description="Test",
                parameters=[],
            )

    def test_plugin_semantic_versioning(self):
        """Test semantic versioning validation (REQ-6.3.1)."""

        valid_versions = ["1.0.0", "1.2.3", "2.0.0-alpha", "1.0.0-beta.1"]

        for version in valid_versions:
            plugin = create_test_plugin(
                id="test",
                name="Test",
                version=version,
                category="system",
                description="Test",
                parameters=[],
            )
            assert plugin.version == version

    def test_plugin_invalid_version(self):
        """Test that invalid version formats are rejected."""
        from wavecore.models.plugins import Plugin

        invalid_versions = ["1.0", "v1.0.0", "1", "abc"]

        for version in invalid_versions:
            with pytest.raises(ValidationError):
                Plugin(
                    id="test",
                    name="Test",
                    version=version,
                    category="system",
                    description="Test",
                    parameters=[],
                )

    def test_plugin_metadata(self):
        """Test plugin metadata fields (REQ-6.1.3)."""

        plugin = create_test_plugin(
            id="test",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test plugin",
            author="Test Author",
            tags=["testing", "example"],
            parameters=[],
        )

        assert plugin.author == "Test Author"
        assert "testing" in plugin.tags
        assert plugin.created_at is not None
        assert plugin.updated_at is not None

    def test_plugin_return_type(self):
        """Test plugin return type specification."""

        plugin = create_test_plugin(
            id="test",
            name="Test",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[],
            return_type="map",
        )

        assert plugin.return_type == "map"

    def test_plugin_parameter_types(self):
        """Test all supported plugin parameter types including map and table."""
        from wavecore.models.plugins import PluginParameter

        plugin = create_test_plugin(
            id="test",
            name="Test",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[
                PluginParameter(name="str_param", type="string", required=True),
                PluginParameter(name="num_param", type="integer", required=False),
                PluginParameter(name="bool_param", type="boolean", required=False),
                PluginParameter(name="array_param", type="array", required=False),
                PluginParameter(
                    name="map_param",
                    type="map",
                    required=False,
                    description="Key-value configuration",
                ),
                PluginParameter(
                    name="table_param",
                    type="table",
                    required=False,
                    description="2D matrix for test data",
                ),
            ],
        )

        assert len(plugin.parameters) == 6
        assert plugin.parameters[4].type == "map"
        assert plugin.parameters[5].type == "table"

    def test_plugin_validation_rules(self):
        """Test plugin validation rules."""
        from wavecore.models.plugins import ValidationRule

        plugin = create_test_plugin(
            id="test",
            name="Test",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[],
            validation_rules=[ValidationRule(field="url", rule="regex", pattern=r"^https?://.+")],
        )

        assert len(plugin.validation_rules) == 1
        assert plugin.validation_rules[0].field == "url"


class TestPluginMetadataRemotable:
    """Test suite for the remotable metadata flag (REQ-3.4.1.3).

    A plugin declares remotable=True to signal it is bundle-safe and may run
    inside a Remote Execution container body. The flag is optional and defaults
    to False, so every existing plugin stays local-only until explicitly opted
    in.
    """

    def test_remotable_defaults_to_false(self):
        from wavecore.models.plugins import PluginMetadata

        meta = PluginMetadata(name="Shell Script", description="Runs a command", category="system")

        assert meta.remotable is False

    def test_remotable_accepts_true(self):
        from wavecore.models.plugins import PluginMetadata

        meta = PluginMetadata(
            name="HTTP Client",
            description="Runs HTTP requests",
            category="network",
            remotable=True,
        )

        assert meta.remotable is True

    def test_remotable_is_a_boolean_field(self):
        from wavecore.models.plugins import PluginMetadata

        with pytest.raises(ValidationError):
            PluginMetadata(
                name="Bad",
                description="Bad remotable",
                category="network",
                remotable="not-a-bool",
            )


class TestBlockModel:
    """Test suite for Block model (REQ-6.2.2)."""

    def test_block_minimal_valid(self):
        """Test block creation with minimal fields - composite structure."""
        block = create_test_block(
            id="deploy-pod",
            name="Deploy Pod",
            version="1.0.0",
            type="action",
            plugins=[],  # Blocks aggregate plugins
            child_blocks=[],  # Blocks can contain other blocks
        )

        assert block.id == "deploy-pod"
        assert block.type == "action"
        assert len(block.plugins) == 0
        assert len(block.child_blocks) == 0

    def test_block_with_plugins(self):
        """Test block aggregating multiple plugins (REQ-6.2.2)."""
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="deploy-and-verify",
            name="Deploy and Verify",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="k8s-deployment-create",
                    plugin_version="^2.0.0",
                    parameters={"namespace": "default", "replicas": 3},
                    order=1,
                ),
                BlockPlugin(
                    plugin_id="k8s-pod-verify",
                    plugin_version="^1.0.0",
                    parameters={"timeout": 60},
                    order=2,
                ),
            ],
            child_blocks=[],
        )

        assert len(block.plugins) == 2
        assert block.plugins[0].plugin_id == "k8s-deployment-create"
        assert block.plugins[0].parameters["namespace"] == "default"
        assert block.plugins[1].order == 2

    def test_block_with_child_blocks(self):
        """Test nested block composition (REQ-6.2.2)."""
        from wavecore.models.blocks import BlockChild

        block = create_test_block(
            id="complex-scenario",
            name="Complex Deployment Scenario",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[
                BlockChild(block_id="setup-namespace", block_version="^1.0.0", order=1),
                BlockChild(block_id="deploy-application", block_version="^2.0.0", order=2),
                BlockChild(block_id="verify-health", block_version="^1.0.0", order=3),
            ],
        )

        assert len(block.child_blocks) == 3
        assert block.child_blocks[0].block_id == "setup-namespace"
        assert block.child_blocks[1].block_version == "^2.0.0"
        assert block.child_blocks[2].order == 3

    def test_block_with_mixed_composition(self):
        """Test block containing both plugins and child blocks."""
        from wavecore.models.blocks import BlockChild
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="hybrid-block",
            name="Hybrid Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="logging-start", plugin_version="1.0.0", parameters={}, order=1
                )
            ],
            child_blocks=[BlockChild(block_id="main-workflow", block_version="2.0.0", order=2)],
        )

        assert len(block.plugins) == 1
        assert len(block.child_blocks) == 1
        assert block.plugins[0].order == 1
        assert block.child_blocks[0].order == 2

    def test_block_dependencies(self):
        """Test block dependency specification (REQ-6.2.2)."""
        from wavecore.models.blocks import BlockDependency

        block = create_test_block(
            id="verify-deployment",
            name="Verify Deployment",
            version="1.0.0",
            type="validation",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="namespace-manager",
                    component_type="block",
                    version_constraint="^1.0.0",
                ),
                BlockDependency(
                    component_id="pod-utilities",
                    component_type="block",
                    version_constraint="~2.1.0",
                ),
            ],
        )

        assert len(block.dependencies) == 2
        assert block.dependencies[0].component_id == "namespace-manager"
        assert block.dependencies[0].version_constraint == "^1.0.0"
        assert block.dependencies[1].version_constraint == "~2.1.0"

    def test_block_execution_flow(self):
        """Test block execution flow definition (sequential/parallel)."""
        from wavecore.models.blocks import ExecutionFlow
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="parallel-deploy",
            name="Parallel Deployment",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="deploy-backend", plugin_version="1.0.0", parameters={}, order=1
                ),
                BlockPlugin(
                    plugin_id="deploy-frontend",
                    plugin_version="1.0.0",
                    parameters={},
                    order=1,  # Same order = parallel
                ),
                BlockPlugin(
                    plugin_id="verify-all",
                    plugin_version="1.0.0",
                    parameters={},
                    order=2,  # Runs after parallel plugins
                ),
            ],
            child_blocks=[],
            execution_flow=ExecutionFlow(
                mode="sequential",  # Overall mode
                parallel_groups=[[0, 1]],  # Plugins at index 0 and 1 run in parallel
            ),
        )

        assert block.execution_flow.mode == "sequential"
        assert len(block.execution_flow.parallel_groups) == 1
        assert block.execution_flow.parallel_groups[0] == [0, 1]

    def test_block_types(self):
        """Test valid block types."""

        valid_types = ["action", "validation", "control", "timing", "data"]

        for block_type in valid_types:
            block = create_test_block(
                id=f"test-{block_type}",
                name="Test",
                version="1.0.0",
                type=block_type,
                plugins=[],
                child_blocks=[],
            )
            assert block.type == block_type

    def test_block_metadata(self):
        """Test block metadata (REQ-6.1.3)."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            description="Test block description",
            author="Test Author",
            tags=["kubernetes", "deployment"],
        )

        assert block.description == "Test block description"
        assert block.author == "Test Author"
        assert "kubernetes" in block.tags
        assert block.created_at is not None

    def test_block_invalid_version(self):
        """Test that invalid block versions are rejected."""
        from wavecore.models.blocks import Block

        with pytest.raises(ValidationError):
            Block(
                id="test",
                name="Test",
                version="invalid",
                type="action",
                plugins=[],
                child_blocks=[],
            )

    def test_block_parameter_model(self):
        """Test BlockParameter model creation (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Test string parameter
        param = BlockParameter(
            name="namespace",
            type="string",
            required=True,
            description="Kubernetes namespace",
        )

        assert param.name == "namespace"
        assert param.type == "string"
        assert param.required is True
        assert param.default is None

    def test_block_with_parameters(self):
        """Test block with input parameter declarations (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="deploy-to-namespace",
            name="Deploy to Namespace",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(
                    name="namespace",
                    type="string",
                    required=True,
                    description="Target Kubernetes namespace",
                ),
                BlockParameter(
                    name="replicas",
                    type="integer",
                    required=False,
                    default=3,
                    description="Number of replicas",
                ),
            ],
            plugins=[],
            child_blocks=[],
        )

        assert len(block.parameters) == 2
        assert block.parameters[0].name == "namespace"
        assert block.parameters[0].required is True
        assert block.parameters[1].name == "replicas"
        assert block.parameters[1].default == 3

    def test_block_parameters_all_types(self):
        """Test block parameters with all supported types (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="multi-type-block",
            name="Multi-Type Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="str_param", type="string", required=True),
                BlockParameter(name="num_param", type="integer", required=True),
                BlockParameter(name="bool_param", type="boolean", required=True),
                BlockParameter(name="array_param", type="array", required=True),
                BlockParameter(name="map_param", type="map", required=True),
                BlockParameter(name="table_param", type="table", required=True),
            ],
            plugins=[],
            child_blocks=[],
        )

        assert len(block.parameters) == 6
        param_types = [p.type for p in block.parameters]
        assert "string" in param_types
        assert "integer" in param_types
        assert "boolean" in param_types
        assert "array" in param_types
        assert "map" in param_types
        assert "table" in param_types

    def test_block_parameters_required_optional(self):
        """Test block with required and optional parameters (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="config-block",
            name="Configuration Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="endpoint", type="string", required=True),
                BlockParameter(name="timeout", type="integer", required=False, default=30),
                BlockParameter(name="retry", type="boolean", required=False, default=True),
            ],
            plugins=[],
            child_blocks=[],
        )

        required_params = [p for p in block.parameters if p.required]
        optional_params = [p for p in block.parameters if not p.required]

        assert len(required_params) == 1
        assert len(optional_params) == 2
        assert required_params[0].name == "endpoint"
        assert optional_params[0].default == 30
        assert optional_params[1].default is True

    def test_block_parameters_with_defaults(self):
        """Test block parameter default values (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="default-block",
            name="Default Values Block",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(
                    name="log_level",
                    type="string",
                    required=False,
                    default="INFO",
                    description="Logging level",
                ),
                BlockParameter(
                    name="max_attempts",
                    type="integer",
                    required=False,
                    default=3,
                    description="Maximum retry attempts",
                ),
                BlockParameter(
                    name="enabled",
                    type="boolean",
                    required=False,
                    default=True,
                    description="Enable feature",
                ),
                BlockParameter(
                    name="tags",
                    type="array",
                    required=False,
                    default=[],
                    description="Resource tags",
                ),
            ],
            plugins=[],
            child_blocks=[],
        )

        assert block.parameters[0].default == "INFO"
        assert block.parameters[1].default == 3
        assert block.parameters[2].default is True
        assert block.parameters[3].default == []

    def test_block_parameter_invalid_type(self):
        """Test that invalid parameter types are rejected (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        with pytest.raises(ValidationError):
            BlockParameter(
                name="invalid",
                type="invalid_type",  # Not a valid type
                required=True,
            )

    def test_block_without_parameters(self):
        """Test block creation without parameters (REQ-3.1.2.1)."""

        block = create_test_block(
            id="no-params-block",
            name="No Parameters Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.parameters == []

    def test_block_parameter_duplicate_names(self):
        """Test that duplicate parameter names are rejected (REQ-3.1.2.1)."""
        from wavecore.models.blocks import Block, BlockParameter
        from wavecore.models.plugins import BlockMetadata

        # Should reject duplicate parameter names
        with pytest.raises(ValidationError) as exc_info:
            Block(
                id="dup-params",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Duplicate Parameters",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugin_id="test",
                parameters=[
                    BlockParameter(name="timeout", type="integer", required=True),
                    BlockParameter(name="timeout", type="string", required=False),
                ],
                plugins=[],
                child_blocks=[],
            )

        assert "duplicate parameter name" in str(exc_info.value).lower()

    def test_block_parameter_empty_name(self):
        """Test that empty parameter names are rejected (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(name="", type="string", required=True)

        assert (
            "empty" in str(exc_info.value).lower()
            or "string should have at least 1 character" in str(exc_info.value).lower()
        )

    def test_block_parameter_name_with_spaces(self):
        """Test parameter name validation for special characters (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Should reject parameter names with spaces
        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(name="my param", type="string", required=True)

        assert (
            "invalid parameter name" in str(exc_info.value).lower()
            or "string does not match expected pattern" in str(exc_info.value).lower()
        )

    def test_block_parameter_default_type_mismatch_string(self):
        """Test that default value type must match parameter type (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # String parameter with number default
        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(
                name="timeout",
                type="string",
                required=False,
                default=123,  # Wrong type
            )

        assert (
            "type mismatch" in str(exc_info.value).lower()
            or "default value type" in str(exc_info.value).lower()
        )

    def test_block_parameter_default_type_mismatch_number(self):
        """Test number parameter with wrong default type (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(
                name="port",
                type="integer",
                required=False,
                default="8080",  # Wrong type
            )

        assert (
            "type mismatch" in str(exc_info.value).lower()
            or "default value type" in str(exc_info.value).lower()
        )

    def test_block_parameter_default_type_mismatch_boolean(self):
        """Test boolean parameter with wrong default type (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(
                name="enabled",
                type="boolean",
                required=False,
                default="true",  # Wrong type
            )

        assert (
            "type mismatch" in str(exc_info.value).lower()
            or "default value type" in str(exc_info.value).lower()
        )

    def test_block_parameter_required_with_default_contradiction(self):
        """Test that required=True with default value is logical contradiction (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Required parameters shouldn't have defaults (they must always be provided)
        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(
                name="endpoint",
                type="string",
                required=True,
                default="http://localhost",  # Contradicts required=True
            )

        error_msg = str(exc_info.value).lower()
        assert "required parameter" in error_msg and "cannot have a default value" in error_msg

    def test_block_parameters_serialization_to_dict(self):
        """Test block with parameters serializes to dict correctly (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="serialize-test",
            name="Serialization Test",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(
                    name="namespace",
                    type="string",
                    required=True,
                    description="Target namespace",
                ),
                BlockParameter(
                    name="replicas",
                    type="integer",
                    required=False,
                    default=3,
                ),
            ],
            plugins=[],
            child_blocks=[],
        )

        block_dict = block.model_dump()

        assert "parameters" in block_dict
        assert len(block_dict["parameters"]) == 2
        assert block_dict["parameters"][0]["name"] == "namespace"
        assert block_dict["parameters"][0]["type"] == "string"
        assert block_dict["parameters"][0]["required"] is True
        assert block_dict["parameters"][1]["default"] == 3

    def test_block_parameters_deserialization_from_dict(self):
        """Test block with parameters deserializes from dict correctly (REQ-3.1.2.1)."""

        block_data = {
            "id": "deserialize-test",
            "name": "Deserialization Test",
            "version": "2.0.0",
            "type": "validation",
            "parameters": [
                {
                    "name": "endpoint",
                    "type": "string",
                    "required": True,
                    "description": "API endpoint",
                },
                {
                    "name": "timeout",
                    "type": "integer",
                    "required": False,
                    "default": 30,
                },
            ],
            "plugins": [],
            "child_blocks": [],
        }

        block = create_test_block(**block_data)

        assert block.id == "deserialize-test"
        assert len(block.parameters) == 2
        assert block.parameters[0].name == "endpoint"
        assert block.parameters[0].required is True
        assert block.parameters[1].default == 30

    def test_block_parameters_json_serialization(self):
        """Test block with parameters serializes to JSON correctly (REQ-3.1.2.1)."""
        import json

        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="json-test",
            name="JSON Test",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(
                    name="config",
                    type="map",
                    required=False,
                    default={"key": "value"},
                ),
            ],
            plugins=[],
            child_blocks=[],
        )

        json_str = block.model_dump_json()
        parsed = json.loads(json_str)

        assert "parameters" in parsed
        assert parsed["parameters"][0]["name"] == "config"
        assert parsed["parameters"][0]["type"] == "map"
        assert parsed["parameters"][0]["default"] == {"key": "value"}

    def test_block_parameter_none_values(self):
        """Test handling of None values in parameter fields (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Optional parameter with no default (None)
        param = BlockParameter(
            name="optional_param",
            type="string",
            required=False,
            default=None,
            description=None,
        )

        assert param.default is None
        assert param.description is None

    def test_block_parameter_valid_names(self):
        """Test valid parameter name patterns (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Valid identifier patterns
        valid_names = [
            "simple",
            "with_underscore",
            "camelCase",
            "PascalCase",
            "name123",
            "_private",
            "__dunder__",
            "a",
            "A",
        ]

        for name in valid_names:
            param = BlockParameter(name=name, type="string", required=False)
            assert param.name == name

    def test_block_parameter_valid_defaults_all_types(self):
        """Test valid default values for all parameter types (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # String type with string default
        p1 = BlockParameter(name="str_param", type="string", default="value")
        assert p1.default == "value"

        # Number type with int default
        p2 = BlockParameter(name="int_param", type="integer", default=42)
        assert p2.default == 42

        # Number type with float default
        p3 = BlockParameter(name="float_param", type="float", default=3.14)
        assert p3.default == 3.14

        # Boolean type with bool default
        p4 = BlockParameter(name="bool_param", type="boolean", default=True)
        assert p4.default is True

        # Array type with list default
        p5 = BlockParameter(name="array_param", type="array", default=[1, 2, 3])
        assert p5.default == [1, 2, 3]

        # Map type with dict default
        p6 = BlockParameter(name="map_param", type="map", default={"key": "val"})
        assert p6.default == {"key": "val"}

        # Table type with list of dicts default
        p7 = BlockParameter(name="table_param", type="table", default=[{"a": 1}, {"b": 2}])
        assert p7.default == [{"a": 1}, {"b": 2}]

        # Table type with list of lists default
        p8 = BlockParameter(name="table_param2", type="table", default=[[1, 2], [3, 4]])
        assert p8.default == [[1, 2], [3, 4]]

    def test_block_parameter_optional_without_default(self):
        """Test optional parameter without default value (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Optional with no default - should validate successfully
        param = BlockParameter(name="optional", type="string", required=False)

        assert param.required is False
        assert param.default is None

    def test_block_parameter_required_without_default(self):
        """Test required parameter without default value (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Required with no default - should validate successfully
        param = BlockParameter(name="required_param", type="string", required=True)

        assert param.required is True
        assert param.default is None

    def test_block_unique_parameter_names_success(self):
        """Test block with unique parameter names validates successfully (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # All unique names
        block = create_test_block(
            id="unique-params",
            name="Unique Parameters",
            version="1.0.0",
            type="action",
            parameters=[
                BlockParameter(name="param1", type="string", required=True),
                BlockParameter(name="param2", type="integer", required=False),
                BlockParameter(name="param3", type="boolean", required=False),
            ],
            plugins=[],
            child_blocks=[],
        )

        assert len(block.parameters) == 3
        param_names = [p.name for p in block.parameters]
        assert len(param_names) == len(set(param_names))  # All unique

    def test_block_parameter_name_validation_special_cases(self):
        """Test parameter name validation edge cases (REQ-3.1.2.1)."""
        from wavecore.models.blocks import BlockParameter

        # Valid: starts with letter
        p1 = BlockParameter(name="validName", type="string")
        assert p1.name == "validName"

        # Valid: starts with underscore
        p2 = BlockParameter(name="_private", type="string")
        assert p2.name == "_private"

        # Valid: contains numbers
        p3 = BlockParameter(name="param123", type="string")
        assert p3.name == "param123"

        # Invalid: starts with number
        with pytest.raises(ValidationError):
            BlockParameter(name="123invalid", type="string")

        # Invalid: contains hyphen
        with pytest.raises(ValidationError):
            BlockParameter(name="invalid-name", type="string")

        # Invalid: contains dot
        with pytest.raises(ValidationError):
            BlockParameter(name="invalid.name", type="string")


class TestBlockParameterIsExpression:
    """Test suite for BlockParameter is_expression field."""

    def test_default_is_expression_false(self):
        """Test that is_expression defaults to False."""
        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="url", type="string", required=True)
        assert param.is_expression is False

    def test_is_expression_true(self):
        """Test creating a parameter with is_expression=True."""
        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="url", type="string", required=True, is_expression=True)
        assert param.is_expression is True

    def test_is_expression_serializes(self):
        """Test that is_expression is included in model_dump output."""
        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="url", type="string", required=True, is_expression=True)
        data = param.model_dump()
        assert "is_expression" in data
        assert data["is_expression"] is True

        # Also verify default serialization
        param_default = BlockParameter(name="port", type="integer", required=False)
        data_default = param_default.model_dump()
        assert "is_expression" in data_default
        assert data_default["is_expression"] is False


class TestBlockParameterIsTemplate:
    """BlockParameter is_template field and its exclusivity with is_expression."""

    def test_default_is_template_false(self):
        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="body", type="string")
        assert param.is_template is False

    def test_is_template_alone_ok(self):
        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="body", type="string", is_template=True)
        assert param.is_template is True
        assert param.is_expression is False

    def test_is_expression_and_is_template_mutually_exclusive(self):
        from wavecore.models.blocks import BlockParameter

        with pytest.raises(ValidationError) as exc_info:
            BlockParameter(name="body", type="string", is_expression=True, is_template=True)

        assert [e["msg"] for e in exc_info.value.errors()] == [
            "Value error, is_expression and is_template are mutually exclusive"
        ]


class TestPluginParameterTrim:
    """Test suite for PluginParameter trim field (REQ-3.4.2.2 - Input Trimming)."""

    def test_default_trim_false(self):
        """trim defaults to False - the value is preserved unless opted in."""
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(name="url", type="string")
        assert param.trim is False

    def test_trim_true(self):
        """A parameter can declare trim=True for strict single-line values."""
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(name="url", type="string", trim=True)
        assert param.trim is True

    def test_trim_serializes(self):
        """trim is included in model_dump output, defaulting to False."""
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(name="url", type="string", trim=True)
        assert param.model_dump()["trim"] is True

        param_default = PluginParameter(name="body", type="string")
        assert param_default.model_dump()["trim"] is False


class TestPluginParameterConditionalRequirement:
    """PluginParameter conditional requirement: required_when and required_when_all."""

    def test_both_conditional_forms_default_to_none(self):
        """A parameter carries neither form unless it declares one."""
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(name="kind", type="string")

        assert param.required_when is None
        assert param.required_when_all is None

    def test_required_when_takes_one_condition(self):
        """The single form names one field and the values that make the parameter required."""
        from wavecore.models.controls.parameters import RequiredWhen
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(
            name="kind",
            type="string",
            required_when={"field": "resource_type", "values": ["default"]},
        )

        assert param.required_when == RequiredWhen(field="resource_type", values=["default"])

    def test_required_when_all_takes_a_list_of_conditions(self):
        """The conjunctive form takes several conditions of the same shape."""
        from wavecore.models.controls.parameters import RequiredWhen
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(
            name="object_kind",
            type="string",
            required_when_all=[
                {"field": "scope_to_object", "values": ["true"]},
                {"field": "object_type", "values": ["default"]},
            ],
        )

        assert param.required_when_all == [
            RequiredWhen(field="scope_to_object", values=["true"]),
            RequiredWhen(field="object_type", values=["default"]),
        ]

    def test_required_and_required_when_are_mutually_exclusive(self):
        """A parameter is required outright or conditionally, never both."""
        from wavecore.models.plugins import PluginParameter

        with pytest.raises(
            ValidationError, match="cannot have both 'required' and 'required_when'"
        ):
            PluginParameter(
                name="kind",
                type="string",
                required=True,
                required_when={"field": "resource_type", "values": ["default"]},
            )

    def test_required_and_required_when_all_are_mutually_exclusive(self):
        """The conjunctive form is under the same rule as the single one."""
        from wavecore.models.plugins import PluginParameter

        with pytest.raises(
            ValidationError, match="cannot have both 'required' and 'required_when_all'"
        ):
            PluginParameter(
                name="object_kind",
                type="string",
                required=True,
                required_when_all=[{"field": "scope_to_object", "values": ["true"]}],
            )

    def test_a_conditional_parameter_may_still_declare_a_default(self):
        """The mutual-exclusion rule is about `required`, not about defaults."""
        from wavecore.models.plugins import PluginParameter

        param = PluginParameter(
            name="kind",
            type="string",
            default="Pod",
            required_when={"field": "resource_type", "values": ["default"]},
        )

        assert param.default == "Pod"


class TestIsTableValueHelper:
    """Test suite for _is_table_value helper function."""

    def test_table_instance_is_valid(self):
        """Test that Table instance is recognized as table value."""
        from wavecore.core.table import Table
        from wavecore.models.blocks import _is_table_value

        table = Table.from_list([{"a": 1, "b": 2}])
        assert _is_table_value(table) is True

    def test_list_of_dicts_is_valid(self):
        """Test that list of dicts is recognized as table value."""
        from wavecore.models.blocks import _is_table_value

        value = [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]
        assert _is_table_value(value) is True

    def test_list_of_lists_is_valid(self):
        """Test that list of lists is recognized as table value."""
        from wavecore.models.blocks import _is_table_value

        value = [["a", "b", "c"], [1, 2, 3]]
        assert _is_table_value(value) is True

    def test_empty_list_is_not_valid(self):
        """Test that empty list is still valid (all items match, vacuously true)."""
        from wavecore.models.blocks import _is_table_value

        # Empty list: all() returns True for empty iterable
        assert _is_table_value([]) is True

    def test_non_table_values_are_invalid(self):
        """Test that non-table values are rejected."""
        from wavecore.models.blocks import _is_table_value

        # Simple string
        assert _is_table_value("hello") is False
        # Simple number
        assert _is_table_value(42) is False
        # Dict (not a list)
        assert _is_table_value({"a": 1}) is False
        # List of strings (not list/dict items)
        assert _is_table_value(["a", "b", "c"]) is False
        # None
        assert _is_table_value(None) is False


class TestVersionCompatibility:
    """Test suite for version compatibility checks (REQ-6.3.4)."""

    def test_version_pinning(self):
        """Test exact version pinning (REQ-6.3.2)."""
        from wavecore.models.blocks import BlockDependency

        dep = BlockDependency(
            component_id="test-block", component_type="block", version_constraint="1.2.3"
        )

        assert dep.version_constraint == "1.2.3"

    def test_version_ranges(self):
        """Test semver range constraints."""
        from wavecore.models.blocks import BlockDependency

        ranges = ["^1.0.0", "~1.2.0", ">=1.0.0", "1.x", "*"]

        for range_spec in ranges:
            dep = BlockDependency(
                component_id="test", component_type="block", version_constraint=range_spec
            )
            assert dep.version_constraint == range_spec

    def test_dependency_resolution(self):
        """Test dependency resolution (REQ-6.3.3)."""
        from wavecore.models.blocks import BlockDependency

        block = create_test_block(
            id="complex-block",
            name="Complex Block",
            version="2.0.0",
            type="action",
            plugin_id="test",
            dependencies=[
                BlockDependency(
                    component_id="dep1", component_type="block", version_constraint="^1.0.0"
                ),
                BlockDependency(
                    component_id="dep2", component_type="block", version_constraint="~2.1.0"
                ),
                BlockDependency(
                    component_id="dep3", component_type="block", version_constraint=">=3.0.0"
                ),
            ],
        )

        assert len(block.dependencies) == 3
        # Actual resolution logic will be in storage layer

    def test_version_constraint_wildcard_patch_level(self):
        """Test version constraint with patch-level wildcard pattern (line 180)."""
        from wavecore.models.blocks import BlockDependency

        # Test the 1.2.x pattern (line 180 in models.py)
        dep = BlockDependency(
            component_id="test-block",
            component_type="block",
            version_constraint="1.2.x",
        )

        assert dep.version_constraint == "1.2.x"

        # Also test other wildcard patterns for completeness
        dep2 = BlockDependency(
            component_id="test-block",
            component_type="block",
            version_constraint="2.5.x",
        )
        assert dep2.version_constraint == "2.5.x"


class TestModelSerialization:
    """Test suite for model serialization/deserialization."""

    def test_plugin_to_dict(self):
        """Test plugin serialization to dict."""

        plugin = create_test_plugin(
            id="test",
            name="Test",
            version="1.0.0",
            category="system",
            description="Test",
            parameters=[],
        )

        data = plugin.model_dump()
        assert data["id"] == "test"
        assert data["version"] == "1.0.0"

    def test_model_from_dict(self):
        """Test model deserialization from dict."""

        data = {
            "id": "shell-script",
            "name": "Shell Script",
            "version": "1.0.0",
            "category": "system",
            "description": "Execute shell scripts",
            "parameters": [],
        }

        plugin = create_test_plugin(**data)
        assert plugin.id == "shell-script"
        assert plugin.name == "Shell Script"


class TestBlockParameterDecimalDefault:
    """A float-typed parameter accepts an exact Decimal default (REQ-3.1.3.14)."""

    def test_float_default_accepts_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(name="rate", type="float", default=Decimal("1.5"))
        assert param.default == Decimal("1.5")

    def test_float_default_accepts_high_precision_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.models.blocks import BlockParameter

        param = BlockParameter(
            name="rate", type="float", default=Decimal("-2123.123213123123699999")
        )
        assert param.default == Decimal("-2123.123213123123699999")


class TestOutputFieldSecretFlag:
    """OutputField secret declaration."""

    def test_secret_defaults_to_false(self):
        from wavecore.models.plugins import OutputField

        field = OutputField(name="token_out", type="string")

        assert field.secret is False

    def test_secret_flag_roundtrips(self):
        from wavecore.models.plugins import OutputField

        field = OutputField(name="token_out", type="string", secret=True)

        assert field.secret is True
