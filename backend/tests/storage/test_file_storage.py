"""
Comprehensive unit tests for WAVE storage layer.

This module tests storage interface and file-based implementation:
- REQ-6.1.1: YAML/JSON test definitions
- REQ-6.1.2: Versioned component files
- REQ-6.1.4: Artifact directory structure
- REQ-6.1.5: Configuration file hierarchy
"""

import fcntl
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import yaml


class TestStorageInterface:
    """Test suite for storage interface definition."""

    def test_storage_interface_exists(self):
        """Test that storage interface is defined."""
        from wavecore.storage import StorageInterface

        assert StorageInterface is not None

    def test_storage_interface_methods(self):
        """Test storage interface has required methods."""
        from wavecore.storage import StorageInterface

        required_methods = [
            "save_plugin",
            "load_plugin",
            "list_plugins",
            "delete_plugin",
            "save_block",
            "load_block",
            "list_blocks",
            "delete_block",
            "save_test",
            "load_test",
            "list_tests",
            "delete_test",
            "save_suite",
            "load_suite",
            "list_suites",
            "delete_suite",
            "save_regression",
            "load_regression",
            "list_regressions",
            "delete_regression",
        ]

        for method in required_methods:
            assert hasattr(StorageInterface, method)


class TestFileBasedStorage:
    """Test suite for file-based storage implementation (REQ-6.1.1, REQ-6.1.2)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        from wavecore.storage import FileBasedStorage

        return FileBasedStorage(base_path=temp_storage_dir)

    def test_storage_initialization(self, temp_storage_dir):
        """Test storage initialization creates directory structure."""
        from wavecore.storage import FileBasedStorage

        _storage = FileBasedStorage(base_path=temp_storage_dir)

        # Verify directory structure (REQ-6.1.4)
        assert (temp_storage_dir / "plugins").exists()
        assert (temp_storage_dir / "blocks").exists()
        assert (temp_storage_dir / "tests").exists()
        assert (temp_storage_dir / "suites").exists()
        assert (temp_storage_dir / "regressions").exists()
        assert (temp_storage_dir / "artifacts").exists()

    def test_save_plugin_yaml(self, storage, temp_storage_dir):
        """Test saving plugin in YAML format (REQ-6.1.1)."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="shell-script",
            name="Shell Script",
            version="1.0.0",
            category="system",
            description="Execute shell scripts",
        )

        storage.save_plugin(plugin, format="yaml")

        # Check file exists with correct path structure
        plugin_file = temp_storage_dir / "plugins" / "system" / "shell-script" / "1.0.0.yaml"
        assert plugin_file.exists()

    def test_save_plugin_json(self, storage, temp_storage_dir):
        """Test saving plugin in JSON format (REQ-6.1.1)."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="http-client",
            name="HTTP Client",
            version="2.0.0",
            category="network",
            description="Make HTTP requests",
        )

        storage.save_plugin(plugin, format="json")

        plugin_file = temp_storage_dir / "plugins" / "network" / "http-client" / "2.0.0.json"
        assert plugin_file.exists()

    def test_load_plugin_yaml(self, storage):
        """Test loading plugin from YAML file."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="test-plugin",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test",
        )

        storage.save_plugin(plugin, format="yaml")
        loaded = storage.load_plugin("test-plugin", version="1.0.0")

        assert loaded.id == plugin.id
        assert loaded.name == plugin.name
        assert loaded.version == plugin.version

    def test_load_plugin_json(self, storage):
        """Test loading plugin from JSON file."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="test-json",
            name="Test JSON",
            version="1.0.0",
            category="system",
            description="Test",
        )

        storage.save_plugin(plugin, format="json")
        loaded = storage.load_plugin("test-json", version="1.0.0", format="json")

        assert loaded.id == plugin.id
        assert loaded.version == plugin.version

    def test_load_plugin_latest_version(self, storage):
        """Test loading latest version when version not specified."""
        from tests.conftest import create_test_plugin

        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            plugin = create_test_plugin(
                id="versioned-plugin",
                name="Versioned",
                version=v,
                category="system",
                description="Test",
            )
            storage.save_plugin(plugin)

        # Load latest (should be 2.0.0)
        loaded = storage.load_plugin("versioned-plugin")
        assert loaded.version == "2.0.0"

    def test_list_plugins(self, storage):
        """Test listing all plugins."""
        from tests.conftest import create_test_plugin

        plugins = [
            create_test_plugin(
                id="p1", name="P1", version="1.0.0", category="system", description=""
            ),
            create_test_plugin(
                id="p2",
                name="P2",
                version="1.0.0",
                category="network",
                description="",
            ),
            create_test_plugin(
                id="p3", name="P3", version="2.0.0", category="system", description=""
            ),
        ]

        for p in plugins:
            storage.save_plugin(p)

        listed = storage.list_plugins()
        assert len(listed) >= 3

    def test_list_plugins_by_category(self, storage):
        """Test listing plugins filtered by category."""
        from tests.conftest import create_test_plugin

        core_plugin = create_test_plugin(
            id="core1", name="Core", version="1.0.0", category="system", description=""
        )
        network_plugin = create_test_plugin(
            id="net1",
            name="Network",
            version="1.0.0",
            category="network",
            description="",
        )

        storage.save_plugin(core_plugin)
        storage.save_plugin(network_plugin)

        core_plugins = storage.list_plugins(category="system")
        assert len(core_plugins) >= 1
        assert all(p.category == "system" for p in core_plugins)

    def test_delete_plugin(self, storage, temp_storage_dir):
        """Test deleting a plugin."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="to-delete",
            name="Delete Me",
            version="1.0.0",
            category="system",
            description="",
        )

        storage.save_plugin(plugin)
        plugin_file = temp_storage_dir / "plugins" / "system" / "to-delete" / "1.0.0.yaml"
        assert plugin_file.exists()

        storage.delete_plugin("to-delete", version="1.0.0")
        assert not plugin_file.exists()

    def test_save_block(self, storage, temp_storage_dir):
        """Test saving block with versioning (REQ-6.1.2)."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="deploy-pod",
            name="Deploy Pod",
            version="1.0.0",
            type="action",
            plugin_id="k8s-pod-create",
        )

        storage.save_block(block)

        block_file = temp_storage_dir / "blocks" / "deploy-pod" / "1.0.0.yaml"
        assert block_file.exists()

    def test_load_block(self, storage):
        """Test loading block."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="test-block", name="Test Block", version="1.0.0", type="action", plugin_id="test"
        )

        storage.save_block(block)
        loaded = storage.load_block("test-block", version="1.0.0")

        assert loaded.id == block.id
        assert loaded.version == block.version

    def test_list_blocks(self, storage):
        """Test listing blocks."""
        from tests.conftest import create_test_block

        blocks = [
            create_test_block(id="b1", name="B1", version="1.0.0", type="action", plugin_id="p1"),
            create_test_block(
                id="b2", name="B2", version="1.0.0", type="validation", plugin_id="p2"
            ),
        ]

        for b in blocks:
            storage.save_block(b)

        listed = storage.list_blocks()
        assert len(listed) >= 2

    def test_load_block_latest_version(self, storage):
        """Test loading latest block version when version not specified."""
        from tests.conftest import create_test_block

        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            block = create_test_block(
                id="versioned-block", name="Versioned", version=v, type="action", plugin_id="test"
            )
            storage.save_block(block)

        # Load latest (should be 2.0.0)
        loaded = storage.load_block("versioned-block")
        assert loaded.version == "2.0.0"

    def test_save_test(self, storage, temp_storage_dir):
        """Test saving test (REQ-6.1.2)."""
        from wavecore.models.entities import Test

        test = Test(id="test-test", name="Test Test", version="1.0.0", blocks=[])

        storage.save_test(test)

        test_file = temp_storage_dir / "tests" / "test-test" / "1.0.0.yaml"
        assert test_file.exists()

    def test_load_test(self, storage):
        """Test loading test."""
        from wavecore.models.entities import Test

        test = Test(id="load-test", name="Load Test", version="1.0.0", blocks=[])

        storage.save_test(test)
        loaded = storage.load_test("load-test", version="1.0.0")

        assert loaded.id == test.id
        assert loaded.version == test.version

    def test_list_tests(self, storage):
        """Test listing tests."""
        from wavecore.models.entities import Test

        tests = [
            Test(id="t1", name="T1", version="1.0.0", blocks=[]),
            Test(id="t2", name="T2", version="1.0.0", blocks=[]),
        ]

        for t in tests:
            storage.save_test(t)

        listed = storage.list_tests()
        assert len(listed) >= 2

    def test_load_test_latest_version(self, storage):
        """Test loading latest test version when version not specified."""
        from wavecore.models.entities import Test

        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            test = Test(id="versioned-test", name="Versioned", version=v, blocks=[])
            storage.save_test(test)

        # Load latest (should be 2.0.0)
        loaded = storage.load_test("versioned-test")
        assert loaded.version == "2.0.0"

    def test_save_suite(self, storage, temp_storage_dir):
        """Test saving suite (REQ-6.2.4)."""
        from wavecore.models.entities import Suite

        suite = Suite(id="test-suite", name="Test Suite", version="1.0.0", tests=[])

        storage.save_suite(suite)

        suite_file = temp_storage_dir / "suites" / "test-suite" / "1.0.0.yaml"
        assert suite_file.exists()

    def test_load_suite(self, storage):
        """Test loading suite."""
        from wavecore.models.entities import Suite

        suite = Suite(id="load-suite", name="Load Suite", version="1.0.0", tests=[])

        storage.save_suite(suite)
        loaded = storage.load_suite("load-suite", version="1.0.0")

        assert loaded.id == suite.id
        assert loaded.version == suite.version

    def test_list_suites(self, storage):
        """Test listing suites."""
        from wavecore.models.entities import Suite

        suites = [
            Suite(id="s1", name="S1", version="1.0.0", tests=[]),
            Suite(id="s2", name="S2", version="1.0.0", tests=[]),
        ]

        for s in suites:
            storage.save_suite(s)

        listed = storage.list_suites()
        assert len(listed) >= 2

    def test_load_suite_latest_version(self, storage):
        """Test loading latest suite version when version not specified."""
        from wavecore.models.entities import Suite

        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            suite = Suite(id="versioned-suite", name="Versioned", version=v, tests=[])
            storage.save_suite(suite)

        # Load latest (should be 2.0.0)
        loaded = storage.load_suite("versioned-suite")
        assert loaded.version == "2.0.0"

    def test_save_regression(self, storage, temp_storage_dir):
        """Test saving regression (REQ-6.2.5)."""
        from wavecore.models.entities import Regression

        regression = Regression(
            id="test-regression", name="Test Regression", version="1.0.0", suites=[]
        )

        storage.save_regression(regression)

        regression_file = temp_storage_dir / "regressions" / "test-regression" / "1.0.0.yaml"
        assert regression_file.exists()

    def test_load_regression(self, storage):
        """Test loading regression."""
        from wavecore.models.entities import Regression

        regression = Regression(
            id="load-regression", name="Load Regression", version="1.0.0", suites=[]
        )

        storage.save_regression(regression)
        loaded = storage.load_regression("load-regression", version="1.0.0")

        assert loaded.id == regression.id
        assert loaded.version == regression.version

    def test_list_regressions(self, storage):
        """Test listing regressions."""
        from wavecore.models.entities import Regression

        regressions = [
            Regression(id="r1", name="R1", version="1.0.0", suites=[]),
            Regression(id="r2", name="R2", version="1.0.0", suites=[]),
        ]

        for r in regressions:
            storage.save_regression(r)

        listed = storage.list_regressions()
        assert len(listed) >= 2

    def test_load_regression_latest_version(self, storage):
        """Test loading latest regression version when version not specified."""
        from wavecore.models.entities import Regression

        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            regression = Regression(
                id="versioned-regression", name="Versioned", version=v, suites=[]
            )
            storage.save_regression(regression)

        # Load latest (should be 2.0.0)
        loaded = storage.load_regression("versioned-regression")
        assert loaded.version == "2.0.0"

    def test_version_conflict_handling(self, storage):
        """Test handling of version conflicts."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="conflict-test",
            name="Conflict",
            version="1.0.0",
            category="system",
            description="",
        )

        storage.save_plugin(plugin)

        # Saving same version again should raise error or overwrite based on config
        with pytest.raises(Exception):  # noqa: B017 - asserts only that the overwrite is refused
            storage.save_plugin(plugin, allow_overwrite=False)

    def test_metadata_preservation(self, storage):
        """Test that metadata is preserved during save/load (REQ-6.1.3)."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="metadata-test",
            name="Metadata Test",
            version="1.0.0",
            category="system",
            description="Test metadata preservation",
            author="Test Author",
            tags=["test", "metadata"],
        )

        storage.save_plugin(plugin)
        loaded = storage.load_plugin("metadata-test", version="1.0.0")

        assert loaded.author == plugin.author
        assert loaded.tags == plugin.tags
        assert loaded.description == plugin.description
        assert loaded.created_at is not None


