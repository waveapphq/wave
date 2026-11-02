"""The remote-worker entry of the stdlib File I/O core (REQ-3.4.1.10).

run dispatches on the operation against raw host paths, applies the block's
defaults for every setting the request leaves out, logs through the callable it
is handed, and answers the result envelope the bundle materializes. The module
itself stays vendorable: standard library only, nothing from wavecore, and no
name the remote interpreter floor lacks.
"""

import ast
import hashlib
import os
import re
import sys
from pathlib import Path
from typing import Any

import pytest

from wavecore.core.remote_exec.runner import REMOTE_PYTHON_FLOOR
from wavecore.plugins import _file_ops

# A whole-second timestamp, so the ISO text carries no fractional part.
_MTIME = 1767225600
_MTIME_ISO = "2026-01-01T00:00:00+00:00"

_OPERATIONS = ["read", "write", "copy", "move", "delete", "stats", "list", "create_folder"]

_LEVELS = frozenset({"DEBUG", "INFO", "WARN", "WARNING", "ERROR"})

_POST_FLOOR_NAMES = frozenset(
    {
        "asyncio.TaskGroup",
        "asyncio.timeout",
        "datetime.UTC",
        "enum.StrEnum",
        "hashlib.file_digest",
        "itertools.batched",
        "tomllib",
        "typing.Self",
        "typing.override",
    }
)

_SOURCE = Path(str(_file_ops.__file__)).read_text(encoding="utf-8")


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class _Recorder:
    """Records the level and message of every line the core logs."""

    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.entries.append((level, message))


def _outputs(result: dict[str, Any]) -> dict[str, Any]:
    """The outputs of the result envelope, asserting the envelope around them."""
    assert result["__wave_type"] == "result"
    assert result["secrets"] == []
    return result["outputs"]


def _requests(root: Path) -> dict[str, dict[str, Any]]:
    """One valid request per operation against a freshly seeded workspace."""
    source = root / "src"
    source.mkdir()
    (source / "note.txt").write_text("payload", encoding="utf-8")
    (root / "gone.txt").write_text("gone", encoding="utf-8")
    (root / "moving.txt").write_text("moving", encoding="utf-8")
    (root / "copying.txt").write_text("copying", encoding="utf-8")
    return {
        "read": {"operation": "read", "path": str(source / "note.txt")},
        "write": {"operation": "write", "path": str(root / "written.txt"), "content": "hi"},
        "copy": {
            "operation": "copy",
            "source": str(root / "copying.txt"),
            "destination": str(root / "copied.txt"),
        },
        "move": {
            "operation": "move",
            "source": str(root / "moving.txt"),
            "destination": str(root / "moved.txt"),
        },
        "delete": {"operation": "delete", "path": str(root / "gone.txt")},
        "stats": {"operation": "stats", "path": str(source / "note.txt")},
        "list": {"operation": "list", "path": str(source)},
        "create_folder": {"operation": "create_folder", "path": str(root / "made")},
    }


def _imported_roots(source: str) -> set[str]:
    """The top-level package of every module the source imports."""
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").split(".")[0])
    return roots


def _post_floor_names(source: str) -> set[str]:
    """The past-the-floor stdlib names the source reads, by import or by attribute."""
    read: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            read |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            read |= {f"{node.module}.{alias.name}" for alias in node.names}
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            read.add(f"{node.value.id}.{node.attr}")
    return read & _POST_FLOOR_NAMES


