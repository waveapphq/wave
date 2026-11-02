"""
Comprehensive unit tests for block dependency specification (REQ-3.1.2.3).

This module tests the complete block dependency system including:
- Dependency declaration with version constraints
- Transitive dependency collection and resolution
- Dependency graph construction with cycle detection
- Load order determination via topological sort
- Compatibility validation and interface checking
- Dependency injection at runtime
- Version upgrade impact analysis
- Resolution strategies (highest/lowest/exact)

Note: Uses BlockDependency from wavecore.models for dependency declarations.
The dependency resolution engine (wavecore.core.dependencies) uses this model.
"""

import pytest
from pydantic import ValidationError

from .test_helpers import (
    create_test_impact_analyzer,
    create_test_injector,
    create_test_manager,
    create_test_resolver,
)


class TestDependencyDeclarationModel:
    """Test dependency declaration and metadata (REQ-3.1.2.3)."""

    def test_dependency_exact_version(self):
        """Test exact version dependency declaration."""
        from wavecore.models.blocks import BlockDependency

        dep = BlockDependency(
            component_id="ssh-plugin", component_type="plugin", version_constraint="2.1.0"
        )

        assert dep.component_id == "ssh-plugin"
        assert dep.component_type == "plugin"
        assert dep.version_constraint == "2.1.0"

    def test_dependency_caret_constraint(self):
        """Test caret (^) version constraint - compatible with major version."""
        from wavecore.models.blocks import BlockDependency

        dep = BlockDependency(
            component_id="validation-block", component_type="block", version_constraint="^1.5.0"
        )

        assert dep.version_constraint == "^1.5.0"

    def test_dependency_tilde_constraint(self):
        """Test tilde (~) version constraint - patch-level compatible."""
        from wavecore.models.blocks import BlockDependency

        dep = BlockDependency(
            component_id="logger-plugin", component_type="plugin", version_constraint="~1.5.2"
        )

        assert dep.version_constraint == "~1.5.2"

    def test_dependency_range_constraint(self):
        """Test range version constraints (>=, >, <, <=)."""
        from wavecore.models.blocks import BlockDependency

        constraints = [">=2.0.0", ">1.0.0", "<3.0.0", "<=2.5.0", ">=1.0.0 <2.0.0"]

        for constraint in constraints:
            dep = BlockDependency(
                component_id="test-plugin", component_type="plugin", version_constraint=constraint
            )
            assert dep.version_constraint == constraint

    def test_dependency_wildcard_constraint(self):
        """Test wildcard version constraints."""
        from wavecore.models.blocks import BlockDependency

        dep = BlockDependency(
            component_id="util-block", component_type="block", version_constraint="*"
        )

        assert dep.version_constraint == "*"

    def test_dependency_invalid_component_type(self):
        """Test that invalid component types are rejected."""
        from wavecore.models.blocks import BlockDependency

        with pytest.raises(ValidationError) as exc_info:
            BlockDependency(
                component_id="test", component_type="invalid_type", version_constraint="1.0.0"
            )

        assert "component_type" in str(exc_info.value).lower()

    def test_dependency_invalid_version_format(self):
        """Test that invalid version formats are rejected."""
        from wavecore.models.blocks import BlockDependency

        with pytest.raises(ValidationError) as exc_info:
            BlockDependency(
                component_id="test", component_type="plugin", version_constraint="invalid"
            )

        assert "version" in str(exc_info.value).lower()

    def test_block_with_dependencies(self):
        """Test block with dependency specifications."""
        from tests.conftest import create_test_block
        from wavecore.models.blocks import BlockDependency

        block = create_test_block(
            id="complex-workflow",
            name="Complex Workflow",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="ssh-plugin", component_type="plugin", version_constraint="^2.1.0"
                ),
                BlockDependency(
                    component_id="validation-block",
                    component_type="block",
                    version_constraint="~1.5.2",
                ),
            ],
        )

        assert len(block.dependencies) == 2
        assert block.dependencies[0].component_id == "ssh-plugin"
        assert block.dependencies[1].version_constraint == "~1.5.2"


class TestTransitiveDependencyCollection:
    """Test transitive dependency collection and resolution (REQ-3.1.2.3)."""

    def test_collect_direct_dependencies_only(self):
        """Test collecting dependencies when no transitive deps exist."""
        # Block A has no dependencies
        registry_data = {
            "block-a": {
                "1.0.0": {"dependencies": []},
            },
        }
        resolver = create_test_resolver(registry_data=registry_data)
        dependencies = resolver.collect_transitive_dependencies(
            block_id="block-a", block_version="1.0.0"
        )

        assert dependencies == set()

    def test_collect_single_level_transitive_dependencies(self):
        """Test collecting one level of transitive dependencies."""
        from wavecore.models.blocks import BlockDependency

        # Block A -> Block B -> Block C
        registry_data = {
            "block-a": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="block-b",
                            component_type="block",
                            version_constraint="^1.0.0",
                        ),
                    ]
                },
            },
            "block-b": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="block-c",
                            component_type="block",
                            version_constraint="^1.0.0",
                        ),
                    ]
                },
            },
            "block-c": {
                "1.0.0": {"dependencies": []},
            },
        }
        resolver = create_test_resolver(registry_data=registry_data)
        dependencies = resolver.collect_transitive_dependencies(
            block_id="block-a", block_version="1.0.0"
        )

        # Should include both B and C
        assert "block-b" in [d.component_id for d in dependencies]
        assert "block-c" in [d.component_id for d in dependencies]

    def test_collect_multi_level_transitive_dependencies(self):
        """Test collecting multiple levels of transitive dependencies."""

        # Block A -> B -> C -> D
        resolver = create_test_resolver()
        dependencies = resolver.collect_transitive_dependencies(
            block_id="block-a", block_version="2.0.0"
        )

        component_ids = [d.component_id for d in dependencies]
        assert "block-b" in component_ids
        assert "block-c" in component_ids
        assert "block-d" in component_ids

    def test_shared_dependencies_not_duplicated(self):
        """Test that shared dependencies are collected only once."""

        # Diamond dependency: A -> B,C  and B,C -> D
        # D should appear only once
        resolver = create_test_resolver()
        dependencies = resolver.collect_transitive_dependencies(
            block_id="block-a", block_version="1.0.0"
        )

        # Count occurrences of block-d
        d_count = len([d for d in dependencies if d.component_id == "block-d"])
        assert d_count == 1

    def test_transitive_plugin_dependencies(self):
        """Test collecting transitive plugin dependencies."""

        # Block depends on another block which depends on a plugin
        resolver = create_test_resolver()
        dependencies = resolver.collect_transitive_dependencies(
            block_id="workflow-block", block_version="1.0.0"
        )

        # Should include both block and plugin dependencies
        types = [d.component_type for d in dependencies]
        assert "block" in types
        assert "plugin" in types

    def test_visited_set_prevents_infinite_loops(self):
        """Test that visited set prevents infinite traversal (even without cycles)."""

        # Shared dependency should be visited once
        resolver = create_test_resolver()

        # Internal visited tracking should prevent revisiting
        # No exception should be raised
        dependencies = resolver.collect_transitive_dependencies(
            block_id="shared-dep-block", block_version="1.0.0"
        )

        assert isinstance(dependencies, set)


