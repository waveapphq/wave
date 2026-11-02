"""
Unit tests for block import/export functionality (REQ-3.1.2.5).

Tests cover:
1. YAML/JSON serialization with complete fidelity
2. Format detection and conversion
3. Validation during import
4. Conflict resolution strategies
5. Batch operations and dependency ordering
6. Error handling and recovery
7. Integration with validator and version manager
"""

import json
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock

import pytest
import yaml

from tests.conftest import create_test_block, create_test_plugin
from wavecore.core.blocks.import_export import (
    BlockExporter,
    BlockImporter,
    ConflictResolution,
    ExportError,
    ImportConflict,
    ImportError,
)
from wavecore.core.blocks.validator import BlockValidator
from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.models.blocks import Block, BlockChild, BlockDependency, BlockParameter, ExecutionFlow
from wavecore.models.plugins import BlockPlugin


class TestBlockExporter:
    """Test suite for BlockExporter class."""

    def test_init_creates_exporter(self):
        """Test that BlockExporter can be instantiated."""
        exporter = BlockExporter()
        assert exporter is not None

    def test_export_to_yaml_string(self):
        """Test exporting a block to YAML string format."""
        # Create a sample block
        block = create_test_block(
            id="test_block",
            name="Test Block",
            version="1.0.0",
            type="action",
            description="Test block for export",
            author="Test Author",
            tags=["test", "export"],
            parameters=[
                BlockParameter(name="input_file", type="string", required=True),
                BlockParameter(name="timeout", type="integer", default=30),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="shell_script",
                    plugin_version="1.0.0",
                    parameters={"command": "echo input_file.txt"},
                    order=0,
                )
            ],
            dependencies=[
                BlockDependency(
                    component_id="common_utils", component_type="block", version_constraint="^2.0.0"
                )
            ],
            execution_flow=ExecutionFlow(mode="sequential"),
        )

        exporter = BlockExporter()
        yaml_str = exporter.export_to_string(block, file_format="yaml")

        # Verify it's valid YAML
        parsed = yaml.safe_load(yaml_str)
        assert parsed["id"] == "test_block"
        assert parsed["version"] == "1.0.0"
        assert parsed["parameters"][0]["name"] == "input_file"
        assert parsed["plugins"][0]["plugin_id"] == "shell_script"
        # Verify dependency exported with new format (component_id + component_type)
        assert parsed["dependencies"][0]["component_id"] == "common_utils"
        assert parsed["dependencies"][0]["component_type"] == "block"

    def test_export_to_json_string(self):
        """Test exporting a block to JSON string format."""
        block = create_test_block(
            id="json_block",
            name="JSON Block",
            version="2.1.0",
            type="validation",
            parameters=[BlockParameter(name="expected", type="string", required=True)],
        )

        exporter = BlockExporter()
        json_str = exporter.export_to_string(block, file_format="json")

        # Verify it's valid JSON
        parsed = json.loads(json_str)
        assert parsed["id"] == "json_block"
        assert parsed["version"] == "2.1.0"
        assert parsed["type"] == "validation"

    def test_export_to_file_yaml(self):
        """Test exporting a block to a YAML file."""
        block = create_test_block(
            id="file_block",
            name="File Block",
            version="1.0.0",
            type="action",
        )

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f:
            filepath = Path(f.name)

        try:
            exporter = BlockExporter()
            exporter.export_to_file(block, filepath)

            # Verify file was created and contains valid YAML
            assert filepath.exists()
            with open(filepath, encoding="utf-8") as f:
                content = yaml.safe_load(f)
                assert content["id"] == "file_block"
                assert content["version"] == "1.0.0"
        finally:
            filepath.unlink(missing_ok=True)

    def test_export_to_file_json(self):
        """Test exporting a block to a JSON file."""
        block = create_test_block(
            id="json_file_block",
            name="JSON File Block",
            version="1.0.0",
            type="control",
        )

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", delete=False
        ) as f:
            filepath = Path(f.name)

        try:
            exporter = BlockExporter()
            exporter.export_to_file(block, filepath)

            # Verify file was created and contains valid JSON
            assert filepath.exists()
            with open(filepath, encoding="utf-8") as f:
                content = json.load(f)
                assert content["id"] == "json_file_block"
                assert content["type"] == "control"
        finally:
            filepath.unlink(missing_ok=True)

    def test_export_preserves_complete_metadata(self):
        """Test that export preserves all block metadata including lifecycle info."""
        block = create_test_block(
            id="complete_block",
            name="Complete Block",
            version="3.0.0",
            type="action",
            is_published=True,
            publish_date=datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
            is_deprecated=True,
            deprecation_reason="Replaced by newer implementation",
            replacement_version="4.0.0",
            deprecation_date=datetime(2024, 6, 1, 12, 0, 0, tzinfo=UTC),
        )

        exporter = BlockExporter()
        yaml_str = exporter.export_to_string(block, file_format="yaml")
        parsed = yaml.safe_load(yaml_str)

        # Verify lifecycle metadata preserved
        assert parsed["is_published"] is True
        assert parsed["publish_date"] == "2024-01-01T12:00:00Z"
        assert parsed["is_deprecated"] is True
        assert parsed["deprecation_reason"] == "Replaced by newer implementation"
        assert parsed["replacement_version"] == "4.0.0"
        assert parsed["deprecation_date"] == "2024-06-01T12:00:00Z"

    def test_export_with_nested_child_blocks(self):
        """Test exporting a block with nested child blocks."""
        block = create_test_block(
            id="parent_block",
            name="Parent Block",
            version="1.0.0",
            type="action",
            child_blocks=[
                BlockChild(block_id="child1", block_version="1.0.0", order=0),
                BlockChild(block_id="child2", block_version="2.0.0", order=1),
            ],
            execution_flow=ExecutionFlow(mode="parallel", parallel_groups=[[0, 1]]),
        )

        exporter = BlockExporter()
        yaml_str = exporter.export_to_string(block, file_format="yaml")
        parsed = yaml.safe_load(yaml_str)

        assert len(parsed["child_blocks"]) == 2
        assert parsed["child_blocks"][0]["block_id"] == "child1"
        assert parsed["execution_flow"]["mode"] == "parallel"
        assert parsed["execution_flow"]["parallel_groups"] == [[0, 1]]

    def test_export_format_auto_detection_yaml(self):
        """Test that format is auto-detected from .yaml file extension."""
        block = create_test_block(id="auto_yaml", name="Auto YAML", version="1.0.0", type="action")

        with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False) as f:
            filepath = Path(f.name)

        try:
            exporter = BlockExporter()
            # Don't specify format, let it auto-detect
            exporter.export_to_file(block, filepath, file_format=None)

            # Verify it's YAML
            with open(filepath, encoding="utf-8") as f:
                content = yaml.safe_load(f)
                assert content["id"] == "auto_yaml"
        finally:
            filepath.unlink(missing_ok=True)

    def test_export_format_auto_detection_json(self):
        """Test that format is auto-detected from .json file extension."""
        block = create_test_block(id="auto_json", name="Auto JSON", version="1.0.0", type="action")

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            filepath = Path(f.name)

        try:
            exporter = BlockExporter()
            # Don't specify format, let it auto-detect
            exporter.export_to_file(block, filepath, file_format=None)

            # Verify it's JSON
            with open(filepath, encoding="utf-8") as f:
                content = json.load(f)
                assert content["id"] == "auto_json"
        finally:
            filepath.unlink(missing_ok=True)

    def test_export_invalid_format_raises_error(self):
        """Test that invalid format raises ExportError."""
        block = create_test_block(id="test", name="Test", version="1.0.0", type="action")
        exporter = BlockExporter()

        with pytest.raises(ExportError, match="^Unsupported export format: xml$"):
            exporter.export_to_string(block, file_format="xml")

    def test_export_batch_with_dependencies(self):
        """Test batch export with dependency resolution."""
        # Create blocks with dependencies
        util_block = create_test_block(id="util", name="Utility", version="1.0.0", type="action")
        main_block = create_test_block(
            id="main",
            name="Main",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="util", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        # Mock block registry
        registry = {"util": {"1.0.0": util_block}}

        exporter = BlockExporter()
        result = exporter.export_batch(
            [main_block], include_dependencies=True, block_registry=registry
        )

        assert result.success is True
        assert result.exported_count == 2
        assert "main" in result.exported_blocks
        assert "util" in result.exported_blocks
        assert len(result.errors) == 0

    def test_export_batch_missing_dependency(self):
        """Test batch export with missing dependency generates warning."""
        main_block = create_test_block(
            id="main",
            name="Main",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="missing", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        exporter = BlockExporter()
        result = exporter.export_batch([main_block], include_dependencies=True, block_registry={})

        assert result.success is True
        assert result.exported_count == 1
        assert "main" in result.exported_blocks
        assert len(result.warnings) == 1
        assert "missing" in result.warnings[0]


class TestBlockImporter:
    """Test suite for BlockImporter class."""

    def test_init_creates_importer(self):
        """Test that BlockImporter can be instantiated with validator and version manager."""
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)
        assert importer is not None

    def test_import_from_yaml_string(self):
        """Test importing a block from YAML string."""
        yaml_content = """
id: imported_block
version: 1.0.0
metadata:
  name: Imported Block
  description: Test import from YAML
  author: Test Author
  tags: []
type: action
plugin_id: shell_script
parameters:
  - name: input
    type: string
    required: true
plugins:
  - plugin_id: shell_script
    plugin_version: 1.0.0
    parameters:
      command: echo test
    order: 0
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        block = importer.import_from_string(yaml_content, file_format="yaml")

        assert block.id == "imported_block"
        assert block.version == "1.0.0"
        assert len(block.parameters) == 1
        assert block.parameters[0].name == "input"
        assert len(block.plugins) == 1

    def test_import_from_json_string(self):
        """Test importing a block from JSON string."""
        json_content = json.dumps(
            {
                "id": "json_imported",
                "version": "2.0.0",
                "metadata": {
                    "name": "JSON Imported",
                    "description": "Test",
                    "author": "Test",
                    "tags": [],
                },
                "type": "validation",
                "plugin_id": "test",
                "parameters": [{"name": "expected", "type": "string", "required": True}],
            }
        )

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        block = importer.import_from_string(json_content, file_format="json")

        assert block.id == "json_imported"
        assert block.version == "2.0.0"
        assert block.type == "validation"

    def test_import_from_file_yaml(self):
        """Test importing a block from a YAML file."""
        yaml_content = """
id: file_imported
version: 1.5.0
metadata:
  name: File Imported
  description: Test
  author: Test
  tags: []
type: control
plugin_id: test
control_reference:
  control_id: if-else
  control_version: "1.0.0"
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

            block = importer.import_from_file(filepath)

            assert block.id == "file_imported"
            assert block.version == "1.5.0"
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_from_file_json(self):
        """Test importing a block from a JSON file."""
        json_content = json.dumps(
            {
                "id": "json_file_imported",
                "version": "3.0.0",
                "metadata": {
                    "name": "JSON File Imported",
                    "description": "Test",
                    "author": "Test",
                    "tags": [],
                },
                "type": "timing",
                "plugin_id": "test",
            }
        )

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", delete=False
        ) as f:
            f.write(json_content)
            filepath = Path(f.name)

        try:
            validator = BlockValidator()
            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager)

            block = importer.import_from_file(filepath)

            assert block.id == "json_file_imported"
            assert block.version == "3.0.0"
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_validates_block(self):
        """Test that import process validates the block."""
        yaml_content = """
id: validated_block
version: 1.0.0
metadata:
  name: Validated Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

plugins:
  - plugin_id: missing_plugin
    plugin_version: 1.0.0
    parameters: {}
    order: 0
"""

        validator = Mock(spec=BlockValidator)
        validation_feedback = Mock()
        validation_feedback.is_valid = False
        validation_feedback.errors = [
            Mock(component="plugin:missing_plugin", message="Plugin not found")
        ]
        validator.validate.return_value = validation_feedback

        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager, validate_on_import=True)

        with pytest.raises(
            ImportError, match="^Validation failed: plugin:missing_plugin: Plugin not found$"
        ):
            importer.import_from_string(yaml_content, file_format="yaml")

    def test_import_skip_validation(self):
        """Test that validation can be skipped during import."""
        yaml_content = """
id: unvalidated_block
version: 1.0.0
metadata:
  name: Unvalidated Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        validator = Mock(spec=BlockValidator)
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager, validate_on_import=False)

        block = importer.import_from_string(yaml_content, file_format="yaml")

        assert block.id == "unvalidated_block"
        # Validator should not be called when validate_on_import=False
        validator.validate.assert_not_called()

    def test_import_conflict_reject_duplicate(self):
        """Test conflict resolution with REJECT strategy."""
        yaml_content = """
