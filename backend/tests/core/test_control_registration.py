"""
Unit tests for WAVE Control Registration.

Requirements tested:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.11: Control registry for runtime version lookup
- REQ-3.5.0.12: Control registration at application startup
"""

from abc import ABC
from typing import Any

import pytest

# =============================================================================
# REQ-3.5.0.10: Control base class with metadata declaration
# =============================================================================


class TestControlBaseClassStructure:
    """Test ControlBase abstract class structure (REQ-3.5.0.10)."""

    def test_control_base_is_abstract_class(self):
        """Verify ControlBase is an abstract base class."""
        from wavecore.controls.base import ControlBase

        assert issubclass(ControlBase, ABC)

    def test_control_base_cannot_be_instantiated_directly(self):
        """Verify ControlBase cannot be instantiated without implementing abstract methods."""
        from wavecore.controls.base import ControlBase

        with pytest.raises(TypeError, match="Can't instantiate abstract class"):
            ControlBase()  # type: ignore


class TestControlBaseMetadataDeclaration:
    """Test control metadata declaration (REQ-3.5.0.10)."""

    def test_control_base_requires_metadata_property(self):
        """Verify ControlBase requires metadata property to be implemented."""
        from wavecore.controls.base import ControlBase

        # metadata must be an abstract property
        assert hasattr(ControlBase, "metadata")
        assert getattr(ControlBase.metadata, "fget", None) is not None

    def test_control_metadata_includes_control_identifier(self):
        """Verify metadata includes control identifier."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.IF_ELSE,
                    "version": "1.0.0",
                    "name": "Test Control",
                    "description": "Test",
                    "category": "conditional",
                    "icon_name": "git-branch",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "branching"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                pass

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        assert "id" in control.metadata
        assert control.metadata["id"] == ControlId.IF_ELSE

    def test_control_metadata_includes_semantic_version(self):
        """Verify metadata includes semantic version."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.2.3",
                    "name": "Test Control",
                    "description": "Test",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                pass

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        assert control.metadata["version"] == "1.2.3"

    def test_control_metadata_includes_parameter_schema(self):
        """Verify metadata includes parameter schema for configuration."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.IF_ELSE,
                    "version": "1.0.0",
                    "name": "If/Else",
                    "description": "Conditional branching",
                    "category": "conditional",
                    "icon_name": "git-branch",
                    "parameter_schema": [
                        ControlParameter(
                            name="condition",
                            type="string",
                            required=True,
                            description="Boolean condition to evaluate",
                        )
                    ],
                    "output_schema": [],
                    "structure_hints": {"type": "branching"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                pass

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        assert "parameter_schema" in control.metadata
        assert len(control.metadata["parameter_schema"]) == 1
        assert control.metadata["parameter_schema"][0].name == "condition"

    def test_control_metadata_includes_structure_hints(self):
        """Verify metadata includes structural hints for visual rendering."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.PARALLEL,
                    "version": "1.0.0",
                    "name": "Parallel",
                    "description": "Parallel execution",
                    "category": "flow",
                    "icon_name": "git-merge",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {
                        "type": "branching",
                        "branches": ["branch_1", "branch_2"],
                        "allows_dynamic_branches": True,
                    },
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                pass

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        hints = control.metadata["structure_hints"]
        assert hints["type"] == "branching"
        assert "branches" in hints


