"""Unit tests for a test's own files traveling through the import archive.

Covers the ``testdata/`` partition in ``_parse_zip_file``, the ``testdata_files``
count in the import preview, and the files ``import_tests`` writes under the
imported test's new id (REQ-3.4.3.2, REQ-5.2.4.9).
"""

import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.tests import service as test_service

_OLD_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_OLD_ID = "22222222-2222-2222-2222-222222222222"


def _document(name: str, test_id: str) -> dict[str, Any]:
    """A minimal exported test document."""
    return {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
        "description": "",
        "workflow": {"nodes": [], "edges": []},
        "variables": {},
        "metadata": {},
    }


def _archive(
    documents: list[tuple[str, dict[str, Any]]],
    members: list[tuple[str, bytes]] | None = None,
) -> bytes:
    """Build an export-shaped archive from documents plus raw members."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for filename, data in documents:
            if filename.endswith(".json"):
                zf.writestr(filename, json.dumps(data))
            else:
                zf.writestr(filename, yaml.dump(data))
        for member, payload in members or []:
            zf.writestr(member, payload)
    return buf.getvalue()


def _seed_testdata(test_id: str, files: dict[str, bytes]) -> Path:
    """Write files into a test's own test data folder."""
    root = storage_paths.get_test_testdata_path(test_id)
    for rel, payload in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    return root


def _testdata_tree(test_id: str) -> dict[str, bytes]:
    """Every file in a test's test data folder, keyed by relative posix path."""
    root = storage_paths.get_test_testdata_path(test_id)
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _zone_test_ids() -> set[str]:
    """The test ids that own a folder in the test data zone."""
    zone = storage_paths.get_testdata_storage_path()
    if not zone.exists():
        return set()
    return {p.name for p in zone.iterdir() if p.is_dir()}


def _anchored(message: str) -> str:
    """An exact-match pattern for pytest.raises."""
    return rf"^{re.escape(message)}$"