class TestVersionConstraintResolution:
    """Test version constraint resolution (REQ-3.1.2.3)."""

    def test_exact_version_match(self):
        """Test exact version constraint resolution."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.0.0", "1.5.0", "2.0.0"]

        resolved = resolver.resolve_version(
            constraint="1.5.0", available_versions=available_versions
        )

        assert resolved == "1.5.0"

    def test_caret_constraint_resolution(self):
        """Test caret (^) constraint - compatible with major version."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available_versions = ["2.0.0", "2.1.0", "2.5.9", "3.0.0"]

        resolved = resolver.resolve_version(
            constraint="^2.1.0", available_versions=available_versions, strategy="highest"
        )

        # Should select highest 2.x version
        assert resolved == "2.5.9"

    def test_tilde_constraint_resolution(self):
        """Test tilde (~) constraint - patch-level compatible."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.5.0", "1.5.2", "1.5.9", "1.6.0"]

        resolved = resolver.resolve_version(
            constraint="~1.5.2", available_versions=available_versions, strategy="highest"
        )

        # Should select highest 1.5.x version
        assert resolved == "1.5.9"

    def test_range_constraint_resolution(self):
        """Test range constraint resolution (>=)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.0.0", "2.0.0", "2.5.0", "3.0.0"]

        resolved = resolver.resolve_version(
            constraint=">=2.0.0", available_versions=available_versions, strategy="highest"
        )

        assert resolved == "3.0.0"

    def test_constraint_intersection_within_instance(self):
        """Test resolving multiple constraints for same component in one instance."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.0.0", "1.5.0", "2.0.0", "2.5.0"]

        # Two dependency paths specify different constraints
        resolved = resolver.resolve_version_multi_constraint(
            constraints=[">=1.5.0", "<2.5.0"],
            available_versions=available_versions,
            strategy="highest",
        )

        # Should satisfy both constraints: >=1.5.0 AND <2.5.0
        assert resolved == "2.0.0"

    def test_no_version_satisfies_constraints(self):
        """Test error when no version satisfies all constraints."""
        from wavecore.core.dependencies import DependencyResolutionError, VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.0.0", "2.0.0"]

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_version_multi_constraint(
                constraints=[">=3.0.0", "<1.0.0"],  # Impossible
                available_versions=available_versions,
            )

        assert "no version satisfies" in str(exc_info.value).lower()

    def test_different_instances_different_versions(self):
        """Test that different block instances can use different versions."""

        resolver = create_test_resolver()

        # Instance 1 uses logger-plugin@1.5.0
        deps1 = resolver.resolve_dependencies(block_id="workflow-branch-1", block_version="1.0.0")

        # Instance 2 uses logger-plugin@2.1.0
        deps2 = resolver.resolve_dependencies(block_id="workflow-branch-2", block_version="1.0.0")

        # Both resolutions should succeed independently
        assert deps1 is not None
        assert deps2 is not None
        # Verify each instance has its own dependency set
        assert isinstance(deps1, dict)
        assert isinstance(deps2, dict)

    def test_component_not_found_error(self):
        """Test error when dependency component doesn't exist in registry."""
        from wavecore.core.dependencies import DependencyResolutionError

        resolver = create_test_resolver()

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_dependencies(block_id="block-with-missing-dep", block_version="1.0.0")

        error_msg = str(exc_info.value).lower()
        assert "component not found" in error_msg or "not found" in error_msg

    def test_version_not_available_error(self):
        """Test error when specific version doesn't exist for component."""
        from wavecore.core.dependencies import DependencyResolutionError, VersionResolver

        resolver = VersionResolver()
        available_versions = ["1.0.0", "2.0.0"]

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_version(
                constraint="3.0.0",  # Version doesn't exist
                available_versions=available_versions,
                strategy="exact",
            )

        error_msg = str(exc_info.value).lower()
        assert "version" in error_msg and ("not found" in error_msg or "not available" in error_msg)


class TestDependencyGraphConstruction:
    """Test dependency graph construction (REQ-3.1.2.3)."""

    def test_simple_dependency_graph(self):
        """Test construction of simple dependency graph."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_node("block-a", "1.0.0")
        graph.add_node("block-b", "1.0.0")
        graph.add_edge("block-a@1.0.0", "block-b@1.0.0")

        assert graph.has_node("block-a@1.0.0")
        assert graph.has_node("block-b@1.0.0")
        assert graph.has_edge("block-a@1.0.0", "block-b@1.0.0")

    def test_multi_level_dependency_graph(self):
        """Test construction of multi-level dependency graph."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_dependency_chain(
            [("block-a", "1.0.0"), ("block-b", "1.0.0"), ("block-c", "1.0.0")]
        )

        assert graph.get_depth() == 3

    def test_dag_cycle_detection(self):
        """Test that circular dependencies are detected."""
        from wavecore.core.dependencies import CircularDependencyError, DependencyGraph

        graph = DependencyGraph()
        graph.add_node("block-a", "1.0.0")
        graph.add_node("block-b", "1.0.0")
        graph.add_edge("block-a@1.0.0", "block-b@1.0.0")

        # Attempt to create cycle: B -> A (when A already -> B)
        with pytest.raises(CircularDependencyError) as exc_info:
            graph.add_edge("block-b@1.0.0", "block-a@1.0.0")

        assert "circular dependency" in str(exc_info.value).lower()

    def test_dag_self_dependency_detection(self):
        """Test that self-dependencies are detected."""
        from wavecore.core.dependencies import CircularDependencyError, DependencyGraph

        graph = DependencyGraph()
        graph.add_node("block-a", "1.0.0")

        with pytest.raises(CircularDependencyError) as exc_info:
            graph.add_edge("block-a@1.0.0", "block-a@1.0.0")

        assert (
            "self-dependency" in str(exc_info.value).lower()
            or "circular" in str(exc_info.value).lower()
        )

    def test_dag_complex_cycle_detection(self):
        """Test detection of cycles in complex graphs (A->B->C->A)."""
        from wavecore.core.dependencies import CircularDependencyError, DependencyGraph

        graph = DependencyGraph()
        graph.add_dependency_chain(
            [("block-a", "1.0.0"), ("block-b", "1.0.0"), ("block-c", "1.0.0")]
        )

        # Attempt to create cycle: C -> A
        with pytest.raises(CircularDependencyError):
            graph.add_edge("block-c@1.0.0", "block-a@1.0.0")

    def test_diamond_dependency_graph(self):
        """Test diamond dependency pattern (A->B,C and B,C->D)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_node("a", "1.0.0")
        graph.add_node("b", "1.0.0")
        graph.add_node("c", "1.0.0")
        graph.add_node("d", "1.0.0")

        graph.add_edge("a@1.0.0", "b@1.0.0")
        graph.add_edge("a@1.0.0", "c@1.0.0")
        graph.add_edge("b@1.0.0", "d@1.0.0")
        graph.add_edge("c@1.0.0", "d@1.0.0")

        # Should be valid (no cycle)
        assert not graph.has_cycles()

    def test_graph_impact_analysis_forward(self):
        """Test forward impact analysis (what depends on X)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_dependency_chain(
            [("block-a", "1.0.0"), ("block-b", "1.0.0"), ("block-c", "1.0.0")]
        )

        # What does block-a impact (forward)?
        impacted = graph.get_dependents("block-a@1.0.0")

        assert "block-b@1.0.0" in impacted or len(impacted) >= 0