class TestControlBaseExecutionContract:
    """Test control execution contract (REQ-3.5.0.10)."""

    def test_control_base_requires_execute_method(self):
        """Verify ControlBase requires execute method to be implemented."""
        from wavecore.controls.base import ControlBase

        # execute must be an abstract method
        assert hasattr(ControlBase, "execute")

    def test_execute_receives_context_parameter(self):
        """Verify execute method receives execution context."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            received_context: dict[str, Any] | None = None

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                self.received_context = context
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        import asyncio

        control = TestControl()
        test_context = {"variables": {"x": 1}, "parameters": {}}
        asyncio.run(control.execute(test_context))
        assert control.received_context == test_context

    def test_execute_is_async(self):
        """Verify execute method is async for non-blocking execution."""
        import asyncio
        import inspect

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "result"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        assert inspect.iscoroutinefunction(control.execute)
        result = asyncio.run(control.execute({}))
        assert result == "result"


class TestControlBaseLifecycleHooks:
    """Test control lifecycle hooks (REQ-3.5.0.10)."""

    def test_control_base_has_initialize_hook(self):
        """Verify ControlBase provides initialize lifecycle hook."""
        from wavecore.controls.base import ControlBase

        assert hasattr(ControlBase, "initialize")

    def test_initialize_is_optional_with_default_impl(self):
        """Verify initialize has default no-op implementation."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        # Should not raise - default implementation does nothing
        asyncio.run(control.initialize({}))

    def test_control_base_has_cleanup_hook(self):
        """Verify ControlBase provides cleanup lifecycle hook."""
        from wavecore.controls.base import ControlBase

        assert hasattr(ControlBase, "cleanup")

    def test_cleanup_is_optional_with_default_impl(self):
        """Verify cleanup has default no-op implementation."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        # Should not raise - default implementation does nothing
        asyncio.run(control.cleanup())

    def test_initialize_can_be_overridden(self):
        """Verify initialize can be overridden for custom setup."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            initialized: bool = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

            async def initialize(self, context: dict[str, Any]) -> None:
                self.initialized = True

        control = TestControl()
        asyncio.run(control.initialize({}))
        assert control.initialized is True

    def test_cleanup_can_be_overridden(self):
        """Verify cleanup can be overridden for custom teardown."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            cleaned_up: bool = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

            async def cleanup(self) -> None:
                self.cleaned_up = True

        control = TestControl()
        asyncio.run(control.cleanup())
        assert control.cleaned_up is True


class TestControlBaseValidationInterface:
    """Test control validation interface (REQ-3.5.0.10)."""

    def test_control_base_requires_validate_method(self):
        """Verify ControlBase requires validate method to be implemented."""
        from wavecore.controls.base import ControlBase

        assert hasattr(ControlBase, "validate")

    def test_validate_receives_parameters(self):
        """Verify validate method receives parameter values."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            validated_params: dict[str, Any] | None = None

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.IF_ELSE,
                    "version": "1.0.0",
                    "name": "If/Else",
                    "description": "Conditional",
                    "category": "conditional",
                    "icon_name": "git-branch",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "branching"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                self.validated_params = params

        control = TestControl()
        test_params = {"condition": "x > 5"}
        asyncio.run(control.validate(test_params))
        assert control.validated_params == test_params

    def test_validate_raises_on_invalid_params(self):
        """Verify validate raises ValueError on invalid parameters."""
        import asyncio

        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.FOR,
                    "version": "1.0.0",
                    "name": "For Loop",
                    "description": "Iterate",
                    "category": "loop",
                    "icon_name": "repeat",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "looping"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                if "iterator" not in params:
                    raise ValueError("iterator parameter is required")

        control = TestControl()
        with pytest.raises(ValueError, match="^iterator parameter is required$"):
            asyncio.run(control.validate({}))


