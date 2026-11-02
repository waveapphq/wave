"""Tests for /functions/{id}/dependents and delete-with-cascade behavior.

Contract:
- GET /functions/{id}/dependents -> 200 with `{"tests": [...], "functions": [...]}`
- DELETE /functions/{id} with dependents -> 409 unless cascade=true
- DELETE /functions/{id}?cascade=true -> 204 plus a body listing cascaded entries

The dependents-count message embeds a literal `(s)` because plurality is
written into the canonical string. The anchored regex for assertions is:

    ^Function '.+' has \\d+ dependent\\(s\\); pass cascade=true to delete$

The literal `(s)` is escaped inside the regex; the actual emitted string is
`Function 'X' has 3 dependent(s); pass cascade=true to delete`.
"""

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from .conftest import make_function_payload

DEPENDENTS_COUNT_RE = re.compile(
    r"^Function '.+' has \d+ dependent\(s\); pass cascade=true to delete$"
)
NOT_FOUND_RE = re.compile(r"^Function '.+' not found$")


def _all_error_messages(body: dict) -> list[str]:
    err = body["error"]
    messages: list[str] = []
    if "message" in err and err["message"]:
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


def _write_test_with_nodes(nodes: list[dict[str, Any]], *, name: str | None = None) -> str:
    """Write a Test definition whose workflow holds ``nodes``."""
    from wavecore.api.services.storage_paths import get_tests_storage_path

    test_id = str(uuid.uuid4())
    test_name = name or f"t_{test_id[:8]}"
    test_dir: Path = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    definition: dict[str, Any] = {
        "id": test_id,
        "name": test_name,
        "version": "1.0.0",
        "workflow": {"nodes": nodes, "edges": []},
        "variables": {},
        "metadata": {},
    }
    with open(test_dir / "test.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(definition, f, sort_keys=False)
    return test_id


def _write_test_referencing(library_id: str, *, name: str | None = None) -> str:
    """Write a Test definition that references the given Function library id."""
    return _write_test_with_nodes(
        [
            {
                "id": str(uuid.uuid4()),
                "type": "workflowNode",
                "data": {
                    "nodeType": "function",
                    "elementType": "function",
                    "functionId": library_id,
                    "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
                },
            }
        ],
        name=name,
    )


def _library_block(function_id: str) -> dict[str, Any]:
    """A library Function block that calls ``function_id`` at 1.0.0."""
    return {
        "id": "call-callee",
        "type": "workflowNode",
        "data": {
            "label": "call_callee",
            "nodeType": "function",
            "elementType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
        },
    }


def _local_block(body_nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """A Local Function block whose body holds ``body_nodes``."""
    return {
        "id": "local-wrapper",
        "type": "workflowNode",
        "data": {
            "label": "Local_Wrapper",
            "nodeType": "function",
            "elementType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "Local_Wrapper",
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": body_nodes, "edges": []},
            },
        },
    }


# ---------------------------------------------------------------------------
# GET /functions/{id}/dependents
# ---------------------------------------------------------------------------


class TestGetDependents:
    def test_empty_dependents_when_none(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="standalone")).json()
        fn_id = created["data"]["id"]
        response = client.get(f"/functions/{fn_id}/dependents")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"]["tests"] == []
        assert body["data"]["functions"] == []

    def test_returns_404_for_missing_function(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.get(f"/functions/{missing_id}/dependents")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_finds_test_referencing_function(self, client: TestClient) -> None:
        created = client.post(
            "/functions", json=make_function_payload(name="referenced_by_test")
        ).json()
        fn_id = created["data"]["id"]
        test_id = _write_test_referencing(fn_id, name="referencing_test")
        response = client.get(f"/functions/{fn_id}/dependents")
        body = response.json()
        assert response.status_code == 200
        test_ids = [t["id"] for t in body["data"]["tests"]]
        assert test_id in test_ids
        # Tests entries carry an id and a human name.
        for entry in body["data"]["tests"]:
            assert {"id", "name"} <= set(entry.keys())

    def test_finds_function_referencing_function(self, client: TestClient) -> None:
        callee = client.post("/functions", json=make_function_payload(name="callee")).json()
        callee_id = callee["data"]["id"]
        caller = client.post(
            "/functions",
            json=make_function_payload(
                name="caller",
                workflow={
                    "nodes": [_library_block(callee_id)],
                    "edges": [{"source": "start-node", "target": "call-callee"}],
                },
            ),
        ).json()
        caller_id = caller["data"]["id"]
        response = client.get(f"/functions/{callee_id}/dependents")
        body = response.json()
        fn_ids = [fn["id"] for fn in body["data"]["functions"]]
        assert caller_id in fn_ids
        for entry in body["data"]["functions"]:
            assert {"id", "name"} <= set(entry.keys())


# ---------------------------------------------------------------------------
# References below the top level
# ---------------------------------------------------------------------------


class TestDependentsBelowTheTopLevel:
    def test_a_caller_inside_a_local_body_is_a_dependent(self, client: TestClient) -> None:
        from wavecore.api.services.functions import _storage

        callee = client.post("/functions", json=make_function_payload(name="deep_callee")).json()
        callee_id = callee["data"]["id"]
        nodes = [_local_block([_library_block(callee_id)])]
        test_id = _write_test_with_nodes(nodes, name="deep_test")
        caller_id = str(uuid.uuid4())
        _storage.save_new_version(
            caller_id,
            "1.0.0",
            {
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": nodes, "edges": []},
            },
            {"published_at": "2026-01-01T00:00:00Z", "published_by": "wave"},
            name="deep_caller",
        )

        for query in ("", "?version=1.0.0"):
            data = client.get(f"/functions/{callee_id}/dependents{query}").json()["data"]
            assert [entry["id"] for entry in data["tests"]] == [test_id], query
            assert [entry["id"] for entry in data["functions"]] == [caller_id], query
        by_version = client.get(f"/functions/{callee_id}/dependents/by-version").json()["data"]
        assert [entry["id"] for entry in by_version["1.0.0"]["tests"]] == [test_id]
        assert [entry["id"] for entry in by_version["1.0.0"]["functions"]] == [caller_id]


# ---------------------------------------------------------------------------
# DELETE /functions/{id} cascade behavior
# ---------------------------------------------------------------------------


class TestDeleteCascade:
    def test_delete_without_cascade_when_dependents_present_returns_409(
        self, client: TestClient
    ) -> None:
        created = client.post("/functions", json=make_function_payload(name="cant_delete")).json()
        fn_id = created["data"]["id"]
        _write_test_referencing(fn_id)
        response = client.delete(f"/functions/{fn_id}")
        assert response.status_code == 409
        assert any(DEPENDENTS_COUNT_RE.match(m) for m in _all_error_messages(response.json()))

    def test_delete_with_cascade_returns_204_and_cascaded_payload(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="cascade_me")).json()
        fn_id = created["data"]["id"]
        test_id = _write_test_referencing(fn_id, name="cascaded_test")
        response = client.delete(f"/functions/{fn_id}?cascade=true")
        # Either 204 or 200 with the cascaded list is accepted; the Function must be gone.
        assert response.status_code in (200, 204), response.text
        assert client.get(f"/functions/{fn_id}").status_code == 404
        if response.status_code == 200:
            body = response.json()
            cascaded = body["data"].get("cascaded", [])
            assert any(entry.get("id") == test_id for entry in cascaded)

    def test_delete_missing_returns_404_regardless_of_cascade(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.delete(f"/functions/{missing_id}?cascade=true")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Plural count formatting
# ---------------------------------------------------------------------------


class TestDependentsCountString:
    def test_count_is_reported_in_error_string(self, client: TestClient) -> None:
        """The (s) literal is in the canonical anchored regex; verify count is integer."""
        created = client.post(
            "/functions", json=make_function_payload(name="multi_dependent")
        ).json()
        fn_id = created["data"]["id"]
        for i in range(3):
            _write_test_referencing(fn_id, name=f"dep_test_{i}")
        response = client.delete(f"/functions/{fn_id}")
        assert response.status_code == 409
        body = response.json()
        message = _all_error_messages(body)[0]
        match = re.match(
            r"^Function '.+' has (\d+) dependent\(s\); " r"pass cascade=true to delete$",
            message,
        )
        assert match is not None, message
        # Count must be exactly the number of dependents we created.
        assert int(match.group(1)) == 3


pytestmark = pytest.mark.usefixtures("temp_storage_path")