class TestConfigurationHierarchy:
    """Test suite for configuration file hierarchy (REQ-6.1.5)."""

    @pytest.fixture
    def config_storage(self):
        """Create storage for configuration testing."""
        temp_dir = tempfile.mkdtemp()
        from wavecore.storage import FileBasedStorage

        storage = FileBasedStorage(base_path=Path(temp_dir))
        yield storage
        shutil.rmtree(temp_dir)

    def test_global_config(self, config_storage):
        """Test global configuration storage."""
        config = {"log_level": "INFO", "artifact_retention_days": 30}

        config_storage.save_config("global", config)
        loaded = config_storage.load_config("global")

        assert loaded["log_level"] == "INFO"
        assert loaded["artifact_retention_days"] == 30

    def test_environment_config(self, config_storage):
        """Test environment-specific configuration."""
        staging_config = {"base_url": "https://staging.example.com", "timeout": 30}

        config_storage.save_config("environments/staging", staging_config)
        loaded = config_storage.load_config("environments/staging")

        assert loaded["base_url"] == "https://staging.example.com"

    def test_config_hierarchy_resolution(self, config_storage):
        """Test configuration hierarchy resolution."""
        # Global config
        global_config = {"timeout": 60, "retry_count": 3}
        config_storage.save_config("global", global_config)

        # Environment-specific override
        env_config = {"timeout": 30}
        config_storage.save_config("environments/prod", env_config)

        # Resolved config should merge with env taking precedence
        resolved = config_storage.resolve_config("environments/prod")

        assert resolved["timeout"] == 30  # From env
        assert resolved["retry_count"] == 3  # From global


