"""
Unit tests for reading plugin definitions from the data folder (REQ-6.1.1).
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

from tests.conftest import create_test_plugin


def _store_plugin(base_path, plugin):
    """Write a plugin definition as UTF-8 YAML where the storage reads it."""
    plugin_file = (
        base_path / "plugins" / plugin.metadata.category / plugin.id / f"{plugin.version}.yaml"
    )
    plugin_file.parent.mkdir(parents=True, exist_ok=True)
    plugin_file.write_bytes(
        yaml.safe_dump(plugin.model_dump(mode="json"), allow_unicode=True).encode("utf-8")
    )


class TestFileBasedStorage:
    """Test suite for file-based storage implementation (REQ-6.1.1)."""

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

    def test_storage_creates_nothing_in_data_folder(self, temp_storage_dir):
        """Test creating the storage leaves the data folder as it was."""
        from wavecore.storage import FileBasedStorage

        FileBasedStorage(base_path=temp_storage_dir)

        assert list(temp_storage_dir.iterdir()) == []

    def test_load_plugin_latest_version(self, storage, temp_storage_dir):
        """Test the latest stored version loads."""
        # Save multiple versions
        for v in ["1.0.0", "1.1.0", "2.0.0"]:
            plugin = create_test_plugin(
                id="versioned-plugin",
                name="Versioned",
                version=v,
                category="system",
                description="Test",
            )
            _store_plugin(temp_storage_dir, plugin)

        # Load latest (should be 2.0.0)
        loaded = storage.load_plugin("versioned-plugin")
        assert loaded.version == "2.0.0"

    def test_load_plugin_orders_versions_by_semver(self, storage, temp_storage_dir):
        """Test 1.10.0 is newer than 1.9.0."""
        for version in ["1.9.0", "1.10.0"]:
            _store_plugin(
                temp_storage_dir,
                create_test_plugin(id="semver-plugin", version=version, category="network"),
            )

        assert storage.load_plugin("semver-plugin").version == "1.10.0"


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

    def test_load_plugin_skips_folder_without_yaml(self, storage):
        """Test a plugin folder that holds no YAML version counts as not found."""
        plugin_dir = storage.base_path / "plugins" / "system" / "empty-plugin"
        plugin_dir.mkdir(parents=True)
        (plugin_dir / "1.0.0.json").write_text("{}", encoding="utf-8")

        with pytest.raises(FileNotFoundError, match="^Plugin not found: empty-plugin$"):
            storage.load_plugin("empty-plugin")

    @pytest.mark.parametrize(
        "plugin_id", ["../network/stored-plugin", "..\\network\\stored-plugin", "..", ""]
    )
    def test_load_plugin_id_that_is_not_one_plain_segment_is_not_found(self, storage, plugin_id):
        """Test an ID reaching another folder never loads the YAML it points at."""
        _store_plugin(storage.base_path, create_test_plugin(id="stored-plugin", category="network"))

        with pytest.raises(FileNotFoundError) as missing:
            storage.load_plugin(plugin_id)

        assert str(missing.value) == f"Plugin not found: {plugin_id}"


LOCALE_TEXT = {"name": "Grüße 測試", "description": "Grüße 測試 description"}

CHILD_LOADS_PLUGIN = f"""\
import sys
from pathlib import Path

from wavecore.storage import FileBasedStorage

TEXT = {LOCALE_TEXT!r}
loaded = FileBasedStorage(base_path=Path(sys.argv[1])).load_plugin("locale-plugin")
same = dict(name=loaded.metadata.name, description=loaded.metadata.description) == TEXT
raise SystemExit(0 if same else 3)
"""


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

    def test_plugin_stored_as_utf8_loads_equal(self, tmp_path, run_child):
        """Test a plugin name and description stored as UTF-8 bytes load equal."""
        # Starts a child Python.
        base = tmp_path / "data"
        _store_plugin(base, create_test_plugin(id="locale-plugin", **LOCALE_TEXT))

        done = run_child(CHILD_LOADS_PLUGIN, str(base))

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
