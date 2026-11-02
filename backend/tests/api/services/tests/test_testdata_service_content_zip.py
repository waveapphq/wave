"""Download of one Test Data file and of a whole folder as a zip."""

import io
import re
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from tests.api.services.tests.conftest import seed_folder, store, testdata_root
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services import shared
from wavecore.api.services.tests import testdata_service


def _zip_names(payload: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        return sorted(archive.namelist())


def _seed_tree(test_id: str) -> None:
    testdata_service.create_folder(test_id, "fixtures")
    testdata_service.create_folder(test_id, "fixtures/data")
    store(test_id, "top.csv", b"top")
    store(test_id, "fixtures/data/inner.csv", b"inner")


class TestContentPath:
    """The route serves the resolved path straight off disk."""

    def test_a_file_resolves_to_its_path(self, test_id: str) -> None:
        """The returned path is the file inside the test's folder."""
        store(test_id, "customers.csv", b"id\n")

        resolved = testdata_service.content_path(test_id, "customers.csv")

        assert resolved == testdata_root(test_id) / "customers.csv"
        assert resolved.read_bytes() == b"id\n"

    def test_a_nested_file_resolves(self, test_id: str) -> None:
        """Nesting is preserved."""
        _seed_tree(test_id)

        resolved = testdata_service.content_path(test_id, "fixtures/data/inner.csv")

        assert resolved.read_bytes() == b"inner"

    def test_a_missing_file_is_not_found(self, test_id: str) -> None:
        """The message names the path that was asked for."""
        with pytest.raises(NotFoundException, match=r"^Test data entry not found: absent\.csv$"):
            testdata_service.content_path(test_id, "absent.csv")

    def test_a_folder_is_not_downloadable_content(self, test_id: str) -> None:
        """A folder is served by the zip endpoint, not the content endpoint."""
        seed_folder(test_id, "fixtures")

        with pytest.raises(NotFoundException, match=r"^Test data entry not found: fixtures$"):
            testdata_service.content_path(test_id, "fixtures")

    def test_an_unsafe_path_is_refused(self, test_id: str) -> None:
        """The safe-path rule applies before anything is opened."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./secrets$"):
            testdata_service.content_path(test_id, "../secrets")

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.content_path("no-such-test", "a.csv")


class TestZipWholeFolder:
    """An empty relative path zips the test's whole folder."""

    def test_every_file_is_written_into_the_sink(self, test_id: str) -> None:
        """The archive carries the files by their path inside the test's folder."""
        _seed_tree(test_id)
        sink = io.BytesIO()

        testdata_service.zip_entry(test_id, "", sink)

        assert _zip_names(sink.getvalue()) == ["fixtures/data/inner.csv", "top.csv"]

    def test_the_file_bytes_survive_the_round_trip(self, test_id: str) -> None:
        """The archived bytes are the stored bytes."""
        _seed_tree(test_id)
        sink = io.BytesIO()

        testdata_service.zip_entry(test_id, "", sink)

        with zipfile.ZipFile(io.BytesIO(sink.getvalue())) as archive:
            assert archive.read("fixtures/data/inner.csv") == b"inner"

    def test_the_download_name_uses_the_test_name(self, test_id: str) -> None:
        """The root zip is named after the test."""
        _seed_tree(test_id)

        name = testdata_service.zip_entry(test_id, "", io.BytesIO())

        assert name == "testdata-Fixture-Carrier.zip"

    def test_the_download_name_keeps_the_letters_of_any_language(self) -> None:
        """A Test named outside ASCII gives its archive that name (REQ-4.6.9)."""
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "हिंदी परीक्षण"})
        store(str(created["id"]), "a.csv", b"x")

        name = testdata_service.zip_entry(str(created["id"]), "", io.BytesIO())

        assert name == "testdata-हिंदी-परीक्षण.zip"

    def test_the_download_name_is_always_filesystem_safe(self) -> None:
        """A name made only of separators still yields a usable file name."""
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "///"})
        store(str(created["id"]), "a.csv", b"x")

        name = testdata_service.zip_entry(str(created["id"]), "", io.BytesIO())

        assert re.match(r"^testdata-[A-Za-z0-9._-]+\.zip$", name)


class TestZipSubfolder:
    """A folder's relative path zips just that folder."""

    def test_only_the_folders_files_are_archived(self, test_id: str) -> None:
        """Files outside the folder stay out of the archive."""
        _seed_tree(test_id)
        sink = io.BytesIO()

        testdata_service.zip_entry(test_id, "fixtures", sink)

        assert _zip_names(sink.getvalue()) == ["fixtures/data/inner.csv"]

    def test_the_download_name_uses_the_folder_name(self, test_id: str) -> None:
        """A nested folder is named after its own final segment."""
        _seed_tree(test_id)

        name = testdata_service.zip_entry(test_id, "fixtures/data", io.BytesIO())

        assert name == "testdata-data.zip"

    def test_a_file_is_not_a_folder(self, test_id: str) -> None:
        """The zip endpoint refuses a file."""
        _seed_tree(test_id)

        with pytest.raises(ValidationException, match=r"^Not a folder: top\.csv$"):
            testdata_service.zip_entry(test_id, "top.csv", io.BytesIO())

    def test_a_missing_folder_is_not_found(self, test_id: str) -> None:
        """The message names the path that was asked for."""
        _seed_tree(test_id)

        with pytest.raises(NotFoundException, match=r"^Test data entry not found: absent$"):
            testdata_service.zip_entry(test_id, "absent", io.BytesIO())

    def test_an_unsafe_path_is_refused(self, test_id: str) -> None:
        """The safe-path rule applies to the zip target."""
        _seed_tree(test_id)

        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./out$"):
            testdata_service.zip_entry(test_id, "../out", io.BytesIO())

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.zip_entry("no-such-test", "", io.BytesIO())


class TestZipGoesThroughTheSharedBuilder:
    """Every archive in the product is assembled by shared.build_export_zip."""

    def test_the_shared_builder_receives_path_entries_and_the_sink(self, test_id: str) -> None:
        """One call, Path contents, and the caller's sink."""
        _seed_tree(test_id)
        sink = io.BytesIO()

        with patch.object(shared, "build_export_zip", wraps=shared.build_export_zip) as spy:
            testdata_service.zip_entry(test_id, "", sink)

        assert spy.call_count == 1
        call = spy.call_args
        files = call.args[0] if call.args else call.kwargs["files"]
        assert sorted(arcname for arcname, _ in files) == [
            "fixtures/data/inner.csv",
            "top.csv",
        ]
        assert all(isinstance(content, Path) for _, content in files)
        assert call.kwargs["sink"] is sink
