"""Unit tests for the test data mutation routes (REQ-5.2.4.12).

Covers POST /tests/{test_id}/testdata/folders, PATCH and DELETE on
/tests/{test_id}/testdata/{path}. PATCH carries the new relative path so rename
and move within the test share one endpoint.
"""

import uuid

from fastapi.testclient import TestClient

from tests.api.routes.tests.conftest import (
    assert_error,
    assert_running_conflict,
    seed_file,
    seed_folder,
    seed_running_execution,
    seed_running_session,
    testdata_root,
)

_TRAVERSAL = "%2E%2E/evil"


class TestCreateFolder:
    """POST /tests/{test_id}/testdata/folders."""

    def test_creates_a_folder_in_the_root(self, client: TestClient, test_id: str) -> None:
        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures"})

        assert response.status_code == 201
        assert response.json() == {"path": "fixtures"}
        assert (testdata_root(test_id) / "fixtures").is_dir()

    def test_creates_a_nested_folder_under_an_existing_parent(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_folder(test_id, "fixtures")

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures/2026"})

        assert response.status_code == 201
        assert response.json() == {"path": "fixtures/2026"}
        assert (testdata_root(test_id) / "fixtures" / "2026").is_dir()

    def test_traversal_path_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "../evil"})

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ../evil",
        )

    def test_over_long_folder_name_is_rejected(self, client: TestClient, test_id: str) -> None:
        name = "a" * 256

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": name})

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message=f"Invalid name: {name}",
        )

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.post(f"/tests/{missing}/testdata/folders", json={"path": "fixtures"})

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )

    def test_missing_parent_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures/2026"})

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Folder not found: fixtures",
        )

    def test_existing_folder_is_a_conflict(self, client: TestClient, test_id: str) -> None:
        seed_folder(test_id, "fixtures")

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures"})

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Folder already exists: fixtures",
        )

    def test_existing_file_of_that_name_is_a_conflict(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "fixtures", b"x")

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures"})

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="File already exists: fixtures",
        )

    def test_running_test_blocks_folder_creation(self, client: TestClient, test_id: str) -> None:
        execution_id = seed_running_execution(test_id)

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures"})

        assert_running_conflict(response, [execution_id])
        assert not (testdata_root(test_id) / "fixtures").exists()

    def test_running_workbench_session_blocks_folder_creation(
        self, client: TestClient, test_id: str
    ) -> None:
        session_id = seed_running_session(test_id, status="paused")

        response = client.post(f"/tests/{test_id}/testdata/folders", json={"path": "fixtures"})

        assert_running_conflict(response, [session_id])


class TestRenameEntry:
    """PATCH /tests/{test_id}/testdata/{path}."""

    def test_renames_a_file(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert response.status_code == 200
        assert response.json() == {"path": "clients.csv"}
        root = testdata_root(test_id)
        assert not (root / "customers.csv").exists()
        assert (root / "clients.csv").read_bytes() == b"rows"

    def test_moves_a_file_into_an_existing_folder(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        seed_folder(test_id, "fixtures")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv",
            json={"path": "fixtures/customers.csv"},
        )

        assert response.status_code == 200
        assert response.json() == {"path": "fixtures/customers.csv"}
        assert (testdata_root(test_id) / "fixtures" / "customers.csv").exists()

    def test_renames_a_folder_with_its_content(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "fixtures/orders.json", b"{}")

        response = client.patch(f"/tests/{test_id}/testdata/fixtures", json={"path": "data"})

        assert response.status_code == 200
        assert response.json() == {"path": "data"}
        assert (testdata_root(test_id) / "data" / "orders.json").exists()

    def test_traversal_in_the_url_path_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = client.patch(
            f"/tests/{test_id}/testdata/{_TRAVERSAL}", json={"path": "clients.csv"}
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ../evil",
        )

    def test_traversal_in_the_body_path_is_rejected(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "../evil"}
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ../evil",
        )

    def test_over_long_new_name_is_rejected(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        name = "a" * 256

        response = client.patch(f"/tests/{test_id}/testdata/customers.csv", json={"path": name})

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message=f"Invalid name: {name}",
        )

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.patch(
            f"/tests/{missing}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )

    def test_unknown_entry_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.patch(
            f"/tests/{test_id}/testdata/ghost.csv", json={"path": "clients.csv"}
        )

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Test data entry not found: ghost.csv",
        )

    def test_missing_destination_parent_is_not_found(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv",
            json={"path": "fixtures/customers.csv"},
        )

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Folder not found: fixtures",
        )

    def test_existing_file_at_the_destination_is_a_conflict(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        seed_file(test_id, "clients.csv", b"other")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="File already exists: clients.csv",
        )

    def test_existing_folder_at_the_destination_is_a_conflict(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        seed_folder(test_id, "clients.csv")

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Folder already exists: clients.csv",
        )

    def test_running_test_blocks_the_rename(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        execution_id = seed_running_execution(test_id)

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert_running_conflict(response, [execution_id])
        assert (testdata_root(test_id) / "customers.csv").exists()

    def test_running_workbench_session_blocks_the_rename(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        session_id = seed_running_session(test_id)

        response = client.patch(
            f"/tests/{test_id}/testdata/customers.csv", json={"path": "clients.csv"}
        )

        assert_running_conflict(response, [session_id])


class TestDeleteEntry:
    """DELETE /tests/{test_id}/testdata/{path}."""

    def test_deletes_a_file(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")

        response = client.delete(f"/tests/{test_id}/testdata/customers.csv")

        assert response.status_code == 204
        assert not (testdata_root(test_id) / "customers.csv").exists()

    def test_deletes_a_folder_recursively(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "fixtures/nested/orders.json", b"{}")

        response = client.delete(f"/tests/{test_id}/testdata/fixtures")

        assert response.status_code == 204
        assert not (testdata_root(test_id) / "fixtures").exists()

    def test_traversal_path_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = client.delete(f"/tests/{test_id}/testdata/{_TRAVERSAL}")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ../evil",
        )

    def test_empty_path_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = client.delete(f"/tests/{test_id}/testdata/")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ",
        )

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.delete(f"/tests/{missing}/testdata/customers.csv")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )

    def test_unknown_entry_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.delete(f"/tests/{test_id}/testdata/ghost.csv")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Test data entry not found: ghost.csv",
        )

    def test_running_test_blocks_the_delete(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        execution_id = seed_running_execution(test_id)

        response = client.delete(f"/tests/{test_id}/testdata/customers.csv")

        assert_running_conflict(response, [execution_id])
        assert (testdata_root(test_id) / "customers.csv").exists()

    def test_running_workbench_session_blocks_the_delete(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"rows")
        session_id = seed_running_session(test_id, status="paused")

        response = client.delete(f"/tests/{test_id}/testdata/customers.csv")

        assert_running_conflict(response, [session_id])
