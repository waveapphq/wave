"""File I/O execution wiring: resolver flavors and the verb bridge (REQ-3.4.1.10).

REQ-3.4.3.1 and REQ-3.4.3.2: Read, Stats, List and the Copy source resolve read-only; every
target resolves through the write flavor, which refuses anything in the Test Data area, and
Delete and the Move source through the removal flavor, which refuses the run's artifacts
folder itself. A relative plain path starts from the WAVE server user's home folder.
"""

import inspect
import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.plugins import _file_paths, _verb_bridge, file_io
from wavecore.plugins.file_io import FileIOPlugin

READ_ONLY_MESSAGE = "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
ARTIFACTS_FOLDER_MESSAGE = (
    "artifact:// is the run's artifacts folder and cannot be deleted or moved"
)


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def context(
    params: dict[str, Any],
    artifacts_dir: Path | None = None,
    testdata_dirs: list[Path] | None = None,
    logger: Any = None,
) -> dict[str, Any]:
    """The execute() context the workbench builds for a block."""
    return {
        "parameters": params,
        "variables": {},
        "logger": logger if logger is not None else MagicMock(),
        "artifacts_dir": str(artifacts_dir) if artifacts_dir is not None else None,
        "testdata_dirs": [str(d) for d in testdata_dirs] if testdata_dirs is not None else None,
    }