class TestErrorPaths:
    """Test suite for error handling and edge cases."""

    @pytest.fixture
    def storage(self):
        """Create file-based storage instance."""
        temp_dir = tempfile.mkdtemp()
        from wavecore.storage import FileBasedStorage

        storage_instance = FileBasedStorage(base_path=Path(temp_dir))
        yield storage_instance
        shutil.rmtree(temp_dir)

    # Plugin error paths
    def test_load_plugin_not_found(self, storage):
        """Test loading non-existent plugin raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Plugin not found"):
            storage.load_plugin("nonexistent-plugin")

    def test_delete_plugin_not_found(self, storage):
        """Test deleting non-existent plugin raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Plugin version not found"):
            storage.delete_plugin("nonexistent", "1.0.0")

    def test_save_plugin_no_overwrite(self, storage):
        """Test saving existing plugin without overwrite raises FileExistsError."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="no-overwrite",
            name="No Overwrite",
            version="1.0.0",
            category="system",
            description="Test",
        )

        storage.save_plugin(plugin)
        with pytest.raises(FileExistsError, match="Plugin version already exists"):
            storage.save_plugin(plugin, allow_overwrite=False)

    # Block error paths
    def test_load_block_not_found(self, storage):
        """Test loading non-existent block raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Block not found"):
            storage.load_block("nonexistent-block")

    def test_load_block_version_not_found(self, storage):
        """Test loading specific non-existent version raises FileNotFoundError."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="test-block", name="Test", version="1.0.0", type="action", plugin_id="test"
        )
        storage.save_block(block)

        with pytest.raises(FileNotFoundError, match="Block version not found"):
            storage.load_block("test-block", version="2.0.0")

    def test_load_block_no_versions(self, storage, temp_storage_dir=None):
        """Test loading block with no versions raises FileNotFoundError."""

        # Create block directory but no version files
        block_dir = storage.base_path / "blocks" / "empty-block"
        block_dir.mkdir(parents=True)

        with pytest.raises(FileNotFoundError, match="No versions found for block"):
            storage.load_block("empty-block")

    def test_save_block_no_overwrite(self, storage):
        """Test saving existing block without overwrite raises FileExistsError."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="no-overwrite-block",
            name="No Overwrite",
            version="1.0.0",
            type="action",
            plugin_id="test",
        )

        storage.save_block(block)
        with pytest.raises(FileExistsError, match="Block version already exists"):
            storage.save_block(block, allow_overwrite=False)

    def test_delete_block_not_found(self, storage):
        """Test deleting non-existent block raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Block version not found"):
            storage.delete_block("nonexistent", "1.0.0")

    # Test error paths
    def test_load_test_not_found(self, storage):
        """Test loading non-existent test raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Test not found"):
            storage.load_test("nonexistent-test")

    def test_load_test_version_not_found(self, storage):
        """Test loading specific non-existent test version raises FileNotFoundError."""
        from wavecore.models.entities import Test

        test = Test(id="test-test", name="Test", version="1.0.0", blocks=[])
        storage.save_test(test)

        with pytest.raises(FileNotFoundError, match="Test version not found"):
            storage.load_test("test-test", version="2.0.0")

    def test_load_test_no_versions(self, storage):
        """Test loading test with no versions raises FileNotFoundError."""
        test_dir = storage.base_path / "tests" / "empty-test"
        test_dir.mkdir(parents=True)

        with pytest.raises(FileNotFoundError, match="No versions found for test"):
            storage.load_test("empty-test")

    def test_save_test_no_overwrite(self, storage):
        """Test saving existing test without overwrite raises FileExistsError."""
        from wavecore.models.entities import Test

        test = Test(id="no-overwrite-test", name="No Overwrite", version="1.0.0", blocks=[])

        storage.save_test(test)
        with pytest.raises(FileExistsError, match="Test version already exists"):
            storage.save_test(test, allow_overwrite=False)

    def test_delete_test_not_found(self, storage):
        """Test deleting non-existent test raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Test version not found"):
            storage.delete_test("nonexistent", "1.0.0")

    # Suite error paths
    def test_load_suite_not_found(self, storage):
        """Test loading non-existent suite raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Suite not found"):
            storage.load_suite("nonexistent-suite")

    def test_load_suite_version_not_found(self, storage):
        """Test loading specific non-existent suite version raises FileNotFoundError."""
        from wavecore.models.entities import Suite

        suite = Suite(id="test-suite", name="Test", version="1.0.0", tests=[])
        storage.save_suite(suite)

        with pytest.raises(FileNotFoundError, match="Suite version not found"):
            storage.load_suite("test-suite", version="2.0.0")

    def test_load_suite_no_versions(self, storage):
        """Test loading suite with no versions raises FileNotFoundError."""
        suite_dir = storage.base_path / "suites" / "empty-suite"
        suite_dir.mkdir(parents=True)

        with pytest.raises(FileNotFoundError, match="No versions found for suite"):
            storage.load_suite("empty-suite")

    def test_save_suite_no_overwrite(self, storage):
        """Test saving existing suite without overwrite raises FileExistsError."""
        from wavecore.models.entities import Suite

        suite = Suite(id="no-overwrite-suite", name="No Overwrite", version="1.0.0", tests=[])

        storage.save_suite(suite)
        with pytest.raises(FileExistsError, match="Suite version already exists"):
            storage.save_suite(suite, allow_overwrite=False)

    def test_delete_suite_not_found(self, storage):
        """Test deleting non-existent suite raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Suite version not found"):
            storage.delete_suite("nonexistent", "1.0.0")

    # Regression error paths
    def test_load_regression_not_found(self, storage):
        """Test loading non-existent regression raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Regression not found"):
            storage.load_regression("nonexistent-regression")

    def test_load_regression_version_not_found(self, storage):
        """Test loading specific non-existent regression version raises FileNotFoundError."""
        from wavecore.models.entities import Regression

        regression = Regression(id="test-regression", name="Test", version="1.0.0", suites=[])
        storage.save_regression(regression)

        with pytest.raises(FileNotFoundError, match="Regression version not found"):
            storage.load_regression("test-regression", version="2.0.0")

    def test_load_regression_no_versions(self, storage):
        """Test loading regression with no versions raises FileNotFoundError."""
        regression_dir = storage.base_path / "regressions" / "empty-regression"
        regression_dir.mkdir(parents=True)

        with pytest.raises(FileNotFoundError, match="No versions found for regression"):
            storage.load_regression("empty-regression")

    def test_save_regression_no_overwrite(self, storage):
        """Test saving existing regression without overwrite raises FileExistsError."""
        from wavecore.models.entities import Regression

        regression = Regression(
            id="no-overwrite-regression", name="No Overwrite", version="1.0.0", suites=[]
        )

        storage.save_regression(regression)
        with pytest.raises(FileExistsError, match="Regression version already exists"):
            storage.save_regression(regression, allow_overwrite=False)

    def test_delete_regression_not_found(self, storage):
        """Test deleting non-existent regression raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Regression version not found"):
            storage.delete_regression("nonexistent", "1.0.0")

    # Configuration error paths
    def test_load_config_not_found(self, storage):
        """Test loading non-existent config raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Config not found"):
            storage.load_config("nonexistent-config")

    def test_resolve_config_no_global(self, storage):
        """Test resolving config without global config."""
        resolved = storage.resolve_config("environments/test")
        assert resolved == {}

    def test_resolve_config_no_specific(self, storage):
        """Test resolving config when specific config doesn't exist."""
        global_config = {"timeout": 60}
        storage.save_config("global", global_config)

        resolved = storage.resolve_config("environments/nonexistent")
        assert resolved["timeout"] == 60

    # File loading error paths
    def test_load_file_not_found(self, storage):
        """Test _load_file with non-existent file raises FileNotFoundError."""
        from wavecore.models.plugins import Plugin

        non_existent = storage.base_path / "does_not_exist.yaml"
        with pytest.raises(FileNotFoundError, match="File not found"):
            storage._load_file(non_existent, Plugin, "yaml")

    # Version handling
    def test_get_latest_version_empty_list(self, storage):
        """Test _get_latest_version with empty list raises ValueError."""
        with pytest.raises(ValueError, match="No versions available"):
            storage._get_latest_version([])

    # Additional edge cases for delete operations
    def test_delete_block_yaml_not_json(self, storage):
        """Test deleting block when only YAML exists (not JSON)."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="yaml-only-block", name="YAML Only", version="1.0.0", type="action", plugin_id="test"
        )
        storage.save_block(block, format="yaml")
        storage.delete_block("yaml-only-block", "1.0.0")

        # Verify it's deleted
        with pytest.raises(FileNotFoundError):
            storage.load_block("yaml-only-block", version="1.0.0")

    def test_delete_test_yaml_not_json(self, storage):
        """Test deleting test when only YAML exists (not JSON)."""
        from wavecore.models.entities import Test

        test = Test(id="yaml-only-test", name="YAML Only", version="1.0.0", blocks=[])
        storage.save_test(test, format="yaml")
        storage.delete_test("yaml-only-test", "1.0.0")

        with pytest.raises(FileNotFoundError):
            storage.load_test("yaml-only-test", version="1.0.0")

    def test_delete_suite_yaml_not_json(self, storage):
        """Test deleting suite when only YAML exists (not JSON)."""
        from wavecore.models.entities import Suite

        suite = Suite(id="yaml-only-suite", name="YAML Only", version="1.0.0", tests=[])
        storage.save_suite(suite, format="yaml")
        storage.delete_suite("yaml-only-suite", "1.0.0")

        with pytest.raises(FileNotFoundError):
            storage.load_suite("yaml-only-suite", version="1.0.0")

    def test_delete_regression_yaml_not_json(self, storage):
        """Test deleting regression when only YAML exists (not JSON)."""
        from wavecore.models.entities import Regression

        regression = Regression(
            id="yaml-only-regression", name="YAML Only", version="1.0.0", suites=[]
        )
        storage.save_regression(regression, format="yaml")
        storage.delete_regression("yaml-only-regression", "1.0.0")

        with pytest.raises(FileNotFoundError):
            storage.load_regression("yaml-only-regression", version="1.0.0")


class TestHelperFunctionEdgeCases:
    """Tests for module-level helper function edge cases."""

    def test_remove_lock_file_with_none(self):
        """Test _remove_lock_file returns immediately when lock_file is None."""
        from wavecore.storage.file_storage.storage import _remove_lock_file

        # Should return without error when passed None
        _remove_lock_file(None)

    def test_remove_temp_file_with_none(self):
        """Test _remove_temp_file returns immediately when temp_file is None."""
        from wavecore.storage.file_storage.storage import _remove_temp_file

        # Should return without error when passed None
        _remove_temp_file(None)

    def test_find_latest_version_in_dir_empty(self, tmp_path):
        """Test _find_latest_version_in_dir returns None for empty directory."""
        from wavecore.storage.file_storage.storage import _find_latest_version_in_dir

        empty_dir = tmp_path / "empty_entity"
        empty_dir.mkdir()

        result = _find_latest_version_in_dir(empty_dir)
        assert result is None


class TestListOperationsEdgeCases:
    """Tests for list operation edge cases - non-dir entries and missing directories."""

    @pytest.fixture
    def storage(self):
        """Create file-based storage instance."""
        temp_dir = tempfile.mkdtemp()
        from wavecore.storage import FileBasedStorage

        storage_instance = FileBasedStorage(base_path=Path(temp_dir))
        yield storage_instance
        shutil.rmtree(temp_dir)

    def test_list_plugins_skips_non_directory_entries(self, storage):
        """Test list_plugins skips files in category directories."""
        from tests.conftest import create_test_plugin

        plugin = create_test_plugin(
            id="real-plugin", name="Real", version="1.0.0", category="system", description=""
        )
        storage.save_plugin(plugin)

        # Create a regular file inside the category directory (not a plugin directory)
        stray_file = storage.base_path / "plugins" / "system" / "stray-file.txt"
        stray_file.write_text("not a plugin")

        listed = storage.list_plugins()
        plugin_ids = [p.id for p in listed]
        assert "real-plugin" in plugin_ids
        # stray file should be silently skipped, not cause an error

    def test_list_blocks_missing_directory(self, storage):
        """Test list_blocks returns empty when blocks directory doesn't exist."""
        import shutil as _shutil

        # Remove the blocks directory that was created during initialization
        _shutil.rmtree(storage.base_path / "blocks")

        result = storage.list_blocks()
        assert result == []

    def test_list_blocks_skips_non_directory_entries(self, storage):
        """Test list_blocks skips files in blocks directory."""
        from tests.conftest import create_test_block

        block = create_test_block(
            id="real-block", name="Real", version="1.0.0", type="action", plugin_id="test"
        )
        storage.save_block(block)

        # Create a stray file in blocks directory
        stray_file = storage.base_path / "blocks" / "stray-file.txt"
        stray_file.write_text("not a block")

        listed = storage.list_blocks()
        block_ids = [b.id for b in listed]
        assert "real-block" in block_ids

    def test_list_tests_missing_directory(self, storage):
        """Test list_tests returns empty when tests directory doesn't exist."""
        import shutil as _shutil

        _shutil.rmtree(storage.base_path / "tests")

        result = storage.list_tests()
        assert result == []

    def test_list_tests_skips_non_directory_entries(self, storage):
        """Test list_tests skips files in tests directory."""
        from wavecore.models.entities import Test

        test = Test(id="real-test", name="Real", version="1.0.0", blocks=[])
        storage.save_test(test)

        stray_file = storage.base_path / "tests" / "stray-file.txt"
        stray_file.write_text("not a test")

        listed = storage.list_tests()
        test_ids = [t.id for t in listed]
        assert "real-test" in test_ids

    def test_list_suites_missing_directory(self, storage):
        """Test list_suites returns empty when suites directory doesn't exist."""
        import shutil as _shutil

        _shutil.rmtree(storage.base_path / "suites")

        result = storage.list_suites()
        assert result == []

    def test_list_suites_skips_non_directory_entries(self, storage):
        """Test list_suites skips files in suites directory."""
        from wavecore.models.entities import Suite

        suite = Suite(id="real-suite", name="Real", version="1.0.0", tests=[])
        storage.save_suite(suite)

        stray_file = storage.base_path / "suites" / "stray-file.txt"
        stray_file.write_text("not a suite")

        listed = storage.list_suites()
        suite_ids = [s.id for s in listed]
        assert "real-suite" in suite_ids

    def test_list_regressions_missing_directory(self, storage):
        """Test list_regressions returns empty when regressions directory doesn't exist."""
        import shutil as _shutil

        _shutil.rmtree(storage.base_path / "regressions")

        result = storage.list_regressions()
        assert result == []

    def test_list_regressions_skips_non_directory_entries(self, storage):
        """Test list_regressions skips files in regressions directory."""
        from wavecore.models.entities import Regression

        regression = Regression(id="real-regression", name="Real", version="1.0.0", suites=[])
        storage.save_regression(regression)

        stray_file = storage.base_path / "regressions" / "stray-file.txt"
        stray_file.write_text("not a regression")

        listed = storage.list_regressions()
        regression_ids = [r.id for r in listed]
        assert "real-regression" in regression_ids


