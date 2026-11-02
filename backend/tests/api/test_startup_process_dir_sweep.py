"""The private process root is swept at server start (REQ-3.4.1.1).

A Shell Script block keeps its script copy and its capture file in a directory
of its own, under WAVE's own storage rather than the working directory or the system temp folder.
A crash leaves those behind, so the server clears the whole root when it starts.
"""

import inspect
from pathlib import Path

from wavecore.api import app as app_module
from wavecore.api.services import storage_paths
from wavecore.plugins import _local_process_common


class TestThePrivateProcessRoot:
    """The root sits under the storage base and is not called a scratch dir."""

    def test_the_root_is_a_folder_of_the_storage_base(self, tmp_path: Path) -> None:
        storage_paths.set_base_path(tmp_path)

        assert storage_paths.get_local_process_storage_path() == tmp_path / "local-process"

    def test_the_root_follows_the_storage_base(self, temp_storage_path: Path) -> None:
        root = storage_paths.get_local_process_storage_path()

        assert root.parent == temp_storage_path

    def test_neither_the_getter_nor_the_path_says_scratch(self) -> None:
        # Scratch already names Function scratch runs, so this root avoids it.
        getters = [name for name in dir(storage_paths) if "local_process" in name]

        assert getters == ["get_local_process_storage_path"]
        assert not hasattr(storage_paths, "get_scratch_storage_path")
        assert "scratch" not in str(storage_paths.get_local_process_storage_path())


class TestTheSweep:
    """Everything the last run left under the root goes; the root itself stays."""

    def test_a_leftover_directory_is_removed(self) -> None:
        root = storage_paths.get_local_process_storage_path()
        root.mkdir(parents=True, exist_ok=True)
        leftover = root / "shell-script-abc123"
        leftover.mkdir()

        _local_process_common.sweep_private_dirs()

        assert not leftover.exists()

    def test_a_leftover_directory_holding_files_is_removed(self) -> None:
        root = storage_paths.get_local_process_storage_path()
        leftover = root / "shell-script-def456"
        leftover.mkdir(parents=True)
        (leftover / "script.sh").write_text("echo hi\n")
        (leftover / "capture").write_bytes(b"COUNT\x007\x00")

        _local_process_common.sweep_private_dirs()

        assert not leftover.exists()

    def test_a_leftover_file_is_removed(self) -> None:
        root = storage_paths.get_local_process_storage_path()
        root.mkdir(parents=True, exist_ok=True)
        stray = root / "capture"
        stray.write_text("stray")

        _local_process_common.sweep_private_dirs()

        assert not stray.exists()

    def test_every_leftover_goes_in_one_sweep(self) -> None:
        root = storage_paths.get_local_process_storage_path()
        root.mkdir(parents=True, exist_ok=True)
        for name in ("shell-script-a", "shell-script-b", "shell-script-c"):
            (root / name).mkdir()

        _local_process_common.sweep_private_dirs()

        assert list(root.iterdir()) == []

    def test_the_root_exists_after_the_sweep(self) -> None:
        root = storage_paths.get_local_process_storage_path()
        root.mkdir(parents=True, exist_ok=True)
        (root / "shell-script-a").mkdir()

        _local_process_common.sweep_private_dirs()

        assert root.is_dir()

    def test_a_missing_root_is_created(self) -> None:
        root = storage_paths.get_local_process_storage_path()

        _local_process_common.sweep_private_dirs()

        assert root.is_dir()
        assert list(root.iterdir()) == []

    def test_a_second_sweep_leaves_the_empty_root_alone(self) -> None:
        _local_process_common.sweep_private_dirs()
        _local_process_common.sweep_private_dirs()

        assert storage_paths.get_local_process_storage_path().is_dir()

    def test_nothing_outside_the_root_is_touched(self, temp_storage_path: Path) -> None:
        # Guard: the sweep clears its own root, never a sibling storage folder.
        sibling = temp_storage_path / "api_tests"
        sibling.mkdir(parents=True, exist_ok=True)
        kept = sibling / "keep.yaml"
        kept.write_text("id: keep\n")

        _local_process_common.sweep_private_dirs()

        assert kept.exists()


class TestServerStart:
    """The sweep runs at startup, beside the session artifact sweep."""

    def test_startup_sweeps_the_private_process_root(self) -> None:
        source = inspect.getsource(app_module.startup_event)

        assert "sweep_private_dirs()" in source
        assert "sweep_session_artifacts()" in source
