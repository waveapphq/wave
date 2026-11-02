"""Unit tests for File I/O artifact:// and testdata:// resolution.

REQ-3.4.3.1: artifact:// resolves from the directory injected via
``context["artifacts_dir"]`` and testdata:// from the test's own data folder.
A `..` segment is followed wherever it leads; the reference is never refused
for leaving its folder.
"""

import os
import tempfile
from typing import Any

import pytest

from wavecore.plugins.file_io import FileIOPlugin

_MISSING_DIR_RE = (
    r"^artifact:// scheme requires artifacts directory, but none configured in context$"
)


def _context(
    parameters: dict[str, Any],
    artifacts_dir: str | None = None,
    testdata_dirs: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "parameters": parameters,
        "variables": {},
        "logger": None,
        "artifacts_dir": artifacts_dir,
        "testdata_dirs": testdata_dirs,
    }


class TestArtifactSchemeResolution:
    """artifact:// resolves into the injected artifacts directory."""

    async def test_write_resolves_into_artifacts_dir(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await plugin.execute(
                _context(
                    {
                        "operation": "write",
                        "path": "artifact://result.json",
                        "content": '{"ok": true}',
                    },
                    artifacts_dir=tmpdir,
                )
            )

            assert result == {}
            written = os.path.join(tmpdir, "result.json")
            assert os.path.exists(written)
            with open(written, encoding="utf-8") as f:
                assert f.read() == '{"ok": true}'

    async def test_read_resolves_into_artifacts_dir(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "data.txt"), "w", encoding="utf-8") as f:
                f.write("artifact content")

            result = await plugin.execute(
                _context(
                    {"operation": "read", "path": "artifact://data.txt"},
                    artifacts_dir=tmpdir,
                )
            )

            assert result["content"] == "artifact content"

    async def test_write_creates_subdirectories(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await plugin.execute(
                _context(
                    {
                        "operation": "write",
                        "path": "artifact://logs/service.log",
                        "content": "line\n",
                    },
                    artifacts_dir=tmpdir,
                )
            )

            assert result == {}
            assert os.path.exists(os.path.join(tmpdir, "logs", "service.log"))

    async def test_internal_dotdot_staying_inside_is_allowed(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await plugin.execute(
                _context(
                    {
                        "operation": "write",
                        "path": "artifact://logs/../result.txt",
                        "content": "ok",
                    },
                    artifacts_dir=tmpdir,
                )
            )

            assert result == {}
            assert os.path.exists(os.path.join(tmpdir, "result.txt"))

    async def test_missing_artifacts_dir_raises_exact_message(self) -> None:
        plugin = FileIOPlugin()

        with pytest.raises(ValueError, match=_MISSING_DIR_RE):
            await plugin.execute(
                _context(
                    {
                        "operation": "write",
                        "path": "artifact://result.json",
                        "content": "{}",
                    },
                    artifacts_dir=None,
                )
            )


class TestArtifactSchemeParentSegments:
    """A resolved artifact:// path may leave artifacts_dir through `..`."""

    async def test_a_write_beside_the_artifacts_folder_lands_there(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts_dir = os.path.join(tmpdir, "artifacts")
            os.makedirs(artifacts_dir)

            await plugin.execute(
                _context(
                    {"operation": "write", "path": "artifact://../beside.txt", "content": "up"},
                    artifacts_dir=artifacts_dir,
                )
            )

            with open(os.path.join(tmpdir, "beside.txt"), encoding="utf-8") as f:
                assert f.read() == "up"

    async def test_a_read_beside_the_artifacts_folder_returns_the_file(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts_dir = os.path.join(tmpdir, "artifacts")
            os.makedirs(artifacts_dir)
            with open(os.path.join(tmpdir, "outside.txt"), "w", encoding="utf-8") as f:
                f.write("beside")

            result = await plugin.execute(
                _context(
                    {"operation": "read", "path": "artifact://../outside.txt"},
                    artifacts_dir=artifacts_dir,
                )
            )

            assert result["content"] == "beside"

    async def test_a_nested_parent_segment_is_followed(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts_dir = os.path.join(tmpdir, "artifacts")
            os.makedirs(artifacts_dir)

            await plugin.execute(
                _context(
                    {
                        "operation": "write",
                        "path": "artifact://logs/../../nested.txt",
                        "content": "up",
                    },
                    artifacts_dir=artifacts_dir,
                )
            )

            assert os.path.isfile(os.path.join(tmpdir, "nested.txt"))

    async def test_a_copy_destination_beside_the_artifacts_folder(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts_dir = os.path.join(tmpdir, "artifacts")
            os.makedirs(artifacts_dir)
            with open(os.path.join(artifacts_dir, "source.txt"), "w", encoding="utf-8") as f:
                f.write("data")

            await plugin.execute(
                _context(
                    {
                        "operation": "copy",
                        "source": "artifact://source.txt",
                        "destination": "artifact://../copied.txt",
                    },
                    artifacts_dir=artifacts_dir,
                )
            )

            with open(os.path.join(tmpdir, "copied.txt"), encoding="utf-8") as f:
                assert f.read() == "data"


class TestTestdataSchemeResolution:
    """testdata:// resolves from the test data folder and follows `..` the same way."""

    async def test_testdata_read_of_contained_file_works(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            testdata_dir = os.path.join(tmpdir, "testdata")
            os.makedirs(testdata_dir)
            with open(os.path.join(testdata_dir, "input.csv"), "w", encoding="utf-8") as f:
                f.write("a,b\n")

            result = await plugin.execute(
                _context(
                    {"operation": "read", "path": "testdata://input.csv"},
                    testdata_dirs=[testdata_dir],
                )
            )

            assert result["content"] == "a,b\n"

    async def test_a_testdata_read_beside_the_folder_returns_the_file(self) -> None:
        plugin = FileIOPlugin()
        with tempfile.TemporaryDirectory() as tmpdir:
            testdata_dir = os.path.join(tmpdir, "testdata")
            os.makedirs(testdata_dir)
            with open(os.path.join(tmpdir, "outside.txt"), "w", encoding="utf-8") as f:
                f.write("beside")

            result = await plugin.execute(
                _context(
                    {"operation": "read", "path": "testdata://../outside.txt"},
                    testdata_dirs=[testdata_dir],
                )
            )

            assert result["content"] == "beside"
