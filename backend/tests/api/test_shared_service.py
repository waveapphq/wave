"""Unit tests for shared service-layer utilities (REQ-5.2.4.9).

This module tests shared.build_export_zip, the single source for bulk-export
ZIP assembly used by every entity bulk export, and shared.parse_file /
shared.parse_zip_file, the single source for reading an import upload.

Test Coverage:
- Content round-trip through zipfile
- Deflate compression method
- str, bytes and Path content inputs
- Streaming into a caller-supplied sink
- Entry ordering preserved
- YAML / JSON document parsing and its rejections
- Import archive scanning with the dunder, claim and error options
- The export file name rule every export shares (REQ-4.6.9)
- The first free numbered name and the match and target of an incoming item (REQ-5.2.4.9.5)
- Variables as a save stores them: typed numbers in wire form (REQ-3.1.3.14)
- One batch delete pass for Suites, Regressions, Tests and Blocks
- One batch clone pass for Suites and Regressions
"""

import dataclasses
import io
import json
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from tests.api.body_shape_support import NOT_AN_ID_ITEM, NOT_ID_ITEMS
from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services import shared
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.functions import import_export as function_import_export
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.regressions import import_export as regression_import_export
from wavecore.api.services.suites import import_export as suite_import_export
from wavecore.api.services.tests import service as test_service


class TestBuildExportZip:
    """Tests for shared.build_export_zip."""

    def test_returns_bytes(self) -> None:
        """The assembled archive is returned as raw bytes."""
        result = shared.build_export_zip([("a.yaml", "name: A\n")])

        assert isinstance(result, bytes)

    def test_content_round_trip(self) -> None:
        """Every (filename, content) pair is readable back from the archive."""
        result = shared.build_export_zip(
            [
                ("alpha.yaml", "name: Alpha\n"),
                ("beta.json", '{"name": "Beta"}'),
            ]
        )

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.namelist() == ["alpha.yaml", "beta.json"]
        assert zf.read("alpha.yaml") == b"name: Alpha\n"
        assert zf.read("beta.json") == b'{"name": "Beta"}'

    def test_uses_deflate_compression(self) -> None:
        """Entries are stored with ZIP_DEFLATED compression."""
        result = shared.build_export_zip([("a.yaml", "name: A\n" * 100)])

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.getinfo("a.yaml").compress_type == zipfile.ZIP_DEFLATED

    def test_accepts_bytes_content(self) -> None:
        """Bytes content is written verbatim."""
        payload = b"\x00\x01binary-ish"
        result = shared.build_export_zip([("blob.json", payload)])

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.read("blob.json") == payload

    def test_accepts_mixed_str_and_bytes_content(self) -> None:
        """A single archive can mix str and bytes entries."""
        result = shared.build_export_zip(
            [
                ("text.yaml", "kind: text\n"),
                ("raw.json", b'{"kind": "raw"}'),
            ]
        )

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.read("text.yaml") == b"kind: text\n"
        assert zf.read("raw.json") == b'{"kind": "raw"}'

    def test_empty_file_list_produces_valid_empty_archive(self) -> None:
        """An empty input list still yields a valid, empty ZIP."""
        result = shared.build_export_zip([])

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.namelist() == []