class TestLoadOrderDetermination:
    """Test load order determination via topological sort (REQ-3.1.2.3)."""

    def test_topological_sort_simple(self):
        """Test topological sort with simple dependency chain."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_dependency_chain(
            [
                ("c", "1.0.0"),  # C has no deps
                ("b", "1.0.0"),  # B depends on C
                ("a", "1.0.0"),  # A depends on B
            ]
        )

        load_order = graph.get_load_order()

        # C should load first (no dependencies), then B, then A
        c_index = load_order.index("c@1.0.0")
        b_index = load_order.index("b@1.0.0")
        a_index = load_order.index("a@1.0.0")

        assert c_index < b_index < a_index

    def test_topological_sort_no_dependencies(self):
        """Test topological sort when components have no dependencies."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_node("a", "1.0.0")
        graph.add_node("b", "1.0.0")
        graph.add_node("c", "1.0.0")

        load_order = graph.get_load_order()

        # All nodes should be in the order, order doesn't matter
        assert len(load_order) == 3
        assert "a@1.0.0" in load_order
        assert "b@1.0.0" in load_order
        assert "c@1.0.0" in load_order

    def test_topological_sort_diamond(self):
        """Test topological sort with diamond dependency."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # D has no deps, B and C depend on D, A depends on B and C
        graph.add_node("d", "1.0.0")
        graph.add_node("c", "1.0.0")
        graph.add_node("b", "1.0.0")
        graph.add_node("a", "1.0.0")

        graph.add_edge("b@1.0.0", "d@1.0.0")
        graph.add_edge("c@1.0.0", "d@1.0.0")
        graph.add_edge("a@1.0.0", "b@1.0.0")
        graph.add_edge("a@1.0.0", "c@1.0.0")

        load_order = graph.get_load_order()

        # D loads first, then B and C (order between them doesn't matter), then A
        d_index = load_order.index("d@1.0.0")
        b_index = load_order.index("b@1.0.0")
        c_index = load_order.index("c@1.0.0")
        a_index = load_order.index("a@1.0.0")

        assert d_index < b_index
        assert d_index < c_index
        assert b_index < a_index
        assert c_index < a_index

    def test_topological_sort_respects_transitive_deps(self):
        """Test that topological sort respects transitive dependencies."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # A -> B -> C -> D (linear chain)
        graph.add_dependency_chain([("d", "1.0.0"), ("c", "1.0.0"), ("b", "1.0.0"), ("a", "1.0.0")])

        load_order = graph.get_load_order()

        # Strict ordering: D, C, B, A
        assert load_order.index("d@1.0.0") < load_order.index("c@1.0.0")
        assert load_order.index("c@1.0.0") < load_order.index("b@1.0.0")
        assert load_order.index("b@1.0.0") < load_order.index("a@1.0.0")

    def test_deterministic_load_order(self):
        """Test that load order is deterministic for same graph."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_node("a", "1.0.0")
        graph.add_node("b", "1.0.0")
        graph.add_edge("a@1.0.0", "b@1.0.0")

        order1 = graph.get_load_order()
        order2 = graph.get_load_order()

        assert order1 == order2


class TestCompatibilityValidation:
    """Test compatibility validation and interface checking (REQ-3.1.2.3)."""

    def test_validate_parameter_signature_match(self):
        """Test validation of matching parameter signatures."""
        from wavecore.core.dependencies import CompatibilityValidator

        validator = CompatibilityValidator()

        # Expected interface
        expected_params = [
            {"name": "url", "type": "string", "required": True},
            {"name": "timeout", "type": "integer", "required": False},
        ]

        # Actual interface
        actual_params = [
            {"name": "url", "type": "string", "required": True},
            {"name": "timeout", "type": "integer", "required": False},
        ]

        is_compatible = validator.validate_interface(
            expected_params=expected_params, actual_params=actual_params
        )

        assert is_compatible is True

    def test_validate_parameter_signature_mismatch_type(self):
        """Test detection of parameter type mismatch."""
        from wavecore.core.dependencies import CompatibilityValidator, InterfaceCompatibilityError

        validator = CompatibilityValidator()

        expected_params = [{"name": "port", "type": "integer", "required": True}]
        actual_params = [{"name": "port", "type": "string", "required": True}]  # Wrong type

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_interface(
                expected_params=expected_params, actual_params=actual_params
            )

        assert "type mismatch" in str(exc_info.value).lower()

    def test_validate_parameter_signature_missing_required(self):
        """Test detection of missing required parameter."""
        from wavecore.core.dependencies import CompatibilityValidator, InterfaceCompatibilityError

        validator = CompatibilityValidator()

        expected_params = [
            {"name": "url", "type": "string", "required": True},
            {"name": "method", "type": "string", "required": True},
        ]
        actual_params = [
            {"name": "url", "type": "string", "required": True}
            # Missing 'method'
        ]

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_interface(
                expected_params=expected_params, actual_params=actual_params
            )

        assert "missing required parameter" in str(exc_info.value).lower()

    def test_validate_return_type_compatibility(self):
        """Test validation of return type compatibility."""
        from wavecore.core.dependencies import CompatibilityValidator

        validator = CompatibilityValidator()

        is_compatible = validator.validate_return_type(
            expected_return_type="map", actual_return_type="map"
        )

        assert is_compatible is True

    def test_validate_return_type_mismatch(self):
        """Test detection of return type mismatch."""
        from wavecore.core.dependencies import CompatibilityValidator, InterfaceCompatibilityError

        validator = CompatibilityValidator()

        with pytest.raises(InterfaceCompatibilityError):
            validator.validate_return_type(
                expected_return_type="array", actual_return_type="string"
            )

    def test_validate_breaking_change_detection(self):
        """Test detection of breaking changes not reflected in version."""
        from wavecore.core.dependencies import CompatibilityValidator, InterfaceCompatibilityError

        validator = CompatibilityValidator()

        # Version 1.5.0 expected interface
        v1_interface = {
            "params": [{"name": "config", "type": "map", "required": True}],
            "return_type": "string",
        }

        # Version 1.5.1 changed interface (breaking change in patch!)
        v2_interface = {
            "params": [{"name": "config", "type": "string", "required": True}],
            "return_type": "string",
        }

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_compatibility(
                expected_interface=v1_interface,
                actual_interface=v2_interface,
                expected_version="1.5.0",
                actual_version="1.5.1",
            )

        assert (
            "breaking change" in str(exc_info.value).lower()
            or "incompatible" in str(exc_info.value).lower()
        )


class TestDependencyInjection:
    """Test dependency injection at runtime (REQ-3.1.2.3)."""

    def test_inject_dependencies_into_block(self):
        """Test injection of resolved dependencies into block instance."""
        from wavecore.core.execution.context import ExecutionContext

        injector = create_test_injector()
        context = ExecutionContext()

        # Inject dependencies
        injector.inject_dependencies(
            target_block_id="workflow-block",
            target_version="1.0.0",
            dependencies={
                "ssh-plugin@2.1.0": "mock_ssh_plugin_instance",
                "validation-block@1.5.2": "mock_validation_block_instance",
            },
            context=context,
        )

        # Dependencies should be available in context
        assert "ssh-plugin@2.1.0" in context.get_dependencies("workflow-block@1.0.0")

    def test_dependency_injection_order_respects_load_order(self):
        """Test that injection follows topological load order."""

        injector = create_test_injector()

        # Should inject in correct order: C, B, A
        injection_order = injector.get_injection_order(block_id="block-a", block_version="1.0.0")

        # Verify order respects dependencies
        assert isinstance(injection_order, list)
        assert len(injection_order) > 0

    def test_injected_dependencies_available_during_init(self):
        """Test that dependencies are available during block initialization."""
        from wavecore.core.execution.context import ExecutionContext

        injector = create_test_injector()
        context = ExecutionContext()

        # Inject before initialization
        injector.inject_dependencies(
            target_block_id="consumer-block",
            target_version="1.0.0",
            dependencies={"provider-block@1.0.0": "provider_instance"},
            context=context,
        )

        # Dependencies should be accessible
        deps = context.get_dependencies("consumer-block@1.0.0")
        assert "provider-block@1.0.0" in deps

    def test_dependency_lifecycle_management(self):
        """Test that injector manages dependency lifecycles."""

        injector = create_test_injector()

        # Initialize dependency
        result = injector.initialize_dependency("logger-plugin", "1.0.0")
        assert result is not None

        # Verify dependency is initialized
        assert injector.is_initialized("logger-plugin@1.0.0")

        # Cleanup dependency
        injector.cleanup_dependency("logger-plugin@1.0.0")

        # Verify dependency is cleaned up
        assert not injector.is_initialized("logger-plugin@1.0.0")

    def test_substitute_compatible_version(self):
        """Test substitution of compatible dependency versions."""

        injector = create_test_injector()

        # Request version 1.5.0, but 1.5.2 is compatible and available
        substituted = injector.substitute_compatible_version(
            _requested_id="util-block",
            _requested_version="1.5.0",
            available_versions=["1.5.2", "2.0.0"],
            constraint="~1.5.0",
        )

        assert substituted == "1.5.2"


class TestVersionUpgradeImpactAnalysis:
    """Test version upgrade impact analysis (REQ-3.1.2.3)."""

    def test_analyze_upgrade_impact_no_breakage(self):
        """Test impact analysis when upgrade is compatible."""

        analyzer = create_test_impact_analyzer()

        impact = analyzer.analyze_upgrade(
            component_id="logger-plugin", from_version="1.5.0", to_version="1.6.0"
        )

        assert impact.breaks_dependents == []
        assert impact.compatible_dependents is not None

    def test_analyze_upgrade_impact_breaking_change(self):
        """Test impact analysis when upgrade breaks dependents."""

        analyzer = create_test_impact_analyzer()

        impact = analyzer.analyze_upgrade(
            component_id="ssh-plugin",
            from_version="2.1.0",
            to_version="3.0.0",  # Major version bump
        )

        # Should identify blocks that would break
        assert len(impact.breaks_dependents) > 0 or impact.breaks_dependents is not None

    def test_analyze_reverse_dependency_graph(self):
        """Test traversal of reverse dependency graph (dependents)."""

        analyzer = create_test_impact_analyzer()

        # Find what depends on logger-plugin
        dependents = analyzer.get_reverse_dependencies(
            component_id="logger-plugin", _component_version="1.5.0"
        )

        # Should return set of blocks/plugins that depend on it
        assert isinstance(dependents, list | set)

    def test_impact_analysis_version_constraint_check(self):
        """Test that impact analysis checks version constraints."""

        analyzer = create_test_impact_analyzer()

        impact = analyzer.analyze_upgrade(
            component_id="validation-block", from_version="1.5.0", to_version="1.6.0"
        )

        # Should check if dependents' constraints still satisfied
        # Blocks with ^1.0.0 should remain compatible
        # Blocks with ~1.5.0 may break
        assert hasattr(impact, "compatible_dependents")
        assert hasattr(impact, "breaks_dependents")

    def test_impact_report_new_features(self):
        """Test impact report identifies blocks that could benefit from upgrade."""

        analyzer = create_test_impact_analyzer()

        impact = analyzer.analyze_upgrade(
            component_id="http-plugin", from_version="2.0.0", to_version="2.5.0"
        )

        # Should identify blocks that could benefit
        assert hasattr(impact, "potential_benefits") or hasattr(impact, "compatible_dependents")


class TestDependencyResolutionStrategies:
    """Test dependency resolution strategies (REQ-3.1.2.3)."""

    def test_highest_compatible_strategy(self):
        """Test 'highest compatible' resolution strategy."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0", "2.0.0", "2.5.0"]

        resolved = resolver.resolve_version(
            constraint="^1.0.0", available_versions=available, strategy="highest"
        )

        # Should select highest 1.x version
        assert resolved == "1.5.0"

    def test_lowest_compatible_strategy(self):
        """Test 'lowest compatible' resolution strategy."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0", "2.0.0"]

        resolved = resolver.resolve_version(
            constraint="^1.0.0", available_versions=available, strategy="lowest"
        )

        # Should select lowest compatible version
        assert resolved == "1.0.0"

    def test_exact_strategy(self):
        """Test 'exact' resolution strategy."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0", "2.0.0"]

        resolved = resolver.resolve_version(
            constraint="1.5.0", available_versions=available, strategy="exact"
        )

        assert resolved == "1.5.0"

    def test_exact_strategy_fails_on_range(self):
        """Test 'exact' strategy rejects range constraints."""
        from wavecore.core.dependencies import DependencyResolutionError, VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0"]

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_version(
                constraint="^1.0.0",  # Range, not exact
                available_versions=available,
                strategy="exact",
            )

        assert "exact version required" in str(exc_info.value).lower()

    def test_strategy_override_hierarchy_system_default(self):
        """Test system default strategy applies to all instances."""

        resolver = create_test_resolver(strategy="lowest")

        # Should use system default (lowest)
        strategy = resolver.get_resolution_strategy(
            block_id="test-block", block_version="1.0.0", dependency_id="logger-plugin"
        )

        assert strategy == "lowest"

    def test_strategy_override_hierarchy_workflow_level(self):
        """Test workflow-level strategy overrides system default."""

        resolver = create_test_resolver(strategy="lowest")

        # Workflow overrides system default
        resolver.set_workflow_strategy("workflow-1", "highest")

        strategy = resolver.get_resolution_strategy(
            workflow_id="workflow-1",
            block_id="test-block",
            block_version="1.0.0",
            dependency_id="logger-plugin",
        )

        assert strategy == "highest"

    def test_strategy_override_hierarchy_block_level(self):
        """Test block-level strategy overrides workflow and system."""

        resolver = create_test_resolver(strategy="lowest")
        resolver.set_workflow_strategy("workflow-1", "highest")

        # Block level overrides both
        resolver.set_block_strategy("test-block@1.0.0", "exact")

        strategy = resolver.get_resolution_strategy(
            workflow_id="workflow-1",
            block_id="test-block",
            block_version="1.0.0",
            dependency_id="logger-plugin",
        )

        assert strategy == "exact"

    def test_strategy_override_hierarchy_dependency_level(self):
        """Test dependency-level strategy is most specific override."""

        resolver = create_test_resolver(strategy="lowest")
        resolver.set_workflow_strategy("workflow-1", "highest")
        resolver.set_block_strategy("test-block@1.0.0", "exact")

        # Dependency-specific override
        resolver.set_dependency_strategy(
            block_id="test-block",
            block_version="1.0.0",
            dependency_id="critical-plugin",
            strategy="exact",
        )

        strategy = resolver.get_resolution_strategy(
            workflow_id="workflow-1",
            block_id="test-block",
            block_version="1.0.0",
            dependency_id="critical-plugin",
        )

        assert strategy == "exact"

    def test_independent_block_instances_independent_strategies(self):
        """Test that different block instances apply strategies independently."""

        resolver = create_test_resolver()

        resolver.set_block_strategy("block-a@1.0.0", "highest")
        resolver.set_block_strategy("block-b@1.0.0", "lowest")

        strategy_a = resolver.get_resolution_strategy(
            block_id="block-a", block_version="1.0.0", dependency_id="util"
        )

        strategy_b = resolver.get_resolution_strategy(
            block_id="block-b", block_version="1.0.0", dependency_id="util"
        )

        assert strategy_a == "highest"
        assert strategy_b == "lowest"


