"""Unit tests for storage_paths module.

Tests the centralized storage path configuration used by API services.
"""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.config import loader
from wavecore.api.config.loader import Config, ConfigValidationError
from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths


def _install_config(
    monkeypatch: pytest.MonkeyPatch, folder: Path, storage: dict[str, Any] | None
) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    config_file = folder / "wave.yaml"
    data = {} if storage is None else {"storage": storage}
    config_file.write_text(yaml.safe_dump(data), encoding="utf-8")
    monkeypatch.setattr(loader, "_config_instance", Config(config_file=str(config_file)))
    storage_paths.reset_path_cache()


@pytest.fixture
def launch_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty launch folder with no data folder settings in the environment."""
    monkeypatch.delenv("WAVE_STORAGE_BASE_PATH", raising=False)
    launch = tmp_path / "launch"
    launch.mkdir()
    monkeypatch.chdir(launch)
    return launch


class TestStoragePaths:
    """Test suite for storage path configuration."""

    def test_get_base_path_has_no_fallback_when_the_folder_is_not_set(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        """No config key and no env: the not-set refusal, never ./data (REQ-4.7.13)."""
        _install_config(monkeypatch, tmp_path / "install", None)

        with pytest.raises(
            ConfigValidationError,
            match=r"^Data folder not set: add storage\.base_path to the config file or set "
            r"WAVE_STORAGE_BASE_PATH$",
        ):
            storage_paths.get_base_path()

        assert not (launch_folder / "data").exists()

    def test_get_base_path_uses_environment_variable(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        """An absolute WAVE_STORAGE_BASE_PATH set after the config loaded still wins."""
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "data"})
        custom_path = str(tmp_path / "custom_storage")
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", custom_path)
        storage_paths.reset_path_cache()

        result = storage_paths.get_base_path()

        assert result == Path(custom_path)

    def test_get_base_path_caches_result(self, tmp_path: Path) -> None:
        """Test that get_base_path caches the result."""
        # First call
        _result1 = storage_paths.get_base_path()
        # Change the path - should not affect cached result
        storage_paths._base_path_cache = tmp_path / "cached"
        result2 = storage_paths.get_base_path()

        # Should return cached value, not re-compute
        assert result2 == tmp_path / "cached"

    def test_get_tests_storage_path(self, tmp_path: Path) -> None:
        """Test that get_tests_storage_path returns correct subdirectory."""
        storage_paths.set_base_path(str(tmp_path))

        result = storage_paths.get_tests_storage_path()

        assert result == tmp_path / "api_tests"

    def test_get_blocks_storage_path(self, tmp_path: Path) -> None:
        """Test that get_blocks_storage_path returns correct subdirectory."""
        storage_paths.set_base_path(str(tmp_path))

        result = storage_paths.get_blocks_storage_path()

        assert result == tmp_path / "api_blocks"

    def test_reset_path_cache_clears_cache(self, tmp_path: Path, temp_storage_path: Path) -> None:
        """Test that reset_path_cache clears the cached path."""
        storage_paths.set_base_path(str(tmp_path / "original"))

        storage_paths.reset_path_cache()

        # After reset, cache should be None
        assert storage_paths._base_path_cache is None

        # Restore the fixture's temp path
        storage_paths.set_base_path(temp_storage_path)

    def test_set_base_path_overrides_default(self, tmp_path: Path) -> None:
        """Test that set_base_path overrides the default path."""
        custom = tmp_path / "custom"
        storage_paths.set_base_path(str(custom))

        result = storage_paths.get_base_path()

        assert result == custom

    def test_set_base_path_accepts_path_object(self, tmp_path: Path) -> None:
        """Test that set_base_path accepts Path objects."""
        custom = tmp_path / "path_object"
        storage_paths.set_base_path(custom)

        result = storage_paths.get_base_path()

        assert result == custom

    def test_get_suites_storage_path(self, tmp_path: Path) -> None:
        """Test that get_suites_storage_path returns correct subdirectory."""
        storage_paths.set_base_path(str(tmp_path))

        result = storage_paths.get_suites_storage_path()

        assert result == tmp_path / "api_suites"

    def test_get_regressions_storage_path(self, tmp_path: Path) -> None:
        """Test that get_regressions_storage_path returns correct subdirectory."""
        storage_paths.set_base_path(str(tmp_path))

        result = storage_paths.get_regressions_storage_path()

        assert result == tmp_path / "api_regressions"


class TestTestDataStoragePaths:
    """The Test Data zone and the per-test folder under it (REQ-4.7.9)."""

    def test_get_testdata_storage_path_is_the_zone_under_the_base(self, tmp_path: Path) -> None:
        """The zone is base_path/testdata."""
        storage_paths.set_base_path(str(tmp_path))

        assert storage_paths.get_testdata_storage_path() == tmp_path / "testdata"

    def test_get_test_testdata_path_is_the_zone_and_the_test_id(self, tmp_path: Path) -> None:
        """A test's folder is base_path/testdata/<test_id>."""
        storage_paths.set_base_path(str(tmp_path))

        result = storage_paths.get_test_testdata_path("11111111-2222-3333-4444-555555555555")

        assert result == tmp_path / "testdata" / "11111111-2222-3333-4444-555555555555"

    def test_test_testdata_path_sits_inside_the_zone(self, tmp_path: Path) -> None:
        """The per-test folder is always a direct child of the zone."""
        storage_paths.set_base_path(str(tmp_path))

        zone = storage_paths.get_testdata_storage_path()
        test_path = storage_paths.get_test_testdata_path("abc")

        assert test_path.parent == zone

    def test_testdata_paths_follow_set_base_path(self, tmp_path: Path) -> None:
        """Repointing the base path moves both testdata paths with it."""
        storage_paths.set_base_path(str(tmp_path / "first"))
        assert storage_paths.get_testdata_storage_path() == tmp_path / "first" / "testdata"

        storage_paths.set_base_path(str(tmp_path / "second"))

        assert storage_paths.get_testdata_storage_path() == tmp_path / "second" / "testdata"
        assert (
            storage_paths.get_test_testdata_path("abc") == tmp_path / "second" / "testdata" / "abc"
        )

    def test_testdata_paths_follow_reset_path_cache(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, temp_storage_path: Path
    ) -> None:
        """After reset_path_cache the zone is recomputed from the environment."""
        storage_paths.set_base_path(str(tmp_path / "stale"))
        custom = tmp_path / "from_env"
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", str(custom))

        storage_paths.reset_path_cache()

        assert storage_paths.get_testdata_storage_path() == custom / "testdata"
        assert storage_paths.get_test_testdata_path("abc") == custom / "testdata" / "abc"

        storage_paths.set_base_path(temp_storage_path)

    def test_testdata_zone_has_no_environment_override(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, temp_storage_path: Path
    ) -> None:
        """Unlike artifacts, the zone has no env var: it always tracks the base path."""
        storage_paths.reset_path_cache()
        monkeypatch.setenv("WAVE_STORAGE_ARTIFACTS_DIR", str(tmp_path / "elsewhere"))
        storage_paths.set_base_path(str(tmp_path / "base"))

        assert storage_paths.get_testdata_storage_path() == tmp_path / "base" / "testdata"

        storage_paths.reset_path_cache()
        storage_paths.set_base_path(temp_storage_path)

    def test_get_test_testdata_path_refuses_an_id_leaving_the_zone(self, tmp_path: Path) -> None:
        storage_paths.set_base_path(str(tmp_path))

        with pytest.raises(ValidationException, match=r"^Invalid UUID format for id: '\.\./x'$"):
            storage_paths.get_test_testdata_path("../x")