id: existing_block
version: 1.0.0
metadata:
  name: Existing Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        # Setup existing block in registry
        existing = create_test_block(
            id="existing_block", name="Old", version="1.0.0", type="action"
        )
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        version_manager.publish(existing)

        importer = BlockImporter(validator, version_manager)

        with pytest.raises(
            ImportConflict, match="^Block 'existing_block' version '1.0.0' already exists$"
        ):
            importer.import_from_string(
                yaml_content, file_format="yaml", conflict_resolution=ConflictResolution.REJECT
            )

    def test_import_conflict_create_new_version(self):
        """Test conflict resolution with CREATE_VERSION strategy."""
        yaml_content = """
id: versionable_block
version: 1.0.0
metadata:
  name: Versionable Block
  description: New import
  author: Test
  tags: []
type: action
plugin_id: test

"""

        # Setup existing block
        existing = create_test_block(
            id="versionable_block", name="Old", version="1.0.0", type="action"
        )
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        version_manager.publish(existing)

        importer = BlockImporter(validator, version_manager)

        block = importer.import_from_string(
            yaml_content, file_format="yaml", conflict_resolution=ConflictResolution.CREATE_VERSION
        )

        # Should create version 1.0.1
        assert block.id == "versionable_block"
        assert block.version == "1.0.1"
        assert block.description == "New import"

    def test_import_conflict_force_overwrite_draft(self):
        """Test conflict resolution with FORCE_OVERWRITE for draft blocks."""
        yaml_content = """
id: draft_block
version: 1.0.0
metadata:
  name: Draft Block Updated
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        # Setup existing draft block
        existing = create_test_block(
            id="draft_block",
            name="Draft Block Original",
            version="1.0.0",
            type="action",
            is_published=False,
        )

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        # Register the draft block
        validator.register_block(existing)

        importer = BlockImporter(validator, version_manager)
        importer._block_registry[(existing.id, existing.version)] = existing

        block = importer.import_from_string(
            yaml_content, file_format="yaml", conflict_resolution=ConflictResolution.FORCE_OVERWRITE
        )

        assert block.id == "draft_block"
        assert block.name == "Draft Block Updated"

    def test_import_conflict_force_overwrite_published_fails(self):
        """Test that FORCE_OVERWRITE fails for published blocks."""
        yaml_content = """
