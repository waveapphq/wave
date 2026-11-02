"""Unit tests for GET /artifacts/executions (execution-artifact summary).

The artifact browser landing list is execution-first, not a flat file dump: one
row per execution that has artifacts, joining the execution record
(name/type/status/finished) with a rollup of its artifact directory (live
artifact count + total bytes). Executions with no live artifacts do not appear.
Paginated and filterable by search/type/status like the other list endpoints.
"""

import uuid
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import make_execution_dir, write_artifact_file
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path

_SUMMARY_KEYS = {
    "execution_id",
    "name",
    "entity_type",
    "status",
    "finished_at",
    "artifact_count",
    "total_size_bytes",
}


def _seed_execution_with_artifacts(
    *,
    name: str = "nightly-run",
    entity_type: str = "test",
    status: str = "passed",
    files: dict[str, bytes] | None = None,
    stamp: str = "20260609-120000",
    ended_at: str = "2026-06-09T12:01:00+00:00",
) -> tuple[str, str, Path]:
    """Seed an execution record + a matching artifact dir with files."""
    dir_name, execution_id, directory = make_execution_dir(stamp=stamp)
    record: dict[str, Any] = {
        "id": execution_id,
        "name": name,
        "entity_type": entity_type,
        "entity_id": str(uuid.uuid4()),
        "environment_id": str(uuid.uuid4()),
        "status": status,
        "started_at": "2026-06-09T12:00:00+00:00",
        "ended_at": ended_at,
        "artifact_dir": dir_name,
    }
    exec_storage._save_execution(record)
    exec_storage._execution_storage[execution_id] = record
    for relative_path, content in (files or {"report.json": b"{}"}).items():
        write_artifact_file(directory, relative_path, content)
    return execution_id, dir_name, directory


class TestExecutionSummaryShape:
    """One row per execution-with-artifacts, with the rollup fields."""

    def test_empty_root_returns_empty_page(self, client: TestClient) -> None:
        response = client.get("/artifacts/executions")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"success", "data", "meta", "pagination"}
        assert body["data"] == []
        assert body["pagination"] == {
            "page": 1,
            "per_page": 50,
            "total": 0,
            "total_pages": 1,
            "total_size_bytes": 0,
        }

    def test_item_shape_and_rollup(self, client: TestClient) -> None:
        execution_id, _dir_name, _directory = _seed_execution_with_artifacts(
            name="checkout-suite",
            entity_type="suite",
            status="failed",
            files={"report.json": b"12345", "logs/smoke/a.log": b"678"},
            ended_at="2026-06-09T12:30:00+00:00",
        )

        response = client.get("/artifacts/executions")

        assert response.status_code == 200
        items = response.json()["data"]
        assert len(items) == 1
        item = items[0]
        assert set(item.keys()) == _SUMMARY_KEYS
        assert item["execution_id"] == execution_id
        assert item["name"] == "checkout-suite"
        assert item["entity_type"] == "suite"
        assert item["status"] == "failed"
        assert item["finished_at"] == "2026-06-09T12:30:00+00:00"
        assert item["artifact_count"] == 2
        assert item["total_size_bytes"] == 8

    def test_execution_without_live_artifacts_is_excluded(self, client: TestClient) -> None:
        # Dir exists but holds no artifact files -> not a row.
        dir_name, execution_id, _directory = make_execution_dir(stamp="20260609-090000")
        record = {
            "id": execution_id,
            "name": "no-artifacts",
            "entity_type": "test",
            "entity_id": str(uuid.uuid4()),
            "status": "passed",
            "started_at": "2026-06-09T09:00:00+00:00",
            "ended_at": "2026-06-09T09:01:00+00:00",
            "artifact_dir": dir_name,
        }
        exec_storage._save_execution(record)
        exec_storage._execution_storage[execution_id] = record

        response = client.get("/artifacts/executions")

        assert response.json()["data"] == []

    def test_rows_sorted_newest_first(self, client: TestClient) -> None:
        _old, _d1, _f1 = _seed_execution_with_artifacts(
            name="older", stamp="20260609-080000", ended_at="2026-06-09T08:05:00+00:00"
        )
        _new, _d2, _f2 = _seed_execution_with_artifacts(
            name="newer", stamp="20260609-180000", ended_at="2026-06-09T18:05:00+00:00"
        )

        response = client.get("/artifacts/executions")

        names = [item["name"] for item in response.json()["data"]]
        assert names == ["newer", "older"]

    def test_stray_file_and_sessions_area_are_excluded(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(name="real-run")
        root = get_artifacts_storage_path()
        (root / "stray.txt").write_text("not a dir")
        session_dir = root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / "f.json").write_text("{}")

        response = client.get("/artifacts/executions")

        names = [item["name"] for item in response.json()["data"]]
        assert names == ["real-run"]


