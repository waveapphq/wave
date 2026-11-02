"""Unit tests for GET /tests/{test_id}/testdata (REQ-5.2.4.12).

The listing is flat: every folder is its own explicit ``dir`` entry, paths are
relative posix, and the order is bytewise by path.
"""

import uuid

from fastapi.testclient import TestClient

from tests.api.routes.tests.conftest import (
    assert_error,
    seed_file,
    seed_folder,
)


class TestListTestDataShape:
    """The 200 body carries entries plus the two aggregates."""

    def test_test_without_a_folder_answers_an_empty_listing(
        self, client: TestClient, test_id: str
    ) -> None:
        response = client.get(f"/tests/{test_id}/testdata")

        assert response.status_code == 200
        assert response.json() == {"entries": [], "total_files": 0, "total_bytes": 0}

    def test_files_and_folders_are_listed_flat(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"ab")
        seed_file(test_id, "fixtures/orders.json", b"{}")
        seed_folder(test_id, "empty")

        response = client.get(f"/tests/{test_id}/testdata")

        assert response.status_code == 200
        body = response.json()
        assert [(e["path"], e["kind"]) for e in body["entries"]] == [
            ("customers.csv", "file"),
            ("empty", "dir"),
            ("fixtures", "dir"),
            ("fixtures/orders.json", "file"),
        ]

    def test_aggregates_count_files_only(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"ab")
        seed_file(test_id, "fixtures/orders.json", b"{}")
        seed_folder(test_id, "empty")

        body = client.get(f"/tests/{test_id}/testdata").json()

        assert body["total_files"] == 2
        assert body["total_bytes"] == 4

    def test_every_entry_carries_path_kind_size_and_modified(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"abcde")

        entry = client.get(f"/tests/{test_id}/testdata").json()["entries"][0]

        assert set(entry) == {"path", "kind", "size_bytes", "modified_at"}
        assert entry["path"] == "customers.csv"
        assert entry["kind"] == "file"
        assert entry["size_bytes"] == 5
        assert entry["modified_at"].startswith("20")

    def test_entries_are_sorted_bytewise_by_path(self, client: TestClient, test_id: str) -> None:
        for name in ("a.txt", "Z.txt", "B.txt"):
            seed_file(test_id, name, b"x")

        body = client.get(f"/tests/{test_id}/testdata").json()

        assert [e["path"] for e in body["entries"]] == ["B.txt", "Z.txt", "a.txt"]


class TestListTestDataExclusions:
    """Dot-directories, symlinks and upload temp files never reach the listing."""

    def test_dot_directories_are_skipped(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"x")
        seed_file(test_id, ".hidden/secret.txt", b"x")

        body = client.get(f"/tests/{test_id}/testdata").json()

        assert [e["path"] for e in body["entries"]] == ["customers.csv"]

    def test_symlinks_are_skipped(self, client: TestClient, test_id: str) -> None:
        target = seed_file(test_id, "customers.csv", b"x")
        (target.parent / "alias.csv").symlink_to(target)

        body = client.get(f"/tests/{test_id}/testdata").json()

        assert [e["path"] for e in body["entries"]] == ["customers.csv"]

    def test_in_progress_uploads_are_skipped(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"x")
        seed_file(test_id, "_upld-customers.csv", b"x")

        body = client.get(f"/tests/{test_id}/testdata").json()

        assert [e["path"] for e in body["entries"]] == ["customers.csv"]


class TestListTestDataUnknownTest:
    """An unknown test id is a 404 with the exact message."""

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.get(f"/tests/{missing}/testdata")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )
