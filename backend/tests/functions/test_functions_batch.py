"""Tests for batch Function endpoints.

Contract:
- POST /functions/batch -> `{"created": [...], "failed": [{"index": int, "errors": [str, ...]},
  ...]}`
- DELETE /functions/batch -> `{"deleted": [str, ...], "failed": [{"id": str, "errors": [...]},
  ...]}`

Atomicity: items are committed independently; per-item failures
do not roll back successes. Each per-item failure carries the exact backend
error strings in the `errors` list.
"""

import re
import uuid

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload, make_input

# Anchored regexes that may appear in per-item errors.
NAME_REQUIRED_RE = re.compile(r"^Function name is required$")
NAME_DUPLICATE_RE = re.compile(r"^Function name '.+' is already in use$")
INPUT_TYPE_RE = re.compile(r"^Function input '.+' has invalid type '.+'$")
NOT_FOUND_RE = re.compile(r"^Function '.+' not found$")


def _failed_errors(failed_item: dict) -> list[str]:
    """Extract the errors list from a failed-item entry."""
    return failed_item.get("errors", [])


# ---------------------------------------------------------------------------
# POST /functions/batch
# ---------------------------------------------------------------------------


class TestBatchCreate:
    def test_all_valid_items_returns_all_created(self, client: TestClient) -> None:
        items = [make_function_payload(name=f"bc_ok_{i}") for i in range(3)]
        response = client.post("/functions/batch", json={"items": items})
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert len(data["created"]) == 3
        assert data["failed"] == []

    def test_invalid_items_return_in_failed_with_index(self, client: TestClient) -> None:
        items = [
            make_function_payload(name="bc_good"),
            make_function_payload(name=""),  # empty name -> 400
            make_function_payload(
                name="bc_invalid_input",
                inputs=[make_input(name="x", type_="blob")],
            ),  # invalid type -> 422
        ]
        response = client.post("/functions/batch", json={"items": items})
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["created"]) == 1
        assert len(data["failed"]) == 2
        failed_indices = {item["index"] for item in data["failed"]}
        assert failed_indices == {1, 2}
        # Each failed item carries the exact error string(s).
        for failed_item in data["failed"]:
            errs = _failed_errors(failed_item)
            assert errs, "failed item missing errors list"
            if failed_item["index"] == 1:
                assert any(NAME_REQUIRED_RE.match(e) for e in errs)
            elif failed_item["index"] == 2:
                assert any(INPUT_TYPE_RE.match(e) for e in errs)

    def test_partial_success_does_not_roll_back(self, client: TestClient) -> None:
        items = [
            make_function_payload(name="bc_keeper"),
            make_function_payload(name=""),
        ]
        client.post("/functions/batch", json={"items": items})
        # The keeper must still be queryable after the failure.
        listed = client.get("/functions").json()
        names = {row["name"] for row in listed["data"]}
        assert "bc_keeper" in names

    def test_duplicate_name_within_batch_fails_second(self, client: TestClient) -> None:
        items = [
            make_function_payload(name="bc_dup"),
            make_function_payload(name="bc_dup"),
        ]
        response = client.post("/functions/batch", json={"items": items})
        data = response.json()["data"]
        assert len(data["created"]) == 1
        assert len(data["failed"]) == 1
        errs = _failed_errors(data["failed"][0])
        assert any(NAME_DUPLICATE_RE.match(e) for e in errs)


# ---------------------------------------------------------------------------
# DELETE /functions/batch
# ---------------------------------------------------------------------------


class TestBatchDelete:
    def test_all_deleted_when_no_dependents(self, client: TestClient) -> None:
        ids = []
        for i in range(3):
            created = client.post(
                "/functions", json=make_function_payload(name=f"bd_ok_{i}")
            ).json()
            ids.append(created["data"]["id"])
        response = client.request("DELETE", "/functions/batch", json={"ids": ids, "cascade": False})
        assert response.status_code == 200
        data = response.json()["data"]
        assert set(data["deleted"]) == set(ids)
        assert data["failed"] == []

    def test_dependent_item_appears_in_failed(self, client: TestClient) -> None:
        from .test_functions_dependents import _write_test_referencing

        created_a = client.post("/functions", json=make_function_payload(name="bd_dep_a")).json()
        a_id = created_a["data"]["id"]
        created_b = client.post("/functions", json=make_function_payload(name="bd_dep_b")).json()
        b_id = created_b["data"]["id"]
        _write_test_referencing(a_id)
        response = client.request(
            "DELETE", "/functions/batch", json={"ids": [a_id, b_id], "cascade": False}
        )
        data = response.json()["data"]
        assert b_id in data["deleted"]
        assert any(failure["id"] == a_id for failure in data["failed"])

    def test_missing_item_appears_in_failed(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.request(
            "DELETE", "/functions/batch", json={"ids": [missing_id], "cascade": False}
        )
        data = response.json()["data"]
        failure = data["failed"][0]
        assert failure["id"] == missing_id
        assert any(NOT_FOUND_RE.match(e) for e in _failed_errors(failure))


pytestmark = pytest.mark.usefixtures("temp_storage_path")