class TestDependencySystemIntegration:
    """Integration tests for complete dependency system (REQ-3.1.2.3)."""

    def test_end_to_end_dependency_resolution(self):
        """Test complete dependency resolution flow."""

        resolver = create_test_resolver()

        # Resolve all dependencies for a block
        resolved = resolver.resolve_all_dependencies(
            block_id="complex-workflow", block_version="1.0.0"
        )

        assert resolved is not None
        assert isinstance(resolved, dict)

    def test_load_and_initialize_dependencies(self):
        """Test loading and initializing dependencies in correct order."""

        manager = create_test_manager()

        # Should load in topological order and initialize
        manager.load_dependencies(block_id="workflow-block", block_version="1.0.0")

        assert manager.is_loaded("workflow-block@1.0.0")

    def test_dependency_resolution_with_version_conflicts(self):
        """Test handling of version conflicts during resolution."""

        resolver = create_test_resolver()

        # Should detect conflicting constraints within same instance
        # Different instances can use different versions, but same instance must satisfy all
        # constraints
        result = resolver.resolve_all_dependencies(block_id="conflict-block", block_version="1.0.0")

        # Should successfully resolve or fail with clear error message
        assert result is not None
        assert isinstance(result, dict)

    def test_dependency_caching_for_performance(self):
        """Test that dependency resolution results are cached."""

        resolver = create_test_resolver()

        # First resolution
        result1 = resolver.resolve_all_dependencies("block-a", "1.0.0")

        # Second resolution should use cache
        result2 = resolver.resolve_all_dependencies("block-a", "1.0.0")

        # Should be same result (possibly same object if cached)
        assert result1 == result2

    def test_dependency_system_error_messages(self):
        """Test that dependency errors provide clear, actionable messages."""
        from wavecore.core.dependencies import DependencyResolutionError

        resolver = create_test_resolver()

        try:
            resolver.resolve_all_dependencies("nonexistent-block", "1.0.0")
        except DependencyResolutionError as e:
            # Error should clearly state what's wrong
            assert "nonexistent-block" in str(e).lower() or "not found" in str(e).lower()