class TestParseZipFilePartition:
    """_parse_zip_file separates testdata members from the document scan."""

    def test_returns_documents_and_files_keyed_by_the_old_test_id(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [
                (f"testdata/{_OLD_ID}/a.txt", b"alpha"),
                (f"testdata/{_OLD_ID}/sub/b.csv", b"id,name\n"),
            ],
        )

        documents, files_by_old_id = _parse_zip_file(content)

        assert [d[1]["name"] for d in documents] == ["T1"]
        assert dict(files_by_old_id[_OLD_ID]) == {
            "a.txt": b"alpha",
            "sub/b.csv": b"id,name\n",
        }

    def test_a_fixture_with_a_document_extension_is_never_a_test(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [
                (f"testdata/{_OLD_ID}/rows.json", json.dumps({"name": "Sneaky JSON"}).encode()),
                (f"testdata/{_OLD_ID}/conf.yaml", yaml.dump({"name": "Sneaky YAML"}).encode()),
                (f"testdata/{_OLD_ID}/conf.yml", yaml.dump({"name": "Sneaky YML"}).encode()),
            ],
        )

        documents, files_by_old_id = _parse_zip_file(content)

        assert [d[1]["name"] for d in documents] == ["T1"]
        assert set(dict(files_by_old_id[_OLD_ID])) == {"rows.json", "conf.yaml", "conf.yml"}

    def test_files_of_several_tests_stay_apart(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive(
            [
                ("T1.yaml", _document("T1", _OLD_ID)),
                ("T2.yaml", _document("T2", _OTHER_OLD_ID)),
            ],
            [
                (f"testdata/{_OLD_ID}/one.txt", b"one"),
                (f"testdata/{_OTHER_OLD_ID}/two.txt", b"two"),
            ],
        )

        documents, files_by_old_id = _parse_zip_file(content)

        assert len(documents) == 2
        assert dict(files_by_old_id[_OLD_ID]) == {"one.txt": b"one"}
        assert dict(files_by_old_id[_OTHER_OLD_ID]) == {"two.txt": b"two"}

    def test_directory_entries_under_testdata_are_not_files(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [
                (f"testdata/{_OLD_ID}/sub/", b""),
                (f"testdata/{_OLD_ID}/sub/b.txt", b"beta"),
            ],
        )

        _documents, files_by_old_id = _parse_zip_file(content)

        assert dict(files_by_old_id[_OLD_ID]) == {"sub/b.txt": b"beta"}

    def test_a_test_without_files_gets_no_entry(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive([("T1.yaml", _document("T1", _OLD_ID))])

        documents, files_by_old_id = _parse_zip_file(content)

        assert len(documents) == 1
        assert _OLD_ID not in files_by_old_id

    def test_an_archive_of_files_only_has_no_importable_documents(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        content = _archive([], [(f"testdata/{_OLD_ID}/a.yaml", b"name: Sneaky\n")])

        with pytest.raises(
            ValidationException, match=_anchored("ZIP archive contains no importable files")
        ):
            _parse_zip_file(content)


class TestArchiveEntryValidation:
    """A bad testdata member is fatal for the whole archive."""

    def test_validate_refuses_a_parent_segment(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        member = f"testdata/{_OLD_ID}/../escape.txt"
        content = _archive([("T1.yaml", _document("T1", _OLD_ID))], [(member, b"x")])

        with pytest.raises(
            ValidationException, match=_anchored(f"Invalid test data path: {member}")
        ):
            validate_test_import(content, "tests-export.zip")

    def test_validate_refuses_an_empty_segment(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        member = f"testdata/{_OLD_ID}//leading.txt"
        content = _archive([("T1.yaml", _document("T1", _OLD_ID))], [(member, b"x")])

        with pytest.raises(
            ValidationException, match=_anchored(f"Invalid test data path: {member}")
        ):
            validate_test_import(content, "tests-export.zip")

    def test_validate_refuses_a_segment_that_breaks_the_name_rule(self) -> None:
        """A path the relative-path rule accepts can still carry an unusable name."""
        from wavecore.api.services.tests.service import validate_test_import

        member = f"testdata/{_OLD_ID}/{'a' * 256}.txt"
        content = _archive([("T1.yaml", _document("T1", _OLD_ID))], [(member, b"x")])

        with pytest.raises(
            ValidationException, match=_anchored(f"Invalid test data path: {member}")
        ):
            validate_test_import(content, "tests-export.zip")

    def test_import_refuses_a_parent_segment(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        member = f"testdata/{_OLD_ID}/../escape.txt"
        content = _archive([("T1.yaml", _document("T1", _OLD_ID))], [(member, b"x")])

        with pytest.raises(
            ValidationException, match=_anchored(f"Invalid test data path: {member}")
        ):
            import_tests(content, "tests-export.zip")

    def test_a_refused_archive_writes_no_files(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        member = f"testdata/{_OLD_ID}/../escape.txt"
        content = _archive([("T1.yaml", _document("T1", _OLD_ID))], [(member, b"x")])

        with pytest.raises(ValidationException):
            import_tests(content, "tests-export.zip")

        assert _zone_test_ids() == set()
        assert test_service._list_all_tests() == []


class TestImportPreviewTestDataCount:
    """The import preview reports how many files each test carries."""

    def test_preview_counts_the_files_of_each_test(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = _archive(
            [
                ("T1.yaml", _document("T1", _OLD_ID)),
                ("T2.yaml", _document("T2", _OTHER_OLD_ID)),
            ],
            [
                (f"testdata/{_OLD_ID}/a.txt", b"a"),
                (f"testdata/{_OLD_ID}/sub/b.txt", b"b"),
                (f"testdata/{_OTHER_OLD_ID}/c.txt", b"c"),
            ],
        )

        result = validate_test_import(content, "tests-export.zip")

        by_name = {t["name"]: t for t in result["tests"]}
        assert by_name["T1"]["testdata_files"] == 2
        assert by_name["T2"]["testdata_files"] == 1

    def test_preview_reports_zero_for_a_test_without_files(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = _archive(
            [
                ("T1.yaml", _document("T1", _OLD_ID)),
                ("T2.yaml", _document("T2", _OTHER_OLD_ID)),
            ],
            [(f"testdata/{_OLD_ID}/a.txt", b"a")],
        )

        result = validate_test_import(content, "tests-export.zip")

        by_name = {t["name"]: t for t in result["tests"]}
        assert by_name["T2"]["testdata_files"] == 0

    def test_a_bare_document_reports_zero(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump(_document("Bare", _OLD_ID)).encode()

        result = validate_test_import(content, "Bare.yaml")

        assert result["tests"][0]["testdata_files"] == 0


class TestImportWritesTestDataFiles:
    """import_tests writes the archive's files under the imported test's id."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_files_land_under_the_new_id(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [
                (f"testdata/{_OLD_ID}/a.txt", b"alpha"),
                (f"testdata/{_OLD_ID}/sub/b.csv", b"id,name\n"),
            ],
        )

        result = import_tests(content, "tests-export.zip")

        new_id = result["imported"][0]["id"]
        assert new_id != _OLD_ID
        assert _testdata_tree(new_id) == {"a.txt": b"alpha", "sub/b.csv": b"id,name\n"}

    def test_the_archive_id_never_becomes_a_folder(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [(f"testdata/{_OLD_ID}/a.txt", b"alpha")],
        )

        result = import_tests(content, "tests-export.zip")

        assert _zone_test_ids() == {result["imported"][0]["id"]}

    def test_a_bare_document_creates_no_folder(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump(_document("Bare", _OLD_ID)).encode()

        import_tests(content, "Bare.yaml")

        assert _zone_test_ids() == set()

    def test_overwrite_replaces_the_existing_files(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"stale.txt": b"stale", "keep/old.csv": b"old"})

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [(f"testdata/{_OLD_ID}/fresh.txt", b"fresh")],
        )

        result = import_tests(content, "tests-export.zip", {"T1": "overwrite"})

        assert result["imported"][0]["id"] == existing["id"]
        assert _testdata_tree(existing["id"]) == {"fresh.txt": b"fresh"}

    def test_skip_writes_nothing(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"mine.txt": b"mine"})

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [(f"testdata/{_OLD_ID}/fresh.txt", b"fresh")],
        )

        result = import_tests(content, "tests-export.zip", {"T1": "skip"})

        assert result["imported"] == []
        assert _testdata_tree(existing["id"]) == {"mine.txt": b"mine"}
        assert _zone_test_ids() == {existing["id"]}

    def test_rename_writes_under_the_new_id(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"mine.txt": b"mine"})

        content = _archive(
            [("T1.yaml", _document("T1", _OLD_ID))],
            [(f"testdata/{_OLD_ID}/fresh.txt", b"fresh")],
        )

        result = import_tests(content, "tests-export.zip", {"T1": "rename"})

        new_id = result["imported"][0]["id"]
        assert new_id != existing["id"]
        assert _testdata_tree(new_id) == {"fresh.txt": b"fresh"}
        assert _testdata_tree(existing["id"]) == {"mine.txt": b"mine"}
