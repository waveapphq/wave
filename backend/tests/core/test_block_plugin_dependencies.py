"""
Test coverage for blocks with plugin dependencies.

These tests ensure that blocks with mixed plugin and block dependencies
are handled correctly, covering the code paths that filter out plugin
dependencies in block-specific operations.
"""

import tempfile
from pathlib import Path

from tests.conftest import create_test_block
from wavecore.core.blocks.import_export import BlockExporter, BlockImporter
from wavecore.core.blocks.validator import BlockValidator
from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.models.blocks import BlockDependency


class TestPluginDependencyHandling:
    """Test that plugin dependencies are properly skipped in block operations."""

    def test_block_validator_skips_plugin_dependencies(self):
        """Test validator skips plugin dependencies (covers line 290)."""
        validator = BlockValidator()

        # Register a base block
        base_block = create_test_block(
            id="base-block", name="Base Block", version="1.0.0", type="action"
        )
        validator.register_block(base_block)
        # Also publish to the validator's internal version manager
        validator._version_manager.publish(base_block)

        # Create block with both block and plugin dependencies
        block = create_test_block(
            id="mixed-deps",
            name="Mixed Dependencies Block",
            version="1.0.0",
            type="action",
            dependencies=[
                # Plugin dependency - should be skipped
                BlockDependency(
                    component_id="logging-plugin",
                    component_type="plugin",
                    version_constraint="^2.0.0",
                ),
                # Block dependency - should be validated
                BlockDependency(
                    component_id="base-block", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Validation should pass (plugin dep is skipped, block dep is satisfied)
        result = validator.validate(block)
        assert result.is_valid is True

    def test_recursive_circular_check_with_plugin_deps(self):
        """Test circular dependency recursive check with plugin deps (covers line 502)."""
        validator = BlockValidator()

        # Create a chain: A -> B (with plugin deps), B -> C (with plugin deps), C -> A
        block_c = create_test_block(
            id="block-c",
            name="Block C",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="plugin-x", component_type="plugin", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        validator.register_block(block_c)
        validator._version_manager.publish(block_c)

        # Now create block A that depends on B
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="plugin-y", component_type="plugin", version_constraint="2.0.0"
                ),
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # And block B that depends on C
        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="plugin-z", component_type="plugin", version_constraint="3.0.0"
                ),
                BlockDependency(
                    component_id="block-c", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        validator.register_block(block_b)
        validator._version_manager.publish(block_b)

        # Register block_a to test recursive check when current_block == block_a
        validator.register_block(block_a)
        validator._version_manager.publish(block_a)

        # Validating A should trigger recursive check through B -> C -> A
        # When it recurses back to A (current_block.id == "block-a"),
        # it will check A's dependencies which include a plugin dep (line 502 hit)
        result = validator.validate(block_a)
        assert result.is_valid is False
        assert any("circular" in str(issue.message).lower() for issue in result.errors)

    def test_block_validator_circular_check_skips_plugin_deps(self):
        """Test circular dependency check skips plugin deps (covers lines 490, 502)."""
        validator = BlockValidator()

        # Create blocks with circular dependency through block deps
        # but also having plugin deps that should be skipped
        block_a = create_test_block(
            id="block-a",
            name="Block A",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="auth-plugin", component_type="plugin", version_constraint="1.0.0"
                ),
                BlockDependency(
                    component_id="block-b", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        block_b = create_test_block(
            id="block-b",
            name="Block B",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="logger-plugin",
                    component_type="plugin",
                    version_constraint="1.0.0",
                ),
                BlockDependency(
                    component_id="block-a", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        validator.register_block(block_a)
        validator.register_block(block_b)
        validator._version_manager.publish(block_a)
        validator._version_manager.publish(block_b)

        # Should detect circular dependency between blocks, ignoring plugins
        result = validator.validate(block_a)
        assert result.is_valid is False
        assert any("circular" in str(issue.message).lower() for issue in result.errors)

        # Also check block_b to ensure line 502 is covered (recursive check)
        result_b = validator.validate(block_b)
        assert result_b.is_valid is False

    def test_block_validator_self_dependency_with_plugin_deps(self):
        """Test self-dependency check with plugin deps (covers line 527)."""
        validator = BlockValidator()

        # Block with self-dependency and plugin dependency
        block = create_test_block(
            id="self-ref",
            name="Self Reference",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="cache-plugin", component_type="plugin", version_constraint="3.0.0"
                ),
                BlockDependency(
                    component_id="self-ref",  # Self dependency
                    component_type="block",
                    version_constraint="1.0.0",
                ),
            ],
        )

        result = validator.validate(block)
        assert result.is_valid is False
        assert any(
            "self-depend" in str(issue.message).lower() or "circular" in str(issue.message).lower()
            for issue in result.errors
        )

    def test_block_export_skips_plugin_dependencies(self):
        """Test export skips plugin dependencies (covers line 181)."""
        block_registry = {}

        # Base block
        base = create_test_block(id="base", name="Base", version="1.0.0", type="action")

        # Block with mixed dependencies
        dependent = create_test_block(
            id="dependent",
            name="Dependent",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="http-plugin", component_type="plugin", version_constraint="^1.0.0"
                ),
                BlockDependency(
                    component_id="base", component_type="block", version_constraint="1.0.0"
                ),
            ],
        )

        # Register blocks
        block_registry["base"] = {"1.0.0": base}
        block_registry["dependent"] = {"1.0.0": dependent}

        exporter = BlockExporter()
        result = exporter.export_batch(
            [dependent], include_dependencies=True, block_registry=block_registry
        )

        # Should export dependent and base, but not try to export plugin
        assert result.success is True
        assert len(result.exported_blocks) == 2
        # exported_blocks is a dict of id -> Block
        block_ids = list(result.exported_blocks.keys())
        assert "dependent" in block_ids or ("dependent", "1.0.0") in result.exported_blocks
        assert "base" in block_ids or ("base", "1.0.0") in result.exported_blocks

    def test_block_import_ordering_skips_plugin_deps(self):
        """Test import ordering skips plugin dependencies (covers line 660)."""
        # Create YAML with blocks having plugin dependencies
        yaml_content = """
- id: block1
  version: 1.0.0
  metadata:
    name: Block 1
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
  dependencies:
    - component_id: database-plugin
      component_type: plugin
      version_constraint: '2.0.0'
    - component_id: block2
      component_type: block
      version_constraint: '1.0.0'
- id: block2
  version: 1.0.0
  metadata:
    name: Block 2
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
  dependencies:
    - component_id: cache-plugin
      component_type: plugin
      version_constraint: '1.5.0'
"""

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f:
            f.write(yaml_content)
            filepath = Path(f.name)

        try:
            validator = BlockValidator()
            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager)

            result = importer.import_batch([filepath])

            # Import should succeed, ordering based on block deps only
            assert result.success is True
            assert result.imported_count == 2

        finally:
            filepath.unlink(missing_ok=True)

    def test_version_manager_validate_deps_skips_plugins(self):
        """Test version manager skips plugin deps (covers line 278)."""
        version_manager = BlockVersionManager()

        # Register a block that satisfies dependency
        satisfying_block = create_test_block(
            id="required-block", name="Required Block", version="2.0.0", type="action"
        )
        version_manager.publish(satisfying_block)

        # Block with mixed dependencies
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="auth-plugin", component_type="plugin", version_constraint="^3.0.0"
                ),
                BlockDependency(
                    component_id="required-block",
                    component_type="block",
                    version_constraint="^2.0.0",
                ),
                BlockDependency(
                    component_id="log-plugin", component_type="plugin", version_constraint="~1.2.0"
                ),
            ],
        )

        # Validate dependencies - should only check block deps
        result = version_manager.validate_dependencies(block)
        assert result["valid"] is True
        assert len(result["satisfied"]) == 1  # Only the block dependency
        assert result["satisfied"][0]["block_id"] == "required-block"
        assert len(result["unsatisfied"]) == 0