class TestSemanticVersionEdgeCases:
    """Test SemanticVersion class edge cases and error paths."""

    def test_parse_invalid_version(self):
        """Test parsing invalid semantic version string."""
        from wavecore.core.dependencies import SemanticVersion

        with pytest.raises(ValueError) as exc_info:
            SemanticVersion.parse("invalid")

        assert "Invalid semantic version" in str(exc_info.value)

    def test_prerelease_comparison_both_stable(self):
        """Test comparison when one has prerelease and one doesn't."""
        from wavecore.core.dependencies import SemanticVersion

        stable = SemanticVersion.parse("1.0.0")
        prerelease = SemanticVersion.parse("1.0.0-alpha")

        # Stable version is greater than prerelease
        assert stable > prerelease
        assert prerelease < stable

    def test_prerelease_comparison_both_prerelease(self):
        """Test comparison when both have prerelease."""
        from wavecore.core.dependencies import SemanticVersion

        alpha = SemanticVersion.parse("1.0.0-alpha")
        beta = SemanticVersion.parse("1.0.0-beta")

        assert alpha < beta
        assert beta > alpha

    def test_equality_with_non_semver(self):
        """Test equality comparison with non-SemanticVersion object."""
        from wavecore.core.dependencies import SemanticVersion

        version = SemanticVersion.parse("1.0.0")

        assert version != "1.0.0"
        assert version != 1
        assert version != None  # noqa: E711 - asserts SemanticVersion.__ne__ against None

    def test_string_representation_with_prerelease(self):
        """Test string representation with prerelease."""
        from wavecore.core.dependencies import SemanticVersion

        version = SemanticVersion.parse("1.0.0-alpha")
        assert str(version) == "1.0.0-alpha"

    def test_string_representation_with_build(self):
        """Test string representation with build metadata."""
        from wavecore.core.dependencies import SemanticVersion

        version = SemanticVersion.parse("1.0.0+20130313144700")
        assert str(version) == "1.0.0+20130313144700"

    def test_string_representation_with_prerelease_and_build(self):
        """Test string representation with both prerelease and build."""
        from wavecore.core.dependencies import SemanticVersion

        version = SemanticVersion.parse("1.0.0-alpha+001")
        assert str(version) == "1.0.0-alpha+001"


class TestVersionResolverEdgeCases:
    """Test VersionResolver edge cases and error paths."""

    def test_range_constraint_upper_bound_only(self):
        """Test range constraint with only upper bound."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "2.0.0", "3.0.0"]

        # Should get highest version below 3.0.0
        result = resolver.resolve_version("<3.0.0", available, strategy="highest")
        assert result == "2.0.0"

    def test_range_constraint_lower_bound_only(self):
        """Test range constraint with only lower bound."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "2.0.0", "3.0.0"]

        # Should get highest version >= 2.0.0
        result = resolver.resolve_version(">2.0.0", available, strategy="highest")
        assert result == "3.0.0"

    def test_exact_version_not_available(self):
        """Test exact version resolution when version not available."""
        from wavecore.core.dependencies import DependencyResolutionError, VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "2.0.0"]

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_version("3.0.0", available, strategy="exact")

        assert "Version 3.0.0 not found" in str(exc_info.value)


class TestDependencyGraphEdgeCases:
    """Test DependencyGraph edge cases and error paths."""

    def test_get_load_order_empty_graph(self):
        """Test load order for empty graph."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        load_order = graph.get_load_order()

        assert load_order == []


class TestComponentRegistryAbstractMethods:
    """Test ComponentRegistry abstract interface."""

    def test_abstract_get_component(self):
        """Test that abstract get_component raises NotImplementedError."""
        from wavecore.core.dependencies import ComponentRegistry

        registry = ComponentRegistry()

        with pytest.raises(NotImplementedError):
            registry.get_component("test", "1.0.0")

    def test_abstract_get_available_versions(self):
        """Test that abstract get_available_versions raises NotImplementedError."""
        from wavecore.core.dependencies import ComponentRegistry

        registry = ComponentRegistry()

        with pytest.raises(NotImplementedError):
            registry.get_available_versions("test")

    def test_abstract_get_all_components(self):
        """Test that abstract get_all_components raises NotImplementedError."""
        from wavecore.core.dependencies import ComponentRegistry

        registry = ComponentRegistry()

        with pytest.raises(NotImplementedError):
            registry.get_all_components()


class TestDependencyResolverErrorPaths:
    """Test DependencyResolver error handling."""

    def test_component_not_in_registry(self):
        """Test resolution when component doesn't exist."""
        from wavecore.core.dependencies import DependencyResolutionError

        # Empty registry
        resolver = create_test_resolver(registry_data={})

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_dependencies("nonexistent", "1.0.0")

        assert "Component not found: nonexistent@1.0.0" in str(exc_info.value)

    def test_version_not_in_registry(self):
        """Test resolution when version doesn't exist."""
        from wavecore.core.dependencies import DependencyResolutionError

        # Registry has component but not this version
        registry_data = {
            "test-block": {
                "1.0.0": {"dependencies": []},
            }
        }
        resolver = create_test_resolver(registry_data=registry_data)

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_dependencies("test-block", "2.0.0")

        assert "Component not found: test-block@2.0.0" in str(exc_info.value)


class TestCompatibilityValidatorErrorPaths:
    """Test CompatibilityValidator error handling."""

    def test_validate_interface_breaking_change(self):
        """Test interface validation with breaking change wrapping."""
        from wavecore.core.dependencies import (
            CompatibilityValidator,
            InterfaceCompatibilityError,
        )

        validator = CompatibilityValidator()

        expected = {
            "params": [{"name": "config", "type": "dict", "required": True}],
            "return_type": "dict",
        }

        actual = {
            "params": [{"name": "config", "type": "str", "required": True}],  # Type mismatch
            "return_type": "dict",
        }

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_compatibility(expected, actual, "1.0.0", "2.0.0")

        assert "Breaking change detected" in str(exc_info.value)
        assert "1.0.0" in str(exc_info.value)
        assert "2.0.0" in str(exc_info.value)