class ResolveSpy:
    """Records how each resolution was asked for, then answers with the real resolution."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *args: Any, **kwargs: Any) -> Path:
        bound = inspect.signature(_file_paths.resolve_plugin_path).bind(*args, **kwargs)
        bound.apply_defaults()
        self.calls.append(dict(bound.arguments))
        return _file_paths.resolve_plugin_path(*args, **kwargs)

    def call_for(self, path: str) -> dict[str, Any]:
        for call in self.calls:
            if call["path"] == path:
                return call
        raise AssertionError(f"{path!r} was never resolved")


@pytest.fixture
def resolver(monkeypatch: pytest.MonkeyPatch) -> ResolveSpy:
    spy = ResolveSpy()
    monkeypatch.setattr(file_io, "resolve_plugin_path", spy)
    return spy


@pytest.fixture
def artifacts(tmp_path: Path) -> Path:
    root = tmp_path / "artifacts"
    root.mkdir()
    return root


@pytest.fixture
def testdata(tmp_path: Path) -> Path:
    root = tmp_path / "testdata"
    root.mkdir()
    (root / "input.csv").write_text("a,b\n", encoding="utf-8")
    return root


class TestReadFlavorResolution:
    """Read, Stats, List and the Copy source ask for a read-only resolution."""

    async def test_read_resolves_read_only(self, resolver: ResolveSpy, artifacts: Path) -> None:
        (artifacts / "note.txt").write_text("hello\n", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context({"operation": "read", "path": "artifact://note.txt"}, artifacts_dir=artifacts)
        )

        assert result == {"content": "hello\n"}
        call = resolver.call_for("artifact://note.txt")
        assert call["read_only_ok"] is True

    async def test_stats_resolves_read_only(self, resolver: ResolveSpy, artifacts: Path) -> None:
        (artifacts / "note.txt").write_text("hello\n", encoding="utf-8")

        await FileIOPlugin().execute(
            context({"operation": "stats", "path": "artifact://note.txt"}, artifacts_dir=artifacts)
        )

        call = resolver.call_for("artifact://note.txt")
        assert call["read_only_ok"] is True

    async def test_list_resolves_read_only(self, resolver: ResolveSpy, artifacts: Path) -> None:
        (artifacts / "logs").mkdir()

        await FileIOPlugin().execute(
            context({"operation": "list", "path": "artifact://logs"}, artifacts_dir=artifacts)
        )

        call = resolver.call_for("artifact://logs")
        assert call["read_only_ok"] is True

    async def test_copy_source_resolves_read_only(
        self, resolver: ResolveSpy, artifacts: Path, testdata: Path
    ) -> None:
        await FileIOPlugin().execute(
            context(
                {
                    "operation": "copy",
                    "source": "testdata://input.csv",
                    "destination": "artifact://copied.csv",
                },
                artifacts_dir=artifacts,
                testdata_dirs=[testdata],
            )
        )

        call = resolver.call_for("testdata://input.csv")
        assert call["read_only_ok"] is True
        assert (artifacts / "copied.csv").read_text(encoding="utf-8") == "a,b\n"


class TestWriteFlavorResolution:
    """Every target - and the Move source - asks for a write resolution."""

    async def test_write_path(self, resolver: ResolveSpy, artifacts: Path) -> None:
        result = await FileIOPlugin().execute(
            context(
                {"operation": "write", "path": "artifact://out.txt", "content": "text"},
                artifacts_dir=artifacts,
            )
        )

        assert result == {}
        call = resolver.call_for("artifact://out.txt")
        assert call["read_only_ok"] is False
        assert call["removes"] is False

    async def test_delete_path(self, resolver: ResolveSpy, artifacts: Path) -> None:
        (artifacts / "gone.txt").write_text("x", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context({"operation": "delete", "path": "artifact://gone.txt"}, artifacts_dir=artifacts)
        )

        assert result == {}
        call = resolver.call_for("artifact://gone.txt")
        assert call["read_only_ok"] is False
        assert call["removes"] is True

    async def test_create_folder_path(self, resolver: ResolveSpy, artifacts: Path) -> None:
        result = await FileIOPlugin().execute(
            context(
                {"operation": "create_folder", "path": "artifact://reports/daily"},
                artifacts_dir=artifacts,
            )
        )

        assert result == {}
        call = resolver.call_for("artifact://reports/daily")
        assert call["read_only_ok"] is False

    async def test_copy_destination(self, resolver: ResolveSpy, artifacts: Path) -> None:
        (artifacts / "a.txt").write_text("x", encoding="utf-8")

        await FileIOPlugin().execute(
            context(
                {
                    "operation": "copy",
                    "source": "artifact://a.txt",
                    "destination": "artifact://b.txt",
                },
                artifacts_dir=artifacts,
            )
        )

        call = resolver.call_for("artifact://b.txt")
        assert call["read_only_ok"] is False
        assert call["removes"] is False

    @pytest.mark.parametrize(
        ("name", "removes"), [("artifact://a.txt", True), ("artifact://b.txt", False)]
    )
    async def test_move_source_and_destination(
        self, resolver: ResolveSpy, artifacts: Path, name: str, removes: bool
    ) -> None:
        (artifacts / "a.txt").write_text("x", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context(
                {
                    "operation": "move",
                    "source": "artifact://a.txt",
                    "destination": "artifact://b.txt",
                },
                artifacts_dir=artifacts,
            )
        )

        assert result == {}
        call = resolver.call_for(name)
        assert call["read_only_ok"] is False
        assert call["removes"] is removes


class TestTheArtifactsFolderItself:
    """A bare artifact:// names the run's artifacts folder: never deleted or moved away."""

    @pytest.mark.parametrize(
        "root", ["artifact://", "artifact:///", "artifact://.", "artifact://sub/.."]
    )
    async def test_delete_is_refused_and_nothing_is_removed(
        self, artifacts: Path, root: str
    ) -> None:
        (artifacts / "sub").mkdir()
        (artifacts / "sub" / "kept.txt").write_text("x", encoding="utf-8")

        with pytest.raises(ValueError, match=exact(ARTIFACTS_FOLDER_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "delete", "path": root, "missing_ok": True},
                    artifacts_dir=artifacts,
                )
            )

        assert (artifacts / "sub" / "kept.txt").read_text(encoding="utf-8") == "x"

    async def test_move_with_the_folder_as_source_is_refused_and_nothing_moves(
        self, artifacts: Path, tmp_path: Path
    ) -> None:
        (artifacts / "kept.txt").write_text("x", encoding="utf-8")
        destination = tmp_path / "moved"

        with pytest.raises(ValueError, match=exact(ARTIFACTS_FOLDER_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "move", "source": "artifact://", "destination": str(destination)},
                    artifacts_dir=artifacts,
                )
            )

        assert (artifacts / "kept.txt").read_text(encoding="utf-8") == "x"
        assert not destination.exists()

    async def test_copy_with_the_folder_as_source_copies_everything(
        self, artifacts: Path, tmp_path: Path
    ) -> None:
        (artifacts / "top.txt").write_text("top", encoding="utf-8")
        (artifacts / "logs").mkdir()
        (artifacts / "logs" / "run.log").write_text("log", encoding="utf-8")
        destination = tmp_path / "backup"

        result = await FileIOPlugin().execute(
            context(
                {"operation": "copy", "source": "artifact://", "destination": str(destination)},
                artifacts_dir=artifacts,
            )
        )

        assert result == {}
        assert (destination / "top.txt").read_text(encoding="utf-8") == "top"
        assert (destination / "logs" / "run.log").read_text(encoding="utf-8") == "log"
        assert (artifacts / "top.txt").is_file()

    async def test_read_fails_as_on_any_folder(self, artifacts: Path) -> None:
        with pytest.raises(OSError, match=exact(f"File not found: {artifacts.resolve()}")):
            await FileIOPlugin().execute(
                context({"operation": "read", "path": "artifact://"}, artifacts_dir=artifacts)
            )

    async def test_write_fails_as_over_any_existing_folder(self, artifacts: Path) -> None:
        with pytest.raises(OSError, match=exact(f"Destination is a folder: {artifacts.resolve()}")):
            await FileIOPlugin().execute(
                context(
                    {"operation": "write", "path": "artifact://", "content": "text"},
                    artifacts_dir=artifacts,
                )
            )

        assert artifacts.is_dir()

    async def test_stats_reports_on_the_artifacts_root(self, artifacts: Path) -> None:
        result = await FileIOPlugin().execute(
            context({"operation": "stats", "path": "artifact://"}, artifacts_dir=artifacts)
        )

        assert result["exists"] is True
        assert result["type"] == "folder"

    async def test_list_lists_the_artifacts_root(self, artifacts: Path) -> None:
        (artifacts / "one.txt").write_text("1", encoding="utf-8")
        (artifacts / "two.txt").write_text("2", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context({"operation": "list", "path": "artifact://"}, artifacts_dir=artifacts)
        )

        assert result["count"] == 2

    async def test_a_folder_inside_is_deleted(self, artifacts: Path) -> None:
        (artifacts / "sub").mkdir()
        (artifacts / "sub" / "a.txt").write_text("a", encoding="utf-8")
        (artifacts / "keep.txt").write_text("k", encoding="utf-8")

        await FileIOPlugin().execute(
            context({"operation": "delete", "path": "artifact://sub"}, artifacts_dir=artifacts)
        )

        assert not (artifacts / "sub").exists()
        assert (artifacts / "keep.txt").is_file()

    async def test_a_folder_inside_is_moved(self, artifacts: Path) -> None:
        (artifacts / "sub").mkdir()
        (artifacts / "sub" / "a.txt").write_text("a", encoding="utf-8")

        await FileIOPlugin().execute(
            context(
                {
                    "operation": "move",
                    "source": "artifact://sub",
                    "destination": "artifact://renamed",
                },
                artifacts_dir=artifacts,
            )
        )

        assert not (artifacts / "sub").exists()
        assert (artifacts / "renamed" / "a.txt").read_text(encoding="utf-8") == "a"

    async def test_a_parent_segment_inside_the_folder_is_followed(self, artifacts: Path) -> None:
        (artifacts / "sub").mkdir()
        (artifacts / "gone.txt").write_text("g", encoding="utf-8")

        await FileIOPlugin().execute(
            context(
                {"operation": "delete", "path": "artifact://sub/../gone.txt"},
                artifacts_dir=artifacts,
            )
        )

        assert not (artifacts / "gone.txt").exists()
        assert (artifacts / "sub").is_dir()