class TestControlBaseIntrospection:
    """Test control introspection without instantiation (REQ-3.5.0.10)."""

    def test_control_class_can_provide_metadata_without_instance(self):
        """Verify concrete controls enable introspection without instantiation."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            # Class-level metadata for introspection
            CONTROL_ID = ControlId.DELAY
            CONTROL_VERSION = "1.0.0"
            CONTROL_NAME = "Delay"
            CONTROL_CATEGORY = "timing"

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": self.CONTROL_ID,
                    "version": self.CONTROL_VERSION,
                    "name": self.CONTROL_NAME,
                    "description": "Pause execution",
                    "category": self.CONTROL_CATEGORY,
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        # Can inspect class attributes without instantiation
        assert TestControl.CONTROL_ID == ControlId.DELAY
        assert TestControl.CONTROL_VERSION == "1.0.0"
        assert TestControl.CONTROL_NAME == "Delay"


class TestControlBaseGetControlMetadataModel:
    """Test helper method for Pydantic model conversion (REQ-3.5.0.10)."""

    def test_get_control_metadata_returns_pydantic_model(self):
        """Verify get_control_metadata returns validated Pydantic model."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause execution for specified duration",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        model = control.get_control_metadata()
        assert isinstance(model, ControlMetadata)
        assert model.id == ControlId.DELAY
        assert model.version == "1.0.0"
        assert model.name == "Delay"

    def test_get_control_metadata_validates_version(self):
        """Verify get_control_metadata rejects invalid semantic version."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "invalid",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        with pytest.raises(ValueError, match="Invalid semantic version"):
            control.get_control_metadata()

    def test_get_control_metadata_raises_when_output_schema_missing(self):
        """Verify get_control_metadata raises ValueError when output_schema is absent."""
        from wavecore.controls.base import ControlBase
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause execution for specified duration",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "structure_hints": {"type": "sequential"},
                    # output_schema intentionally omitted
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        control = TestControl()
        with pytest.raises(
            ValueError,
            match="^Control 'ControlId.DELAY' missing required 'output_schema' in metadata$",
        ):
            control.get_control_metadata()


# =============================================================================
# REQ-3.5.0.11: Control registry for runtime version lookup
# =============================================================================


class TestControlRegistryWithImplementations:
    """Test control registry with implementation classes (REQ-3.5.0.11)."""

    def test_registry_stores_control_implementations(self):
        """Verify registry can store control implementation classes."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        impl = registry.get(ControlId.DELAY, "1.0.0")
        assert impl is not None
        assert impl == TestControl

    def test_registry_get_returns_none_for_missing(self):
        """Verify registry returns None for unregistered controls."""
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        assert registry.get(ControlId.DELAY, "1.0.0") is None

    def test_registry_get_returns_none_for_missing_version(self):
        """Verify registry returns None for unregistered versions."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        assert registry.get(ControlId.DELAY, "2.0.0") is None


class TestControlRegistryVersionResolution:
    """Test version constraint resolution (REQ-3.5.0.11)."""

    def test_resolve_exact_version(self):
        """Verify exact version pin resolves correctly."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV1(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV1)

        impl = registry.resolve(ControlId.DELAY, "1.0.0")
        assert impl == TestControlV1

    def test_resolve_caret_constraint(self):
        """Verify caret constraint resolves to highest compatible version."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV1(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV12(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.2.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV2(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "2.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV1)
        registry.register(TestControlV12)
        registry.register(TestControlV2)

        # ^1.0.0 should resolve to 1.2.0 (highest 1.x)
        impl = registry.resolve(ControlId.DELAY, "^1.0.0")
        assert impl == TestControlV12

    def test_resolve_tilde_constraint(self):
        """Verify tilde constraint resolves to highest patch version."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV100(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV101(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.1",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV110(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.1.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV100)
        registry.register(TestControlV101)
        registry.register(TestControlV110)

        # ~1.0.0 should resolve to 1.0.1 (highest 1.0.x, not 1.1.0)
        impl = registry.resolve(ControlId.DELAY, "~1.0.0")
        assert impl == TestControlV101

    def test_resolve_range_constraint(self):
        """Verify range constraint resolves within specified bounds."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV100(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV150(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.5.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV200(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "2.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV100)
        registry.register(TestControlV150)
        registry.register(TestControlV200)

        # >=1.0.0,<2.0.0 should resolve to 1.5.0 (highest within range)
        impl = registry.resolve(ControlId.DELAY, ">=1.0.0,<2.0.0")
        assert impl == TestControlV150

    def test_resolve_prefers_non_deprecated(self):
        """Verify version resolution prefers non-deprecated versions."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV1(ControlBase):
            DEPRECATED = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                    "deprecated": self.DEPRECATED,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV11(ControlBase):
            DEPRECATED = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.1.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                    "deprecated": self.DEPRECATED,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV12Deprecated(ControlBase):
            DEPRECATED = True

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.2.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                    "deprecated": self.DEPRECATED,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV1)
        registry.register(TestControlV11)
        registry.register(TestControlV12Deprecated, deprecated=True)

        # ^1.0.0 should resolve to 1.1.0 (skips deprecated 1.2.0)
        impl = registry.resolve(ControlId.DELAY, "^1.0.0")
        assert impl == TestControlV11

    def test_resolve_returns_deprecated_when_only_option(self):
        """Verify resolution returns deprecated version when it's the only match."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV1Deprecated(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                    "deprecated": True,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV1Deprecated, deprecated=True)

        # Should return deprecated version when it's the only match
        impl = registry.resolve(ControlId.DELAY, "^1.0.0")
        assert impl == TestControlV1Deprecated

    def test_resolve_raises_on_no_match(self):
        """Verify resolution raises VersionNotFoundError when no match exists."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        with pytest.raises(VersionNotFoundError):
            registry.resolve(ControlId.DELAY, "2.0.0")


class TestControlRegistryIndexedLookup:
    """Test indexed structures for constant-time lookup (REQ-3.5.0.11)."""

    def test_lookup_by_control_id_is_constant_time(self):
        """Verify lookup by control ID uses indexed structure."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        # Registry should use dict for O(1) lookup
        assert hasattr(registry, "_implementations")
        assert isinstance(registry._implementations, dict)

    def test_lookup_by_version_is_constant_time(self):
        """Verify lookup by version uses indexed structure."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        # Version lookup within control ID should also be O(1)
        assert ControlId.DELAY in registry._implementations
        assert isinstance(registry._implementations[ControlId.DELAY], dict)


class TestControlRegistryEnumeration:
    """Test registry enumeration capabilities (REQ-3.5.0.11)."""

    def test_list_versions_for_control_id(self):
        """Verify registry can list all versions registered for a control ID."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControlV1(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlV2(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "2.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControlV1)
        registry.register(TestControlV2)

        versions = registry.list_versions(ControlId.DELAY)
        assert set(versions) == {"1.0.0", "2.0.0"}

    def test_list_versions_returns_empty_for_unregistered_control(self):
        """Verify list_versions returns empty list for unregistered control ID."""
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        versions = registry.list_versions(ControlId.DELAY)
        assert versions == []

    def test_list_control_ids(self):
        """Verify registry can list all registered control IDs."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class DelayControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class IfElseControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.IF_ELSE,
                    "version": "1.0.0",
                    "name": "If/Else",
                    "description": "Conditional",
                    "category": "conditional",
                    "icon_name": "git-branch",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "branching"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(DelayControl)
        registry.register(IfElseControl)

        control_ids = registry.list_control_ids()
        assert set(control_ids) == {ControlId.DELAY, ControlId.IF_ELSE}

    def test_list_control_ids_returns_empty_for_empty_registry(self):
        """Verify list_control_ids returns empty list for empty registry."""
        from wavecore.controls.registry import ControlImplementationRegistry

        registry = ControlImplementationRegistry()
        control_ids = registry.list_control_ids()
        assert control_ids == []