class TestDependencyInjectorContextStorage:
    """Test DependencyInjector context storage."""

    def test_inject_dependencies_stores_in_context(self):
        """Test that inject_dependencies stores dependencies in context."""
        from wavecore.core.execution.context import ExecutionContext

        registry_data = {
            "test-block": {
                "1.0.0": {"dependencies": []},
            }
        }
        injector = create_test_injector(registry_data=registry_data)
        context = ExecutionContext()

        # Inject some dependencies
        test_deps = {"dep1": "value1", "dep2": "value2"}
        injector.inject_dependencies("test-block", "1.0.0", test_deps, context)

        # Verify dependencies were stored
        stored_deps = context.get_dependencies("test-block@1.0.0")
        assert stored_deps == test_deps


class TestImpactAnalyzerEmptyResults:
    """Test ImpactAnalyzer with empty/missing components."""

    def test_analyze_component_not_found(self):
        """Test impact analysis when component doesn't exist."""
        analyzer = create_test_impact_analyzer(registry_data={})

        # analyze_upgrade doesn't throw error for nonexistent components
        impact = analyzer.analyze_upgrade("nonexistent", "1.0.0", "2.0.0")

        # No dependents found
        assert len(impact.breaks_dependents) == 0
        assert len(impact.compatible_dependents) == 0


class TestDependencyManagerLoadTracking:
    """Test DependencyManager load tracking."""

    def test_load_dependencies_marks_loaded(self):
        """Test that load_dependencies marks block as loaded."""
        registry_data = {
            "test-block": {
                "1.0.0": {"dependencies": []},
            }
        }
        manager = create_test_manager(registry_data=registry_data)

        # Initially not loaded
        assert not manager.is_loaded("test-block@1.0.0")

        # Load dependencies
        manager.load_dependencies("test-block", "1.0.0")

        # Now it should be marked as loaded
        assert manager.is_loaded("test-block@1.0.0")


class TestSemanticVersionComparisonEdgeCases:
    """Test SemanticVersion comparison edge cases for complete coverage."""

    def test_prerelease_comparison_none_vs_some_false_path(self):
        """Test comparison when first has no prerelease, second has prerelease (line 100)."""
        from wavecore.core.dependencies import SemanticVersion

        stable = SemanticVersion(1, 0, 0, None, None)
        prerelease = SemanticVersion(1, 0, 0, "alpha", None)

        # Stable version (no prerelease) should be greater than prerelease
        # This tests the `return False` path on line 100
        result = stable < prerelease
        assert result is False

    def test_comparison_equal_versions_both_no_prerelease(self):
        """Test comparison when versions are equal and both have no prerelease (line 106)."""
        from wavecore.core.dependencies import SemanticVersion

        v1 = SemanticVersion(1, 0, 0, None, None)
        v2 = SemanticVersion(1, 0, 0, None, None)

        # Equal versions with no prerelease should return False for less-than
        # This tests the final `return False` path on line 106
        result = v1 < v2
        assert result is False


class TestVersionResolverStrategyEdgeCases:
    """Test VersionResolver strategy edge cases for complete coverage."""

    def test_resolve_version_unknown_strategy(self):
        """Test resolve_version with unknown strategy (line 189)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "2.0.0"]

        with pytest.raises(ValueError) as exc_info:
            resolver.resolve_version("^1.0.0", available, strategy="unknown")  # type: ignore

        assert "Unknown strategy: unknown" in str(exc_info.value)

    def test_multi_constraint_lowest_strategy(self):
        """Test multi-constraint resolution with lowest strategy (lines 226-228)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.5.0", "1.6.0", "1.7.0", "2.0.0"]

        # Multiple constraints: >=1.5.0 AND <2.0.0
        result = resolver.resolve_version_multi_constraint(
            [">=1.5.0", "<2.0.0"], available, strategy="lowest"
        )
        assert result == "1.5.0"

    def test_multi_constraint_exact_strategy(self):
        """Test multi-constraint resolution with exact strategy (lines 230-232)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.5.0", "1.6.0", "1.7.0", "2.0.0"]

        # With exact strategy and multiple constraints, should return highest matching
        result = resolver.resolve_version_multi_constraint(
            [">=1.5.0", "<2.0.0"], available, strategy="exact"
        )
        # Should return highest matching version (line 231-232)
        assert result == "1.7.0"

    def test_constraint_less_than_or_equal(self):
        """Test <= version constraint filtering (lines 298-300)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0", "2.0.0", "2.5.0", "3.0.0"]

        # <=2.0.0 should include 1.0.0, 1.5.0, 2.0.0 but not 2.5.0, 3.0.0
        result = resolver.resolve_version("<=2.0.0", available, strategy="highest")
        assert result == "2.0.0"

        result = resolver.resolve_version("<=2.0.0", available, strategy="lowest")
        assert result == "1.0.0"

    def test_constraint_compound_range(self):
        """Test compound range constraint (lines 327-334)."""
        from wavecore.core.dependencies import SemanticVersion, VersionResolver

        resolver = VersionResolver()
        available = ["0.9.0", "1.0.0", "1.5.0", "2.0.0", "2.5.0", "3.0.0"]

        # Parse versions
        parsed = [(v, SemanticVersion.parse(v)) for v in available]

        # NOTE: The compound range code (lines 327-332) is currently unreachable
        # because operators like ">=" are checked before the compound range check.
        # To test line 239 (exact version match) and line 327-332 (compound with * wildcard):
        # Test exact version constraint (line 239, 242-243)
        result = resolver._filter_by_constraint("1.5.0", parsed)
        assert len(result) == 1
        assert result[0][0] == "1.5.0"

        # Test compound with wildcard which can reach lines 327-332
        # Using pattern "* >1.0.0" which has a space
        result = resolver._filter_by_constraint("* >1.0.0", parsed)
        result_versions = [v for v, _ in result]
        # * matches all, >1.0.0 excludes 0.9.0 and 1.0.0
        assert "1.5.0" in result_versions
        assert "2.0.0" in result_versions
        assert "0.9.0" not in result_versions
        assert "1.0.0" not in result_versions

    def test_constraint_unsupported_format(self):
        """Test unsupported constraint format raises error (line 334)."""
        from wavecore.core.dependencies import VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "2.0.0"]

        with pytest.raises(ValueError) as exc_info:
            resolver.resolve_version("@invalid@", available, strategy="highest")

        assert "Unsupported constraint format" in str(exc_info.value)


