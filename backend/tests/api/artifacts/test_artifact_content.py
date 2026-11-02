"""Unit tests for GET /artifacts/content/{artifact_id}.

Streams raw artifact bytes with a guessed Content-Type and an attachment
Content-Disposition. Supports HTTP Range requests (206 + Content-Range) and
rejects unsatisfiable ranges with 416 ``Invalid range``.
"""

import re

import pytest
from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import make_execution_dir, write_artifact_file
from tests.api.download_name_helpers import ENTITY_NAME, assert_whole_name

_INVALID_ID_RE = r"^Invalid artifact identifier: .+$"


class TestDownloadArtifactContent:
    """Full-content downloads."""

    def test_full_download_returns_bytes_and_headers(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        content = b"0123456789"
        write_artifact_file(directory, "data.txt", content)

        response = client.get(f"/artifacts/content/{dir_name}/data.txt")

        assert response.status_code == 200
        assert response.content == content
        assert response.headers["content-type"].startswith("text/plain")
        assert response.headers["content-disposition"] == 'attachment; filename="data.txt"'

    def test_content_type_guessed_from_extension(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "result.json", b"{}")

        response = client.get(f"/artifacts/content/{dir_name}/result.json")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")

    def test_unknown_extension_served_as_octet_stream(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "no_extension_file", b"\x00\x01")

        response = client.get(f"/artifacts/content/{dir_name}/no_extension_file")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/octet-stream")

    def test_nested_artifact_download(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "logs/service.log", b"log line\n")

        response = client.get(f"/artifacts/content/{dir_name}/logs/service.log")

        assert response.status_code == 200
        assert response.content == b"log line\n"
        assert response.headers["content-disposition"] == 'attachment; filename="service.log"'


class TestContentDisposition:
    """The ``disposition`` query param (attachment default, inline opt-in)."""

    def test_explicit_attachment_disposition(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(f"/artifacts/content/{dir_name}/data.txt?disposition=attachment")

        assert response.status_code == 200
        assert response.headers["content-disposition"] == 'attachment; filename="data.txt"'

    def test_inline_disposition_renders_in_browser(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "report.v1.html", b"<html></html>")

        response = client.get(f"/artifacts/content/{dir_name}/report.v1.html?disposition=inline")

        assert response.status_code == 200
        assert response.headers["content-disposition"] == 'inline; filename="report.v1.html"'
        assert response.headers["content-type"].startswith("text/html")

    def test_invalid_disposition_rejected(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(f"/artifacts/content/{dir_name}/data.txt?disposition=bogus")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid disposition 'bogus': valid values are attachment, inline"
        )


class TestRangeRequests:
    """Partial-content downloads via the Range header."""

    def test_bounded_range_returns_206_with_content_range(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(
            f"/artifacts/content/{dir_name}/data.txt",
            headers={"Range": "bytes=2-5"},
        )

        assert response.status_code == 206
        assert response.content == b"2345"
        assert response.headers["content-range"] == "bytes 2-5/10"

    def test_open_ended_range_returns_tail(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(
            f"/artifacts/content/{dir_name}/data.txt",
            headers={"Range": "bytes=7-"},
        )

        assert response.status_code == 206
        assert response.content == b"789"
        assert response.headers["content-range"] == "bytes 7-9/10"

    def test_range_end_clamped_to_file_size(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(
            f"/artifacts/content/{dir_name}/data.txt",
            headers={"Range": "bytes=8-999"},
        )

        assert response.status_code == 206
        assert response.content == b"89"
        assert response.headers["content-range"] == "bytes 8-9/10"

    def test_range_start_beyond_size_returns_416(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(
            f"/artifacts/content/{dir_name}/data.txt",
            headers={"Range": "bytes=10-"},
        )

        assert response.status_code == 416
        assert response.json()["error"]["message"] == "Invalid range"

    def test_malformed_range_header_is_ignored(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = client.get(
            f"/artifacts/content/{dir_name}/data.txt",
            headers={"Range": "bytes=abc"},
        )

        assert response.status_code == 200
        assert response.content == b"0123456789"


class TestDownloadArtifactContentErrors:
    """Same 400/404 contract as the meta endpoint."""

    def test_traversal_identifier_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/content/..%2Fescape.txt")

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_absolute_identifier_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/content/%2Fetc%2Fpasswd")

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_missing_artifact_returns_404(self, client: TestClient) -> None:
        dir_name, _execution_id, _directory = make_execution_dir()

        response = client.get(f"/artifacts/content/{dir_name}/missing.txt")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == f"Artifact {dir_name}/missing.txt not found"


class TestDownloadKeepsTheWholeFileName:
    """A file named with text outside plain ASCII downloads under its whole name (REQ-4.6.9)."""

    @pytest.mark.parametrize("disposition", ["attachment", "inline"])
    def test_a_log_named_after_its_test_downloads(
        self, client: TestClient, disposition: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        name = f"{ENTITY_NAME}.log"
        write_artifact_file(directory, f"logs/{name}", b"line\n")

        response = client.get(
            f"/artifacts/content/{dir_name}/logs/{name}", params={"disposition": disposition}
        )

        assert_whole_name(response, name)
        assert response.headers["content-disposition"].startswith(
            f'{disposition}; filename="Gre .log"; '
        )
        assert response.content == b"line\n"