class TestControlRegistryImmutability:
    """Test immutable-after-startup design (REQ-3.5.0.11)."""

    def test_registry_can_be_frozen(self):
        """Verify registry can be frozen after startup to prevent modifications."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControl2(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "2.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)
        registry.freeze()

        with pytest.raises(RuntimeError, match="Registry is frozen"):
            registry.register(TestControl2)

    def test_frozen_registry_allows_reads(self):
        """Verify frozen registry still allows read operations."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)
        registry.freeze()

        # Read operations should still work
        impl = registry.get(ControlId.DELAY, "1.0.0")
        assert impl == TestControl


class TestControlRegistryClearMethod:
    """Test registry clear method (REQ-3.5.0.11)."""

    def test_registry_clear_removes_all_implementations(self):
        """Verify clear removes all registered implementations."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)
        assert registry.get(ControlId.DELAY, "1.0.0") is not None

        registry.clear()
        assert registry.get(ControlId.DELAY, "1.0.0") is None

    def test_clear_also_unfreezes_registry(self):
        """Verify clear unfreezes the registry for re-registration."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)
        registry.freeze()
        registry.clear()

        # Should be able to register again
        registry.register(TestControl)
        assert registry.get(ControlId.DELAY, "1.0.0") == TestControl


# =============================================================================
# REQ-3.5.0.12: Control registration at application startup
# =============================================================================


class TestControlRegistrationAtStartup:
    """Test control registration during application startup (REQ-3.5.0.12)."""

    def test_register_all_core_controls_loads_15_controls(self):
        """Verify register_all_core_controls registers all 15 control types."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        # Verify all 15 controls are registered
        for control_id in ControlId:
            impl = registry.get(control_id, "1.0.0")
            assert impl is not None, f"Missing implementation for {control_id.name}"

    def test_core_controls_register_at_version_1_0_0(self):
        """Verify core controls register at initial version 1.0.0."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        # All core controls should have 1.0.0 version
        for control_id in ControlId:
            impl = registry.get(control_id, "1.0.0")
            assert impl is not None
            # Verify the implementation's metadata matches
            instance = impl()
            assert instance.metadata["version"] == "1.0.0"


class TestControlRegistrationValidation:
    """Test registration validates entries at startup (REQ-3.5.0.12)."""

    def test_registration_rejects_duplicate_versions(self):
        """Verify duplicate version registration fails immediately."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            DuplicateControlVersionError,
        )
        from wavecore.models.enums import ControlId

        class TestControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        class TestControlDupe(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",  # Same version
                    "name": "Delay Dupe",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        registry.register(TestControl)

        with pytest.raises(DuplicateControlVersionError):
            registry.register(TestControlDupe)

    def test_registration_rejects_missing_metadata(self):
        """Verify registration fails for controls with missing metadata fields."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    # Missing required fields: id, version, name, etc.
                    "description": "Incomplete",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Missing required metadata"):
            registry.register(BadControl)

    def test_registration_rejects_invalid_parameter_schema(self):
        """Verify registration fails for controls with invalid parameter schemas."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [{"name": "", "type": "string"}],  # Empty name is invalid
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Invalid parameter schema"):
            registry.register(BadControl)

    def test_registration_rejects_invalid_semver(self):
        """Verify registration fails for controls with invalid semantic version."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "not-a-version",  # Invalid semver
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Invalid semantic version"):
            registry.register(BadControl)

    def test_registration_rejects_missing_category(self):
        """Verify registration fails for controls missing category field."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    # Missing: "category"
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Missing required metadata"):
            registry.register(BadControl)

    def test_registration_rejects_missing_icon_name(self):
        """Verify registration fails for controls missing icon_name field."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    # Missing: "icon_name"
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Missing required metadata"):
            registry.register(BadControl)

    def test_registration_rejects_missing_structure_hints(self):
        """Verify registration fails for controls missing structure_hints field."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    # Missing: "structure_hints"
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Missing required metadata"):
            registry.register(BadControl)

    def test_registration_rejects_invalid_category(self):
        """Verify registration fails for controls with invalid category value."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class BadControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "invalid_category",  # Not in: conditional, loop, flow, timing
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()

        with pytest.raises(InvalidControlMetadataError, match="Invalid category"):
            registry.register(BadControl)