NOT_ONE_SEGMENT = ["", ".", "..", "../outside", "a/b", "/abs", "a\\b", "..\\outside", "a\x00b"]


class TestEntityDir:
    """A stored entity's folder is one plain path segment under its storage root."""

    def test_an_id_is_the_folder_under_the_root(self, tmp_path: Path) -> None:
        entity_id = "11111111-2222-3333-4444-555555555555"

        assert storage_paths.entity_dir(tmp_path, entity_id) == tmp_path / entity_id

    @pytest.mark.parametrize("entity_id", ["abc", "a.b", "...", "name with spaces"])
    def test_any_plain_segment_is_accepted(self, tmp_path: Path, entity_id: str) -> None:
        assert storage_paths.entity_dir(tmp_path, entity_id).parent == tmp_path

    @pytest.mark.parametrize("entity_id", NOT_ONE_SEGMENT)
    def test_an_id_that_is_not_one_plain_segment_is_refused(
        self, tmp_path: Path, entity_id: str
    ) -> None:
        with pytest.raises(ValidationException) as refused:
            storage_paths.entity_dir(tmp_path, entity_id)

        assert refused.value.message == f"Invalid UUID format for id: '{entity_id}'"

    @pytest.mark.parametrize("entity_id", NOT_ONE_SEGMENT)
    def test_is_entity_id_is_false_for_what_entity_dir_refuses(self, entity_id: str) -> None:
        assert storage_paths.is_entity_id(entity_id) is False

    def test_is_entity_id_is_true_for_a_uuid(self) -> None:
        assert storage_paths.is_entity_id("11111111-2222-3333-4444-555555555555") is True


