"""Shared settings-file helper: read-merge-write of one YAML file (REQ-4.7.8)."""

import errno
import os
import stat
import threading
from collections.abc import Callable
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services import settings_file

_BOUND = 2.0
_SETTLE = 0.05


def _defaults() -> dict[str, Any]:
    return {
        "policy": {"lock_trusted_hosts": False, "default_block_action": "accept-new"},
        "hosts": [],
        "port": 8765,
    }


def _store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def _start(target: Callable[[], None]) -> threading.Thread:
    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    return thread


class _Holder:
    """Holds ``locked(path)`` in its own thread until released."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.held = threading.Event()
        self.release = threading.Event()
        self.thread = _start(self._run)
        assert self.held.wait(_BOUND)

    def _run(self) -> None:
        with settings_file.locked(self.path):
            self.held.set()
            self.release.wait(_BOUND)

    def done(self) -> None:
        self.release.set()
        self.thread.join(_BOUND)


class TestRead:
    def test_missing_file_returns_the_defaults(self, tmp_path: Path) -> None:
        result = settings_file.read(tmp_path / "absent.yaml", _defaults())

        assert result == _defaults()

    def test_missing_file_is_not_created_by_a_read(self, tmp_path: Path) -> None:
        path = tmp_path / "absent.yaml"

        settings_file.read(path, _defaults())

        assert not path.exists()

    def test_missing_file_result_is_a_copy_of_the_defaults(self, tmp_path: Path) -> None:
        defaults = _defaults()

        result = settings_file.read(tmp_path / "absent.yaml", defaults)
        result["port"] = 1
        result["policy"]["lock_trusted_hosts"] = True
        result["hosts"].append({"id": "a"})

        assert defaults == _defaults()

    def test_empty_file_reads_as_the_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        path.write_text("", encoding="utf-8")

        assert settings_file.read(path, _defaults()) == _defaults()

    def test_stored_keys_are_merged_over_the_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"port": 9000})

        result = settings_file.read(path, _defaults())

        assert result == {**_defaults(), "port": 9000}

    def test_nested_mapping_default_is_merged_one_level_deeper(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"policy": {"lock_trusted_hosts": True}})

        result = settings_file.read(path, _defaults())

        assert result["policy"] == {
            "lock_trusted_hosts": True,
            "default_block_action": "accept-new",
        }
        assert result["hosts"] == []
        assert result["port"] == 8765

    def test_stored_list_replaces_the_default_list(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"hosts": [{"id": "a", "host": "db1", "port": 22}]})

        result = settings_file.read(path, _defaults())

        assert result["hosts"] == [{"id": "a", "host": "db1", "port": 22}]

    def test_merged_result_does_not_share_the_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"port": 9000})
        defaults = _defaults()

        result = settings_file.read(path, defaults)
        result["policy"]["default_block_action"] = "strict"
        result["hosts"].append({"id": "a"})

        assert defaults == _defaults()

    def test_reads_utf8_text(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        path.write_bytes("name: Grüße\n".encode())

        assert settings_file.read(path, {"name": ""}) == {"name": "Grüße"}

    def test_file_that_is_not_a_mapping_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        path.write_text("- a\n- b\n", encoding="utf-8")

        with pytest.raises(ValueError, match=r"^the file does not hold a YAML mapping$"):
            settings_file.read(path, _defaults())

    def test_stored_value_replaces_a_mapping_default(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"policy": "strict"})

        assert settings_file.read(path, _defaults()) == {**_defaults(), "policy": "strict"}

    def test_stored_mapping_replaces_a_plain_default(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"port": {"low": 1024}})

        assert settings_file.read(path, _defaults()) == {**_defaults(), "port": {"low": 1024}}

    def test_stored_key_without_a_default_is_kept(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        _store(path, {"extra": {"kept": True}})

        assert settings_file.read(path, _defaults()) == {**_defaults(), "extra": {"kept": True}}

    def test_merge_stops_one_level_below_the_top(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        defaults = {
            "network": {
                "ssh_hosts": {"lock_trusted_hosts": False, "default_block_action": "disabled"},
                "certificates": {"public_source": "builtin"},
            }
        }
        _store(path, {"network": {"ssh_hosts": {"lock_trusted_hosts": True}}})

        assert settings_file.read(path, defaults) == {
            "network": {
                "ssh_hosts": {"lock_trusted_hosts": True},
                "certificates": {"public_source": "builtin"},
            }
        }

    @pytest.mark.parametrize(
        "stored",
        [
            {},
            {"port": 9000},
            {"policy": {"lock_trusted_hosts": True}},
            {"policy": "strict"},
            {"port": {"low": 1024}},
            {"hosts": [{"id": "a", "host": "db1", "port": 22}]},
            {"extra": {"kept": True}},
        ],
        ids=[
            "nothing-stored",
            "plain-value",
            "nested-mapping",
            "value-over-mapping",
            "mapping-over-value",
            "list",
            "key-without-default",
        ],
    )
    def test_read_result_is_the_shared_merge_of_the_stored_values(
        self, stored: dict[str, Any], tmp_path: Path
    ) -> None:
        from wavecore.api.config import instance_settings

        path = tmp_path / "settings.yaml"
        _store(path, stored)

        result = settings_file.read(path, _defaults())

        assert result == instance_settings.merge_over_defaults(_defaults(), stored)


class TestWrite:
    def test_write_creates_the_parent_folder(self, tmp_path: Path) -> None:
        path = tmp_path / "network" / "deeper" / "ssh_hosts.yaml"

        settings_file.write(path, {"hosts": []})

        assert path.is_file()

    def test_written_file_is_the_values_as_yaml(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        values = {"policy": {"lock_trusted_hosts": True}, "hosts": [{"id": "a"}], "port": 22}

        settings_file.write(path, values)

        assert yaml.safe_load(path.read_text(encoding="utf-8")) == values

    def test_write_leaves_no_temp_file_beside_the_target(self, tmp_path: Path) -> None:
        folder = tmp_path / "network"
        path = folder / "certificates.yaml"

        settings_file.write(path, {"public_source": "builtin"})
        settings_file.write(path, {"public_source": "host"})

        assert sorted(folder.iterdir()) == [path]

    def test_write_moves_a_temp_file_beside_the_target_into_place(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "network" / "ssh_hosts.yaml"
        real_replace = os.replace
        calls: list[tuple[Path, Path]] = []

        def spy(src: Any, dst: Any) -> None:
            calls.append((Path(src), Path(dst)))
            real_replace(src, dst)

        monkeypatch.setattr(os, "replace", spy)

        settings_file.write(path, {"hosts": []})

        assert len(calls) == 1
        source, target = calls[0]
        assert target == path
        assert source.parent == path.parent
        assert source != path

    def test_write_replaces_the_whole_file(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        settings_file.write(path, {"a": 1, "b": 2})

        settings_file.write(path, {"a": 3})

        assert yaml.safe_load(path.read_text(encoding="utf-8")) == {"a": 3}

    def test_failed_replace_keeps_the_old_file_and_no_temp_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        folder = tmp_path / "network"
        path = folder / "ssh_hosts.yaml"
        settings_file.write(path, {"hosts": [{"id": "kept"}]})

        def refuse(src: Any, dst: Any) -> None:
            raise OSError("disk full")

        monkeypatch.setattr(os, "replace", refuse)

        with pytest.raises(OSError, match=r"^disk full$"):
            settings_file.write(path, {"hosts": []})

        assert yaml.safe_load(path.read_text(encoding="utf-8")) == {"hosts": [{"id": "kept"}]}
        assert sorted(folder.iterdir()) == [path]

    def test_utf8_round_trip(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"

        settings_file.write(path, {"name": "Grüße"})

        assert "Grüße" in path.read_bytes().decode("utf-8")
        assert settings_file.read(path, {"name": ""}) == {"name": "Grüße"}

    def test_written_text_is_the_yaml_dump_of_the_values_in_their_order(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "settings.yaml"
        values = {"port": 22, "name": "Grüße", "hosts": [{"id": "b"}, {"id": "a"}], "empty": None}

        settings_file.write(path, values)

        assert path.read_text(encoding="utf-8") == yaml.safe_dump(
            values, allow_unicode=True, sort_keys=False
        )

    def test_write_hands_its_yaml_text_to_write_text_atomic(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "settings.yaml"
        values = {"port": 22, "name": "Grüße"}
        calls: list[tuple[Path, str, int | None]] = []

        def spy(path: Path, text: str, mode: int | None = None) -> None:
            calls.append((path, text, mode))

        monkeypatch.setattr(settings_file, "write_text_atomic", spy)

        settings_file.write(path, values)

        assert calls == [(path, yaml.safe_dump(values, allow_unicode=True, sort_keys=False), None)]
        assert not path.exists()


class TestWriteTextAtomic:
    def test_writes_the_text_as_utf8(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        text = "# Grüße\nname: zoë-日本\n"

        settings_file.write_text_atomic(path, text)

        assert path.read_bytes() == text.encode()

    def test_replaces_the_whole_file(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        path.write_text("old: 1\nmore: 2\n", encoding="utf-8")

        settings_file.write_text_atomic(path, "new: 3\n")

        assert path.read_text(encoding="utf-8") == "new: 3\n"

    def test_line_ends_are_written_as_given_on_every_platform(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "config.yaml"
        real_fdopen = os.fdopen
        newlines: list[Any] = []

        def spy(*args: Any, **kwargs: Any) -> Any:
            newlines.append(kwargs.get("newline"))
            return real_fdopen(*args, **kwargs)

        monkeypatch.setattr(os, "fdopen", spy)

        settings_file.write_text_atomic(path, "a: 1\r\nb: 2\n")

        assert newlines == [""]
        assert path.read_bytes() == b"a: 1\r\nb: 2\n"

    def test_moves_a_temp_file_beside_the_target_into_place(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        folder = tmp_path / "config"
        folder.mkdir()
        path = folder / "config.yaml"
        real_replace = os.replace
        calls: list[tuple[Path, Path]] = []

        def spy(src: Any, dst: Any) -> None:
            calls.append((Path(src), Path(dst)))
            real_replace(src, dst)

        monkeypatch.setattr(os, "replace", spy)

        settings_file.write_text_atomic(path, "a: 1\n")

        assert len(calls) == 1
        source, target = calls[0]
        assert target == path
        assert source.parent == folder
        assert fnmatch(source.name, ".config.yaml.*.tmp")
        assert sorted(folder.iterdir()) == [path]

    def test_text_is_synced_to_disk_before_the_move(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "config.yaml"
        real_fsync = os.fsync
        real_replace = os.replace
        steps: list[str] = []

        def sync(descriptor: int) -> None:
            steps.append("sync")
            real_fsync(descriptor)

        def move(src: Any, dst: Any) -> None:
            steps.append("move")
            real_replace(src, dst)

        monkeypatch.setattr(os, "fsync", sync)
        monkeypatch.setattr(os, "replace", move)

        settings_file.write_text_atomic(path, "a: 1\n")

        assert steps[:2] == ["sync", "move"]

    def test_mode_is_applied_before_the_move_when_given(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "config.yaml"
        path.write_text("a: 0\n", encoding="utf-8")
        real_replace = os.replace
        modes: list[int] = []

        def move(src: Any, dst: Any) -> None:
            modes.append(stat.S_IMODE(os.stat(src).st_mode))
            real_replace(src, dst)

        monkeypatch.setattr(os, "replace", move)

        settings_file.write_text_atomic(path, "a: 1\n", mode=0o640)

        assert modes == [0o640]
        assert stat.S_IMODE(path.stat().st_mode) == 0o640

    @pytest.mark.parametrize("step", ["fsync", "chmod", "replace"])
    def test_failed_step_keeps_the_old_file_and_removes_the_temp_file(
        self, step: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        folder = tmp_path / "config"
        folder.mkdir()
        path = folder / "config.yaml"
        path.write_text("kept: true\n", encoding="utf-8")

        def refuse(*args: Any, **kwargs: Any) -> None:
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr(os, step, refuse)

        with pytest.raises(OSError) as caught:
            settings_file.write_text_atomic(path, "kept: false\n", mode=0o640)

        assert caught.value.errno == errno.ENOSPC
        assert path.read_text(encoding="utf-8") == "kept: true\n"
        assert sorted(folder.iterdir()) == [path]


class TestLocked:
    def test_locked_is_reentrant(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        finished = threading.Event()

        def body() -> None:
            with settings_file.locked(path), settings_file.locked(path):
                finished.set()

        _start(body)

        assert finished.wait(_BOUND)

    def test_read_and_write_inside_locked_do_not_deadlock(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        results: list[dict[str, Any]] = []

        def body() -> None:
            with settings_file.locked(path):
                current = settings_file.read(path, {"count": 0})
                settings_file.write(path, {"count": current["count"] + 1})
                results.append(settings_file.read(path, {"count": 0}))

        _start(body).join(_BOUND)

        assert results == [{"count": 1}]

    @pytest.mark.parametrize("spelling", ["dot-dot", "relative"])
    def test_two_spellings_of_one_file_share_one_lock(
        self, spelling: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "sub").mkdir()
        path = tmp_path / "settings.yaml"
        if spelling == "dot-dot":
            other = tmp_path / "sub" / ".." / "settings.yaml"
        else:
            monkeypatch.chdir(tmp_path)
            other = Path("settings.yaml")
        acquired = threading.Event()

        def contender() -> None:
            with settings_file.locked(other):
                acquired.set()

        holder = _Holder(path)
        _start(contender)
        try:
            assert not acquired.wait(_SETTLE)
        finally:
            holder.done()

        assert acquired.wait(_BOUND)

    def test_different_files_do_not_share_a_lock(self, tmp_path: Path) -> None:
        acquired = threading.Event()

        def contender() -> None:
            with settings_file.locked(tmp_path / "certificates.yaml"):
                acquired.set()

        holder = _Holder(tmp_path / "ssh_hosts.yaml")
        try:
            _start(contender)
            assert acquired.wait(_BOUND)
        finally:
            holder.done()

    def test_write_waits_for_a_held_lock(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        holder = _Holder(path)
        writer = _start(lambda: settings_file.write(path, {"a": 1}))
        try:
            writer.join(_SETTLE)
            assert not path.exists()
        finally:
            holder.done()

        writer.join(_BOUND)
        assert yaml.safe_load(path.read_text(encoding="utf-8")) == {"a": 1}

    def test_read_waits_for_a_held_lock(self, tmp_path: Path) -> None:
        path = tmp_path / "settings.yaml"
        results: list[dict[str, Any]] = []
        holder = _Holder(path)
        reader = _start(lambda: results.append(settings_file.read(path, {"a": 0})))
        try:
            reader.join(_SETTLE)
            assert results == []
        finally:
            holder.done()

        reader.join(_BOUND)
        assert results == [{"a": 0}]