class TestTheTestDataRoot:
    """A bare testdata:// names the running test's data folder, read-only for every target."""

    async def test_copy_with_the_folder_as_source_copies_everything(
        self, resolver: ResolveSpy, artifacts: Path, testdata: Path
    ) -> None:
        (testdata / "sheets").mkdir()
        (testdata / "sheets" / "book.csv").write_text("c,d\n", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context(
                {"operation": "copy", "source": "testdata://", "destination": "artifact://copy"},
                artifacts_dir=artifacts,
                testdata_dirs=[testdata],
            )
        )

        assert result == {}
        assert (artifacts / "copy" / "input.csv").read_text(encoding="utf-8") == "a,b\n"
        assert (artifacts / "copy" / "sheets" / "book.csv").read_text(encoding="utf-8") == "c,d\n"
        assert (testdata / "input.csv").is_file()
        assert resolver.call_for("testdata://")["read_only_ok"] is True

    async def test_read_fails_as_on_any_folder(self, testdata: Path) -> None:
        with pytest.raises(OSError, match=exact(f"File not found: {testdata.resolve()}")):
            await FileIOPlugin().execute(
                context({"operation": "read", "path": "testdata://"}, testdata_dirs=[testdata])
            )

    @pytest.mark.parametrize(
        "rows",
        [
            {"operation": "write", "path": "testdata://", "content": "text"},
            {"operation": "copy", "source": "artifact://a.txt", "destination": "testdata://"},
            {"operation": "move", "source": "artifact://a.txt", "destination": "testdata://"},
            {"operation": "create_folder", "path": "testdata://"},
        ],
    )
    async def test_a_target_on_the_root_keeps_the_read_only_refusal(
        self, artifacts: Path, testdata: Path, rows: dict[str, Any]
    ) -> None:
        (artifacts / "a.txt").write_text("x", encoding="utf-8")

        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(rows, artifacts_dir=artifacts, testdata_dirs=[testdata])
            )

        assert sorted(entry.name for entry in testdata.iterdir()) == ["input.csv"]
        assert (artifacts / "a.txt").is_file()

    @pytest.mark.parametrize(
        "rows",
        [
            {"operation": "delete", "path": "testdata://"},
            {"operation": "move", "source": "testdata://", "destination": "artifact://moved"},
        ],
    )
    async def test_delete_and_the_move_source_keep_the_read_only_refusal(
        self, artifacts: Path, testdata: Path, rows: dict[str, Any]
    ) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(rows, artifacts_dir=artifacts, testdata_dirs=[testdata])
            )

        assert (testdata / "input.csv").is_file()

    async def test_stats_reports_on_the_testdata_root(self, testdata: Path) -> None:
        result = await FileIOPlugin().execute(
            context({"operation": "stats", "path": "testdata://"}, testdata_dirs=[testdata])
        )

        assert result["exists"] is True
        assert result["type"] == "folder"

    async def test_list_lists_the_testdata_root(self, testdata: Path) -> None:
        result = await FileIOPlugin().execute(
            context({"operation": "list", "path": "testdata://"}, testdata_dirs=[testdata])
        )

        assert result["count"] == 1


