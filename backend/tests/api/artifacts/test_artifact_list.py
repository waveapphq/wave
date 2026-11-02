"""Unit tests for GET /artifacts (scan-based listing, REQ-3.7.1.4).

The endpoint scans the per-execution directories under the artifact root and
returns paginated ArtifactMeta items sorted by created_at descending. The
``sessions/`` area is excluded. Identity is path-shaped:
``{artifact_dir_name}/{relative_path}``.
"""

import uuid
from datetime import datetime

from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import make_execution_dir, write_artifact_file
from wavecore.api.services.storage_paths import get_artifacts_storage_path

_BASE_MTIME = 1781000000.0


class TestListArtifacts:
    """GET /artifacts returns the standard {success, data, pagination} envelope."""

    def test_empty_root_returns_empty_page(self, client: TestClient) -> None:
        response = client.get("/artifacts")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"success", "data", "meta", "pagination"}
        assert body["data"] == []
        assert body["pagination"] == {
            "page": 1,
            "per_page": 50,
            "total": 0,
            "total_pages": 1,
        }

    def test_item_shape_matches_artifact_meta(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        content = b'{"result": true}'
        write_artifact_file(directory, "data.json", content, mtime=_BASE_MTIME)

        response = client.get("/artifacts")

        assert response.status_code == 200
        items = response.json()["data"]
        assert len(items) == 1
        item = items[0]
        assert set(item.keys()) == {
            "id",
            "execution_id",
            "name",
            "path",
            "size_bytes",
            "content_type",
            "compression",
            "created_at",
        }
        assert item["id"] == f"{dir_name}/data.json"
        assert item["execution_id"] == execution_id
        assert item["name"] == "data.json"
        assert item["path"] == "data.json"
        assert item["size_bytes"] == len(content)
        assert item["content_type"] == "application/json"
        assert item["compression"] is None
        datetime.fromisoformat(item["created_at"])

    def test_compressed_filename_compression_is_parsed(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "report.json.gz", b"gzdata")

        response = client.get("/artifacts")

        item = response.json()["data"][0]
        assert item["id"] == f"{dir_name}/report.json.gz"
        assert item["name"] == "report.json"
        assert item["compression"] == "gzip"
        assert "version" not in item

    def test_unknown_extension_falls_back_to_octet_stream(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "no_extension_file", b"raw")

        response = client.get("/artifacts")

        assert response.json()["data"][0]["content_type"] == "application/octet-stream"

    def test_nested_files_are_listed_with_relative_paths(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "logs/service.log", b"line\n")

        response = client.get("/artifacts")

        item = response.json()["data"][0]
        assert item["id"] == f"{dir_name}/logs/service.log"
        assert item["path"] == "logs/service.log"

    def test_items_sorted_by_created_at_descending(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "oldest.txt", b"1", mtime=_BASE_MTIME)
        write_artifact_file(directory, "middle.txt", b"2", mtime=_BASE_MTIME + 100)
        write_artifact_file(directory, "newest.txt", b"3", mtime=_BASE_MTIME + 200)

        response = client.get("/artifacts")

        paths = [item["path"] for item in response.json()["data"]]
        assert paths == ["newest.txt", "middle.txt", "oldest.txt"]

    def test_sessions_area_is_excluded(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "kept.txt", b"keep")
        session_dir = get_artifacts_storage_path() / "sessions" / str(uuid.uuid4())
        session_dir.mkdir(parents=True)
        (session_dir / "transient.txt").write_bytes(b"skip")

        response = client.get("/artifacts")

        items = response.json()["data"]
        assert [item["path"] for item in items] == ["kept.txt"]

    def test_filter_by_execution_id(self, client: TestClient) -> None:
        _dir_a, execution_a, directory_a = make_execution_dir(stamp="20260609-100000")
        _dir_b, _execution_b, directory_b = make_execution_dir(stamp="20260609-110000")
        write_artifact_file(directory_a, "from-a.txt", b"a")
        write_artifact_file(directory_b, "from-b.txt", b"b")

        response = client.get("/artifacts", params={"execution_id": execution_a})

        items = response.json()["data"]
        assert [item["path"] for item in items] == ["from-a.txt"]
        assert items[0]["execution_id"] == execution_a

    def test_filter_by_unknown_execution_id_returns_empty(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "a.txt", b"a")

        response = client.get("/artifacts", params={"execution_id": str(uuid.uuid4())})

        body = response.json()
        assert body["data"] == []
        assert body["pagination"]["total"] == 0


class TestListArtifactsPagination:
    """Page-based pagination math."""

    def test_pagination_slices_and_counts(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        for index in range(5):
            write_artifact_file(
                directory,
                f"file-{index}.txt",
                b"x",
                mtime=_BASE_MTIME + index,
            )

        response = client.get("/artifacts", params={"page": 2, "per_page": 2})

        body = response.json()
        # Descending by created_at: page 1 = file-4, file-3; page 2 = file-2, file-1.
        assert [item["path"] for item in body["data"]] == ["file-2.txt", "file-1.txt"]
        assert body["pagination"] == {
            "page": 2,
            "per_page": 2,
            "total": 5,
            "total_pages": 3,
        }

    def test_page_beyond_range_returns_empty_items(self, client: TestClient) -> None:
        _dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "only.txt", b"x")

        response = client.get("/artifacts", params={"page": 9, "per_page": 50})

        body = response.json()
        assert body["data"] == []
        assert body["pagination"]["total"] == 1

    def test_page_below_one_is_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts", params={"page": 0})

        assert response.status_code == 400
        assert response.json()["success"] is False

    def test_per_page_below_one_is_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts", params={"per_page": 0})

        assert response.status_code == 400
        assert response.json()["success"] is False

    def test_per_page_above_hundred_is_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts", params={"per_page": 101})

        assert response.status_code == 400
        assert response.json()["success"] is False