class TestExecutionSummaryFilters:
    """search / type / status narrow the rows."""

    def test_search_matches_name(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(name="login-regression", stamp="20260609-100000")
        _seed_execution_with_artifacts(name="payment-suite", stamp="20260609-110000")

        response = client.get("/artifacts/executions", params={"search": "payment"})

        names = [item["name"] for item in response.json()["data"]]
        assert names == ["payment-suite"]

    def test_filter_by_type(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(name="a-test", entity_type="test", stamp="20260609-100000")
        _seed_execution_with_artifacts(
            name="a-regression", entity_type="regression", stamp="20260609-110000"
        )

        response = client.get("/artifacts/executions", params={"type": "regression"})

        names = [item["name"] for item in response.json()["data"]]
        assert names == ["a-regression"]

    def test_filter_by_status(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(name="passed-run", status="passed", stamp="20260609-100000")
        _seed_execution_with_artifacts(name="failed-run", status="failed", stamp="20260609-110000")

        response = client.get("/artifacts/executions", params={"status": "failed"})

        names = [item["name"] for item in response.json()["data"]]
        assert names == ["failed-run"]

    def test_filter_by_multiple_types(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(name="a-test", entity_type="test", stamp="20260609-100000")
        _seed_execution_with_artifacts(name="a-suite", entity_type="suite", stamp="20260609-110000")
        _seed_execution_with_artifacts(
            name="a-reg", entity_type="regression", stamp="20260609-120000"
        )

        response = client.get("/artifacts/executions", params={"type": "test,suite"})

        names = sorted(item["name"] for item in response.json()["data"])
        assert names == ["a-suite", "a-test"]


class TestExecutionSummaryPagination:
    """Page-based pagination over the execution rows."""

    def test_pagination_slices_and_counts(self, client: TestClient) -> None:
        for index in range(5):
            _seed_execution_with_artifacts(
                name=f"run-{index}",
                stamp=f"20260609-1{index}0000",
                ended_at=f"2026-06-09T1{index}:00:00+00:00",
            )

        response = client.get("/artifacts/executions", params={"page": 2, "per_page": 2})

        body = response.json()
        assert len(body["data"]) == 2
        assert body["pagination"] == {
            "page": 2,
            "per_page": 2,
            "total": 5,
            "total_pages": 3,
            "total_size_bytes": 10,
        }

    def test_pagination_carries_filter_aware_grand_total_size(self, client: TestClient) -> None:
        _seed_execution_with_artifacts(
            name="big-run", files={"a.bin": b"x" * 100}, stamp="20260609-100000"
        )
        _seed_execution_with_artifacts(
            name="small-run", files={"b.bin": b"x" * 20}, stamp="20260609-110000"
        )

        # Grand total spans BOTH executions even when a single page holds one.
        body = client.get("/artifacts/executions", params={"per_page": 1}).json()
        assert len(body["data"]) == 1
        assert body["pagination"]["total_size_bytes"] == 120

        # Filter-aware: narrowing to one execution narrows the grand total.
        filtered = client.get("/artifacts/executions", params={"search": "big"}).json()
        assert filtered["pagination"]["total_size_bytes"] == 100

    def test_page_below_one_is_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/executions", params={"page": 0})

        assert response.status_code == 400
        assert response.json()["success"] is False

    def test_per_page_above_hundred_is_rejected(self, client: TestClient) -> None:
        response = client.get("/artifacts/executions", params={"per_page": 101})

        assert response.status_code == 400
        assert response.json()["success"] is False