class TestStatsOnAMissingPath:
    """Stats answers exists false instead of raising when the resolver finds nothing."""

    async def test_unresolvable_testdata_reference(self, testdata: Path) -> None:
        result = await FileIOPlugin().execute(
            context(
                {"operation": "stats", "path": "testdata://missing.csv"}, testdata_dirs=[testdata]
            )
        )

        assert result["exists"] is False
        assert result["type"] == ""
        assert result["modified"] == ""

    async def test_missing_artifact_reference(self, artifacts: Path) -> None:
        result = await FileIOPlugin().execute(
            context(
                {"operation": "stats", "path": "artifact://nothing.txt"}, artifacts_dir=artifacts
            )
        )

        assert result["exists"] is False

    async def test_an_absolute_file_after_the_testdata_scheme_is_looked_for_in_the_folder(
        self, testdata: Path, tmp_path: Path
    ) -> None:
        outside = tmp_path / "outside.txt"
        outside.write_text("x", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context(
                {"operation": "stats", "path": f"testdata://{outside}"}, testdata_dirs=[testdata]
            )
        )

        assert result["exists"] is False

    async def test_missing_absolute_path(self, tmp_path: Path) -> None:
        result = await FileIOPlugin().execute(
            context({"operation": "stats", "path": str(tmp_path / "nothing.txt")})
        )

        assert result["exists"] is False

    async def test_a_reference_that_leaves_the_artifacts_folder_is_reported_on(
        self, artifacts: Path
    ) -> None:
        (artifacts.parent / "outside.txt").write_text("x", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context(
                {"operation": "stats", "path": "artifact://../outside.txt"},
                artifacts_dir=artifacts,
            )
        )

        assert result["exists"] is True
        assert result["type"] == "file"