id: published_block
version: 1.0.0
metadata:
  name: Published Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        # Setup existing published block
        existing = create_test_block(
            id="published_block", name="Original", version="1.0.0", type="action", is_published=True
        )

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        version_manager.publish(existing)

        importer = BlockImporter(validator, version_manager)
        importer._block_registry[(existing.id, existing.version)] = existing

        with pytest.raises(
            ImportError,
            match="^Cannot overwrite published block 'published_block' version '1.0.0'$",
        ):
            importer.import_from_string(
                yaml_content,
                file_format="yaml",
                conflict_resolution=ConflictResolution.FORCE_OVERWRITE,
            )

    def test_import_preserves_lifecycle_metadata(self):
        """Test that import preserves lifecycle metadata."""
        yaml_content = """
id: lifecycle_block
version: 2.0.0
metadata:
  name: Lifecycle Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

is_published: true
publish_date: '2024-01-15T10:00:00Z'
is_deprecated: true
deprecation_reason: Old implementation
replacement_version: 3.0.0
deprecation_date: '2024-06-01T10:00:00Z'
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        block = importer.import_from_string(yaml_content, file_format="yaml")

        assert block.is_published is True
        assert block.publish_date == datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)
        assert block.is_deprecated is True
        assert block.deprecation_reason == "Old implementation"
        assert block.replacement_version == "3.0.0"

    def test_import_malformed_yaml_raises_error(self):
        """Test that malformed YAML raises ImportError with line info."""
        yaml_content = """