class TestControlRegistrationCompletesBeforeRequests:
    """Test registration completes before application accepts requests (REQ-3.5.0.12)."""

    def test_startup_registration_is_synchronous(self):
        """Verify startup registration is synchronous to complete before requests."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()

        # Registration should be synchronous
        register_all_core_controls(registry)

        # All controls should be immediately available
        for control_id in ControlId:
            assert registry.get(control_id, "1.0.0") is not None

    def test_registration_freezes_registry_after_startup(self):
        """Verify registry is frozen after startup registration completes."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry, freeze_after=True)

        # Registry should be frozen
        class LateControl(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "2.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        with pytest.raises(RuntimeError, match="Registry is frozen"):
            registry.register(LateControl)


class TestCoreControlImplementations:
    """Test that all 13 core control implementations exist (REQ-3.5.0.12)."""

    def test_if_else_control_exists(self):
        """Verify If/Else control implementation exists."""
        from wavecore.controls.conditional import IfElseControl
        from wavecore.models.enums import ControlId

        instance = IfElseControl()
        assert instance.metadata["id"] == ControlId.IF_ELSE

    def test_switch_case_control_exists(self):
        """Verify Switch/Case control implementation exists."""
        from wavecore.controls.conditional import SwitchCaseControl
        from wavecore.models.enums import ControlId

        instance = SwitchCaseControl()
        assert instance.metadata["id"] == ControlId.SWITCH_CASE

    def test_assert_control_exists(self):
        """Verify Assert control implementation exists."""
        from wavecore.controls.conditional import AssertControl
        from wavecore.models.enums import ControlId

        instance = AssertControl()
        assert instance.metadata["id"] == ControlId.ASSERT

    def test_for_control_exists(self):
        """Verify For loop control implementation exists."""
        from wavecore.controls.loop import ForControl
        from wavecore.models.enums import ControlId

        instance = ForControl()
        assert instance.metadata["id"] == ControlId.FOR

    def test_for_each_control_exists(self):
        """Verify ForEach control implementation exists."""
        from wavecore.controls.loop import ForEachControl
        from wavecore.models.enums import ControlId

        instance = ForEachControl()
        assert instance.metadata["id"] == ControlId.FOR_EACH

    def test_while_control_exists(self):
        """Verify While control implementation exists."""
        from wavecore.controls.loop import WhileControl
        from wavecore.models.enums import ControlId

        instance = WhileControl()
        assert instance.metadata["id"] == ControlId.WHILE

    def test_break_control_exists(self):
        """Verify Break control implementation exists."""
        from wavecore.controls.loop import BreakControl
        from wavecore.models.enums import ControlId

        instance = BreakControl()
        assert instance.metadata["id"] == ControlId.BREAK

    def test_continue_control_exists(self):
        """Verify Continue control implementation exists."""
        from wavecore.controls.loop import ContinueControl
        from wavecore.models.enums import ControlId

        instance = ContinueControl()
        assert instance.metadata["id"] == ControlId.CONTINUE

    def test_parallel_control_exists(self):
        """Verify Parallel control implementation exists."""
        from wavecore.controls.flow import ParallelControl
        from wavecore.models.enums import ControlId

        instance = ParallelControl()
        assert instance.metadata["id"] == ControlId.PARALLEL

    def test_try_catch_finally_control_exists(self):
        """Verify Try/Catch/Finally control implementation exists."""
        from wavecore.controls.flow import TryCatchFinallyControl
        from wavecore.models.enums import ControlId

        instance = TryCatchFinallyControl()
        assert instance.metadata["id"] == ControlId.TRY_CATCH_FINALLY

    def test_halt_control_exists(self):
        """Verify Halt control implementation exists."""
        from wavecore.controls.flow import HaltControl
        from wavecore.models.enums import ControlId

        instance = HaltControl()
        assert instance.metadata["id"] == ControlId.HALT

    def test_delay_control_exists(self):
        """Verify Delay control implementation exists."""
        from wavecore.controls.timing import DelayControl
        from wavecore.models.enums import ControlId

        instance = DelayControl()
        assert instance.metadata["id"] == ControlId.DELAY

    def test_wait_until_control_exists(self):
        """Verify WaitUntil control implementation exists."""
        from wavecore.controls.timing import WaitUntilControl
        from wavecore.models.enums import ControlId

        instance = WaitUntilControl()
        assert instance.metadata["id"] == ControlId.WAIT_UNTIL

    def test_wait_until_resolves_at_its_implemented_version(self):
        """Verify WaitUntil is registered and resolvable at 1.0.0."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        impl = registry.get(ControlId.WAIT_UNTIL, "1.0.0")
        assert impl is not None
        assert impl().metadata["version"] == "1.0.0"


class TestGlobalControlRegistry:
    """Test global control registry instance (REQ-3.5.0.11, REQ-3.5.0.12)."""

    def test_global_registry_instance_exists(self):
        """Verify global registry instance is available."""
        from wavecore.controls.registry import get_control_implementation

        # Should not raise - global registry exists
        assert callable(get_control_implementation)

    def test_get_control_implementation_returns_class(self):
        """Verify get_control_implementation returns control implementation class."""
        from wavecore.controls.registry import _registry as global_registry
        from wavecore.controls.registry import (
            get_control_implementation,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        # Ensure core controls are registered
        global_registry.clear()
        register_all_core_controls(global_registry)

        impl = get_control_implementation(ControlId.DELAY, "1.0.0")
        assert impl is not None

        # Should be instantiable
        instance = impl()
        assert instance.metadata["id"] == ControlId.DELAY

    def test_clear_global_registry(self):
        """Verify global registry can be cleared."""
        from wavecore.controls.registry import _registry as global_registry
        from wavecore.controls.registry import (
            clear_control_registry,
            get_control_implementation,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        # Register and then clear
        register_all_core_controls(global_registry)
        clear_control_registry()

        # Should return None after clear
        impl = get_control_implementation(ControlId.DELAY, "1.0.0")
        assert impl is None


class TestConcreteControlExecuteValidate:
    """Test execute and validate methods of concrete control implementations (REQ-3.5.0.10)."""

    def test_if_else_execute_returns_branch(self):
        """Verify IfElse execute returns branch decision."""
        import asyncio

        from wavecore.controls.conditional import IfElseControl

        control = IfElseControl()
        context = {
            "parameters": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "conditions": [
                            {
                                "type": "literal",
                                "variable": "x",
                                "value_type": "integer",
                                "operator": "equals",
                                "reference_value": 1,
                            },
                        ],
                    },
                ],
            },
            "variables": {"x": 1},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "branch_0"}

    def test_if_else_validate_requires_branches(self):
        """Verify IfElse validate requires branches parameter."""
        import asyncio

        from wavecore.controls.conditional import IfElseControl

        control = IfElseControl()
        with pytest.raises(ValueError, match="branches parameter is required"):
            asyncio.run(control.validate({}))

    def test_if_else_validate_passes_with_branches(self):
        """Verify IfElse validate passes with valid branches."""
        import asyncio

        from wavecore.controls.conditional import IfElseControl

        control = IfElseControl()
        asyncio.run(
            control.validate(
                {
                    "branches": [
                        {
                            "id": "branch_0",
                            "type": "if",
                            "conditions": [
                                {
                                    "type": "literal",
                                    "variable": "x",
                                    "value_type": "integer",
                                    "operator": "equals",
                                    "reference_value": 1,
                                },
                            ],
                        },
                    ],
                }
            )
        )

    def test_assert_execute_returns_passed_result(self):
        """Verify Assert execute returns dict with passed key."""
        import asyncio

        from wavecore.controls.conditional import AssertControl

        control = AssertControl()
        context = {
            "parameters": {
                "assertions": [
                    {
                        "type": "literal",
                        "variable": "x",
                        "value_type": "integer",
                        "operator": "equals",
                        "reference_value": 10,
                    }
                ],
                "mode": "single",
            },
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True}

    def test_assert_validate_requires_assertions(self):
        """Verify Assert validate requires assertions parameter."""
        import asyncio

        from wavecore.controls.conditional import AssertControl

        control = AssertControl()
        with pytest.raises(ValueError, match="assertions parameter is required"):
            asyncio.run(control.validate({}))

    def test_assert_validate_passes_with_assertions(self):
        """Verify Assert validate passes with assertions parameter."""
        import asyncio

        from wavecore.controls.conditional import AssertControl

        control = AssertControl()
        assertions = [{"type": "literal", "variable": "x", "operator": "equals"}]
        asyncio.run(control.validate({"assertions": assertions}))

    def test_for_execute_returns_signals(self):
        """Verify For execute returns __for_loop signal dict."""
        import asyncio

        from wavecore.controls.loop import ForControl

        control = ForControl()
        context = {"parameters": {"mode": "count", "count": 5}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__for_loop"] is True

    def test_for_validate_count_mode(self):
        """Verify For validate requires count in count mode."""
        import asyncio

        from wavecore.controls.loop import ForControl

        control = ForControl()
        with pytest.raises(ValueError, match="count is required when mode is 'count'"):
            asyncio.run(control.validate({"mode": "count"}))

    def test_for_validate_range_mode(self):
        """Verify For validate requires start and end in range mode."""
        import asyncio

        from wavecore.controls.loop import ForControl

        control = ForControl()
        with pytest.raises(ValueError, match="start is required when mode is 'range'"):
            asyncio.run(control.validate({"mode": "range"}))

    def test_for_validate_passes_count_mode(self):
        """Verify For validate passes with valid count mode parameters."""
        import asyncio

        from wavecore.controls.loop import ForControl

        control = ForControl()
        asyncio.run(control.validate({"mode": "count", "count": 5}))

    def test_for_each_execute_returns_signals(self):
        """Verify ForEach execute returns engine signals dict."""
        import asyncio

        from wavecore.controls.loop import ForEachControl

        control = ForEachControl()
        result = asyncio.run(control.execute({"parameters": {"collection": ["a", "b"]}}))
        assert result["__for_each"] is True
        assert result["__collection"] == ["a", "b"]

    def test_for_each_validate_requires_collection(self):
        """Verify ForEach validate requires collection parameter."""
        import asyncio

        from wavecore.controls.loop import ForEachControl

        control = ForEachControl()
        with pytest.raises(ValueError, match="collection parameter is required"):
            asyncio.run(control.validate({}))

    def test_for_each_validate_passes_with_collection(self):
        """Verify ForEach validate passes with collection parameter."""
        import asyncio

        from wavecore.controls.loop import ForEachControl

        control = ForEachControl()
        asyncio.run(control.validate({"collection": ["item1", "item2"]}))

    def test_while_execute_returns_engine_signals(self):
        """Verify While execute returns engine signals."""
        import asyncio

        from wavecore.controls.loop import WhileControl

        control = WhileControl()
        result = asyncio.run(control.execute({"conditions": [], "mode": "while-do"}))
        assert result is not None
        assert result["__while_loop"] is True
        assert result["__mode"] == "while-do"
        assert result["index"] == 0

    def test_while_validate_requires_conditions(self):
        """Verify While validate requires conditions parameter."""
        import asyncio

        from wavecore.controls.loop import WhileControl

        control = WhileControl()
        with pytest.raises(ValueError, match="conditions parameter is required"):
            asyncio.run(control.validate({}))

    def test_while_validate_passes_with_conditions(self):
        """Verify While validate passes with conditions parameter."""
        import asyncio

        from wavecore.controls.loop import WhileControl

        control = WhileControl()
        asyncio.run(control.validate({"conditions": [], "mode": "while-do"}))

    def test_break_execute_returns_break_signal(self):
        """Verify Break execute returns __break signal with target."""
        import asyncio

        from wavecore.controls.loop import BreakControl

        control = BreakControl()
        result = asyncio.run(control.execute({"parameters": {"target_loop": "loop-1"}}))
        assert result["__break"] is True
        assert result["__break_target"] == "loop-1"

    def test_break_validate_requires_target_loop(self):
        """Verify Break validate rejects empty parameters (target_loop required)."""
        import asyncio

        import pytest

        from wavecore.controls.loop import BreakControl

        control = BreakControl()
        with pytest.raises(ValueError, match="^target_loop is required$"):
            asyncio.run(control.validate({}))

    def test_break_validate_accepts_valid_target(self):
        """Verify Break validate accepts non-empty target_loop."""
        import asyncio

        from wavecore.controls.loop import BreakControl

        control = BreakControl()
        asyncio.run(control.validate({"target_loop": "for-1"}))

    def test_continue_execute_returns_continue_signal(self):
        """Verify Continue execute returns __continue signal with target."""
        import asyncio

        from wavecore.controls.loop import ContinueControl

        control = ContinueControl()
        result = asyncio.run(control.execute({"parameters": {"target_loop": "loop-1"}}))
        assert result["__continue"] is True
        assert result["__continue_target"] == "loop-1"

    def test_continue_validate_requires_target_loop(self):
        """Verify Continue validate rejects empty parameters (target_loop required)."""
        import asyncio

        import pytest

        from wavecore.controls.loop import ContinueControl

        control = ContinueControl()
        with pytest.raises(ValueError, match="^target_loop is required$"):
            asyncio.run(control.validate({}))

    def test_continue_validate_accepts_valid_target(self):
        """Verify Continue validate accepts non-empty target_loop."""
        import asyncio

        from wavecore.controls.loop import ContinueControl

        control = ContinueControl()
        asyncio.run(control.validate({"target_loop": "while-1"}))

    def test_try_catch_finally_execute_returns_none(self):
        """Verify TryCatchFinally execute returns engine signals."""
        import asyncio

        from wavecore.controls.flow import TryCatchFinallyControl

        control = TryCatchFinallyControl()
        result = asyncio.run(control.execute({"parameters": {}, "variables": {}}))
        assert result["__branch"] == "try"
        assert result["__try_catch"] is True

    def test_try_catch_finally_validate_accepts_empty_params(self):
        """Verify TryCatchFinally validate accepts empty params (no required params)."""
        import asyncio

        from wavecore.controls.flow import TryCatchFinallyControl

        control = TryCatchFinallyControl()
        asyncio.run(control.validate({}))

    def test_halt_execute_returns_halt_signal(self):
        """Verify Halt execute returns __halt signal dict."""
        import asyncio

        from wavecore.controls.flow import HaltControl

        control = HaltControl()
        result = asyncio.run(control.execute({}))
        assert result["__halt"] is True
        assert result["__halt_scope"] == "test"
        assert result["__halt_status"] == "failed"

    def test_halt_validate_rejects_invalid_scope(self):
        """Verify Halt validate rejects invalid scope (unified runtime enum format)."""
        import asyncio

        from wavecore.controls.flow import HaltControl

        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression, function; Actual "
            r"value was 'invalid'\.$",
        ):
            asyncio.run(control.validate({"scope": "invalid"}))

    def test_halt_validate_passes_with_valid_scope(self):
        """Verify Halt validate passes with valid scope."""
        import asyncio

        from wavecore.controls.flow import HaltControl

        control = HaltControl()
        asyncio.run(control.validate({"scope": "suite"}))

    def test_delay_execute_returns_delay_info(self):
        """Verify Delay execute returns delay timing information (REQ-3.5.4.1)."""
        import asyncio

        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 10}}  # 10ms
        result = asyncio.run(control.execute(context))
        assert result is not None
        assert "planned_duration_ms" in result
        assert "actual_duration_ms" in result
        assert result["planned_duration_ms"] == 10

    def test_delay_validate_requires_duration(self):
        """Verify Delay validate requires duration parameter."""
        import asyncio

        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="duration parameter is required"):
            asyncio.run(control.validate({}))

    def test_delay_validate_passes_with_duration(self):
        """Verify Delay validate passes with duration parameter (REQ-3.5.4.1)."""
        import asyncio

        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        # Duration must be positive integer in milliseconds (frontend converts "5s" to 5000)
        asyncio.run(control.validate({"duration": 5000}))

    def test_wait_until_execute_emits_the_wait_signal(self):
        """Verify WaitUntil execute hands the engine its round parameters."""
        import asyncio

        from wavecore.controls.timing import WaitUntilControl

        control = WaitUntilControl()
        result = asyncio.run(
            control.execute(
                {
                    "parameters": {
                        "conditions": [{"id": "c1", "type": "expression", "expression": "ready"}],
                        "timeout": 30000,
                    },
                    "variables": {},
                }
            )
        )
        assert result["__wait_until"] is True

    def test_wait_until_validate_requires_conditions(self):
        """Verify WaitUntil validate requires the conditions parameter."""
        import asyncio

        from wavecore.controls.timing import WaitUntilControl

        control = WaitUntilControl()
        with pytest.raises(ValueError, match="conditions parameter is required"):
            asyncio.run(control.validate({}))

    def test_wait_until_validate_requires_timeout(self):
        """Verify WaitUntil validate requires timeout parameter."""
        import asyncio

        from wavecore.controls.timing import WaitUntilControl

        control = WaitUntilControl()
        with pytest.raises(ValueError, match="timeout parameter is required"):
            asyncio.run(
                control.validate(
                    {"conditions": [{"id": "c1", "type": "expression", "expression": "ready"}]}
                )
            )

    def test_wait_until_validate_passes_with_params(self):
        """Verify WaitUntil validate passes with required parameters."""
        import asyncio

        from wavecore.controls.timing import WaitUntilControl

        control = WaitUntilControl()
        asyncio.run(
            control.validate(
                {
                    "conditions": [{"id": "c1", "type": "expression", "expression": "ready"}],
                    "timeout": 30000,
                }
            )
        )


class TestRegistryEdgeCases:
    """Test edge cases in control registry (REQ-3.5.0.11)."""

    def test_resolve_unregistered_control_id_raises_version_not_found(self):
        """Verify resolve raises VersionNotFoundError for unregistered control ID."""
        from wavecore.controls.registry import ControlImplementationRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        # Don't register anything - call resolve on empty registry

        with pytest.raises(VersionNotFoundError):
            registry.resolve(ControlId.DELAY, "1.0.0")

    def test_registration_handles_unexpected_param_type(self):
        """Verify registration handles unexpected parameter schema types."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            InvalidControlMetadataError,
        )
        from wavecore.models.enums import ControlId

        class ControlWithBadParamType(ControlBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "1.0.0",
                    "name": "Delay",
                    "description": "Pause",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [
                        123,  # Integer - neither dict nor ControlParameter model
                    ],
                    "output_schema": [],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        registry = ControlImplementationRegistry()
        with pytest.raises(InvalidControlMetadataError, match="empty parameter name"):
            registry.register(ControlWithBadParamType)
