"""Unit tests for the promoted file-tree helpers (REQ-5.2.4.12, REQ-3.4.3.2).

``file_tree`` holds the three idioms artifacts, session artifacts and test data
share: the safe-relative-path rule, the flat directory walk, and the download
response builder. A download's content type comes from WAVE's own file-type
table, never from the WAVE host's file-type configuration (REQ-3.4.3.10).
"""

import mimetypes
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest
from starlette.responses import FileResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import file_tree

_INVALID_DISPOSITION = r"^Invalid disposition 'sideways': valid values are attachment, inline$"


@pytest.fixture
def host_file_types(monkeypatch: pytest.MonkeyPatch) -> Mock:
    """Spy on the host's file-type lookup; the lookup itself still answers."""
    spy = Mock(wraps=mimetypes)
    monkeypatch.setattr(mimetypes, "guess_type", spy.guess_type)
    monkeypatch.setattr(mimetypes, "init", spy.init)
    return spy


def _entry(entries: list[dict[str, object]], path: str) -> dict[str, object]:
    """The one entry with this relative path."""
    matches = [entry for entry in entries if entry["path"] == path]
    assert len(matches) == 1, f"{path} not found in {[e['path'] for e in entries]}"
    return matches[0]


def _disposition(response: FileResponse) -> str:
    return response.headers["content-disposition"]


class TestIsSafeRelativePath:
    """The leading-slash / empty-segment / parent-segment rule."""

    def test_a_plain_name_is_safe(self) -> None:
        """A single file name is a valid relative path."""
        assert file_tree.is_safe_relative_path("customers.csv") is True

    def test_a_nested_path_is_safe(self) -> None:
        """Posix-separated nesting is a valid relative path."""
        assert file_tree.is_safe_relative_path("fixtures/data/customers.csv") is True

    def test_a_leading_slash_is_refused(self) -> None:
        """A rooted path is never relative."""
        assert file_tree.is_safe_relative_path("/customers.csv") is False

    def test_an_absolute_path_is_refused(self) -> None:
        """An absolute host path is refused outright."""
        assert file_tree.is_safe_relative_path("/etc/passwd") is False

    def test_an_empty_segment_is_refused(self) -> None:
        """A doubled separator leaves an empty segment."""
        assert file_tree.is_safe_relative_path("fixtures//data.csv") is False

    def test_a_trailing_slash_is_refused(self) -> None:
        """A trailing separator leaves an empty final segment."""
        assert file_tree.is_safe_relative_path("fixtures/") is False

    def test_the_empty_string_is_refused(self) -> None:
        """The empty string is not a path to anything."""
        assert file_tree.is_safe_relative_path("") is False

    def test_a_leading_parent_segment_is_refused(self) -> None:
        """A path that starts by climbing out is refused."""
        assert file_tree.is_safe_relative_path("../secrets") is False

    def test_a_middle_parent_segment_is_refused(self) -> None:
        """A path that climbs out halfway is refused."""
        assert file_tree.is_safe_relative_path("fixtures/../../secrets") is False

    def test_a_trailing_parent_segment_is_refused(self) -> None:
        """A path that ends on a parent segment is refused."""
        assert file_tree.is_safe_relative_path("fixtures/..") is False