class TestRefusedSave:
    """Test suite for a save refused because the version already exists."""

    @pytest.fixture
    def refused(self, tmp_path, caplog):
        """Save an existing version with overwrite off and return what the refusal did."""
        from wavecore.models.entities import Test
        from wavecore.storage import FileBasedStorage

        storage = FileBasedStorage(base_path=tmp_path)
        test = Test(id="kept-test", name="Kept", version="1.0.0", blocks=[])
        storage.save_test(test)
        stored = tmp_path / "tests" / "kept-test" / "1.0.0.yaml"
        attempts = []
        real_flock = fcntl.flock

        def counting_flock(fd, operation):
            # Each save attempt asks for the exclusive lock once.
            if operation & fcntl.LOCK_EX:
                attempts.append(operation)
            return real_flock(fd, operation)

        with (
            patch("fcntl.flock", side_effect=counting_flock),
            patch("time.sleep") as sleep,
            caplog.at_level(logging.ERROR),
            pytest.raises(
                FileExistsError,
                match=f"^Test version already exists: {re.escape(str(stored))}$",
            ),
        ):
            storage.save_test(test, allow_overwrite=False)

        return SimpleNamespace(
            attempts=len(attempts),
            waits=[call.args[0] for call in sleep.call_args_list],
            failure_lines=[
                record.getMessage()
                for record in caplog.records
                if record.getMessage().startswith("Transaction failed")
            ],
        )

    def test_refusal_comes_after_one_save_attempt(self, refused):
        """Test a refused save is not tried again."""
        assert refused.attempts == 1

    def test_refusal_asks_for_no_wait(self, refused):
        """Test a refused save never waits before it fails."""
        assert refused.waits == []

    def test_refusal_logs_no_transaction_failure(self, refused):
        """Test a refused save logs no "Transaction failed" error line."""
        assert refused.failure_lines == []