class TestRunAnswersTheResultEnvelope:
    """The worker's return value is the envelope materialize converts."""

    def test_carries_the_result_tag_outputs_and_secrets(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["read"]

        result = _file_ops.run(request, _Recorder())

        assert set(result) == {"__wave_type", "outputs", "secrets"}
        assert result["__wave_type"] == "result"
        assert result["secrets"] == []

    def test_the_outputs_are_the_operation_result(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["read"]

        result = _file_ops.run(request, _Recorder())

        assert result["outputs"] == {"content": "payload"}


class TestRunDispatch:
    """Every operation reaches its own worker with raw host paths."""

    def test_read(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["read"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {"content": "payload"}

    def test_write(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["write"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {}
        assert (tmp_path / "written.txt").read_text(encoding="utf-8") == "hi"

    def test_copy(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["copy"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {}
        assert (tmp_path / "copied.txt").read_text(encoding="utf-8") == "copying"
        assert (tmp_path / "copying.txt").exists()

    def test_move(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["move"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {}
        assert (tmp_path / "moved.txt").read_text(encoding="utf-8") == "moving"
        assert not (tmp_path / "moving.txt").exists()

    def test_delete(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["delete"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {}
        assert not (tmp_path / "gone.txt").exists()

    def test_stats(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["stats"]
        os.utime(request["path"], (_MTIME, _MTIME))

        assert _outputs(_file_ops.run(request, _Recorder())) == {
            "exists": True,
            "type": "file",
            "modified": _MTIME_ISO,
        }

    def test_list(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["list"]
        os.utime(str(tmp_path / "src" / "note.txt"), (_MTIME, _MTIME))

        outputs = _outputs(_file_ops.run(request, _Recorder()))

        assert outputs["count"] == 1
        assert outputs["entries"]["rows"] == [["note.txt", "note.txt", "file", _MTIME_ISO]]

    def test_create_folder(self, tmp_path: Path) -> None:
        request = _requests(tmp_path)["create_folder"]

        assert _outputs(_file_ops.run(request, _Recorder())) == {}
        assert (tmp_path / "made").is_dir()


class TestRunAppliesTheDefaults:
    """A setting the request leaves out takes the block's default."""

    def test_write_defaults_to_replacing_the_file(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        _file_ops.run({"operation": "write", "path": str(target), "content": "new"}, _Recorder())

        assert target.read_text(encoding="utf-8") == "new"

    def test_write_honors_an_explicit_choice(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        _file_ops.run(
            {
                "operation": "write",
                "path": str(target),
                "content": "-new",
                "if_exists": "append",
            },
            _Recorder(),
        )

        assert target.read_text(encoding="utf-8") == "old-new"

    def test_copy_defaults_to_replacing_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        _file_ops.run(
            {"operation": "copy", "source": str(source), "destination": str(destination)},
            _Recorder(),
        )

        assert destination.read_text(encoding="utf-8") == "new"

    def test_copy_honors_an_explicit_choice(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        with pytest.raises(
            OSError, match=_exact(f"Destination exists and if_exists=fail: {destination}")
        ):
            _file_ops.run(
                {
                    "operation": "copy",
                    "source": str(source),
                    "destination": str(destination),
                    "if_exists": "fail",
                },
                _Recorder(),
            )

    def test_move_defaults_to_replacing_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        _file_ops.run(
            {"operation": "move", "source": str(source), "destination": str(destination)},
            _Recorder(),
        )

        assert destination.read_text(encoding="utf-8") == "new"

    def test_delete_defaults_to_refusing_a_missing_path(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Nothing to delete: {target}")):
            _file_ops.run({"operation": "delete", "path": str(target)}, _Recorder())

    def test_delete_honors_ignore_missing(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.run(
            {"operation": "delete", "path": str(target), "missing_ok": True}, _Recorder()
        )

        assert _outputs(result) == {}

    def test_stats_defaults_to_individual_without_size_or_checksum(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_bytes(b"payload")
        os.utime(target, (_MTIME, _MTIME))

        outputs = _outputs(_file_ops.run({"operation": "stats", "path": str(target)}, _Recorder()))

        assert outputs == {"exists": True, "type": "file", "modified": _MTIME_ISO}

    def test_stats_honors_the_size_the_checksum_and_the_format(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_bytes(b"payload")
        os.utime(target, (_MTIME, _MTIME))

        outputs = _outputs(
            _file_ops.run(
                {
                    "operation": "stats",
                    "path": str(target),
                    "size": True,
                    "checksum": "sha256",
                    "output_format": "map",
                },
                _Recorder(),
            )
        )

        assert outputs == {
            "stats": {
                "exists": True,
                "type": "file",
                "modified": _MTIME_ISO,
                "size": 7,
                "checksum": hashlib.sha256(b"payload").hexdigest(),
            }
        }

    def test_list_defaults_to_everything_at_the_top_level_without_size(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "deep.txt").write_text("deep", encoding="utf-8")
        (tmp_path / "top.txt").write_text("top", encoding="utf-8")
        for entry in (tmp_path / "sub", tmp_path / "top.txt"):
            os.utime(entry, (_MTIME, _MTIME))

        outputs = _outputs(_file_ops.run({"operation": "list", "path": str(tmp_path)}, _Recorder()))

        assert [row[1] for row in outputs["entries"]["rows"]] == ["sub", "top.txt"]
        assert len(outputs["entries"]["columns"]) == 4

    def test_list_honors_the_pattern_the_recursion_and_the_size(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "deep.txt").write_text("deep", encoding="utf-8")
        (tmp_path / "top.txt").write_text("top", encoding="utf-8")
        for entry in (tmp_path / "sub" / "deep.txt", tmp_path / "sub", tmp_path / "top.txt"):
            os.utime(entry, (_MTIME, _MTIME))

        outputs = _outputs(
            _file_ops.run(
                {
                    "operation": "list",
                    "path": str(tmp_path),
                    "pattern": "^deep",
                    "recursive": True,
                    "size": True,
                },
                _Recorder(),
            )
        )

        assert outputs["entries"]["rows"] == [["deep.txt", "sub/deep.txt", "file", _MTIME_ISO, 4]]


class TestRunLogsThroughTheCallable:
    """Every operation writes at least one line through the log callable it is handed."""

    @pytest.mark.parametrize("operation", _OPERATIONS)
    def test_records_at_least_one_line(self, tmp_path: Path, operation: str) -> None:
        log = _Recorder()

        _file_ops.run(_requests(tmp_path)[operation], log)

        assert log.entries

    @pytest.mark.parametrize("operation", _OPERATIONS)
    def test_records_a_level_and_a_message(self, tmp_path: Path, operation: str) -> None:
        log = _Recorder()

        _file_ops.run(_requests(tmp_path)[operation], log)

        for level, message in log.entries:
            assert level in _LEVELS
            assert isinstance(message, str)


class TestTheCoreStaysVendorable:
    """The module is copied verbatim onto a host, so it may lean on nothing but the stdlib."""

    def test_the_source_was_found(self) -> None:
        assert _SOURCE.strip()

    def test_imports_only_the_standard_library(self) -> None:
        assert _imported_roots(_SOURCE) <= set(sys.stdlib_module_names)

    def test_imports_nothing_from_wavecore(self) -> None:
        assert "wavecore" not in _imported_roots(_SOURCE)

    def test_makes_no_relative_import(self) -> None:
        assert not [
            node
            for node in ast.walk(ast.parse(_SOURCE))
            if isinstance(node, ast.ImportFrom) and node.level
        ]

    def test_reads_no_name_past_the_interpreter_floor(self) -> None:
        assert _post_floor_names(_SOURCE) == set()

    def test_never_names_the_datetime_utc_alias(self) -> None:
        assert "datetime.UTC" not in _SOURCE

    def test_parses_at_the_interpreter_floor(self) -> None:
        ast.parse(_SOURCE, feature_version=REMOTE_PYTHON_FLOOR)


def _remote_host_refusal(scheme: str) -> str:
    return (
        f"{scheme} paths are not available on the remote host - "
        "use an absolute or relative path on the remote host"
    )


_SCHEME_REQUESTS = [
    pytest.param("read", {"operation": "read", "path": "{ref}"}, id="read"),
    pytest.param("write", {"operation": "write", "path": "{ref}", "content": "hi"}, id="write"),
    pytest.param(
        "copy source",
        {"operation": "copy", "source": "{ref}", "destination": "out/copied.txt"},
        id="copy-source",
    ),
    pytest.param(
        "copy destination",
        {"operation": "copy", "source": "in.txt", "destination": "{ref}"},
        id="copy-destination",
    ),
    pytest.param(
        "move source",
        {"operation": "move", "source": "{ref}", "destination": "out/moved.txt"},
        id="move-source",
    ),
    pytest.param(
        "move destination",
        {"operation": "move", "source": "in.txt", "destination": "{ref}"},
        id="move-destination",
    ),
    pytest.param(
        "delete", {"operation": "delete", "path": "{ref}", "missing_ok": True}, id="delete"
    ),
    pytest.param("stats", {"operation": "stats", "path": "{ref}"}, id="stats"),
    pytest.param("list", {"operation": "list", "path": "{ref}"}, id="list"),
    pytest.param(
        "create folder", {"operation": "create_folder", "path": "{ref}"}, id="create-folder"
    ),
]


def _with_reference(request: dict[str, Any], reference: str) -> dict[str, Any]:
    return {key: reference if value == "{ref}" else value for key, value in request.items()}


class TestRunRefusesWaveSchemesOnTheRemoteHost:
    """A WAVE-side scheme names nothing on the remote host, so the entry refuses it untouched."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    @pytest.mark.parametrize(("case", "request_shape"), _SCHEME_REQUESTS)
    def test_the_scheme_is_refused_with_the_exact_message(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        scheme: str,
        case: str,
        request_shape: dict[str, Any],
    ) -> None:
        monkeypatch.chdir(tmp_path)
        (tmp_path / "in.txt").write_text("payload", encoding="utf-8")
        request = _with_reference(request_shape, f"{scheme}data/orders.csv")

        with pytest.raises(ValueError, match=_exact(_remote_host_refusal(scheme))):
            _file_ops.run(request, _Recorder())

        assert sorted(p.name for p in tmp_path.iterdir()) == ["in.txt"], case

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_nothing_is_logged_for_a_refused_request(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        monkeypatch.chdir(tmp_path)
        log = _Recorder()

        with pytest.raises(ValueError, match=_exact(_remote_host_refusal(scheme))):
            _file_ops.run({"operation": "write", "path": f"{scheme}x.txt", "content": "x"}, log)

        assert log.entries == []

    def test_a_scheme_on_a_row_the_operation_does_not_use_is_left_alone(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "note.txt"
        source.write_text("payload", encoding="utf-8")
        request = {"operation": "read", "path": str(source), "destination": "testdata://x.txt"}

        assert _outputs(_file_ops.run(request, _Recorder())) == {"content": "payload"}

    def test_a_scheme_later_in_the_path_is_an_ordinary_name(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)

        _file_ops.run({"operation": "create_folder", "path": "folder/testdata:"}, _Recorder())

        assert (tmp_path / "folder" / "testdata:").is_dir()


class TestRunTakesRelativeAndParentPaths:
    """On the remote host a relative path starts where the worker starts, and `..` is followed."""

    def test_a_relative_write_lands_under_the_starting_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)

        _file_ops.run(
            {"operation": "write", "path": "reports/out.txt", "content": "relative"}, _Recorder()
        )

        assert (tmp_path / "reports" / "out.txt").read_text(encoding="utf-8") == "relative"

    def test_the_wave_server_users_home_plays_no_part(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        start = tmp_path / "ssh-home"
        start.mkdir()
        monkeypatch.chdir(start)

        _file_ops.run({"operation": "write", "path": "out.txt", "content": "remote"}, _Recorder())

        assert (start / "out.txt").read_text(encoding="utf-8") == "remote"
        assert not (server_home / "out.txt").exists()

    def test_a_relative_read_reads_from_the_starting_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "in.txt").write_text("payload", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        assert _outputs(_file_ops.run({"operation": "read", "path": "in.txt"}, _Recorder())) == {
            "content": "payload"
        }

    def test_a_relative_parent_segment_leaves_the_starting_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        start = tmp_path / "home"
        start.mkdir()
        monkeypatch.chdir(start)

        _file_ops.run({"operation": "write", "path": "../beside.txt", "content": "up"}, _Recorder())

        assert (tmp_path / "beside.txt").read_text(encoding="utf-8") == "up"

    def test_an_absolute_parent_segment_is_followed(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        (tmp_path / "in.txt").write_text("payload", encoding="utf-8")

        outputs = _outputs(
            _file_ops.run({"operation": "read", "path": f"{tmp_path}/sub/../in.txt"}, _Recorder())
        )

        assert outputs == {"content": "payload"}


class TestRunNormalizesAPathBeforeUsingIt:
    """A `..` is collapsed before the disk is touched, as on WAVE, so its folder need not exist."""

    @pytest.fixture
    def start(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
        (tmp_path / "in.txt").write_text("payload", encoding="utf-8")
        (tmp_path / "gone.txt").write_text("gone", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        return tmp_path

    def _names(self, start: Path) -> list[str]:
        return sorted(entry.name for entry in start.iterdir())

    def test_a_write_through_a_missing_folder_lands_beside_it(self, start: Path) -> None:
        _file_ops.run(
            {"operation": "write", "path": "made/../out.txt", "content": "x"}, _Recorder()
        )

        assert (start / "out.txt").read_text(encoding="utf-8") == "x"
        assert self._names(start) == ["gone.txt", "in.txt", "out.txt"]

    def test_a_read_through_a_missing_folder_reads_the_file(self, start: Path) -> None:
        outputs = _outputs(
            _file_ops.run({"operation": "read", "path": "made/../in.txt"}, _Recorder())
        )

        assert outputs == {"content": "payload"}

    def test_a_copy_through_missing_folders_on_both_rows(self, start: Path) -> None:
        request = {"operation": "copy", "source": "a/../in.txt", "destination": "b/../copied.txt"}

        _file_ops.run(request, _Recorder())

        assert (start / "copied.txt").read_text(encoding="utf-8") == "payload"
        assert self._names(start) == ["copied.txt", "gone.txt", "in.txt"]

    def test_a_move_through_missing_folders_on_both_rows(self, start: Path) -> None:
        request = {"operation": "move", "source": "a/../in.txt", "destination": "b/../moved.txt"}

        _file_ops.run(request, _Recorder())

        assert self._names(start) == ["gone.txt", "moved.txt"]

    def test_a_delete_through_a_missing_folder(self, start: Path) -> None:
        _file_ops.run({"operation": "delete", "path": "made/../gone.txt"}, _Recorder())

        assert self._names(start) == ["in.txt"]

    def test_stats_through_a_missing_folder_reports_the_file(self, start: Path) -> None:
        outputs = _outputs(
            _file_ops.run({"operation": "stats", "path": "made/../in.txt"}, _Recorder())
        )

        assert outputs["exists"] is True
        assert outputs["type"] == "file"

    def test_a_list_through_a_missing_folder_lists_the_folder_beside_it(self, start: Path) -> None:
        outputs = _outputs(_file_ops.run({"operation": "list", "path": "made/.."}, _Recorder()))

        assert outputs["count"] == 2

    def test_create_folder_through_a_missing_folder_makes_only_the_named_one(
        self, start: Path
    ) -> None:
        _file_ops.run({"operation": "create_folder", "path": "made/../new"}, _Recorder())

        assert self._names(start) == ["gone.txt", "in.txt", "new"]

    def test_the_log_line_names_the_normalized_path(self, start: Path) -> None:
        log = _Recorder()

        _file_ops.run({"operation": "write", "path": "made/../out.txt", "content": "x"}, log)

        assert log.entries == [("INFO", f"Wrote 1 characters to {start / 'out.txt'}")]

    def test_a_missing_file_is_named_by_its_normalized_path(self, start: Path) -> None:
        with pytest.raises(FileNotFoundError, match=_exact(f"File not found: {start / 'no.txt'}")):
            _file_ops.run({"operation": "read", "path": "made/../no.txt"}, _Recorder())
