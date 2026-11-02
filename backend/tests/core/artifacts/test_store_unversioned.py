"""Unit tests for the unversioned artifact store (REQ-3.7.1.1).

Artifacts are unversioned: WAVE-generated artifacts are written under the
plain logical ``name.ext`` (optionally suffixed ``.gz`` / ``.zip``), never
``name.vN.ext``. Re-writing the same logical name overwrites in place; reports
are immutable per execution and "regenerate" is a delete-then-write flow owned
by the caller. ``parse_artifact_filename`` recovers (logical name, compression)
- there is no version element.
"""

import gzip
import json
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from wavecore.core.artifacts import store


class TestUnversionedWrites:
    """write_json / write_text / write_bytes produce plain ``name.ext``."""

    def test_write_json_uses_plain_name(self, tmp_path: Path) -> None:
        result = store.write_json(tmp_path, "report", {"n": 1})

        assert result == tmp_path / "report.json"
        assert json.loads(result.read_text()) == {"n": 1}

    def test_write_text_uses_plain_name(self, tmp_path: Path) -> None:
        result = store.write_text(tmp_path, "notes", "hello")

        assert result == tmp_path / "notes.txt"
        assert result.read_text() == "hello"

    def test_write_bytes_uses_plain_name(self, tmp_path: Path) -> None:
        result = store.write_bytes(tmp_path, "blob", b"\x00\x01")

        assert result == tmp_path / "blob.bin"
        assert result.read_bytes() == b"\x00\x01"

    def test_explicit_extension_is_preserved(self, tmp_path: Path) -> None:
        result = store.write_text(tmp_path, "report.html", "<html></html>")

        assert result == tmp_path / "report.html"

    def test_subdirectory_name_is_honored(self, tmp_path: Path) -> None:
        result = store.write_json(tmp_path, "logs/report", {})

        assert result == tmp_path / "logs" / "report.json"
        assert result.parent.is_dir()


class TestOverwriteSemantics:
    """Re-writing a logical name overwrites in place - no ``vN`` proliferation."""

    def test_second_json_write_overwrites_in_place(self, tmp_path: Path) -> None:
        store.write_json(tmp_path, "report", {"n": 1})
        result = store.write_json(tmp_path, "report", {"n": 2})

        assert result == tmp_path / "report.json"
        assert json.loads(result.read_text()) == {"n": 2}
        assert list(tmp_path.glob("report*.json")) == [tmp_path / "report.json"]

    def test_no_versioned_filenames_are_ever_created(self, tmp_path: Path) -> None:
        for index in range(3):
            store.write_text(tmp_path, "notes", f"v{index}")

        names = sorted(p.name for p in tmp_path.iterdir())
        assert names == ["notes.txt"]
        assert not any(".v" in name for name in names)

    def test_text_and_bytes_overwrite_too(self, tmp_path: Path) -> None:
        store.write_text(tmp_path, "notes", "one")
        store.write_text(tmp_path, "notes", "two")
        store.write_bytes(tmp_path, "blob", b"one")
        store.write_bytes(tmp_path, "blob", b"two")

        assert (tmp_path / "notes.txt").read_text() == "two"
        assert (tmp_path / "blob.bin").read_bytes() == b"two"


class TestCompressionSuffixes:
    """Compression remains a filename suffix; no version element."""

    def test_gzip_writes_plain_name_with_gz_suffix(self, tmp_path: Path) -> None:
        result = store.write_json(tmp_path, "report", {"n": 1}, compression="gzip")

        assert result == tmp_path / "report.json.gz"
        with gzip.open(result, "rb") as handle:
            assert json.loads(handle.read()) == {"n": 1}

    def test_zip_writes_plain_name_with_zip_suffix(self, tmp_path: Path) -> None:
        result = store.write_bytes(tmp_path, "archive", b"payload", compression="zip")

        assert result == tmp_path / "archive.bin.zip"
        with zipfile.ZipFile(result) as archive:
            assert archive.read("archive.bin") == b"payload"


class TestParseArtifactFilename:
    """parse_artifact_filename returns (logical name, compression) - no version."""

    def test_plain_filename_returns_name_and_no_compression(self) -> None:
        assert store.parse_artifact_filename("report.json") == ("report.json", None)

    def test_html_filename(self) -> None:
        assert store.parse_artifact_filename("report.html") == ("report.html", None)

    def test_error_filename(self) -> None:
        assert store.parse_artifact_filename("error.json") == ("error.json", None)

    def test_gzip_suffix_is_stripped_into_compression(self) -> None:
        assert store.parse_artifact_filename("report.json.gz") == ("report.json", "gzip")

    def test_zip_suffix_is_stripped_into_compression(self) -> None:
        assert store.parse_artifact_filename("archive.bin.zip") == ("archive.bin", "zip")

    def test_plugin_written_filename_is_unchanged(self) -> None:
        assert store.parse_artifact_filename("service.log") == ("service.log", None)

    def test_filename_without_extension(self) -> None:
        assert store.parse_artifact_filename("README") == ("README", None)

    def test_round_trip_with_writer_output(self, tmp_path: Path) -> None:
        written = store.write_json(tmp_path, "report", {}, compression="gzip")

        assert store.parse_artifact_filename(written.name) == ("report.json", "gzip")


class TestInMemoryValidation:
    """JSON is validated in memory before any file reaches disk."""

    def test_circular_reference_in_dict_raises_before_io(self, tmp_path: Path) -> None:
        data: dict = {"a": 1}
        data["self"] = data

        with pytest.raises(ValueError, match=r"^Circular reference detected$"):
            store.write_json(tmp_path, "error", data)

        assert list(tmp_path.iterdir()) == []

    def test_circular_reference_in_list_raises_before_io(self, tmp_path: Path) -> None:
        inner: list = []
        inner.append(inner)

        with pytest.raises(ValueError, match=r"^Circular reference detected$"):
            store.write_json(tmp_path, "error", {"items": inner})

        assert list(tmp_path.iterdir()) == []

    def test_non_serializable_raises_typeerror_before_io(self, tmp_path: Path) -> None:
        with pytest.raises(TypeError):
            store.write_json(tmp_path, "error", {"bad": {1, 2, 3}})

        assert list(tmp_path.iterdir()) == []


class TestCompressionValidationAndFallback:
    """Compression mode is validated up front; gzip failure falls back to plain."""

    @pytest.mark.parametrize("writer_name", ["write_json", "write_text", "write_bytes"])
    def test_unknown_compression_rejected(self, tmp_path: Path, writer_name: str) -> None:
        writer = getattr(store, writer_name)
        data: object = (
            {"a": 1}
            if writer_name == "write_json"
            else ("text" if writer_name == "write_text" else b"bytes")
        )

        with pytest.raises(
            ValueError,
            match=r"^Invalid compression type 'lz4': valid types are none, gzip, zip$",
        ):
            writer(tmp_path, "artifact", data, compression="lz4")

        assert list(tmp_path.iterdir()) == []

    def test_gzip_failure_falls_back_to_plain_write(self, tmp_path: Path) -> None:
        with patch(
            "wavecore.core.artifacts.store.gzip.open",
            side_effect=OSError("gzip unavailable"),
        ):
            result = store.write_json(tmp_path, "report", {"keep": "me"}, compression="gzip")

        assert result == tmp_path / "report.json"
        assert json.loads(result.read_text()) == {"keep": "me"}
