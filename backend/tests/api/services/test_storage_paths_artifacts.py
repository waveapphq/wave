"""Unit tests for the canonical artifact root resolution (REQ-3.7.1.4).

``storage_paths.get_artifacts_storage_path()`` resolves the single artifact
root: the ``WAVE_STORAGE_ARTIFACTS_DIR`` environment override wins, otherwise
``{base_path}/artifacts``. The result is cached like ``get_base_path()`` and
cleared by ``reset_path_cache()``.
"""

from pathlib import Path

import pytest

from wavecore.api.services import storage_paths


class TestArtifactsStoragePath:
    """Resolution order: env override, then {base_path}/artifacts."""

    def test_default_is_artifacts_under_base_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.delenv("WAVE_STORAGE_ARTIFACTS_DIR", raising=False)
        storage_paths.reset_path_cache()
        storage_paths.set_base_path(tmp_path)

        result = storage_paths.get_artifacts_storage_path()

        assert result == tmp_path / "artifacts"

    def test_env_override_wins_over_base_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        override = tmp_path / "external-volume" / "wave-artifacts"
        monkeypatch.setenv("WAVE_STORAGE_ARTIFACTS_DIR", str(override))
        storage_paths.reset_path_cache()
        storage_paths.set_base_path(tmp_path)

        result = storage_paths.get_artifacts_storage_path()

        assert result == override

    def test_result_is_cached_until_reset(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.delenv("WAVE_STORAGE_ARTIFACTS_DIR", raising=False)
        storage_paths.reset_path_cache()
        storage_paths.set_base_path(tmp_path)
        first = storage_paths.get_artifacts_storage_path()

        # A late env change must NOT affect the cached value.
        monkeypatch.setenv("WAVE_STORAGE_ARTIFACTS_DIR", str(tmp_path / "late-override"))
        second = storage_paths.get_artifacts_storage_path()

        assert second == first

    def test_reset_path_cache_picks_up_env_change(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.delenv("WAVE_STORAGE_ARTIFACTS_DIR", raising=False)
        storage_paths.reset_path_cache()
        storage_paths.set_base_path(tmp_path)
        storage_paths.get_artifacts_storage_path()

        override = tmp_path / "after-reset"
        monkeypatch.setenv("WAVE_STORAGE_ARTIFACTS_DIR", str(override))
        storage_paths.reset_path_cache()
        storage_paths.set_base_path(tmp_path)

        assert storage_paths.get_artifacts_storage_path() == override

    def test_default_follows_base_path_changes_after_reset(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.delenv("WAVE_STORAGE_ARTIFACTS_DIR", raising=False)
        first_base = tmp_path / "base-one"
        second_base = tmp_path / "base-two"

        storage_paths.reset_path_cache()
        storage_paths.set_base_path(first_base)
        assert storage_paths.get_artifacts_storage_path() == first_base / "artifacts"

        storage_paths.reset_path_cache()
        storage_paths.set_base_path(second_base)
        assert storage_paths.get_artifacts_storage_path() == second_base / "artifacts"