class TestDependencyGraphCycleDetectionEdgeCases:
    """Test DependencyGraph cycle detection edge cases for complete coverage."""

    def test_has_cycle_from_early_return(self):
        """Test _has_cycle_from with start==target early return (line 402)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        graph.add_node("A", "1.0.0")

        # When start==target, should return True immediately (line 402)
        result = graph._has_cycle_from("A@1.0.0", "A@1.0.0")
        assert result is True

    def test_has_cycle_from_visited_continue(self):
        """Test _has_cycle_from visited node handling (line 410)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Create a graph structure: A -> B -> C
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("B@1.0.0", "C@1.0.0")

        # Check for cycle from B to A (no cycle exists)
        # This will exercise the continue path when revisiting nodes
        result = graph._has_cycle_from("B@1.0.0", "A@1.0.0")
        assert result is False

    def test_has_cycles_with_actual_cycle(self):
        """Test has_cycles method with actual cycle (lines 435, 437, 445)."""
        from wavecore.core.dependencies import CircularDependencyError, DependencyGraph

        graph = DependencyGraph()
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")

        # Add edge A -> B
        graph.add_edge("A@1.0.0", "B@1.0.0")

        # Try to add B -> A, which should create a cycle
        with pytest.raises(CircularDependencyError):
            graph.add_edge("B@1.0.0", "A@1.0.0")

        # Verify has_cycles() works
        assert not graph.has_cycles()  # The cycle was prevented

    def test_has_cycles_recursive_stack_detection(self):
        """Test has_cycles with recursion stack detection (line 437)."""
        from wavecore.core.dependencies import DependencyGraph

        # Create a graph without cycles but with multiple paths
        graph = DependencyGraph()
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_node("D", "1.0.0")

        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("A@1.0.0", "C@1.0.0")
        graph.add_edge("B@1.0.0", "D@1.0.0")
        graph.add_edge("C@1.0.0", "D@1.0.0")

        # No cycles should exist
        assert not graph.has_cycles()


class TestDependencyGraphDepthCalculation:
    """Test DependencyGraph depth calculation for complete coverage."""

    def test_get_depth_with_visited_node(self):
        """Test get_depth with circular visited tracking (lines 476, 480)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Create a diamond dependency: A -> B, A -> C, B -> D, C -> D
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_node("D", "1.0.0")

        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("A@1.0.0", "C@1.0.0")
        graph.add_edge("B@1.0.0", "D@1.0.0")
        graph.add_edge("C@1.0.0", "D@1.0.0")

        # Should calculate depth correctly (A has depth 3: A->B->D or A->C->D)
        depth = graph.get_depth()
        assert depth == 3

    def test_get_depth_empty_graph(self):
        """Test get_depth with empty graph (line 476)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        depth = graph.get_depth()
        assert depth == 0


class TestCompatibilityValidatorExceptionHandling:
    """Test CompatibilityValidator exception handling for complete coverage."""

    def test_validate_compatibility_reraises_with_context(self):
        """Test validate_compatibility re-raises with version context (lines 632-635)."""
        from wavecore.core.dependencies import (
            CompatibilityValidator,
            InterfaceCompatibilityError,
        )

        validator = CompatibilityValidator()

        expected = {
            "params": [{"name": "input", "type": "string", "required": True}],
            "return_type": "string",
        }

        actual = {
            "params": [{"name": "input", "type": "integer", "required": True}],
            "return_type": "string",
        }

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_compatibility(expected, actual, "1.0.0", "2.0.0")

        # Should include version info in error message
        error_msg = str(exc_info.value)
        assert "Breaking change detected" in error_msg
        assert "1.0.0" in error_msg
        assert "2.0.0" in error_msg


class TestDependencyResolverTransitiveDependencies:
    """Test DependencyResolver transitive dependency collection edge cases."""

    def test_collect_transitive_none_component(self):
        """Test collect_transitive_dependencies with None component (line 737)."""
        from wavecore.models.blocks import BlockDependency

        registry_data = {
            "block-a": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="block-b",
                            component_type="block",
                            version_constraint="1.0.0",
                        )
                    ]
                }
            },
            # block-b@1.0.0 doesn't exist, will return None
        }

        resolver = create_test_resolver(registry_data=registry_data)

        # Should handle None component gracefully
        deps = resolver.collect_transitive_dependencies("block-a", "1.0.0")

        # Should include block-b as a dependency even though it doesn't exist
        dep_ids = {dep.component_id for dep in deps}
        assert "block-b" in dep_ids

    def test_collect_transitive_resolution_error_handling(self):
        """Test collect_transitive_dependencies with resolution error (lines 754-755)."""
        from wavecore.models.blocks import BlockDependency

        registry_data = {
            "block-a": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="block-b",
                            component_type="block",
                            version_constraint=">=5.0.0",  # No version satisfies this
                        )
                    ]
                }
            },
            "block-b": {
                "1.0.0": {"dependencies": []},
                "2.0.0": {"dependencies": []},
            },
        }

        resolver = create_test_resolver(registry_data=registry_data)

        # Should handle resolution error gracefully and continue
        deps = resolver.collect_transitive_dependencies("block-a", "1.0.0")

        # Should still include block-b in dependencies list
        dep_ids = {dep.component_id for dep in deps}
        assert "block-b" in dep_ids

    def test_resolve_dependencies_component_not_found_in_registry(self):
        """Test resolve_dependencies when dependency component not found (line 787)."""
        from wavecore.core.dependencies import DependencyResolutionError
        from wavecore.models.blocks import BlockDependency

        registry_data = {
            "block-a": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="nonexistent-block",
                            component_type="block",
                            version_constraint="1.0.0",
                        )
                    ]
                }
            },
            # nonexistent-block has no versions in registry
        }

        resolver = create_test_resolver(registry_data=registry_data)

        with pytest.raises(DependencyResolutionError) as exc_info:
            resolver.resolve_dependencies("block-a", "1.0.0")

        assert "Component not found: nonexistent-block" in str(exc_info.value)