class TestWalkEntries:
    """The flat listing every file surface answers with."""

    def test_a_file_entry_carries_path_kind_size_and_modified(self, tmp_path: Path) -> None:
        """One file yields one entry with the four Entry fields."""
        (tmp_path / "customers.csv").write_bytes(b"id,name\n")

        entries = file_tree.walk_entries(tmp_path)

        assert len(entries) == 1
        assert entries[0]["path"] == "customers.csv"
        assert entries[0]["kind"] == "file"
        assert entries[0]["size_bytes"] == 8
        assert entries[0]["modified_at"]

    def test_nested_paths_are_relative_and_posix(self, tmp_path: Path) -> None:
        """A nested file's path is relative to the root with forward slashes."""
        nested = tmp_path / "fixtures" / "data"
        nested.mkdir(parents=True)
        (nested / "customers.csv").write_bytes(b"x")

        entries = file_tree.walk_entries(tmp_path)

        paths = {entry["path"] for entry in entries}
        assert "fixtures/data/customers.csv" in paths

    def test_folders_get_their_own_dir_entries(self, tmp_path: Path) -> None:
        """The list is flat: every folder is its own explicit entry."""
        nested = tmp_path / "fixtures" / "data"
        nested.mkdir(parents=True)
        (nested / "customers.csv").write_bytes(b"x")

        entries = file_tree.walk_entries(tmp_path)

        assert _entry(entries, "fixtures")["kind"] == "dir"
        assert _entry(entries, "fixtures/data")["kind"] == "dir"

    def test_an_empty_folder_is_listed(self, tmp_path: Path) -> None:
        """Explicit dir entries are what make an empty folder visible."""
        (tmp_path / "staging").mkdir()

        entries = file_tree.walk_entries(tmp_path)

        assert [entry["path"] for entry in entries] == ["staging"]
        assert entries[0]["kind"] == "dir"

    def test_a_folder_entry_reports_no_size(self, tmp_path: Path) -> None:
        """Folder sizes are aggregated by the caller, so the entry reports zero."""
        (tmp_path / "staging").mkdir()

        entries = file_tree.walk_entries(tmp_path)

        assert entries[0]["size_bytes"] == 0

    def test_modified_at_is_iso_8601_utc_with_an_offset(self, tmp_path: Path) -> None:
        """The timestamp parses as an aware UTC datetime matching the file mtime."""
        target = tmp_path / "customers.csv"
        target.write_bytes(b"x")

        entries = file_tree.walk_entries(tmp_path)

        parsed = datetime.fromisoformat(str(entries[0]["modified_at"]))
        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == timedelta(0)
        assert parsed == datetime.fromtimestamp(target.stat().st_mtime, tz=UTC)

    def test_dot_directories_are_skipped(self, tmp_path: Path) -> None:
        """A dot-directory and everything under it stays out of the listing."""
        hidden = tmp_path / ".git"
        hidden.mkdir()
        (hidden / "config").write_bytes(b"x")
        (tmp_path / "customers.csv").write_bytes(b"x")

        entries = file_tree.walk_entries(tmp_path)

        assert [entry["path"] for entry in entries] == ["customers.csv"]

    def test_a_nested_dot_directory_is_skipped(self, tmp_path: Path) -> None:
        """The skip applies at every depth, not only at the root."""
        hidden = tmp_path / "fixtures" / ".cache"
        hidden.mkdir(parents=True)
        (hidden / "blob").write_bytes(b"x")

        entries = file_tree.walk_entries(tmp_path)

        assert [entry["path"] for entry in entries] == ["fixtures"]

    def test_a_symlinked_file_is_skipped(self, tmp_path: Path) -> None:
        """Symlinks are never listed, even when their target is inside the root."""
        (tmp_path / "customers.csv").write_bytes(b"x")
        (tmp_path / "alias.csv").symlink_to(tmp_path / "customers.csv")

        entries = file_tree.walk_entries(tmp_path)

        assert [entry["path"] for entry in entries] == ["customers.csv"]

    def test_a_symlinked_folder_is_skipped(self, tmp_path: Path) -> None:
        """A symlinked folder is neither listed nor descended into."""
        real = tmp_path / "fixtures"
        real.mkdir()
        (real / "customers.csv").write_bytes(b"x")
        (tmp_path / "alias").symlink_to(real, target_is_directory=True)

        entries = file_tree.walk_entries(tmp_path)

        assert sorted(entry["path"] for entry in entries) == [
            "fixtures",
            "fixtures/customers.csv",
        ]

    def test_a_missing_root_yields_no_entries(self, tmp_path: Path) -> None:
        """A folder that was never created lists as empty, not as an error."""
        assert file_tree.walk_entries(tmp_path / "absent") == []


class TestContentResponseDisposition:
    """Only attachment and inline are served."""

    def test_attachment_is_accepted(self, tmp_path: Path) -> None:
        """The default download disposition is honored."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        response = file_tree.content_response(target, "attachment")

        assert _disposition(response).startswith("attachment;")

    def test_inline_is_accepted(self, tmp_path: Path) -> None:
        """The preview disposition is honored."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        response = file_tree.content_response(target, "inline")

        assert _disposition(response).startswith("inline;")

    def test_an_unknown_disposition_is_refused(self, tmp_path: Path) -> None:
        """Anything else is a 400 naming the two valid values."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        with pytest.raises(ValidationException, match=_INVALID_DISPOSITION):
            file_tree.content_response(target, "sideways")

    def test_an_empty_disposition_is_refused(self, tmp_path: Path) -> None:
        """An empty value is not a silent default."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        with pytest.raises(
            ValidationException,
            match=r"^Invalid disposition '': valid values are attachment, inline$",
        ):
            file_tree.content_response(target, "")