class TestBasePathFromConfig:
    """One resolver: get_base_path() reads Config.resolved_data_folder() (REQ-4.7.13)."""

    def test_relative_setting_resolves_against_the_config_file_folder(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        install = tmp_path / "install"
        _install_config(monkeypatch, install / "config", {"base_path": "../data"})

        result = storage_paths.get_base_path()

        assert result.is_absolute()
        assert ".." not in result.parts
        assert result.resolve() == (install / "data").resolve()
        assert not (launch_folder / "data").exists()

    def test_absolute_setting_is_used_as_is(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "/srv/wave-data"})

        assert storage_paths.get_base_path() == Path("/srv/wave-data")

    def test_get_base_path_is_what_the_config_resolver_returns(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", None)
        monkeypatch.setattr(Config, "resolved_data_folder", lambda self: Path("/srv/from-resolver"))
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "/srv/from-env")
        storage_paths.reset_path_cache()

        assert storage_paths.get_base_path() == Path("/srv/from-resolver")

    def test_relative_environment_override_is_refused(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "/srv/wave-data"})
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "data")
        storage_paths.reset_path_cache()

        with pytest.raises(
            ConfigValidationError,
            match=rf"^{re.escape('WAVE_STORAGE_BASE_PATH must be an absolute path: data')}$",
        ):
            storage_paths.get_base_path()

    def test_set_base_path_wins_over_the_config(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "/srv/wave-data"})
        storage_paths.set_base_path(tmp_path / "programmatic")

        assert storage_paths.get_base_path() == tmp_path / "programmatic"

    def test_set_base_path_wins_when_the_config_has_no_folder(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", None)
        storage_paths.set_base_path(tmp_path / "programmatic")

        assert storage_paths.get_base_path() == tmp_path / "programmatic"

    def test_the_old_default_constant_is_gone(self) -> None:
        assert not hasattr(storage_paths, "_DEFAULT_BASE_PATH")

    def test_the_resolved_folder_stays_until_the_cache_is_reset(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, launch_folder: Path
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "/srv/wave-data"})
        assert storage_paths.get_base_path() == Path("/srv/wave-data")

        loader.get_config().set("storage.base_path", "/srv/elsewhere")
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "/srv/from-env")

        assert storage_paths.get_base_path() == Path("/srv/wave-data")
        storage_paths.reset_path_cache()
        assert storage_paths.get_base_path() == Path("/srv/from-env")


class TestNetworkStoragePaths:
    """The network area of the data folder holds one file per store (REQ-4.7.8)."""

    def test_network_storage_path_is_under_the_base(self, tmp_path: Path) -> None:
        storage_paths.set_base_path(tmp_path)

        assert storage_paths.get_network_storage_path() == tmp_path / "network"

    def test_ssh_hosts_file_is_in_the_network_area(self, tmp_path: Path) -> None:
        storage_paths.set_base_path(tmp_path)

        assert storage_paths.get_ssh_hosts_file_path() == tmp_path / "network" / "ssh_hosts.yaml"

    def test_certificates_file_is_in_the_network_area(self, tmp_path: Path) -> None:
        storage_paths.set_base_path(tmp_path)

        assert (
            storage_paths.get_certificates_file_path() == tmp_path / "network" / "certificates.yaml"
        )

    def test_network_paths_follow_the_base(self, temp_storage_path: Path) -> None:
        assert storage_paths.get_network_storage_path() == temp_storage_path / "network"
        assert storage_paths.get_ssh_hosts_file_path().parent == temp_storage_path / "network"
        assert storage_paths.get_certificates_file_path().parent == temp_storage_path / "network"


class TestInstanceSettingsPaths:
    """Instance settings live in the config file, so the data folder has no path for them."""

    @pytest.mark.parametrize("name", ["get_mcp_settings_file_path", "get_backups_storage_path"])
    def test_the_data_folder_path_helper_is_gone(self, name: str) -> None:
        assert not hasattr(storage_paths, name)