LOCALE_TEXT = {"name": "Grüße 測試", "description": "Grüße 測試 description"}
LOCALE_ENTITY = {"id": "locale-test", "version": "1.0.0", "blocks": [], **LOCALE_TEXT}

LOCALE_CHILD = f"""\
import sys
from pathlib import Path

from wavecore.models.entities import Test
from wavecore.storage import FileBasedStorage

TEXT = {LOCALE_TEXT!r}
ENTITY = {LOCALE_ENTITY!r}
storage = FileBasedStorage(base_path=Path(sys.argv[1]))


def loaded_text(file_format):
    loaded = storage.load_test(ENTITY["id"], version=ENTITY["version"], format=file_format)
    return dict(name=loaded.name, description=loaded.description)


def answer(same):
    raise SystemExit(0 if same else 3)
"""

CHILD_SAVES_AND_LOADS_ENTITY = f"""{LOCALE_CHILD}
for file_format in ("yaml", "json"):
    storage.save_test(Test(**ENTITY), format=file_format)
answer(loaded_text("yaml") == TEXT and loaded_text("json") == TEXT)
"""

CHILD_LOADS_ENTITY = f"""{LOCALE_CHILD}
answer(loaded_text(sys.argv[2]) == TEXT)
"""

CHILD_SAVES_AND_LOADS_CONFIG = f"""{LOCALE_CHILD}
storage.save_config("global", TEXT)
answer(storage.load_config("global") == TEXT)
"""