id: bad_block
version: 1.0.0
metadata:
  name: Bad Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

parameters:
  - name: test
    type: string
  required: yes  # Wrong indentation
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        with pytest.raises(ImportError, match="^Failed to parse YAML"):
            importer.import_from_string(yaml_content, file_format="yaml")

    def test_import_malformed_json_raises_error(self):
        """Test that malformed JSON raises ImportError."""
        json_content = '{"id": "bad", "version": 1.0.0}'  # version should be string

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        with pytest.raises(ImportError, match="^Block validation error"):
            importer.import_from_string(json_content, file_format="json")

    def test_import_batch_single_file(self):
        """Test batch import from a single file containing multiple blocks."""
        yaml_content = """
- id: block1
  version: 1.0.0
  metadata:
    name: Block One
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
- id: block2
  version: 1.0.0
  metadata:
    name: Block Two
    description: Test
    author: Test
    tags: []
  type: validation
  plugin_id: test
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

            assert result.success is True
            assert result.imported_count == 2
            assert "block1" in result.imported_blocks
            assert "block2" in result.imported_blocks
            assert len(result.errors) == 0
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_with_dependencies_ordered(self):
        """Test batch import orders blocks by dependencies."""
        # Create files with dependent blocks (in wrong order)
        dependent_yaml = """
id: dependent
version: 1.0.0
metadata:
  name: Dependent Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

dependencies:
  - component_id: base
    component_type: block
    version_constraint: '1.0.0'
"""

        base_yaml = """
id: base
version: 1.0.0
metadata:
  name: Base Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f1:
            f1.write(dependent_yaml)
            file1 = Path(f1.name)

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f2:
            f2.write(base_yaml)
            file2 = Path(f2.name)

        try:
            validator = BlockValidator()
            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager)

            # Import with wrong order - should reorder based on dependencies
            result = importer.import_batch([file1, file2])

            assert result.success is True
            assert result.imported_count == 2
            # Base should be imported before dependent
            assert result.import_order == ["base", "dependent"]
        finally:
            file1.unlink(missing_ok=True)
            file2.unlink(missing_ok=True)

    def test_import_batch_circular_dependency_detected(self):
        """Test batch import detects circular dependencies."""
        yaml_content = """
- id: block_a
  version: 1.0.0
  metadata:
    name: Block A
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
  dependencies:
    - component_id: block_b
      component_type: block
      version_constraint: '1.0.0'
- id: block_b
  version: 1.0.0
  metadata:
    name: Block B
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
  dependencies:
    - component_id: block_a
      component_type: block
      version_constraint: '1.0.0'
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

            assert result.success is False
            assert len(result.errors) == 1
            assert "Circular dependency" in result.errors[0]
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_partial_success(self):
        """Test batch import handles partial success gracefully."""
        yaml_content = """
- id: good_block
  version: 1.0.0
  metadata:
    name: Good Block
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
- id: bad_block
  version: invalid_version
  metadata:
    name: Bad Block
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
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

            result = importer.import_batch([filepath], stop_on_error=False)

            assert result.success is False  # Overall failed due to bad block
            assert result.imported_count == 1  # But good block was imported
            assert "good_block" in result.imported_blocks
            assert "bad_block" not in result.imported_blocks
            assert len(result.errors) == 1
            assert "bad_block" in result.errors[0]
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_dry_run(self):
        """Test dry run validates without modifying registry."""
        yaml_content = """
id: dry_run_block
version: 1.0.0
metadata:
  name: Dry Run Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        # Get initial registry size
        initial_size = len(importer._block_registry)

        result = importer.validate_import(yaml_content, file_format="yaml")

        assert result.is_valid is True
        assert result.block.id == "dry_run_block"
        # Registry should not be modified
        assert len(importer._block_registry) == initial_size

    def test_format_conversion_yaml_to_json(self):
        """Test converting block from YAML to JSON format."""
        yaml_content = """
id: convert_block
version: 1.0.0
metadata:
  name: Convert Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

parameters:
  - name: input
    type: string
    required: true
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)
        exporter = BlockExporter()

        # Import from YAML
        block = importer.import_from_string(yaml_content, file_format="yaml")

        # Export to JSON
        json_str = exporter.export_to_string(block, file_format="json")

        # Re-import from JSON
        reimported = importer.import_from_string(json_str, file_format="json")

        # Verify consistency
        assert reimported.id == block.id
        assert reimported.version == block.version
        assert len(reimported.parameters) == len(block.parameters)

    def test_format_conversion_json_to_yaml(self):
        """Test converting block from JSON to YAML format."""
        json_content = json.dumps(
            {
                "id": "json_convert",
                "version": "2.0.0",
                "metadata": {
                    "name": "JSON Convert",
                    "description": "Test",
                    "author": "Test",
                    "tags": [],
                },
                "type": "validation",
                "plugin_id": "test",
                "parameters": [{"name": "expected", "type": "string", "required": True}],
            }
        )

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)
        exporter = BlockExporter()

        # Import from JSON
        block = importer.import_from_string(json_content, file_format="json")

        # Export to YAML
        yaml_str = exporter.export_to_string(block, file_format="yaml")

        # Re-import from YAML
        reimported = importer.import_from_string(yaml_str, file_format="yaml")

        # Verify consistency
        assert reimported.id == block.id
        assert reimported.version == block.version
        assert reimported.type == block.type