class TestBuildExportZipFromDisk:
    """A Path content entry is written straight from disk (REQ-5.2.4.9)."""

    def test_path_content_is_written_from_disk(self, tmp_path: Path) -> None:
        """The file's bytes land under the given archive name."""
        source = tmp_path / "customers.csv"
        source.write_bytes(b"id,name\n1,Ada\n")

        result = shared.build_export_zip([("testdata/t1/customers.csv", source)])

        assert result is not None
        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.namelist() == ["testdata/t1/customers.csv"]
        assert zf.read("testdata/t1/customers.csv") == b"id,name\n1,Ada\n"

    def test_path_content_uses_deflate_like_the_other_entries(self, tmp_path: Path) -> None:
        """Disk entries are compressed the same way inline entries are."""
        source = tmp_path / "big.txt"
        source.write_bytes(b"repeat\n" * 200)

        result = shared.build_export_zip([("big.txt", source)])

        assert result is not None
        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.getinfo("big.txt").compress_type == zipfile.ZIP_DEFLATED

    def test_path_binary_content_survives_the_round_trip(self, tmp_path: Path) -> None:
        """Raw bytes are not decoded or re-encoded on the way through."""
        payload = bytes(range(256))
        source = tmp_path / "blob.bin"
        source.write_bytes(payload)

        result = shared.build_export_zip([("blob.bin", source)])

        assert result is not None
        assert zipfile.ZipFile(io.BytesIO(result)).read("blob.bin") == payload

    def test_path_entries_mix_with_str_and_bytes_entries(self, tmp_path: Path) -> None:
        """One archive can carry the document inline and the files from disk."""
        source = tmp_path / "fixture.csv"
        source.write_bytes(b"a,b\n")

        result = shared.build_export_zip(
            [
                ("test.yaml", "name: Carrier\n"),
                ("raw.json", b'{"kind": "raw"}'),
                ("testdata/t1/fixture.csv", source),
            ]
        )

        assert result is not None
        zf = zipfile.ZipFile(io.BytesIO(result))
        assert zf.namelist() == ["test.yaml", "raw.json", "testdata/t1/fixture.csv"]
        assert zf.read("test.yaml") == b"name: Carrier\n"
        assert zf.read("raw.json") == b'{"kind": "raw"}'
        assert zf.read("testdata/t1/fixture.csv") == b"a,b\n"


class TestBuildExportZipSink:
    """With a sink the archive is streamed there and nothing is returned."""

    def test_sink_receives_the_archive_and_nothing_is_returned(self) -> None:
        """The return value is None; the bytes are in the sink."""
        sink = io.BytesIO()

        result = shared.build_export_zip([("a.yaml", "name: A\n")], sink=sink)

        assert result is None
        zf = zipfile.ZipFile(io.BytesIO(sink.getvalue()))
        assert zf.namelist() == ["a.yaml"]
        assert zf.read("a.yaml") == b"name: A\n"

    def test_sink_accepts_path_entries(self, tmp_path: Path) -> None:
        """Disk entries stream into the sink the same way inline entries do."""
        source = tmp_path / "fixture.csv"
        source.write_bytes(b"a,b\n")
        sink = io.BytesIO()

        shared.build_export_zip([("fixtures/fixture.csv", source)], sink=sink)

        zf = zipfile.ZipFile(io.BytesIO(sink.getvalue()))
        assert zf.read("fixtures/fixture.csv") == b"a,b\n"

    def test_sink_writes_to_a_real_file_handle(self, tmp_path: Path) -> None:
        """A file opened for binary write is a valid sink."""
        archive = tmp_path / "out.zip"
        with open(archive, "wb") as handle:
            shared.build_export_zip([("a.yaml", "name: A\n")], sink=handle)

        with zipfile.ZipFile(archive) as zf:
            assert zf.read("a.yaml") == b"name: A\n"

    def test_empty_file_list_still_writes_a_valid_archive_to_the_sink(self) -> None:
        """An empty input list yields a valid, empty ZIP in the sink."""
        sink = io.BytesIO()

        shared.build_export_zip([], sink=sink)

        assert zipfile.ZipFile(io.BytesIO(sink.getvalue())).namelist() == []

    def test_sink_is_keyword_only(self) -> None:
        """The sink cannot be passed positionally, so the 6 existing callers are safe."""
        with pytest.raises(TypeError):
            shared.build_export_zip([("a.yaml", "name: A\n")], io.BytesIO())  # type: ignore[misc]


