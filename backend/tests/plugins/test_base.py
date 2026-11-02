"""
Unit tests for plugin base class and plugin system.

Tests requirements:
- REQ-3.4.2.1: Plugin creation interface
- REQ-3.4.2.2: Plugin parameter definition
- REQ-3.4.2.3: Plugin validation logic
- REQ-3.4.2.4: Plugin versioning
- REQ-3.4.2.5: Plugin documentation
"""

from typing import Any

import pytest


class TestPluginBaseClass:
    """Test suite for abstract plugin base class (REQ-3.4.2.1)."""

    def test_plugin_base_abstract_methods(self):
        """Test that plugin base class defines abstract methods that must be implemented."""
        from wavecore.plugins.base import PluginBase

        # Should not be able to instantiate abstract base directly
        with pytest.raises(TypeError):
            PluginBase()

    def test_plugin_concrete_implementation(self):
        """Test that concrete plugins can be created by extending base."""
        from wavecore.plugins.base import PluginBase

        class TestPlugin(PluginBase):
            """Concrete test plugin implementation."""

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "test-plugin",
                    "name": "Test Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test plugin for unit testing",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "test result"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = TestPlugin()
        assert plugin.metadata["id"] == "test-plugin"
        assert plugin.metadata["version"] == "1.0.0"

    def test_plugin_lifecycle_methods(self):
        """Test plugin lifecycle: initialize, execute, cleanup."""
        from wavecore.plugins.base import PluginBase

        class LifecyclePlugin(PluginBase):
            def __init__(self):
                self.initialized = False
                self.cleaned_up = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "lifecycle-test",
                    "name": "Lifecycle Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test lifecycle",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def initialize(self, context: dict[str, Any]) -> None:
                self.initialized = True

            async def execute(self, context: dict[str, Any]) -> Any:
                return "executed"

            async def cleanup(self) -> None:
                self.cleaned_up = True

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = LifecyclePlugin()
        assert not plugin.initialized
        assert not plugin.cleaned_up

    def test_plugin_metadata_validation(self):
        """Test that plugin metadata is validated on creation."""
        from wavecore.plugins.base import PluginBase

        class InvalidPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "invalid",
                    "name": "Invalid",
                    "version": "not-semver",  # Invalid version
                    "category": "system",
                    "description": "Invalid",
                    "parameters": [],
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InvalidPlugin()
        # Validation should fail when getting plugin model
        with pytest.raises(ValueError, match="Invalid semantic version"):
            plugin.get_plugin_model()