class TestIntegration:
    """Integration tests for import/export with real validator and version manager."""

    def test_full_round_trip_yaml(self):
        """Test complete export and re-import cycle with YAML."""
        # Create a complex block
        original = create_test_block(
            id="roundtrip",
            name="Round Trip Test",
            version="1.0.0",
            type="action",
            description="Test round trip",
            author="Test Author",
            tags=["test", "roundtrip"],
            parameters=[
                BlockParameter(name="input", type="string", required=True),
                BlockParameter(name="output", type="string", default="result.txt"),
            ],
            plugins=[
                BlockPlugin(
                    plugin_id="shell_script",
                    plugin_version="1.0.0",
                    parameters={"command": "process input_data"},
                    order=0,
                )
            ],
            dependencies=[
                BlockDependency(
                    component_id="utils", component_type="block", version_constraint="^1.0.0"
                )
            ],
            execution_flow=ExecutionFlow(mode="sequential"),
            is_published=True,
            publish_date=datetime(2024, 1, 1, tzinfo=UTC),
        )

        # Export
        exporter = BlockExporter()
        yaml_str = exporter.export_to_string(original, file_format="yaml")

        # Import
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)
        imported = importer.import_from_string(yaml_str, file_format="yaml")

        # Verify exact match
        assert imported.id == original.id
        assert imported.name == original.name
        assert imported.version == original.version
        assert imported.description == original.description
        assert imported.author == original.author
        assert imported.tags == original.tags
        assert len(imported.parameters) == len(original.parameters)
        assert len(imported.plugins) == len(original.plugins)
        assert len(imported.dependencies) == len(original.dependencies)
        assert imported.is_published == original.is_published

    def test_full_round_trip_json(self):
        """Test complete export and re-import cycle with JSON."""
        original = create_test_block(
            id="json_roundtrip",
            name="JSON Round Trip",
            version="2.0.0",
            type="validation",
            parameters=[BlockParameter(name="expected", type="string", required=True)],
            child_blocks=[BlockChild(block_id="validator", block_version="1.0.0", order=0)],
        )

        # Export
        exporter = BlockExporter()
        json_str = exporter.export_to_string(original, file_format="json")

        # Import
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)
        imported = importer.import_from_string(json_str, file_format="json")

        # Verify exact match
        assert imported.id == original.id
        assert imported.version == original.version
        assert len(imported.child_blocks) == 1
        assert imported.child_blocks[0].block_id == "validator"

    def test_import_with_validation_integration(self):
        """Test import with full validation using real validator."""
        yaml_content = """
id: validated_import
version: 1.0.0
metadata:
  name: Validated Import
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

plugins:
  - plugin_id: shell_script
    plugin_version: 1.0.0
    parameters:
      command: echo test
    order: 0
"""

        # Setup validator with registered plugin
        from wavecore.models.plugins import PluginParameter

        validator = BlockValidator()
        plugin = create_test_plugin(
            id="shell_script",
            name="Shell Script",
            version="1.0.0",
            category="system",
            description="Execute shell scripts",
            parameters=[
                PluginParameter(
                    name="command", type="string", required=True, description="Command to execute"
                )
            ],
        )
        validator.register_plugin(plugin)

        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager, validate_on_import=True)

        # Should import successfully with validation
        block = importer.import_from_string(yaml_content, file_format="yaml")
        assert block.id == "validated_import"

    def test_export_import_preserves_dates(self):
        """Test that datetime fields are preserved correctly."""
        original = create_test_block(
            id="date_test",
            name="Date Test",
            version="1.0.0",
            type="action",
            created_at=datetime(2024, 1, 1, 10, 30, 0, tzinfo=UTC),
            updated_at=datetime(2024, 6, 15, 14, 45, 0, tzinfo=UTC),
            is_published=True,
            publish_date=datetime(2024, 2, 1, 9, 0, 0, tzinfo=UTC),
        )

        # Export and re-import
        exporter = BlockExporter()
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        yaml_str = exporter.export_to_string(original, file_format="yaml")
        imported = importer.import_from_string(yaml_str, file_format="yaml")

        # Dates should match exactly
        assert imported.created_at == original.created_at
        assert imported.updated_at == original.updated_at
        assert imported.publish_date == original.publish_date