def _zip(members: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    return buf.getvalue()


class TestParseFile:
    """Tests for shared.parse_file."""

    def test_parses_yaml(self) -> None:
        """A .yaml member becomes a dict."""
        assert shared.parse_file(b"name: Production\n", "env.yaml") == {"name": "Production"}

    def test_parses_yml(self) -> None:
        """The .yml extension is YAML too."""
        assert shared.parse_file(b"name: Test\n", "env.yml") == {"name": "Test"}

    def test_parses_json(self) -> None:
        """A .json member becomes a dict."""
        content = json.dumps({"name": "Staging"}).encode()

        assert shared.parse_file(content, "env.json") == {"name": "Staging"}

    def test_invalid_yaml_is_rejected(self) -> None:
        """Unparsable YAML raises with the YAML wording."""
        with pytest.raises(ValidationException, match=r"^Invalid YAML: could not parse file$"):
            shared.parse_file(b"{{invalid: yaml:", "env.yaml")

    def test_invalid_json_is_rejected(self) -> None:
        """Unparsable JSON raises with the JSON wording."""
        with pytest.raises(ValidationException, match=r"^Invalid JSON: could not parse file$"):
            shared.parse_file(b"{bad json!", "env.json")

    def test_non_mapping_is_rejected(self) -> None:
        """A top-level list is not an importable document."""
        with pytest.raises(ValidationException, match=r"^File must contain a mapping/object$"):
            shared.parse_file(b"- one\n- two\n", "env.yaml")


class TestParseZipFile:
    """Tests for shared.parse_zip_file, the single import-archive parser."""

    def test_reads_yaml_and_yml_members(self) -> None:
        """Both YAML extensions are importable documents."""
        results = shared.parse_zip_file(_zip({"a.yaml": "name: A\n", "b.yml": "name: B\n"}))

        assert {data["name"] for _, data in results} == {"A", "B"}

    def test_reads_json_members(self) -> None:
        """A JSON member is an importable document."""
        results = shared.parse_zip_file(_zip({"a.json": '{"name": "A"}'}))

        assert results == [("a.json", {"name": "A"})]

    def test_other_extensions_are_ignored(self) -> None:
        """A member that is not YAML or JSON is not a document."""
        results = shared.parse_zip_file(_zip({"readme.txt": "text", "a.yaml": "name: A\n"}))

        assert [name for name, _ in results] == ["a.yaml"]

    def test_archive_without_documents_is_rejected(self) -> None:
        """An archive carrying no document raises."""
        with pytest.raises(
            ValidationException, match=r"^ZIP archive contains no importable files$"
        ):
            shared.parse_zip_file(_zip({"readme.txt": "text"}))

    def test_bad_archive_is_rejected(self) -> None:
        """Bytes that are not a ZIP raise."""
        with pytest.raises(ValidationException, match=r"^Invalid ZIP archive$"):
            shared.parse_zip_file(b"not a zip file")

    def test_dunder_members_are_documents_by_default(self) -> None:
        """Without the option, a '__'-prefixed member is scanned like any other."""
        results = shared.parse_zip_file(_zip({"__MACOSX/a.yaml": "name: A\n"}))

        assert [name for name, _ in results] == ["__MACOSX/a.yaml"]

    def test_skip_dunder_drops_archiver_metadata(self) -> None:
        """With the option, a '__'-prefixed member is never a document."""
        archive = _zip({"__MACOSX/a.yaml": "name: A\n", "b.yaml": "name: B\n"})

        results = shared.parse_zip_file(archive, skip_dunder=True)

        assert [name for name, _ in results] == ["b.yaml"]

    def test_skip_dunder_can_empty_the_archive(self) -> None:
        """An archive of nothing but metadata raises."""
        with pytest.raises(
            ValidationException, match=r"^ZIP archive contains no importable files$"
        ):
            shared.parse_zip_file(_zip({"__MACOSX/a.yaml": "name: A\n"}), skip_dunder=True)

    def test_claimed_members_are_not_documents(self) -> None:
        """A member the hook claims is consumed before the document scan."""
        claimed: list[str] = []

        def claim(zf: zipfile.ZipFile, member: str) -> bool:
            if not member.startswith("files/"):
                return False
            claimed.append(zf.read(member).decode())
            return True

        archive = _zip({"files/a.yaml": "name: Claimed\n", "b.yaml": "name: B\n"})

        results = shared.parse_zip_file(archive, claim_member=claim)

        assert [name for name, _ in results] == ["b.yaml"]
        assert claimed == ["name: Claimed\n"]

    def test_unclaimed_members_stay_documents(self) -> None:
        """A hook that claims nothing leaves the scan untouched."""
        results = shared.parse_zip_file(
            _zip({"a.yaml": "name: A\n"}), claim_member=lambda _zf, _member: False
        )

        assert [name for name, _ in results] == ["a.yaml"]

    def test_custom_parser_reads_every_document(self) -> None:
        """The caller's document parser replaces the default one."""

        def parse(raw: bytes, filename: str) -> dict[str, str]:
            return {"raw": raw.decode(), "from": filename}

        results = shared.parse_zip_file(_zip({"a.yaml": "anything at all"}), parse=parse)

        assert results == [("a.yaml", {"raw": "anything at all", "from": "a.yaml"})]

    def test_custom_error_class_is_raised_for_a_bad_archive(self) -> None:
        """The caller's exception class carries the bad-archive message."""

        class Boom(Exception):
            pass

        with pytest.raises(Boom, match=r"^Invalid ZIP archive$"):
            shared.parse_zip_file(b"not a zip file", error=Boom)

    def test_custom_error_class_is_raised_for_an_empty_archive(self) -> None:
        """The caller's exception class carries the empty-archive message."""

        class Boom(Exception):
            pass

        with pytest.raises(Boom, match=r"^ZIP archive contains no importable files$"):
            shared.parse_zip_file(_zip({"readme.txt": "text"}), error=Boom)


_HINDI_NAME = "हिंदी परीक्षण"
_HINDI_STEM = "हिंदी-परीक्षण"


class TestExportFileStem:
    """A display name as an export file name keeps every language's letters (REQ-4.6.9)."""

    @pytest.mark.parametrize(
        ("name", "stem"),
        [
            pytest.param("Login Flow", "Login-Flow", id="space"),
            pytest.param("  spaced \t out  ", "spaced-out", id="space-runs"),
            pytest.param("Suite@#$%!", "Suite", id="punctuation"),
            pytest.param("my-profile_name", "my-profile_name", id="dash-underscore"),
            pytest.param("Grüße 測試", "Grüße-測試", id="latin-cjk"),
            pytest.param(_HINDI_NAME, _HINDI_STEM, id="vowel-signs"),
            pytest.param("cafe\u0301 run", "cafe\u0301-run", id="combining-accent"),
            pytest.param("مُشَكَّل", "مُشَكَّل", id="arabic-marks"),
            pytest.param("run ٣", "run-٣", id="digit"),
        ],
    )
    def test_letters_marks_and_digits_of_any_language_are_kept(self, name: str, stem: str) -> None:
        assert shared.export_file_stem(name, "entity") == stem

    @pytest.mark.parametrize("name", ["", "   ", "@#$%", "😀"])
    def test_a_name_with_nothing_to_keep_gives_the_fallback(self, name: str) -> None:
        assert shared.export_file_stem(name, "entity") == "entity"

    @pytest.mark.parametrize(
        ("helper", "fallback"),
        [
            pytest.param(test_service._sanitize_filename, "test", id="tests"),
            pytest.param(suite_import_export._sanitize_filename, "suite", id="suites"),
            pytest.param(
                regression_import_export._sanitize_filename, "regression", id="regressions"
            ),
            pytest.param(profile_common._sanitize_filename, "profile", id="profiles"),
            pytest.param(environment_service._sanitize_filename, "environment", id="environments"),
            pytest.param(function_import_export._sanitize_filename, "function", id="functions"),
            pytest.param(execution_service._slugify_execution_name, "execution", id="executions"),
        ],
    )
    def test_every_export_names_its_file_by_this_rule(
        self, helper: Callable[[str], str], fallback: str
    ) -> None:
        assert helper(_HINDI_NAME) == _HINDI_STEM
        assert helper("@#$") == fallback


_NAME_OF_32 = "n" * 32
_ANY_RESOLUTION = [None, "skip", "overwrite", "rename"]


class TestFirstFreeName:
    """shared.first_free_name: the name a renamed item gets (REQ-5.2.4.9.5, REQ-3.1.2.5)."""

    def test_a_free_base_is_returned_as_it_is(self) -> None:
        assert shared.first_free_name("Calc", set()) == "Calc"

    def test_a_taken_base_gets_2(self) -> None:
        assert shared.first_free_name("Calc", {"Calc"}) == "Calc (2)"

    @pytest.mark.parametrize(
        ("taken", "expected"),
        [
            pytest.param({"Calc", "Calc (2)"}, "Calc (3)", id="2-is-taken"),
            pytest.param({"Calc", "Calc (3)"}, "Calc (2)", id="3-is-taken"),
        ],
    )
    def test_the_first_free_number_is_used(self, taken: set[str], expected: str) -> None:
        assert shared.first_free_name("Calc", taken) == expected

    def test_max_length_cuts_the_base_so_the_whole_name_fits(self) -> None:
        name = shared.first_free_name(_NAME_OF_32, {_NAME_OF_32}, max_length=32)

        assert len(name) <= 32
        assert name.endswith(" (2)")

    @pytest.mark.parametrize(
        "base",
        [
            pytest.param(_NAME_OF_32, id="at-the-limit"),
            pytest.param("n" * 40, id="over-the-limit"),
        ],
    )
    def test_max_length_leaves_a_free_base_alone(self, base: str) -> None:
        assert shared.first_free_name(base, set(), max_length=32) == base

    @pytest.mark.parametrize(
        ("taken", "expected"),
        [
            pytest.param({"calc"}, "Calc (2)", id="the-base"),
            pytest.param({"calc", "CALC (2)"}, "Calc (3)", id="a-numbered-name"),
        ],
    )
    def test_normalize_compares_the_names_through_it(self, taken: set[str], expected: str) -> None:
        assert shared.first_free_name("Calc", taken, normalize=str.casefold) == expected

    def test_taken_is_not_changed(self) -> None:
        taken = {"Calc", "Calc (2)"}

        shared.first_free_name("Calc", taken)

        assert taken == {"Calc", "Calc (2)"}


def _decide(
    source_id: str | None,
    name: str,
    resolution: str | None,
    names_by_id: dict[str, str],
    written_ids: set[str] | None = None,
    **options: Any,
) -> Any:
    return shared.decide_item_target(
        source_id=source_id,
        name=name,
        resolution=resolution,
        names_by_id=names_by_id,
        written_ids=set() if written_ids is None else written_ids,
        **options,
    )


def _is_new_id(target_id: Any, source_id: str | None, names_by_id: dict[str, str]) -> bool:
    return (
        isinstance(target_id, str)
        and bool(target_id)
        and target_id != source_id
        and target_id not in names_by_id
    )


class TestDecideItemTarget:
    """shared.decide_item_target: the match and the target of one item (REQ-5.2.4.9.5)."""

    @pytest.mark.parametrize("resolution", ["skip", "overwrite", "rename"])
    def test_no_match_creates_the_item_as_itself(self, resolution: str) -> None:
        target = _decide("backup-1", "Calc", resolution, {"here-1": "Other"})

        assert target.conflict is None
        assert target.action == "create"
        assert target.target_id == "backup-1"
        assert target.target_name == "Calc"
        assert target.blocked is None

    @pytest.mark.parametrize("resolution", _ANY_RESOLUTION)
    def test_the_same_id_is_an_id_conflict(self, resolution: str | None) -> None:
        target = _decide("fn-1", "Calc", resolution, {"fn-1": "Other"})

        assert target.conflict == "id"

    @pytest.mark.parametrize("resolution", _ANY_RESOLUTION)
    def test_the_same_name_on_another_item_is_a_name_conflict(self, resolution: str | None) -> None:
        target = _decide("backup-1", "Calc", resolution, {"here-1": "Calc"})

        assert target.conflict == "name"

    @pytest.mark.parametrize("resolution", _ANY_RESOLUTION)
    def test_one_item_holding_the_id_and_the_name_is_a_both_conflict(
        self, resolution: str | None
    ) -> None:
        target = _decide("fn-1", "Calc", resolution, {"fn-1": "Calc"})

        assert target.conflict == "both"

    def test_an_id_on_one_item_and_the_name_on_another_is_a_both_conflict(self) -> None:
        target = _decide("fn-1", "Calc", "skip", {"fn-1": "Other", "fn-2": "Calc"})

        assert target.conflict == "both"
        assert target.target_id == "fn-1"

    @pytest.mark.parametrize(
        ("names_by_id", "conflict"),
        [
            pytest.param({"fn-1": "Other"}, "id", id="id"),
            pytest.param({"fn-2": "Calc"}, "name", id="name"),
            pytest.param({"fn-1": "Calc"}, "both", id="both"),
            pytest.param({"fn-2": "Other"}, None, id="no-match"),
        ],
    )
    def test_without_a_resolution_only_the_match_is_decided(
        self, names_by_id: dict[str, str], conflict: str | None
    ) -> None:
        target = _decide("fn-1", "Calc", None, names_by_id)

        assert target.conflict == conflict
        assert target.action is None
        assert target.target_id is None
        assert target.target_name == "Calc"
        assert target.blocked is None

    @pytest.mark.parametrize(
        ("names_by_id", "target_id"),
        [
            pytest.param({"fn-1": "Other"}, "fn-1", id="the-same-id"),
            pytest.param({"here-1": "Calc"}, "here-1", id="the-same-name"),
        ],
    )
    def test_skip_points_at_the_item_here(
        self, names_by_id: dict[str, str], target_id: str
    ) -> None:
        target = _decide("fn-1", "Calc", "skip", names_by_id)

        assert target.action == "skip"
        assert target.target_id == target_id
        assert target.blocked is None

    def test_skip_with_several_same_name_items_points_at_the_first_listed(self) -> None:
        names_by_id = {"here-1": "Other", "here-2": "Calc", "here-3": "Calc"}

        target = _decide("backup-1", "Calc", "skip", names_by_id)

        assert target.action == "skip"
        assert target.target_id == "here-2"

    def test_overwrite_lands_on_the_same_id_item(self) -> None:
        target = _decide("fn-1", "New name", "overwrite", {"fn-1": "Old name"})

        assert target.action == "overwrite"
        assert target.target_id == "fn-1"
        assert target.target_name == "New name"
        assert target.blocked is None

    def test_overwrite_lands_on_the_same_name_item_when_no_id_matches(self) -> None:
        target = _decide("backup-1", "Calc", "overwrite", {"here-1": "Calc"})

        assert target.action == "overwrite"
        assert target.target_id == "here-1"
        assert target.target_name == "Calc"
        assert target.blocked is None

    def test_overwrite_is_blocked_when_the_name_belongs_to_another_item(self) -> None:
        target = _decide("fn-1", "Calc", "overwrite", {"fn-1": "Other", "fn-2": "Calc"})

        assert target.action == "blocked"
        assert target.blocked == "NAME_TAKEN"

    @pytest.mark.parametrize(
        ("source_id", "names_by_id"),
        [
            pytest.param("fn-1", {"fn-1": "Other"}, id="matched-by-id"),
            pytest.param("backup-1", {"fn-1": "Calc"}, id="matched-by-name"),
        ],
    )
    def test_overwrite_is_blocked_when_the_target_was_written_in_this_run(
        self, source_id: str, names_by_id: dict[str, str]
    ) -> None:
        target = _decide(source_id, "Calc", "overwrite", names_by_id, written_ids={"fn-1"})

        assert target.action == "blocked"
        assert target.blocked == "SAME_RUN"

    def test_overwrite_is_blocked_when_several_items_share_the_name_and_none_the_id(self) -> None:
        target = _decide("backup-1", "Calc", "overwrite", {"here-1": "Calc", "here-2": "Calc"})

        assert target.action == "blocked"
        assert target.blocked == "AMBIGUOUS_NAME"

    def test_rename_keeps_its_id_when_the_id_is_free(self) -> None:
        target = _decide("backup-1", "Calc", "rename", {"here-1": "Calc"})

        assert target.action == "rename"
        assert target.target_id == "backup-1"
        assert target.target_name == "Calc (2)"
        assert target.blocked is None

    def test_rename_draws_a_new_id_when_the_id_is_taken(self) -> None:
        names_by_id = {"fn-1": "Calc"}

        target = _decide("fn-1", "Calc", "rename", names_by_id)

        assert target.action == "rename"
        assert _is_new_id(target.target_id, "fn-1", names_by_id)

    def test_rename_takes_the_first_free_numbered_name(self) -> None:
        target = _decide("backup-1", "Calc", "rename", {"here-1": "Calc", "here-2": "Calc (2)"})

        assert target.action == "rename"
        assert target.target_name == "Calc (3)"

    def test_rename_keeps_the_name_when_that_name_is_free(self) -> None:
        target = _decide("fn-1", "Calc", "rename", {"fn-1": "Other"})

        assert target.action == "rename"
        assert target.target_name == "Calc"

    def test_an_item_without_an_id_matches_by_name_only_and_gets_a_new_id(self) -> None:
        names_by_id = {"here-1": "Calc"}

        created = _decide(None, "Fresh", "skip", names_by_id)
        renamed = _decide(None, "Calc", "rename", names_by_id)

        assert created.conflict is None
        assert created.action == "create"
        assert _is_new_id(created.target_id, None, names_by_id)
        assert renamed.conflict == "name"
        assert renamed.action == "rename"
        assert _is_new_id(renamed.target_id, None, names_by_id)

    @pytest.mark.parametrize(
        ("source_id", "resolution", "names_by_id", "kept_id"),
        [
            pytest.param("fn-1", "rename", {"fn-1": "Calc"}, None, id="rename-with-a-taken-id"),
            pytest.param(None, "skip", {"here-1": "Other"}, None, id="create-without-an-id"),
            pytest.param(None, "rename", {"here-1": "Calc"}, None, id="rename-without-an-id"),
            pytest.param("fn-1", "skip", {"fn-1": "Calc"}, "fn-1", id="skip"),
            pytest.param(None, "skip", {"here-1": "Calc"}, "here-1", id="skip-without-an-id"),
            pytest.param("fn-1", "overwrite", {"fn-1": "Calc"}, "fn-1", id="overwrite"),
            pytest.param(
                None, "overwrite", {"here-1": "Calc"}, "here-1", id="overwrite-without-an-id"
            ),
            pytest.param(
                "backup-1", "overwrite", {"here-1": "Other"}, "backup-1", id="create-with-a-free-id"
            ),
            pytest.param(
                "backup-1", "rename", {"here-1": "Calc"}, "backup-1", id="rename-with-a-free-id"
            ),
        ],
    )
    def test_a_new_id_is_drawn_only_when_the_item_needs_one(
        self,
        source_id: str | None,
        resolution: str,
        names_by_id: dict[str, str],
        kept_id: str | None,
    ) -> None:
        target = _decide(source_id, "Calc", resolution, names_by_id)

        if kept_id is None:
            assert _is_new_id(target.target_id, source_id, names_by_id)
        else:
            assert target.target_id == kept_id

    def test_names_compare_exactly_without_normalize(self) -> None:
        target = _decide("backup-1", "Calc", "skip", {"here-1": "calc"})

        assert target.conflict is None
        assert target.action == "create"

    @pytest.mark.parametrize(
        ("name", "name_here"),
        [
            pytest.param("Calc", "calc", id="lower-case-here"),
            pytest.param("calc", "Calc", id="lower-case-in-the-backup"),
        ],
    )
    def test_normalize_makes_names_that_differ_by_case_conflict(
        self, name: str, name_here: str
    ) -> None:
        target = _decide("backup-1", name, "skip", {"here-1": name_here}, normalize=str.casefold)

        assert target.conflict == "name"

    @pytest.mark.parametrize(
        ("name", "name_here"),
        [
            pytest.param(" Env ", "Env", id="spaces-in-the-backup"),
            pytest.param("Env", " Env ", id="spaces-here"),
        ],
    )
    def test_a_trimming_normalize_ignores_outer_spaces(self, name: str, name_here: str) -> None:
        target = _decide("backup-1", name, "skip", {"here-1": name_here}, normalize=str.strip)

        assert target.conflict == "name"

    def test_max_name_length_caps_the_renamed_name(self) -> None:
        target = _decide(
            "backup-1", _NAME_OF_32, "rename", {"here-1": _NAME_OF_32}, max_name_length=32
        )

        assert target.action == "rename"
        assert len(target.target_name) <= 32
        assert target.target_name.endswith(" (2)")

    @pytest.mark.parametrize(
        ("source_id", "name", "conflict"),
        [
            pytest.param("fn-1", "Other", "id", id="its-id"),
            pytest.param("backup-1", "Calc", "name", id="its-name"),
        ],
    )
    def test_items_written_earlier_in_the_run_count_as_here(
        self, source_id: str, name: str, conflict: str
    ) -> None:
        target = _decide(source_id, name, "skip", {"fn-1": "Calc"}, written_ids={"fn-1"})

        assert target.conflict == conflict
        assert target.action == "skip"
        assert target.target_id == "fn-1"

    def test_the_result_is_frozen_and_the_inputs_are_untouched(self) -> None:
        names_by_id = {"fn-1": "Calc", "fn-2": "Calc (2)"}
        written_ids = {"fn-2"}

        target = _decide("fn-1", "Calc", "rename", names_by_id, written_ids)

        assert isinstance(target, shared.ItemTarget)
        with pytest.raises(dataclasses.FrozenInstanceError):
            target.action = "skip"
        assert names_by_id == {"fn-1": "Calc", "fn-2": "Calc (2)"}
        assert written_ids == {"fn-2"}


class TestStoredVariableValues:
    """Each typed number a variable holds is stored in its wire form (REQ-3.1.3.14)."""

    def test_each_declared_number_takes_its_wire_form(self) -> None:
        variables = {
            "rate": {"type": "float", "value": 1e-07},
            "big": {"type": "integer", "value": 1234567890123456789},
            "whole": {"type": "float", "value": 30.0},
            "half": {"type": "float", "value": 2.5},
            "count": {"type": "integer", "value": 30},
            "loose": 1e-07,
        }

        assert shared.stored_variable_values(variables) == {
            "rate": {"type": "float", "value": "0.0000001"},
            "big": {"type": "integer", "value": "1234567890123456789"},
            "whole": {"type": "float", "value": "30.0"},
            "half": {"type": "float", "value": 2.5},
            "count": {"type": "integer", "value": 30},
            "loose": 1e-07,
        }


class TestBatchDelete:
    """shared.batch_delete: one pass over the IDs, each refusal kept by its index."""

    def test_deletes_each_id_in_order(self) -> None:
        seen: list[str] = []

        def delete(item_id: str) -> bool:
            seen.append(item_id)
            return True

        assert shared.batch_delete(["a", "b"], delete, "Suite") == {
            "deleted": ["a", "b"],
            "failed": [],
        }
        assert seen == ["a", "b"]

    def test_names_a_missing_id_by_kind_and_index(self) -> None:
        result = shared.batch_delete(["here", "gone"], lambda item_id: item_id == "here", "Test")

        assert result == {
            "deleted": ["here"],
            "failed": [{"index": 1, "error": "Test with ID 'gone' not found"}],
        }

    @pytest.mark.parametrize("item", NOT_ID_ITEMS)
    def test_keeps_an_item_that_is_not_an_id_and_goes_on(self, item: Any) -> None:
        seen: list[str] = []

        def delete(item_id: str) -> bool:
            seen.append(item_id)
            return True

        assert shared.batch_delete([item, "free"], delete, "Block") == {
            "deleted": ["free"],
            "failed": [{"index": 0, "error": NOT_AN_ID_ITEM}],
        }
        assert seen == ["free"]

    @pytest.mark.parametrize("error", [ConflictException("Busy"), ValueError("Busy")])
    def test_keeps_a_refusal_and_goes_on(self, error: Exception) -> None:
        def delete(item_id: str) -> bool:
            if item_id == "busy":
                raise error
            return True

        assert shared.batch_delete(["busy", "free"], delete, "Regression") == {
            "deleted": ["free"],
            "failed": [{"index": 0, "error": "Busy"}],
        }


class TestBatchClone:
    """shared.batch_clone: one pass over the IDs, each refusal kept by its index."""

    def test_clones_each_id_in_order(self) -> None:
        seen: list[str] = []

        def clone(item_id: str) -> dict[str, Any]:
            seen.append(item_id)
            return {"id": f"{item_id}-copy", "name": "Copy"}

        assert shared.batch_clone(["a", "b"], clone, "Suite") == {
            "cloned": [
                {"original_id": "a", "cloned_id": "a-copy"},
                {"original_id": "b", "cloned_id": "b-copy"},
            ],
            "failed": [],
        }
        assert seen == ["a", "b"]

    def test_names_a_missing_id_by_kind_and_index(self) -> None:
        def clone(item_id: str) -> dict[str, Any] | None:
            return {"id": "here-copy"} if item_id == "here" else None

        assert shared.batch_clone(["here", "gone"], clone, "Regression") == {
            "cloned": [{"original_id": "here", "cloned_id": "here-copy"}],
            "failed": [{"index": 1, "error": "Regression with ID 'gone' not found"}],
        }

    @pytest.mark.parametrize("item", NOT_ID_ITEMS)
    def test_keeps_an_item_that_is_not_an_id_and_goes_on(self, item: Any) -> None:
        seen: list[str] = []

        def clone(item_id: str) -> dict[str, Any]:
            seen.append(item_id)
            return {"id": f"{item_id}-copy"}

        assert shared.batch_clone([item, "free"], clone, "Suite") == {
            "cloned": [{"original_id": "free", "cloned_id": "free-copy"}],
            "failed": [{"index": 0, "error": NOT_AN_ID_ITEM}],
        }
        assert seen == ["free"]

    @pytest.mark.parametrize("error", [ConflictException("Taken"), ValueError("Taken")])
    def test_keeps_a_refusal_and_goes_on(self, error: Exception) -> None:
        def clone(item_id: str) -> dict[str, Any]:
            if item_id == "taken":
                raise error
            return {"id": f"{item_id}-copy"}

        assert shared.batch_clone(["taken", "free"], clone, "Suite") == {
            "cloned": [{"original_id": "free", "cloned_id": "free-copy"}],
            "failed": [{"index": 0, "error": "Taken"}],
        }