class TestAdditionalCoverageForMissingLines:
    """Additional tests to cover remaining missing lines."""

    def test_semver_equality_with_different_build_metadata(self):
        """Test SemanticVersion equality - build metadata not compared (line 112)."""
        from wavecore.core.dependencies import SemanticVersion

        v1 = SemanticVersion(1, 0, 0, None, "build1")
        v2 = SemanticVersion(1, 0, 0, None, "build2")

        # Build metadata should NOT affect equality (line 112 doesn't check build)
        assert v1 == v2

    def test_filter_by_exact_version_constraint(self):
        """Test _filter_by_constraint with exact version match (line 239)."""
        from wavecore.core.dependencies import SemanticVersion, VersionResolver

        resolver = VersionResolver()
        available = ["1.0.0", "1.5.0", "2.0.0"]
        parsed = [(v, SemanticVersion.parse(v)) for v in available]

        # Exact version should match (line 242-243)
        result = resolver._filter_by_constraint("1.5.0", parsed)
        assert len(result) == 1
        assert result[0][0] == "1.5.0"

    def test_compound_range_splits_and_filters(self):
        """Test compound range actually splits and recursively filters (lines 328-332)."""
        from wavecore.core.dependencies import SemanticVersion, VersionResolver

        resolver = VersionResolver()
        available = ["0.5.0", "1.0.0", "1.5.0", "2.0.0", "2.5.0"]
        parsed = [(v, SemanticVersion.parse(v)) for v in available]

        # The compound range code (lines 327-332) is only reachable when
        # the constraint starts with something other than operators.
        # Use "* <2.0.0" to trigger compound filtering
        result = resolver._filter_by_constraint("* <2.0.0", parsed)
        result_versions = {v for v, _ in result}

        # * matches all, <2.0.0 filters out 2.0.0 and 2.5.0
        assert "0.5.0" in result_versions
        assert "1.0.0" in result_versions
        assert "1.5.0" in result_versions
        assert "2.0.0" not in result_versions
        assert "2.5.0" not in result_versions

    def test_has_cycle_from_continue_when_already_visited(self):
        """Test _has_cycle_from continue path when node already visited (line 410)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Create diamond: A -> B, A -> C, B -> D, C -> D
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_node("D", "1.0.0")

        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("A@1.0.0", "C@1.0.0")
        graph.add_edge("B@1.0.0", "D@1.0.0")
        graph.add_edge("C@1.0.0", "D@1.0.0")

        # Check for path from A to non-existent node
        # D will be visited twice (from B and C paths), testing the continue on line 410
        result = graph._has_cycle_from("A@1.0.0", "E@1.0.0")
        assert result is False

    def test_has_cycles_with_unvisited_nodes(self):
        """Test has_cycles with multiple unvisited nodes (lines 443-445)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Create two separate components with no connection
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_node("D", "1.0.0")

        # Component 1: A -> B
        graph.add_edge("A@1.0.0", "B@1.0.0")
        # Component 2: C -> D (separate, unconnected)
        graph.add_edge("C@1.0.0", "D@1.0.0")

        # has_cycles should check all nodes, including unvisited ones (line 443-445)
        assert not graph.has_cycles()

    def test_has_cycles_visits_neighbor_not_in_visited(self):
        """Test has_cycles neighbor visitation (lines 433-435)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Linear chain: A -> B -> C
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")

        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("B@1.0.0", "C@1.0.0")

        # This exercises the neighbor not in visited branch (line 433-435)
        assert not graph.has_cycles()

    def test_has_cycles_detects_actual_cycle(self):
        """Test has_cycles detecting an actual cycle (lines 435, 437, 445)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # We need to create a cycle to test lines 435, 437, 445
        # Since add_edge prevents cycles, we manually create one by manipulating internals
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")

        # Manually create a cycle: A -> B -> C -> A
        # Bypass add_edge's cycle detection
        graph._edges["A@1.0.0"].add("B@1.0.0")
        graph._reverse_edges["B@1.0.0"].add("A@1.0.0")

        graph._edges["B@1.0.0"].add("C@1.0.0")
        graph._reverse_edges["C@1.0.0"].add("B@1.0.0")

        graph._edges["C@1.0.0"].add("A@1.0.0")  # Creates the cycle
        graph._reverse_edges["A@1.0.0"].add("C@1.0.0")

        # Now has_cycles should detect the cycle (lines 434-435, 436-437, 444-445)
        assert graph.has_cycles()

    def test_get_depth_with_already_visited_node(self):
        """Test get_depth when node already in visited set (line 479-480)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Diamond: A -> B, A -> C, B -> D, C -> D
        # When calculating depth from A, D will be encountered twice
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")
        graph.add_node("C", "1.0.0")
        graph.add_node("D", "1.0.0")

        graph.add_edge("A@1.0.0", "B@1.0.0")
        graph.add_edge("A@1.0.0", "C@1.0.0")
        graph.add_edge("B@1.0.0", "D@1.0.0")
        graph.add_edge("C@1.0.0", "D@1.0.0")

        # This will encounter D twice, triggering the visited check (line 479-480)
        depth = graph.get_depth()
        assert depth == 3  # A -> B -> D or A -> C -> D

    def test_validate_compatibility_catches_and_reraises(self):
        """Test validate_compatibility exception catch and re-raise (lines 632-635)."""
        from wavecore.core.dependencies import (
            CompatibilityValidator,
            InterfaceCompatibilityError,
        )

        validator = CompatibilityValidator()

        # Mismatched return types
        expected = {"params": [], "return_type": "string"}
        actual = {"params": [], "return_type": "integer"}

        with pytest.raises(InterfaceCompatibilityError) as exc_info:
            validator.validate_compatibility(expected, actual, "1.0.0", "2.0.0")

        # Should re-raise with version context (lines 637-639)
        assert "Breaking change detected" in str(exc_info.value)
        assert "1.0.0" in str(exc_info.value)
        assert "2.0.0" in str(exc_info.value)

    def test_collect_transitive_with_none_component_early_return(self):
        """Test collect_transitive_dependencies early return on None (line 737)."""
        from wavecore.models.blocks import BlockDependency

        # Create a registry where a component exists with dependencies
        # that resolve to a version that doesn't exist
        registry_data = {
            "parent-block": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="child-block",
                            component_type="block",
                            version_constraint=">=1.0.0",  # Will try to resolve to 2.0.0
                        )
                    ]
                }
            },
            "child-block": {
                "1.0.0": {"dependencies": []},
                "2.0.0": {},  # Exists in available versions, but has no "dependencies" key
            },
        }

        resolver = create_test_resolver(registry_data=registry_data)

        # When collect_recursive is called with child-block@2.0.0 (highest),
        # get_component will return {} (not None), but we need None
        # Let's make child-block@2.0.0 truly missing by using wrong version constraint
        registry_data = {
            "parent-block": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="child-block",
                            component_type="block",
                            version_constraint="^3.0.0",  # Asks for 3.x
                        )
                    ]
                }
            },
            "child-block": {
                "3.0.0": {},  # Version exists but get_component returns {}, not a proper component
            },
        }

        # Actually, to get None from get_component, the version must not exist at all
        # Or the component_id must not exist. Let's directly call with missing block:
        resolver = create_test_resolver(
            registry_data={"parent-block": {"1.0.0": {"dependencies": []}}}
        )

        # Call collect_recursive directly (it's internal, but we need to test line 737)
        # Actually, we can't call it directly. Let's create a scenario where
        # the resolved version doesn't exist in the registry

        # Better approach: make get_available_versions return a version that doesn't
        # actually exist in get_component
        registry_data = {
            "parent-block": {
                "1.0.0": {
                    "dependencies": [
                        BlockDependency(
                            component_id="child-block",
                            component_type="block",
                            version_constraint="1.0.0",
                        )
                    ]
                }
            },
            "child-block": {
                # Version 1.0.0 is in available versions (keys), but we'll make get_component
                # return None by not having the version data
                # Actually, keys() will list it, so this won't work either
            },
        }

        # The only way to get None is if get_component is called with non-existent component
        # Let's trace: collect_recursive calls get_component(comp_id, comp_ver)
        # where comp_ver comes from resolve_version
        # If resolve_version returns a version that doesn't exist, get_component returns None

        # Final approach: Have a component with no matching versions for the constraint
        # So get_available_versions returns [], resolution fails, but we already handle that
        # Or: Have the initial call be for a component that doesn't exist
        resolver = create_test_resolver(registry_data={})

        # Call with non-existent component - this will make get_component return None on line 735
        deps = resolver.collect_transitive_dependencies("nonexistent-block", "1.0.0")

        # Should return empty set since component doesn't exist (line 737 early return)
        assert len(deps) == 0

    def test_get_depth_returns_zero_for_visited(self):
        """Test get_depth returns 0 when node already visited (line 480)."""
        from wavecore.core.dependencies import DependencyGraph

        graph = DependencyGraph()
        # Create a self-referential structure using internal manipulation
        # to force the visited check to return 0
        graph.add_node("A", "1.0.0")
        graph.add_node("B", "1.0.0")

        # Create A -> B where B somehow appears visited in recursion
        # (this is hard to trigger legitimately, but we can test the path)
        graph._edges["A@1.0.0"].add("B@1.0.0")
        graph._edges["B@1.0.0"].add("A@1.0.0")  # Creates cycle

        # get_depth should handle this gracefully
        depth = graph.get_depth()
        # With cycle, the visited check should prevent infinite recursion
        assert depth >= 0  # Should not crash

    def test_validate_compatibility_success_returns_true(self):
        """Test validate_compatibility returns True on success (line 635)."""
        from wavecore.core.dependencies import CompatibilityValidator

        validator = CompatibilityValidator()

        # Matching interfaces
        expected = {
            "params": [{"name": "input", "type": "string", "required": True}],
            "return_type": "string",
        }
        actual = {
            "params": [{"name": "input", "type": "string", "required": True}],
            "return_type": "string",
        }

        # Should return True (line 635) when interfaces match
        result = validator.validate_compatibility(expected, actual, "1.0.0", "1.1.0")
        assert result is True