class TestContentResponseHeaders:
    """The download headers every file surface repeats."""

    def test_the_file_is_served_from_disk(self, tmp_path: Path) -> None:
        """The response streams the path; the bytes are never read into memory."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"id,name\n")

        response = file_tree.content_response(target, "attachment")

        assert isinstance(response, FileResponse)
        assert Path(response.path) == target

    def test_content_type_options_is_nosniff(self, tmp_path: Path) -> None:
        """Browsers must not guess a type the server did not send."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        response = file_tree.content_response(target, "attachment")

        assert response.headers["x-content-type-options"] == "nosniff"

    def test_cache_control_is_no_store(self, tmp_path: Path) -> None:
        """Test data and artifacts are never cached by the browser."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        response = file_tree.content_response(target, "attachment")

        assert response.headers["cache-control"] == "no-store"


class TestContentResponseMediaType:
    """REQ-3.4.3.10: a download's type comes from WAVE's own table, never the host's."""

    @pytest.mark.parametrize(
        ("file_name", "content_type"),
        [
            ("values.yaml", "application/yaml"),
            ("values.yml", "application/yaml"),
            ("events.jsonl", "application/jsonl"),
            ("report.json", "application/json"),
        ],
    )
    def test_a_download_is_served_with_the_table_type(
        self, tmp_path: Path, host_file_types: Mock, file_name: str, content_type: str
    ) -> None:
        """The media type and the header both carry the table's type for the extension."""
        target = tmp_path / file_name
        target.write_bytes(b"x")

        response = file_tree.content_response(target, "attachment")

        assert response.media_type == content_type
        assert response.headers["content-type"] == content_type
        assert host_file_types.mock_calls == []

    def test_a_text_download_is_served_with_the_table_type(
        self, tmp_path: Path, host_file_types: Mock
    ) -> None:
        """TypeScript source is sent as text, whatever the host calls a .ts file."""
        target = tmp_path / "client.ts"
        target.write_bytes(b"export {};\n")

        response = file_tree.content_response(target, "inline")

        assert response.media_type == "text/typescript"
        assert host_file_types.mock_calls == []

    def test_an_unknown_extension_is_served_as_octet_stream(
        self, tmp_path: Path, host_file_types: Mock
    ) -> None:
        """An extension the table does not know is generic binary data."""
        target = tmp_path / "payload.unknownext"
        target.write_bytes(b"\x00\x01")

        response = file_tree.content_response(target, "attachment")

        assert response.media_type == "application/octet-stream"
        assert host_file_types.mock_calls == []


class TestContentResponseCompressedFiles:
    """REQ-3.4.3.10: a compressed download carries the same label on every WAVE host."""

    @pytest.mark.parametrize(
        ("file_name", "content_type"),
        [
            ("report.json.gz", "application/json"),
            ("archive.tar.gz", "application/x-tar"),
            ("report.JSON.gz", "application/json"),
        ],
    )
    def test_a_gzip_download_is_served_with_the_type_of_the_file_inside(
        self, tmp_path: Path, host_file_types: Mock, file_name: str, content_type: str
    ) -> None:
        """A .gz file whose inner type the table knows is labeled as that file."""
        target = tmp_path / file_name
        target.write_bytes(b"gz")

        response = file_tree.content_response(target, "attachment")

        assert response.media_type == content_type
        assert response.headers["content-type"] == content_type
        assert host_file_types.mock_calls == []

    @pytest.mark.parametrize("file_name", ["payload.gz", "payload.unknownext.gz"])
    def test_a_gzip_download_of_an_unknown_file_is_served_as_gzip(
        self, tmp_path: Path, host_file_types: Mock, file_name: str
    ) -> None:
        """A .gz file whose inner type the table does not know is a gzip file."""
        target = tmp_path / file_name
        target.write_bytes(b"gz")

        response = file_tree.content_response(target, "attachment")

        assert response.media_type == "application/gzip"
        assert host_file_types.mock_calls == []

    @pytest.mark.parametrize("file_name", ["bundle.zip", "data.csv.zip"])
    def test_a_zip_download_is_served_as_zip(
        self, tmp_path: Path, host_file_types: Mock, file_name: str
    ) -> None:
        """A .zip file is a zip file, whatever its name says is inside."""
        target = tmp_path / file_name
        target.write_bytes(b"PK")

        response = file_tree.content_response(target, "attachment")

        assert response.media_type == "application/zip"
        assert response.headers["content-type"] == "application/zip"
        assert host_file_types.mock_calls == []