class TestTestdataIsReadOnly:
    """The write flavor refuses the test's own files however the block addresses them."""

    async def test_write(self, artifacts: Path, testdata: Path) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "write", "path": "testdata://out.txt", "content": "text"},
                    artifacts_dir=artifacts,
                    testdata_dirs=[testdata],
                )
            )

    async def test_delete(self, testdata: Path) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "delete", "path": "testdata://input.csv"},
                    testdata_dirs=[testdata],
                )
            )

    async def test_move_source(self, artifacts: Path, testdata: Path) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {
                        "operation": "move",
                        "source": "testdata://input.csv",
                        "destination": "artifact://input.csv",
                    },
                    artifacts_dir=artifacts,
                    testdata_dirs=[testdata],
                )
            )

    async def test_move_destination(self, artifacts: Path, testdata: Path) -> None:
        (artifacts / "a.txt").write_text("x", encoding="utf-8")

        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {
                        "operation": "move",
                        "source": "artifact://a.txt",
                        "destination": "testdata://a.txt",
                    },
                    artifacts_dir=artifacts,
                    testdata_dirs=[testdata],
                )
            )

    async def test_copy_destination(self, artifacts: Path, testdata: Path) -> None:
        (artifacts / "a.txt").write_text("x", encoding="utf-8")

        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {
                        "operation": "copy",
                        "source": "artifact://a.txt",
                        "destination": "testdata://a.txt",
                    },
                    artifacts_dir=artifacts,
                    testdata_dirs=[testdata],
                )
            )

    async def test_create_folder(self, testdata: Path) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "create_folder", "path": "testdata://cases"},
                    testdata_dirs=[testdata],
                )
            )


class TestTheTestDataAreaIsReadOnly:
    """Any test's folder in the Test Data storage zone is refused as a target, by any form."""

    @pytest.fixture
    def zone(self) -> Path:
        from wavecore.api.services import storage_paths

        running = storage_paths.get_test_testdata_path("running-test")
        other = storage_paths.get_test_testdata_path("other-test")
        running.mkdir(parents=True, exist_ok=True)
        other.mkdir(parents=True, exist_ok=True)
        (other / "shared.csv").write_text("a,b\n", encoding="utf-8")
        return running.parent

    async def test_a_write_into_another_tests_folder_by_absolute_path(self, zone: Path) -> None:
        target = zone / "other-test" / "out.txt"

        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "write", "path": str(target), "content": "text"},
                    testdata_dirs=[zone / "running-test"],
                )
            )

        assert not target.exists()

    async def test_a_write_into_the_running_tests_folder_by_absolute_path(self, zone: Path) -> None:
        target = zone / "running-test" / "out.txt"

        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {"operation": "write", "path": str(target), "content": "text"},
                    testdata_dirs=[zone / "running-test"],
                )
            )

        assert not target.exists()

    async def test_a_delete_in_another_tests_folder_through_a_parent_segment(
        self, zone: Path
    ) -> None:
        with pytest.raises(ValueError, match=exact(READ_ONLY_MESSAGE)):
            await FileIOPlugin().execute(
                context(
                    {
                        "operation": "delete",
                        "path": f"{zone}/running-test/../other-test/shared.csv",
                    },
                    testdata_dirs=[zone / "running-test"],
                )
            )

        assert (zone / "other-test" / "shared.csv").exists()

    async def test_a_read_from_another_tests_folder_is_allowed(self, zone: Path) -> None:
        result = await FileIOPlugin().execute(
            context(
                {"operation": "read", "path": "testdata://../other-test/shared.csv"},
                testdata_dirs=[zone / "running-test"],
            )
        )

        assert result == {"content": "a,b\n"}


