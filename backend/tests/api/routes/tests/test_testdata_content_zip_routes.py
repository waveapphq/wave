"""Unit tests for the test data content and zip routes (REQ-5.2.4.12).

GET /tests/{test_id}/testdata/content/{path} serves one file from disk;
GET /tests/{test_id}/testdata/zip?path= serves a zip of the whole folder or of
one subfolder, built into a temp file that the background task removes.
"""

import io
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.api.download_name_helpers import ENTITY_NAME, assert_whole_name
from tests.api.routes.tests.conftest import (
    assert_error,
    create_test_document,
    seed_file,
)
from wavecore.api.services.tests import testdata_service


class TestContentRoute:
    """The file is served from disk with the download headers."""

    def test_default_disposition_is_attachment(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"id,name\n1,ada\n")

        response = client.get(f"/tests/{test_id}/testdata/content/customers.csv")

        assert response.status_code == 200
        assert response.content == b"id,name\n1,ada\n"
        assert response.headers["content-disposition"].startswith("attachment;")

    def test_a_plain_name_is_sent_in_the_plain_form_only(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"x")

        response = client.get(f"/tests/{test_id}/testdata/content/customers.csv")

        assert response.headers["content-disposition"] == 'attachment; filename="customers.csv"'

    def test_non_ascii_name_is_percent_encoded_with_an_ascii_fallback(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "déjà.csv", b"x")

        response = client.get(f"/tests/{test_id}/testdata/content/d%C3%A9j%C3%A0.csv")

        disposition = response.headers["content-disposition"]
        assert response.status_code == 200
        assert "filename*=UTF-8''d%C3%A9j%C3%A0.csv" in disposition
        assert disposition.isascii()

    def test_nested_path_is_served(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "fixtures/orders.json", b"{}")

        response = client.get(f"/tests/{test_id}/testdata/content/fixtures/orders.json")

        assert response.status_code == 200
        assert response.content == b"{}"

    def test_explicit_inline_disposition(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "report.html", b"<html></html>")

        response = client.get(f"/tests/{test_id}/testdata/content/report.html?disposition=inline")

        assert response.status_code == 200
        assert response.headers["content-disposition"].startswith("inline;")

    def test_hardening_headers_are_present(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"x")

        response = client.get(f"/tests/{test_id}/testdata/content/customers.csv")

        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "no-store"

    def test_invalid_disposition_is_rejected(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"x")

        response = client.get(f"/tests/{test_id}/testdata/content/customers.csv?disposition=bogus")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid disposition 'bogus': valid values are attachment, inline",
        )

    def test_unknown_entry_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.get(f"/tests/{test_id}/testdata/content/ghost.csv")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Test data entry not found: ghost.csv",
        )

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.get(f"/tests/{missing}/testdata/content/customers.csv")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )


def _zip_names(payload: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        return sorted(archive.namelist())


class TestZipRoute:
    """The whole folder or one subfolder is served as a zip."""

    def test_whole_folder_zip(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        seed_file(test_id, "fixtures/orders.json", b"{}")

        response = client.get(f"/tests/{test_id}/testdata/zip")

        assert response.status_code == 200
        assert _zip_names(response.content) == ["customers.csv", "fixtures/orders.json"]

    def test_empty_path_query_means_the_whole_folder(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.get(f"/tests/{test_id}/testdata/zip?path=")

        assert response.status_code == 200
        assert _zip_names(response.content) == ["customers.csv"]

    def test_whole_folder_zip_is_named_after_the_test(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.get(f"/tests/{test_id}/testdata/zip")

        assert 'filename="testdata-Checkout-Flow.zip"' in response.headers["content-disposition"]

    def test_subfolder_zip_holds_only_that_subtree(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        seed_file(test_id, "fixtures/orders.json", b"{}")
        seed_file(test_id, "fixtures/nested/deep.txt", b"deep")

        response = client.get(f"/tests/{test_id}/testdata/zip?path=fixtures")

        assert response.status_code == 200
        assert _zip_names(response.content) == [
            "fixtures/nested/deep.txt",
            "fixtures/orders.json",
        ]

    def test_subfolder_zip_is_named_after_the_folder(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "fixtures/orders.json", b"{}")

        response = client.get(f"/tests/{test_id}/testdata/zip?path=fixtures")

        assert 'filename="testdata-fixtures.zip"' in response.headers["content-disposition"]

    def test_zip_media_type(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.get(f"/tests/{test_id}/testdata/zip")

        assert response.headers["content-type"].startswith("application/zip")

    def test_temp_file_is_removed_after_the_response(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        spool = tmp_path / "spool"
        spool.mkdir()
        created = create_test_document("Spooled-Test")
        seed_file(created["id"], "customers.csv", b"rows")
        monkeypatch.setattr(tempfile, "tempdir", str(spool))

        response = client.get(f"/tests/{created['id']}/testdata/zip")

        assert response.status_code == 200
        assert list(spool.iterdir()) == []

    def test_unknown_folder_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.get(f"/tests/{test_id}/testdata/zip?path=ghost")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Test data entry not found: ghost",
        )

    def test_a_file_target_is_rejected(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.get(f"/tests/{test_id}/testdata/zip?path=customers.csv")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Not a folder: customers.csv",
        )

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.get(f"/tests/{missing}/testdata/zip")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )


class TestZipKeepsTheWholeFileName:
    """A zip name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    def test_a_name_outside_plain_ascii_is_sent_whole(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        name = f"{ENTITY_NAME}.zip"
        zip_entry = testdata_service.zip_entry

        def named(*args: Any, **kwargs: Any) -> str:
            zip_entry(*args, **kwargs)
            return name

        monkeypatch.setattr(testdata_service, "zip_entry", named)

        response = client.get(f"/tests/{test_id}/testdata/zip")

        assert_whole_name(response, name)
        assert _zip_names(response.content) == ["customers.csv"]