class TestCoverageCompletion:
    """Additional tests to achieve 100% code coverage."""

    def test_export_to_file_write_error(self):
        """Test export to file handles write errors."""
        block = create_test_block(id="test", name="Test", version="1.0.0", type="action")
        exporter = BlockExporter()

        # Use an invalid path
        filepath = Path("/invalid/path/that/does/not/exist/block.yaml")

        with pytest.raises(ExportError, match="^Failed to write file"):
            exporter.export_to_file(block, filepath)

    def test_export_to_file_unsupported_extension(self):
        """Test export to file with unsupported extension."""
        block = create_test_block(id="test", name="Test", version="1.0.0", type="action")
        exporter = BlockExporter()

        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            filepath = Path(f.name)

        try:
            with pytest.raises(ExportError, match="^Cannot auto-detect format from extension"):
                exporter.export_to_file(block, filepath, file_format=None)
        finally:
            filepath.unlink(missing_ok=True)

    def test_export_batch_skip_already_exported(self):
        """Test batch export skips blocks already exported."""
        block1 = create_test_block(id="block1", name="Block 1", version="1.0.0", type="action")
        block2 = create_test_block(
            id="block2",
            name="Block 2",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="block1", component_type="block", version_constraint="1.0.0"
                )
            ],
        )

        # Create registry with block1
        registry = {"block1": {"1.0.0": block1}}

        exporter = BlockExporter()
        # Export both blocks, block1 appears twice (direct and via dependency)
        result = exporter.export_batch(
            [block1, block2], include_dependencies=True, block_registry=registry
        )

        # Should export each block only once
        assert result.exported_count == 2
        assert len(result.exported_blocks) == 2

    def test_export_batch_exception_handling(self):
        """Test batch export handles exceptions."""
        # Create a mock block that raises exception when accessing dependencies
        block = Mock(spec=Block)
        block.id = "bad_block"
        block.version = "1.0.0"
        block.dependencies = Mock(side_effect=Exception("Dependency error"))

        exporter = BlockExporter()
        result = exporter.export_batch([block], include_dependencies=True)

        assert result.success is False
        assert len(result.errors) == 1
        assert "bad_block" in result.errors[0]

    def test_import_from_file_read_error(self):
        """Test import from file handles read errors."""
        filepath = Path("/nonexistent/file.yaml")

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        with pytest.raises(ImportError, match="^Failed to read file"):
            importer.import_from_file(filepath)

    def test_import_from_file_unsupported_extension(self):
        """Test import from file with unsupported extension."""
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(b"some content")
            filepath = Path(f.name)

        try:
            validator = BlockValidator()
            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager)

            with pytest.raises(ImportError, match="^Cannot auto-detect format from extension"):
                importer.import_from_file(filepath)
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_json_format(self):
        """Test batch import with JSON format files."""
        json_content = json.dumps(
            [
                {
                    "id": "block1",
                    "version": "1.0.0",
                    "metadata": {
                        "name": "Block 1",
                        "description": "Test",
                        "author": "Test",
                        "tags": [],
                    },
                    "type": "action",
                    "plugin_id": "test",
                },
                {
                    "id": "block2",
                    "version": "1.0.0",
                    "metadata": {
                        "name": "Block 2",
                        "description": "Test",
                        "author": "Test",
                        "tags": [],
                    },
                    "type": "validation",
                    "plugin_id": "test",
                },
            ]
        )

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", delete=False
        ) as f:
            f.write(json_content)
            filepath = Path(f.name)

        try:
            validator = BlockValidator()
            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager)

            result = importer.import_batch([filepath])

            assert result.success is True
            assert result.imported_count == 2
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_stop_on_first_error(self):
        """Test batch import stops on first error when requested."""
        yaml_content = """
- id: block1
  name: Block 1
  version: bad_version
  type: action
- id: block2
  name: Block 2
  version: 1.0.0
  type: action
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

            result = importer.import_batch([filepath], stop_on_error=True)

            assert result.success is False
            assert result.imported_count == 0  # Should not import any blocks
            assert len(result.errors) == 1
        finally:
            filepath.unlink(missing_ok=True)

    def test_validate_import_json_format(self):
        """Test dry run validation with JSON format."""
        json_content = json.dumps(
            {
                "id": "test_block",
                "version": "1.0.0",
                "metadata": {
                    "name": "Test Block",
                    "description": "Test",
                    "author": "Test",
                    "tags": [],
                },
                "type": "action",
                "plugin_id": "test",
            }
        )

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        result = importer.validate_import(json_content, file_format="json")

        assert result.is_valid is True
        assert result.block.id == "test_block"

    def test_validate_import_validation_errors(self):
        """Test dry run validation reports validation errors."""
        yaml_content = """
id: test_block
version: 1.0.0
metadata:
  name: Test Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