class TestContentResponseFilename:
    """RFC 5987 naming with an ASCII fallback."""

    def test_a_plain_name_is_sent_in_the_plain_form_only(self, tmp_path: Path) -> None:
        """A name of plain characters needs no encoded form."""
        target = tmp_path / "report.csv"
        target.write_bytes(b"x")

        disposition = _disposition(file_tree.content_response(target, "attachment"))

        assert disposition == 'attachment; filename="report.csv"'

    def test_a_non_ascii_name_is_percent_encoded(self, tmp_path: Path) -> None:
        """filename* carries the UTF-8 percent-encoded name."""
        target = tmp_path / "déjà.csv"
        target.write_bytes(b"x")

        disposition = _disposition(file_tree.content_response(target, "attachment"))

        assert "filename*=UTF-8''d%C3%A9j%C3%A0.csv" in disposition

    def test_a_non_ascii_name_still_has_an_ascii_fallback(self, tmp_path: Path) -> None:
        """The plain filename stays ASCII for clients that ignore filename*."""
        target = tmp_path / "déjà.csv"
        target.write_bytes(b"x")

        disposition = _disposition(file_tree.content_response(target, "attachment"))

        match = re.search(r'filename="([^"]*)"', disposition)
        assert match is not None
        assert match.group(1).isascii()

    def test_a_quote_in_the_name_does_not_break_the_header(self, tmp_path: Path) -> None:
        """A double quote in the file name never ends the fallback early."""
        target = tmp_path / 'we"ird.csv'
        target.write_bytes(b"x")

        disposition = _disposition(file_tree.content_response(target, "attachment"))

        match = re.search(r'filename="([^"]*)"', disposition)
        assert match is not None
        assert '"' not in match.group(1)
        assert "filename*=UTF-8''we%22ird.csv" in disposition


class TestContentDisposition:
    """One header value for every download whose file name comes from data (REQ-4.6.9)."""

    @pytest.mark.parametrize("disposition", ["attachment", "inline"])
    def test_a_plain_name_is_sent_as_it_is(self, disposition: str) -> None:
        value = file_tree.content_disposition(disposition, "run log (1).txt")

        assert value == f'{disposition}; filename="run log (1).txt"'

    def test_every_plain_character_is_kept(self) -> None:
        plain = "".join(chr(code) for code in range(0x20, 0x7F) if chr(code) not in '"\\')

        value = file_tree.content_disposition("attachment", plain)

        assert value == f'attachment; filename="{plain}"'

    def test_a_name_outside_latin_1_is_sent_whole_in_the_encoded_form(self) -> None:
        value = file_tree.content_disposition("attachment", "Grüße 測試.yaml")

        assert value == (
            'attachment; filename="Gre .yaml"; '
            "filename*=UTF-8''Gr%C3%BC%C3%9Fe%20%E6%B8%AC%E8%A9%A6.yaml"
        )

    def test_a_latin_1_name_gets_the_encoded_form_too(self) -> None:
        value = file_tree.content_disposition("inline", "Grüße.yaml")

        assert value == "inline; filename=\"Gre.yaml\"; filename*=UTF-8''Gr%C3%BC%C3%9Fe.yaml"

    @pytest.mark.parametrize(
        ("name", "fallback", "encoded"),
        [
            pytest.param('we"ird.csv', "weird.csv", "we%22ird.csv", id="quote"),
            pytest.param("back\\slash.csv", "backslash.csv", "back%5Cslash.csv", id="backslash"),
            pytest.param("tab\tbed.csv", "tabbed.csv", "tab%09bed.csv", id="control-character"),
            pytest.param("line\nbreak.csv", "linebreak.csv", "line%0Abreak.csv", id="line-break"),
            pytest.param("car\r\nriage.csv", "carriage.csv", "car%0D%0Ariage.csv", id="crlf"),
            pytest.param("del\x7fete.csv", "delete.csv", "del%7Fete.csv", id="delete-character"),
        ],
    )
    def test_a_character_outside_the_plain_set_is_dropped_from_the_fallback(
        self, name: str, fallback: str, encoded: str
    ) -> None:
        value = file_tree.content_disposition("attachment", name)

        assert value == f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"

    def test_a_name_with_nothing_plain_left_falls_back_to_the_download_name(self) -> None:
        value = file_tree.content_disposition("attachment", "測試")

        assert value == "attachment; filename=\"download\"; filename*=UTF-8''%E6%B8%AC%E8%A9%A6"

    def test_a_name_utf_8_cannot_write_still_gives_a_header(self) -> None:
        value = file_tree.content_disposition("attachment", "cafe\udce9.txt")

        assert value == "attachment; filename=\"cafe.txt\"; filename*=UTF-8''cafe%3F.txt"

    def test_the_header_value_is_always_plain_ascii(self) -> None:
        value = file_tree.content_disposition("attachment", "Grüße\r\n測試\udce9.yaml")

        assert value.isascii()
        assert value.isprintable()