class TestRelativeAndParentPathsOnWave:
    """A relative path starts at the WAVE server user's home folder; `..` goes where it points."""

    async def test_a_relative_write_lands_under_the_server_users_home(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        monkeypatch.chdir(tmp_path)

        await FileIOPlugin().execute(
            context({"operation": "write", "path": "reports/out.txt", "content": "text"})
        )

        assert (server_home / "reports" / "out.txt").read_text(encoding="utf-8") == "text"
        assert not (tmp_path / "reports").exists()

    @pytest.mark.parametrize(
        ("rows", "expected"),
        [
            ({"operation": "read", "path": "in/data.txt"}, {"content": "payload"}),
            ({"operation": "stats", "path": "in/data.txt"}, None),
            ({"operation": "list", "path": "in"}, None),
        ],
    )
    async def test_a_relative_read_starts_from_the_server_users_home(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        server_home: Path,
        rows: dict[str, Any],
        expected: dict[str, Any] | None,
    ) -> None:
        (server_home / "in").mkdir()
        (server_home / "in" / "data.txt").write_text("payload", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        result = await FileIOPlugin().execute(context(rows))

        if expected is not None:
            assert result == expected
        elif rows["operation"] == "stats":
            assert result["exists"] is True
        else:
            assert result["count"] == 1

    async def test_a_relative_copy_move_and_delete_start_from_the_server_users_home(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        (server_home / "a.txt").write_text("a", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        plugin = FileIOPlugin()

        await plugin.execute(
            context({"operation": "copy", "source": "a.txt", "destination": "copies/b.txt"})
        )
        await plugin.execute(
            context({"operation": "move", "source": "copies/b.txt", "destination": "c.txt"})
        )
        await plugin.execute(context({"operation": "delete", "path": "a.txt"}))

        assert not (server_home / "a.txt").exists()
        assert not (server_home / "copies" / "b.txt").exists()
        assert (server_home / "c.txt").read_text(encoding="utf-8") == "a"

    async def test_a_relative_parent_segment_starts_from_the_server_users_home(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        start = tmp_path / "server-process"
        start.mkdir()
        monkeypatch.chdir(start)

        await FileIOPlugin().execute(
            context({"operation": "create_folder", "path": "../beside-home/made"})
        )

        assert (server_home.parent / "beside-home" / "made").is_dir()

    async def test_an_artifact_write_that_leaves_the_artifacts_folder(
        self, artifacts: Path
    ) -> None:
        await FileIOPlugin().execute(
            context(
                {"operation": "write", "path": "artifact://../beside.txt", "content": "text"},
                artifacts_dir=artifacts,
            )
        )

        assert (artifacts.parent / "beside.txt").read_text(encoding="utf-8") == "text"

    async def test_a_testdata_read_that_leaves_the_testdata_folder(
        self, tmp_path: Path, testdata: Path
    ) -> None:
        (tmp_path / "beside.csv").write_text("x,y\n", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context(
                {"operation": "read", "path": "testdata://../beside.csv"}, testdata_dirs=[testdata]
            )
        )

        assert result == {"content": "x,y\n"}

    async def test_a_plain_parent_segment_is_followed(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        (tmp_path / "in.txt").write_text("payload", encoding="utf-8")

        result = await FileIOPlugin().execute(
            context({"operation": "read", "path": f"{tmp_path}/sub/../in.txt"})
        )

        assert result == {"content": "payload"}


class TestVerbBridgeWiring:
    """The block runs its standard-library core off the loop through the shared bridge."""

    def test_run_verb_comes_from_the_verb_bridge(self) -> None:
        assert file_io.run_verb is _verb_bridge.run_verb

    async def test_execute_answers_with_what_the_bridge_returns(
        self, monkeypatch: pytest.MonkeyPatch, artifacts: Path
    ) -> None:
        calls: list[list[Any]] = []
        sentinel = {"content": "from the bridge"}

        async def fake_run_verb(*args: Any, **kwargs: Any) -> Any:
            calls.append(list(args) + list(kwargs.values()))
            return sentinel

        monkeypatch.setattr(file_io, "run_verb", fake_run_verb)
        ctx = context({"operation": "read", "path": "artifact://note.txt"}, artifacts_dir=artifacts)

        assert await FileIOPlugin().execute(ctx) is sentinel
        assert len(calls) == 1
        assert any(passed is ctx for passed in calls[0])

    async def test_execute_tolerates_a_none_logger(self, artifacts: Path) -> None:
        (artifacts / "note.txt").write_text("hello\n", encoding="utf-8")
        ctx = context(
            {"operation": "read", "path": "artifact://note.txt"},
            artifacts_dir=artifacts,
            logger=None,
        )
        ctx["logger"] = None

        assert await FileIOPlugin().execute(ctx) == {"content": "hello\n"}

    async def test_execute_tolerates_a_context_without_a_logger(self, artifacts: Path) -> None:
        (artifacts / "note.txt").write_text("hello\n", encoding="utf-8")
        ctx = context({"operation": "read", "path": "artifact://note.txt"}, artifacts_dir=artifacts)
        del ctx["logger"]

        assert await FileIOPlugin().execute(ctx) == {"content": "hello\n"}


class TestAiofilesIsGone:
    """The plugin owns no asynchronous file access: the core is standard-library and sync."""

    def test_no_aiofiles_in_the_source(self) -> None:
        assert "aiofiles" not in inspect.getsource(file_io)

    def test_no_aiofiles_attribute(self) -> None:
        assert not hasattr(file_io, "aiofiles")