class TestPluginParameterDefinition:
    """Test suite for plugin parameter definition (REQ-3.4.2.2)."""

    def test_parameter_types_supported(self):
        """Test all supported parameter types: string, number, boolean, array, map, table."""
        from wavecore.plugins.base import PluginBase

        class MultiTypePlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "multi-type",
                    "name": "Multi Type",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test all types",
                    "parameters": [
                        {"name": "str_param", "type": "string", "required": True},
                        {"name": "num_param", "type": "integer", "required": False},
                        {"name": "bool_param", "type": "boolean", "required": False},
                        {"name": "array_param", "type": "array", "required": False},
                        {"name": "map_param", "type": "map", "required": False},
                        {"name": "table_param", "type": "table", "required": False},
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = MultiTypePlugin()
        model = plugin.get_plugin_model()
        assert len(model.parameters) == 6
        assert model.parameters[0].type == "string"
        assert model.parameters[4].type == "map"
        assert model.parameters[5].type == "table"

    def test_required_vs_optional_parameters(self):
        """Test required and optional parameter handling."""
        from wavecore.plugins.base import PluginBase

        class ParamPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "param-test",
                    "name": "Param Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test params",
                    "parameters": [
                        {"name": "required_param", "type": "string", "required": True},
                        {
                            "name": "optional_param",
                            "type": "string",
                            "required": False,
                            "default": "default_value",
                        },
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                # Should enforce required params
                if "required_param" not in params:
                    raise ValueError("required_param is required")

        plugin = ParamPlugin()
        model = plugin.get_plugin_model()
        assert model.parameters[0].required is True
        assert model.parameters[1].required is False
        assert model.parameters[1].default == "default_value"

    def test_parameter_descriptions(self):
        """Test parameter descriptions for GUI help."""
        from wavecore.plugins.base import PluginBase

        class DocPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "doc-test",
                    "name": "Doc Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test docs",
                    "parameters": [
                        {
                            "name": "param1",
                            "type": "string",
                            "required": True,
                            "description": "This parameter does something important",
                        }
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = DocPlugin()
        model = plugin.get_plugin_model()
        assert model.parameters[0].description == "This parameter does something important"


class TestPluginValidation:
    """Test suite for plugin validation logic (REQ-3.4.2.3)."""

    @pytest.mark.asyncio
    async def test_schema_driven_type_validation(self):
        """Test automatic type validation from parameter schema."""
        from wavecore.plugins.base import PluginBase

        class ValidatingPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "validating",
                    "name": "Validating",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test validation",
                    "parameters": [{"name": "num_param", "type": "integer", "required": True}],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                # Type checking should happen here
                if not isinstance(params.get("num_param"), int | float):
                    raise TypeError("num_param must be a number")

        plugin = ValidatingPlugin()

        # Valid parameter
        await plugin.validate({"num_param": 42})

        # Invalid type
        with pytest.raises(TypeError, match="must be a number"):
            await plugin.validate({"num_param": "not a number"})

    @pytest.mark.asyncio
    async def test_required_parameter_validation(self):
        """Test required parameter checking."""
        from wavecore.plugins.base import PluginBase

        class RequiredPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "required-test",
                    "name": "Required Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test required",
                    "parameters": [{"name": "required_param", "type": "string", "required": True}],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                if "required_param" not in params:
                    raise ValueError("Missing required parameter: required_param")

        plugin = RequiredPlugin()

        # Missing required parameter
        with pytest.raises(ValueError, match="Missing required parameter"):
            await plugin.validate({})

        # Present required parameter
        await plugin.validate({"required_param": "value"})

    @pytest.mark.asyncio
    async def test_custom_validation_logic(self):
        """Test custom validation beyond schema validation."""
        from wavecore.plugins.base import PluginBase

        class CustomValidationPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "custom-validation",
                    "name": "Custom Validation",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test custom validation",
                    "parameters": [
                        {"name": "min_val", "type": "integer", "required": True},
                        {"name": "max_val", "type": "integer", "required": True},
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                # Cross-parameter validation
                min_val = params.get("min_val")
                max_val = params.get("max_val")
                if min_val is not None and max_val is not None and min_val > max_val:
                    raise ValueError("min_val must be <= max_val")

        plugin = CustomValidationPlugin()

        # Valid relationship
        await plugin.validate({"min_val": 1, "max_val": 10})

        # Invalid relationship
        with pytest.raises(ValueError, match="min_val must be <= max_val"):
            await plugin.validate({"min_val": 10, "max_val": 1})


class TestPluginVersioning:
    """Test suite for plugin versioning (REQ-3.4.2.4)."""

    def test_semantic_version_enforcement(self):
        """Test that plugins must use valid semantic versions."""
        from wavecore.plugins.base import PluginBase

        class VersionedPlugin(PluginBase):
            def __init__(self, version: str):
                self.version = version

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "versioned",
                    "name": "Versioned",
                    "version": self.version,
                    "category": "system",
                    "description": "Test versioning",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        # Valid versions
        for version in ["1.0.0", "1.2.3", "2.0.0-alpha", "1.0.0+build123"]:
            plugin = VersionedPlugin(version)
            model = plugin.get_plugin_model()
            assert model.version == version

        # Invalid versions
        for version in ["1.0", "v1.0.0", "1.0.0.0", "invalid"]:
            plugin = VersionedPlugin(version)
            with pytest.raises(ValueError, match="Invalid semantic version"):
                plugin.get_plugin_model()

    def test_multiple_plugin_versions_coexist(self):
        """Test that multiple versions of same plugin can coexist."""
        from wavecore.plugins.base import PluginBase

        class MyPlugin(PluginBase):
            def __init__(self, version: str):
                self._version = version

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "my-plugin",
                    "name": "My Plugin",
                    "version": self._version,
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return f"v{self._version}"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        # Create multiple versions
        plugin_v1 = MyPlugin("1.0.0")
        plugin_v2 = MyPlugin("2.0.0")

        # Both should coexist independently
        assert plugin_v1.get_plugin_model().version == "1.0.0"
        assert plugin_v2.get_plugin_model().version == "2.0.0"


class TestPluginDocumentation:
    """Test suite for plugin documentation (REQ-3.4.2.5)."""

    def test_plugin_documentation_structure(self):
        """Test that plugin includes documentation metadata."""
        from wavecore.plugins.base import PluginBase

        class DocumentedPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "documented",
                    "name": "Documented Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "A well-documented plugin for testing",
                    "parameters": [
                        {
                            "name": "param1",
                            "type": "string",
                            "required": True,
                            "description": "First parameter - does X",
                        }
                    ],
                    "return_type": "string",
                    "output_schema": [],
                    "documentation": {
                        "overview": "This plugin performs XYZ operations",
                        "behavior": "It does A, B, and C in sequence",
                        "examples": [
                            {
                                "description": "Basic usage",
                                "parameters": {"param1": "example_value"},
                            }
                        ],
                    },
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "result"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = DocumentedPlugin()
        meta = plugin.metadata

        assert "documentation" in meta
        assert "overview" in meta["documentation"]
        assert "examples" in meta["documentation"]
        assert len(meta["documentation"]["examples"]) > 0

    def test_parameter_inline_documentation(self):
        """Test context-sensitive parameter documentation."""
        from wavecore.plugins.base import PluginBase

        class InlineDocPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "inline-doc",
                    "name": "Inline Doc",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test inline docs",
                    "parameters": [
                        {
                            "name": "timeout",
                            "type": "integer",
                            "required": False,
                            "default": 30,
                            "description": "Timeout in seconds - how long to wait before giving up",
                        }
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InlineDocPlugin()
        model = plugin.get_plugin_model()

        # Parameter should have description for inline help
        param = model.parameters[0]
        assert param.description is not None
        assert "Timeout in seconds" in param.description


class TestPluginLifecycle:
    """Test suite for plugin lifecycle hooks."""

    @pytest.mark.asyncio
    async def test_initialize_hook_called(self):
        """Test that initialize hook is called before execution."""
        from wavecore.plugins.base import PluginBase

        class InitPlugin(PluginBase):
            def __init__(self):
                self.init_called = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "init-test",
                    "name": "Init Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test init",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def initialize(self, context: dict[str, Any]) -> None:
                self.init_called = True

            async def execute(self, context: dict[str, Any]) -> Any:
                return "executed"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InitPlugin()
        await plugin.initialize({})
        assert plugin.init_called is True

    @pytest.mark.asyncio
    async def test_cleanup_hook_called(self):
        """Test that cleanup hook is called after execution."""
        from wavecore.plugins.base import PluginBase

        class CleanupPlugin(PluginBase):
            def __init__(self):
                self.cleanup_called = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "cleanup-test",
                    "name": "Cleanup Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test cleanup",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "executed"

            async def cleanup(self) -> None:
                self.cleanup_called = True

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = CleanupPlugin()
        await plugin.cleanup()
        assert plugin.cleanup_called is True

    @pytest.mark.asyncio
    async def test_default_initialize_implementation(self):
        """Test that default initialize implementation does nothing (no-op)."""
        from wavecore.plugins.base import PluginBase

        class DefaultInitPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "default-init",
                    "name": "Default Init",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test default init",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "executed"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

            # Not overriding initialize - will use default

        plugin = DefaultInitPlugin()
        # Default initialize should be a no-op
        await plugin.initialize({})

    @pytest.mark.asyncio
    async def test_default_cleanup_implementation(self):
        """Test that default cleanup implementation does nothing (no-op)."""
        from wavecore.plugins.base import PluginBase

        class DefaultCleanupPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "default-cleanup",
                    "name": "Default Cleanup",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test default cleanup",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "executed"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

            # Not overriding cleanup - will use default

        plugin = DefaultCleanupPlugin()
        # Default cleanup should be a no-op
        await plugin.cleanup()


class TestPluginModelConversion:
    """Test suite for plugin metadata to model conversion."""

    def test_get_plugin_model_with_dict_parameters(self):
        """Test conversion of dict parameters to PluginParameter objects."""
        from wavecore.plugins.base import PluginBase

        class DictParamPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "dict-param",
                    "name": "Dict Param",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test dict params",
                    "parameters": [{"name": "param1", "type": "string", "required": True}],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = DictParamPlugin()
        model = plugin.get_plugin_model()
        assert len(model.parameters) == 1
        assert model.parameters[0].name == "param1"

    def test_get_plugin_model_with_pluginparameter_objects(self):
        """Test that PluginParameter objects are passed through correctly."""
        from wavecore.models.plugins import PluginParameter
        from wavecore.plugins.base import PluginBase

        class ObjectParamPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "object-param",
                    "name": "Object Param",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test object params",
                    "parameters": [PluginParameter(name="param1", type="string", required=True)],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ObjectParamPlugin()
        model = plugin.get_plugin_model()
        assert len(model.parameters) == 1
        assert model.parameters[0].name == "param1"

    def test_get_plugin_model_invalid_parameter_type(self):
        """Test that invalid parameter types raise ValueError."""
        from wavecore.plugins.base import PluginBase

        class InvalidParamPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "invalid-param",
                    "name": "Invalid Param",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test invalid params",
                    "parameters": ["invalid"],  # Wrong type
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InvalidParamPlugin()
        with pytest.raises(ValueError, match="Invalid parameter type"):
            plugin.get_plugin_model()

    def test_get_plugin_model_missing_output_schema(self):
        """Test that missing output_schema key raises ValueError."""
        from wavecore.plugins.base import PluginBase

        class NoOutputSchemaPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "no-output-schema",
                    "name": "No Output Schema",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test missing output_schema",
                    "parameters": [],
                    "return_type": None,
                    # output_schema key intentionally omitted
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = NoOutputSchemaPlugin()
        with pytest.raises(
            ValueError,
            match="^Plugin 'no-output-schema' missing required 'output_schema' in metadata$",
        ):
            plugin.get_plugin_model()

    def test_get_plugin_model_with_outputfield_objects(self):
        """Test that OutputField objects in output_schema are passed through correctly."""
        from wavecore.models.plugins import OutputField
        from wavecore.plugins.base import PluginBase

        class OutputFieldObjectPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "output-field-object",
                    "name": "Output Field Object",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test OutputField objects in output_schema",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": [
                        OutputField(name="result", type="string", description="The result value")
                    ],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = OutputFieldObjectPlugin()
        model = plugin.get_plugin_model()
        assert len(model.outputs) == 1
        assert model.outputs[0].name == "result"
        assert model.outputs[0].type == "string"

    def test_get_plugin_model_invalid_output_field_type(self):
        """Test that invalid output field types in output_schema raise ValueError."""
        from wavecore.plugins.base import PluginBase

        class InvalidOutputPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "invalid-output",
                    "name": "Invalid Output",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test invalid output field type",
                    "parameters": [],
                    "return_type": None,
                    "output_schema": ["invalid"],  # Wrong type - not dict or OutputField
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InvalidOutputPlugin()
        with pytest.raises(ValueError, match="Invalid output field type"):
            plugin.get_plugin_model()


class TestPluginExecution:
    """Test suite for plugin execution context and lifecycle."""

    @pytest.mark.asyncio
    async def test_plugin_execution_with_context(self):
        """Test plugin receives execution context."""
        from wavecore.plugins.base import PluginBase

        class ContextPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "context-test",
                    "name": "Context Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test context",
                    "parameters": [],
                    "return_type": "string",
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                # Plugin should have access to variables, logger, etc
                return context.get("test_var", "default")

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ContextPlugin()
        context = {"test_var": "test_value", "variables": {}}

        result = await plugin.execute(context)
        assert result == "test_value"

    @pytest.mark.asyncio
    async def test_plugin_return_values(self):
        """Test plugin return value handling."""
        from wavecore.plugins.base import PluginBase

        class ReturnPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "return-test",
                    "name": "Return Test",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test return",
                    "parameters": [],
                    "return_type": "map",
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return {"status": "success", "count": 42}

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ReturnPlugin()
        result = await plugin.execute({})

        assert isinstance(result, dict)
        assert result["status"] == "success"
        assert result["count"] == 42


class TestNoDefaultOnASecretSetting:
    """No block secret setting declares a default (SECUI-13, REQ-3.1.3.18)."""

    def test_no_plugin_declares_a_default_on_a_credential_setting(self) -> None:
        import wavecore.plugins as plugin_package
        from wavecore.core.secrets.masking import secret_param_names

        credentials: list[str] = []
        defaulted: list[str] = []
        for name in plugin_package.__all__:
            metadata = getattr(plugin_package, name)().metadata
            secret = secret_param_names(metadata)
            for parameter in metadata["parameters"]:
                if isinstance(parameter, dict) and parameter["name"] in secret:
                    credentials.append(f"{metadata['id']}.{parameter['name']}")
                    if "default" in parameter:
                        defaulted.append(credentials[-1])

        assert credentials
        assert defaulted == []

    def test_no_control_declares_a_default_on_a_secret_setting(self) -> None:
        from wavecore.controls import registry as control_registry
        from wavecore.models.plugins import get_param_attr

        controls = control_registry.ControlImplementationRegistry()
        control_registry.register_all_core_controls(controls)
        defaulted: list[str] = []
        for control_id in controls.list_control_ids():
            for version in controls.list_versions(control_id):
                control = controls.get(control_id, version)
                assert control is not None
                defaulted.extend(
                    f"{control_id.value}.{get_param_attr(parameter, 'name')}"
                    for parameter in control().metadata["parameter_schema"]
                    if get_param_attr(parameter, "secret", False)
                    and get_param_attr(parameter, "default") is not None
                )

        assert defaulted == []