plugins:
  - plugin_id: missing_plugin
    plugin_version: 1.0.0
    parameters: {}
    order: 0
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        result = importer.validate_import(yaml_content)

        assert result.is_valid is False
        assert len(result.errors) > 0
        assert "missing_plugin" in result.errors[0]

    def test_validate_import_parse_error(self):
        """Test dry run validation handles parse errors."""
        invalid_yaml = "invalid: yaml: content:"

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        result = importer.validate_import(invalid_yaml)

        assert result.is_valid is False
        assert len(result.errors) == 1

    def test_create_new_version_non_standard_version(self):
        """Test version creation with non-standard version format."""
        # Create block with valid version first
        block = create_test_block(id="test", name="Test", version="1.0.0", type="action")

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        # Manually set non-standard version to test the else clause
        block.version = "1.0"  # Only 2 parts instead of 3
        new_block = importer._create_new_version(block)

        assert new_block.version == "1.0.1"  # Should append .1 for non-standard versions

    def test_import_batch_with_exception_during_import(self):
        """Test batch import handles exceptions during individual block import."""
        yaml_content = """
- id: block1
  name: Block 1
  version: 1.0.0
  type: action
"""

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f:
            f.write(yaml_content)
            filepath = Path(f.name)

        try:
            # Create a validator that raises an exception
            validator = Mock(spec=BlockValidator)
            validator.validate.side_effect = Exception("Validation error")

            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager, validate_on_import=True)

            result = importer.import_batch([filepath], stop_on_error=False)

            assert result.success is False
            assert len(result.errors) == 1
            assert "block1" in result.errors[0]
        finally:
            filepath.unlink(missing_ok=True)

    def test_datetime_conversion_multiple_fields(self):
        """Test datetime conversion for all datetime fields."""
        yaml_content = """
id: datetime_test
version: 1.0.0
metadata:
  name: DateTime Test
  description: Test
  author: Test
  tags: []
  created_at: '2024-01-01T10:00:00Z'
  updated_at: '2024-02-01T11:00:00Z'
type: action
plugin_id: test
is_published: true
publish_date: '2024-03-01T12:00:00Z'
is_deprecated: true
deprecation_reason: 'Testing deprecation'
deprecation_date: '2024-04-01T13:00:00Z'
"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        block = importer.import_from_string(yaml_content, file_format="yaml")

        assert block.created_at == datetime(2024, 1, 1, 10, 0, 0, tzinfo=UTC)
        assert block.updated_at == datetime(2024, 2, 1, 11, 0, 0, tzinfo=UTC)
        assert block.publish_date == datetime(2024, 3, 1, 12, 0, 0, tzinfo=UTC)
        assert block.deprecation_date == datetime(2024, 4, 1, 13, 0, 0, tzinfo=UTC)

    def test_export_batch_caret_version_matching(self):
        """Test batch export handles caret version constraints."""
        block1 = create_test_block(id="lib", name="Library", version="1.2.3", type="action")
        main_block = create_test_block(
            id="main",
            name="Main",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="lib", component_type="block", version_constraint="^1.0.0"
                )
            ],
        )

        registry = {"lib": {"1.2.3": block1}}

        exporter = BlockExporter()
        result = exporter.export_batch(
            [main_block], include_dependencies=True, block_registry=registry
        )

        assert result.exported_count == 2
        assert "lib" in result.exported_blocks

    def test_export_batch_version_not_found_in_registry(self):
        """Test batch export warns when version not found in registry."""
        main_block = create_test_block(
            id="main",
            name="Main",
            version="1.0.0",
            type="action",
            dependencies=[
                BlockDependency(
                    component_id="lib", component_type="block", version_constraint="2.0.0"
                )
            ],
        )

        # Registry has lib but with wrong version
        wrong_version_block = create_test_block(
            id="lib", name="Library", version="1.0.0", type="action"
        )
        registry = {"lib": {"1.0.0": wrong_version_block}}

        exporter = BlockExporter()
        result = exporter.export_batch(
            [main_block], include_dependencies=True, block_registry=registry
        )

        assert result.exported_count == 1  # Only main block
        assert len(result.warnings) == 1
        assert "lib" in result.warnings[0]
        assert "2.0.0" in result.warnings[0]

    def test_import_unsupported_format(self):
        """Test import with unsupported format raises error."""
        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        with pytest.raises(ImportError, match="^Unsupported import format: xml$"):
            importer.import_from_string("content", file_format="xml")

    def test_import_invalid_block_dict(self):
        """Test import with invalid block dict raises validation error."""
        yaml_content = """
id: 123
version: 1.0.0
metadata:
  name: Bad Block
  description: Test
  author: Test
  tags: []
type: invalid_type
plugin_id: test

"""

        validator = BlockValidator()
        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        with pytest.raises(ImportError, match="^Block validation error:"):
            importer.import_from_string(yaml_content, file_format="yaml")

    def test_validate_import_with_warnings(self):
        """Test dry run validation returns warnings."""
        yaml_content = """
id: test_block
version: 1.0.0
metadata:
  name: Test Block
  description: Test
  author: Test
  tags: []
type: action
plugin_id: test

parameters:
  - name: unused
    type: string
"""

        validator = Mock(spec=BlockValidator)
        feedback = Mock()
        feedback.is_valid = True
        feedback.errors = []
        feedback.warnings = [Mock(component="param", message="Unused parameter")]
        validator.validate.return_value = feedback

        version_manager = BlockVersionManager()
        importer = BlockImporter(validator, version_manager)

        result = importer.validate_import(yaml_content)

        assert result.is_valid is True
        assert len(result.warnings) == 1
        assert "Unused parameter" in result.warnings[0]

    def test_get_existing_block_with_version_manager_exception(self):
        """Test _get_existing_block handles version manager exceptions."""
        validator = BlockValidator()
        version_manager = Mock(spec=BlockVersionManager)
        version_manager.get.side_effect = Exception("Version manager error")

        importer = BlockImporter(validator, version_manager)

        # Should return None when exception occurs
        result = importer._get_existing_block("test", "1.0.0")
        assert result is None

    def test_register_block_with_publish_exception(self):
        """Test _register_block handles publish exceptions gracefully."""
        block = create_test_block(
            id="test", name="Test", version="1.0.0", type="action", is_published=True
        )

        validator = Mock(spec=BlockValidator)
        version_manager = Mock(spec=BlockVersionManager)
        version_manager.publish.side_effect = Exception("Already published")

        importer = BlockImporter(validator, version_manager)

        # Should not raise exception
        importer._register_block(block)

        # Block should still be in registry
        assert (block.id, block.version) in importer._block_registry

    def test_import_batch_successful_registration(self):
        """Test batch import successfully registers blocks."""
        yaml_content = """