CHILD_LOADS_CONFIG = f"""{LOCALE_CHILD}
answer(storage.load_config("global") == TEXT)
"""


def _stored(path):
    """Parse a stored file from its bytes, read as UTF-8."""
    text = path.read_bytes().decode("utf-8")
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


def _utf8_bytes(data, file_format):
    """Serialize without escapes, so the bytes hold the text itself as UTF-8."""
    if file_format == "json":
        return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).encode("utf-8")


class TestLocaleIndependence:
    """Test suite for stored text on a WAVE host whose locale is not UTF-8 (REQ-4.6.9)."""

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

    def test_saved_entity_is_utf8_on_disk_and_loads_back(self, tmp_path, run_child):
        """Test a saved name and description are UTF-8 on disk and load back equal."""
        # Starts a child Python.
        base = tmp_path / "data"

        done = run_child(CHILD_SAVES_AND_LOADS_ENTITY, str(base))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        for file_format in ("yaml", "json"):
            stored = _stored(base / "tests" / "locale-test" / f"1.0.0.{file_format}")
            assert {key: stored[key] for key in LOCALE_TEXT} == LOCALE_TEXT

    @pytest.mark.parametrize("file_format", ["yaml", "json"])
    def test_entity_stored_as_utf8_loads_equal(self, tmp_path, run_child, file_format):
        """Test a name and description stored as UTF-8 bytes load equal."""
        # Starts a child Python.
        base = tmp_path / "data"
        entity_file = base / "tests" / "locale-test" / f"1.0.0.{file_format}"
        entity_file.parent.mkdir(parents=True)
        entity_file.write_bytes(_utf8_bytes(LOCALE_ENTITY, file_format))

        done = run_child(CHILD_LOADS_ENTITY, str(base), file_format)

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")

    def test_saved_config_is_utf8_on_disk_and_loads_back(self, tmp_path, run_child):
        """Test a saved configuration is UTF-8 on disk and loads back equal."""
        # Starts a child Python.
        base = tmp_path / "data"

        done = run_child(CHILD_SAVES_AND_LOADS_CONFIG, str(base))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        assert _stored(base / "config" / "global.yaml") == LOCALE_TEXT

    def test_config_stored_as_utf8_loads_equal(self, tmp_path, run_child):
        """Test a configuration stored as UTF-8 bytes loads equal."""
        # Starts a child Python.
        base = tmp_path / "data"
        config_file = base / "config" / "global.yaml"
        config_file.parent.mkdir(parents=True)
        config_file.write_bytes(_utf8_bytes(LOCALE_TEXT, "yaml"))

        done = run_child(CHILD_LOADS_CONFIG, str(base))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
