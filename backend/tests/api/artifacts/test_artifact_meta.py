"""Unit tests for GET /artifacts/meta/{artifact_id}.

Returns the ArtifactMeta shape plus an on-demand ``checksum_sha256``.
Path-shaped identifiers are validated for containment before any filesystem
access: traversal, absolute, and malformed ids are rejected with 400.

The content type an artifact reports and is downloaded with comes from WAVE's
own file-type table, never from the WAVE host's file-type configuration
(REQ-3.4.3.10); a compressed artifact reports the type of its logical name.
"""

import hashlib
import mimetypes
import re
import uuid
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import (
    make_execution_dir,
    seed_execution_record,
    write_artifact_file,
)

_INVALID_ID_RE = r"^Invalid artifact identifier: .+$"
_NOT_FOUND_RE = r"^Artifact .+ not found$"


@pytest.fixture
def host_file_types(monkeypatch: pytest.MonkeyPatch) -> Mock:
    """Spy on the host's file-type lookup; the lookup itself still answers."""
    spy = Mock(wraps=mimetypes)
    monkeypatch.setattr(mimetypes, "guess_type", spy.guess_type)
    monkeypatch.setattr(mimetypes, "init", spy.init)
    return spy


class TestGetArtifactMeta:
    """Metadata + integrity checksum for a single artifact."""

    def test_meta_returns_artifact_meta_with_checksum(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        content = b"hello artifact world"
        write_artifact_file(directory, "logs/service.log", content)

        response = client.get(f"/artifacts/meta/{dir_name}/logs/service.log")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {
            "id",
            "execution_id",
            "name",
            "path",
            "size_bytes",
            "content_type",
            "compression",
            "created_at",
            "checksum_sha256",
        }
        assert body["id"] == f"{dir_name}/logs/service.log"
        assert body["execution_id"] == execution_id
        assert body["name"] == "service.log"
        assert body["path"] == "logs/service.log"
        assert body["compression"] is None
        assert body["size_bytes"] == len(content)
        assert body["checksum_sha256"] == hashlib.sha256(content).hexdigest()

    def test_meta_parses_compressed_filename(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "error.json.gz", b"gz")

        response = client.get(f"/artifacts/meta/{dir_name}/error.json.gz")

        body = response.json()
        assert body["name"] == "error.json"
        assert body["compression"] == "gzip"
        assert "version" not in body

    def test_meta_checksum_reflects_current_bytes(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"first")
        write_artifact_file(directory, "data.txt", b"second")

        response = client.get(f"/artifacts/meta/{dir_name}/data.txt")

        assert response.json()["checksum_sha256"] == hashlib.sha256(b"second").hexdigest()


class TestArtifactContentType:
    """REQ-3.4.3.10: an artifact's type comes from WAVE's own table, never the host's."""

    def test_meta_reports_the_table_type(self, client: TestClient, host_file_types: Mock) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "report.ts", b"export {};\n")

        response = client.get(f"/artifacts/meta/{dir_name}/report.ts")

        assert response.json()["content_type"] == "text/typescript"
        assert host_file_types.mock_calls == []

    def test_meta_reports_an_unknown_extension_as_octet_stream(
        self, client: TestClient, host_file_types: Mock
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "payload.unknownext", b"\x00\x01")

        response = client.get(f"/artifacts/meta/{dir_name}/payload.unknownext")

        assert response.json()["content_type"] == "application/octet-stream"
        assert host_file_types.mock_calls == []

    def test_meta_reports_a_compressed_artifact_by_its_logical_name(
        self, client: TestClient, host_file_types: Mock
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "report.json.gz", b"gz")

        response = client.get(f"/artifacts/meta/{dir_name}/report.json.gz")

        body = response.json()
        assert body["name"] == "report.json"
        assert body["compression"] == "gzip"
        assert body["content_type"] == "application/json"
        assert host_file_types.mock_calls == []

    def test_a_removed_artifact_is_listed_with_the_table_type(
        self, client: TestClient, host_file_types: Mock
    ) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.ts", b"export {};\n")
        client.delete(f"/artifacts/{dir_name}/report.ts")

        response = client.get(
            "/artifacts", params={"execution_id": execution_id, "include_removed": "true"}
        )

        items = response.json()["data"]
        assert [item["content_type"] for item in items] == ["text/typescript"]
        assert items[0]["removed_at"]
        assert host_file_types.mock_calls == []

    def test_a_download_is_served_with_the_table_type(
        self, client: TestClient, host_file_types: Mock
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "values.yaml", b"k: v\n")

        response = client.get(f"/artifacts/content/{dir_name}/values.yaml")

        assert response.content == b"k: v\n"
        assert response.headers["content-type"] == "application/yaml"
        assert host_file_types.mock_calls == []


class TestCompressedArtifactContentType:
    """REQ-3.4.3.10: a compressed artifact carries the same label on every WAVE host."""

    @pytest.mark.parametrize("file_name", ["data.csv.zip", "bundle.zip"])
    def test_meta_reports_a_zip_artifact_as_zip(
        self, client: TestClient, host_file_types: Mock, file_name: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, file_name, b"PK")

        response = client.get(f"/artifacts/meta/{dir_name}/{file_name}")

        assert response.json()["content_type"] == "application/zip"
        assert host_file_types.mock_calls == []

    @pytest.mark.parametrize("file_name", ["data.csv.zip", "bundle.zip"])
    def test_a_zip_artifact_is_downloaded_as_zip(
        self, client: TestClient, host_file_types: Mock, file_name: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, file_name, b"PK")

        response = client.get(f"/artifacts/content/{dir_name}/{file_name}")

        assert response.content == b"PK"
        assert response.headers["content-type"] == "application/zip"
        assert host_file_types.mock_calls == []

    def test_a_gzip_artifact_is_downloaded_with_the_type_of_the_file_inside(
        self, client: TestClient, host_file_types: Mock
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "report.json.gz", b"gz")

        response = client.get(f"/artifacts/content/{dir_name}/report.json.gz")

        assert response.content == b"gz"
        assert response.headers["content-type"] == "application/json"
        assert host_file_types.mock_calls == []


class TestGetArtifactMetaErrors:
    """400 on invalid identifiers, 404 on missing artifacts."""

    def test_traversal_identifier_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/meta/..%2Fescape.txt")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert re.match(_INVALID_ID_RE, message)
        assert message == "Invalid artifact identifier: ../escape.txt"

    def test_nested_traversal_identifier_rejected(self, client: TestClient) -> None:
        dir_name, _execution_id, _directory = make_execution_dir()

        response = client.get(f"/artifacts/meta/{dir_name}/..%2F..%2Fescape.txt")

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_absolute_identifier_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/meta/%2Fetc%2Fpasswd")

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_malformed_identifier_without_relative_path_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/meta/just-a-directory-name")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert message == "Invalid artifact identifier: just-a-directory-name"

    def test_missing_artifact_returns_404_with_identifier(self, client: TestClient) -> None:
        dir_name, _execution_id, _directory = make_execution_dir()

        response = client.get(f"/artifacts/meta/{dir_name}/missing.txt")

        assert response.status_code == 404
        message = response.json()["error"]["message"]
        assert re.match(_NOT_FOUND_RE, message)
        assert message == f"Artifact {dir_name}/missing.txt not found"

    def test_missing_execution_dir_returns_404(self, client: TestClient) -> None:
        ghost_dir = f"20260609-120000-{uuid.uuid4()}"

        response = client.get(f"/artifacts/meta/{ghost_dir}/file.txt")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == f"Artifact {ghost_dir}/file.txt not found"