- id: test1
  version: 1.0.0
  metadata:
    name: Test 1
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
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

            assert result.success is True
            assert result.imported_count == 1
            # Check block is in registry
            assert ("test1", "1.0.0") in importer._block_registry
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_stop_on_error_during_import(self):
        """Test batch import stops on error during individual import."""
        yaml_content = """
- id: test1
  version: 1.0.0
  metadata:
    name: Test 1
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
- id: test2
  version: 1.0.0
  metadata:
    name: Test 2
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
"""

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f:
            f.write(yaml_content)
            filepath = Path(f.name)

        try:
            validator = Mock(spec=BlockValidator)
            # First block validates, second fails
            feedback1 = Mock()
            feedback1.is_valid = True
            feedback2 = Mock()
            feedback2.is_valid = False
            feedback2.errors = [Mock(component="test", message="Error")]
            validator.validate.side_effect = [feedback1, feedback2]

            version_manager = BlockVersionManager()
            importer = BlockImporter(validator, version_manager, validate_on_import=True)

            result = importer.import_batch([filepath], stop_on_error=True)

            assert result.success is False
            assert result.imported_count == 1  # Only first block imported
            assert len(result.errors) == 1
        finally:
            filepath.unlink(missing_ok=True)

    def test_import_batch_conflict_reject(self):
        """Test batch import rejects conflicting blocks."""
        yaml_content = """
- id: conflict_block
  version: 1.0.0
  metadata:
    name: Conflict Block
    description: Test
    author: Test
    tags: []
  type: action
  plugin_id: test
"""

        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".yaml", delete=False
        ) as f:
            f.write(yaml_content)
            filepath = Path(f.name)

        try:
            # Pre-register the block to cause conflict
            existing = create_test_block(
                id="conflict_block",
                name="Existing",
                version="1.0.0",
                type="action",
                is_published=True,
            )

            validator = BlockValidator()
            version_manager = BlockVersionManager()
            version_manager.publish(existing)

            importer = BlockImporter(validator, version_manager)

            result = importer.import_batch([filepath], stop_on_error=False)

            assert result.success is False
            assert result.imported_count == 0
            assert len(result.errors) == 1
            assert "conflict_block" in result.errors[0]
            assert "already exists" in result.errors[0]
        finally:
            filepath.unlink(missing_ok=True)


LOCALE_TEXT = {"name": "Grüße 測試", "description": "Grüße 測試 description"}

LOCALE_CHILD = f"""\
import sys
from pathlib import Path

from wavecore.core.blocks.import_export import BlockExporter, BlockImporter
from wavecore.core.blocks.validator import BlockValidator
from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.models.blocks import Block

TEXT = {LOCALE_TEXT!r}
files = [Path(argument) for argument in sys.argv[1:]]


def importer():
    return BlockImporter(BlockValidator(), BlockVersionManager())


def answer(blocks):
    texts = [dict(name=block.name, description=block.description) for block in blocks]
    raise SystemExit(0 if texts == [TEXT] * len(files) else 3)
"""

CHILD_EXPORTS_AND_IMPORTS = f"""{LOCALE_CHILD}
block = Block(
    id="locale_block",
    version="1.0.0",
    type="action",
    plugin_id="test",
    metadata=dict(author="Test Author", tags=[], **TEXT),
)
for target in files:
    BlockExporter().export_to_file(block, target)
answer([importer().import_from_file(target) for target in files])
"""

CHILD_IMPORTS_FILES = f"""{LOCALE_CHILD}
answer([importer().import_from_file(source) for source in files])
"""

CHILD_IMPORTS_BATCH = f"""{LOCALE_CHILD}
result = importer().import_batch(files)
print(ascii(result.errors), file=sys.stderr)
answer(result.imported_blocks.values())
"""


def _stored(path):
    """Parse an exported file from its bytes, read as UTF-8."""
    text = path.read_bytes().decode("utf-8")
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


def _write_utf8_block_files(directory):
    """Write one YAML and one JSON block file whose bytes hold the text itself as UTF-8."""

    def block(block_id):
        return {
            "id": block_id,
            "version": "1.0.0",
            "metadata": {"author": "Test Author", "tags": [], **LOCALE_TEXT},
            "type": "action",
            "plugin_id": "test",
        }

    yaml_file = directory / "block.yaml"
    yaml_file.write_bytes(
        yaml.safe_dump(block("locale_yaml"), allow_unicode=True, sort_keys=False).encode("utf-8")
    )
    json_file = directory / "block.json"
    json_file.write_bytes(
        json.dumps(block("locale_json"), ensure_ascii=False, indent=2).encode("utf-8")
    )
    return [yaml_file, json_file]


class TestLocaleIndependence:
    """Test suite for block files on a WAVE host whose locale is not UTF-8 (REQ-4.6.9)."""

    @pytest.fixture
    def run_child(self, tmp_path, non_utf8_child_env):
        """Run source as a file in a child Python on a host that is not UTF-8."""

        def _run(source, *arguments):
            script = tmp_path / "child.py"
            script.write_text(source, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(script), *arguments],
                env=non_utf8_child_env,
                capture_output=True,
                timeout=30,
                check=False,
            )

        return _run

    def test_exported_file_is_utf8_on_disk_and_imports_back(self, tmp_path, run_child):
        """Test an exported name and description are UTF-8 on disk and import back equal."""
        # Starts a child Python.
        targets = [tmp_path / "block.yaml", tmp_path / "block.json"]

        done = run_child(CHILD_EXPORTS_AND_IMPORTS, *map(str, targets))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        for target in targets:
            metadata = _stored(target)["metadata"]
            assert {key: metadata[key] for key in LOCALE_TEXT} == LOCALE_TEXT

    def test_file_stored_as_utf8_imports_equal(self, tmp_path, run_child):
        """Test a name and description stored as UTF-8 bytes import equal."""
        # Starts a child Python.
        sources = _write_utf8_block_files(tmp_path)

        done = run_child(CHILD_IMPORTS_FILES, *map(str, sources))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")

    def test_files_stored_as_utf8_import_equal_as_a_batch(self, tmp_path, run_child):
        """Test names and descriptions stored as UTF-8 bytes import equal in a batch."""
        # Starts a child Python.
        sources = _write_utf8_block_files(tmp_path)

        done = run_child(CHILD_IMPORTS_BATCH, *map(str, sources))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
