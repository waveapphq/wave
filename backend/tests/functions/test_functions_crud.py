"""Endpoint tests for Function CRUD (REQ-3.1.2.1, REQ-3.1.2.4).

Covers GET/POST/PUT/DELETE for `/functions` and `/functions/{id}` plus the
pagination parameter validation. The Function backend persists Published
Functions under `backend/data/functions/<id>/function.yaml`; the autouse
temp_storage_path fixture redirects this to a tmp dir.

All API responses use the WAVE standard envelope: success responses are
`{"success": True, "data": ..., "pagination": ...}` and error responses are
`{"success": False, "error": {"message": ..., "code": ...}}` with the
status code matching the contract. The data field carries the contract shape
(FunctionSummary, FunctionDefinition, etc.).
"""

import re
import uuid

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload, make_input, make_output

# Anchored regex strings for the exact error messages.
PAGE_PARAM_RE = re.compile(r"^Invalid page parameter; must be a positive integer$")
PER_PAGE_PARAM_RE = re.compile(r"^Invalid per_page parameter; must be between 1 and 100$")


def _function_definition_keys() -> set[str]:
    """Keys expected on a FunctionDefinition."""
    return {
        "id",
        "name",
        "description",
        "tags",
        "inputs",
        "outputs",
        "dependencies",
        "workflow",
        "metadata",
    }


def _function_summary_keys() -> set[str]:
    """Keys expected on a FunctionSummary."""
    return {"id", "name", "description", "tags", "created_at", "updated_at"}


# ---------------------------------------------------------------------------
# GET /functions (list)
# ---------------------------------------------------------------------------


class TestListFunctions:
    def test_returns_empty_list_when_no_functions(self, client: TestClient) -> None:
        response = client.get("/functions")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == []
        assert body["pagination"]["total"] == 0
        assert body["pagination"]["page"] == 1
        assert body["pagination"]["per_page"] == 50
        assert body["pagination"]["total_pages"] == 0

    def test_returns_summaries_after_create(self, client: TestClient) -> None:
        for i in range(3):
            client.post("/functions", json=make_function_payload(name=f"fn_{i}"))
        response = client.get("/functions")
        assert response.status_code == 200
        body = response.json()
        assert body["pagination"]["total"] == 3
        assert len(body["data"]) == 3
        for row in body["data"]:
            assert _function_summary_keys() <= set(row.keys())

    def test_default_per_page_is_50(self, client: TestClient) -> None:
        response = client.get("/functions")
        assert response.json()["pagination"]["per_page"] == 50

    def test_pagination_caps_per_page_at_100(self, client: TestClient) -> None:
        response = client.get("/functions?per_page=101")
        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert PER_PAGE_PARAM_RE.match(body["error"]["message"])

    def test_pagination_rejects_per_page_below_1(self, client: TestClient) -> None:
        response = client.get("/functions?per_page=0")
        assert response.status_code == 400
        body = response.json()
        assert PER_PAGE_PARAM_RE.match(body["error"]["message"])

    def test_pagination_rejects_negative_page(self, client: TestClient) -> None:
        response = client.get("/functions?page=-1")
        assert response.status_code == 400
        body = response.json()
        assert PAGE_PARAM_RE.match(body["error"]["message"])

    def test_pagination_rejects_zero_page(self, client: TestClient) -> None:
        response = client.get("/functions?page=0")
        assert response.status_code == 400
        body = response.json()
        assert PAGE_PARAM_RE.match(body["error"]["message"])

    def test_pagination_returns_correct_page_count(self, client: TestClient) -> None:
        for i in range(7):
            client.post("/functions", json=make_function_payload(name=f"fn_{i}"))
        response = client.get("/functions?per_page=3")
        body = response.json()
        assert body["pagination"]["total"] == 7
        assert body["pagination"]["per_page"] == 3
        assert body["pagination"]["total_pages"] == 3
        assert len(body["data"]) == 3

    def test_search_filters_by_substring(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="alpha"))
        client.post("/functions", json=make_function_payload(name="beta_alpha"))
        client.post("/functions", json=make_function_payload(name="gamma"))
        response = client.get("/functions?search=alpha")
        body = response.json()
        names = {row["name"] for row in body["data"]}
        assert names == {"alpha", "beta_alpha"}

    def test_tags_filter_csv(self, client: TestClient) -> None:
        client.post(
            "/functions",
            json=make_function_payload(name="a", tags=["red", "blue"]),
        )
        client.post(
            "/functions",
            json=make_function_payload(name="b", tags=["green"]),
        )
        client.post(
            "/functions",
            json=make_function_payload(name="c", tags=["blue"]),
        )
        response = client.get("/functions?tags=blue")
        body = response.json()
        names = {row["name"] for row in body["data"]}
        assert names == {"a", "c"}

    def test_sort_by_name_orders_globally_across_pages(self, client: TestClient) -> None:
        # Sort must run server-side BEFORE pagination. Paging with per_page < total and
        # concatenating the pages must yield the globally name-sorted order,
        # not a per-page reordering of an otherwise unsorted page.
        names = ["mango", "apple", "cherry", "banana", "date"]
        for n in names:
            client.post("/functions", json=make_function_payload(name=n))

        ordered: list[str] = []
        for page in (1, 2, 3):
            body = client.get(
                f"/functions?sort_by=name&sort_order=asc&per_page=2&page={page}"
            ).json()
            ordered.extend(row["name"] for row in body["data"])

        assert ordered == sorted(names)

    def test_sort_by_name_desc_reverses_order(self, client: TestClient) -> None:
        names = ["mango", "apple", "cherry", "banana", "date"]
        for n in names:
            client.post("/functions", json=make_function_payload(name=n))

        asc = [
            row["name"]
            for row in client.get("/functions?sort_by=name&sort_order=asc").json()["data"]
        ]
        desc = [
            row["name"]
            for row in client.get("/functions?sort_by=name&sort_order=desc").json()["data"]
        ]
        assert asc == sorted(names)
        assert desc == list(reversed(asc))

    def test_sort_by_tags_orders_by_joined_tags(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="zebra", tags=["aaa"]))
        client.post("/functions", json=make_function_payload(name="apple", tags=["zzz"]))
        client.post("/functions", json=make_function_payload(name="mango", tags=["mmm"]))
        body = client.get("/functions?sort_by=tags&sort_order=asc").json()
        assert [row["name"] for row in body["data"]] == ["zebra", "mango", "apple"]

    def test_sort_by_updated_is_accepted(self, client: TestClient) -> None:
        for n in ("a", "b", "c"):
            client.post("/functions", json=make_function_payload(name=n))
        body = client.get("/functions?sort_by=updated&sort_order=asc").json()
        assert body["pagination"]["total"] == 3
        assert {row["name"] for row in body["data"]} == {"a", "b", "c"}

    def test_unknown_sort_field_falls_back_without_error(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="a"))
        client.post("/functions", json=make_function_payload(name="b"))
        body = client.get("/functions?sort_by=bogus&sort_order=asc").json()
        assert body["pagination"]["total"] == 2
        assert {row["name"] for row in body["data"]} == {"a", "b"}


def test_sort_by_version_uses_semver_not_lexical(monkeypatch: pytest.MonkeyPatch) -> None:
    """Version sort orders by semver, so 10.0.0 follows 2.0.0 (not lexical)."""
    from wavecore.api.services.functions import _storage, service

    rows = [
        {"id": "1", "name": "b", "latest_version": "2.0.0", "tags": [], "updated_at": ""},
        {"id": "2", "name": "c", "latest_version": "10.0.0", "tags": [], "updated_at": ""},
        {"id": "3", "name": "a", "latest_version": "1.0.0", "tags": [], "updated_at": ""},
    ]
    monkeypatch.setattr(_storage, "list_function_summaries", lambda: list(rows))

    result = service.list_functions(sort_by="version", sort_order="asc")
    assert [r["latest_version"] for r in result["data"]] == ["1.0.0", "2.0.0", "10.0.0"]


# ---------------------------------------------------------------------------
# GET /functions/{id} (get one)
# ---------------------------------------------------------------------------


class TestGetFunction:
    def test_returns_200_with_definition_and_etag(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="get_me")).json()
        fn_id = created["data"]["id"]
        response = client.get(f"/functions/{fn_id}")
        assert response.status_code == 200
        assert "ETag" in response.headers
        # ETag must be 64-char hex per the compute_etag spec.
        assert re.fullmatch(r"[0-9a-f]{64}", response.headers["ETag"].strip('"'))
        body = response.json()
        assert body["success"] is True
        assert _function_definition_keys() <= set(body["data"].keys())
        assert body["data"]["id"] == fn_id

    def test_returns_404_when_missing(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.get(f"/functions/{missing_id}")
        assert response.status_code == 404
        body = response.json()
        assert re.match(r"^Function '.+' not found$", body["error"]["message"])
        assert f"'{missing_id}'" in body["error"]["message"]


# ---------------------------------------------------------------------------
# POST /functions (create)
# ---------------------------------------------------------------------------


class TestCreateFunction:
    def test_returns_201_with_full_definition(self, client: TestClient) -> None:
        response = client.post("/functions", json=make_function_payload(name="created"))
        assert response.status_code == 201
        body = response.json()
        assert body["success"] is True
        assert _function_definition_keys() <= set(body["data"].keys())
        assert body["data"]["name"] == "created"
        # A fresh UUID is assigned by the service.
        uuid.UUID(body["data"]["id"])

    def test_returns_etag_header_on_create(self, client: TestClient) -> None:
        response = client.post("/functions", json=make_function_payload(name="etagged"))
        assert response.status_code == 201
        assert "ETag" in response.headers

    def test_returns_400_for_duplicate_name(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="dup"))
        response = client.post("/functions", json=make_function_payload(name="dup"))
        assert response.status_code == 400
        body = response.json()
        assert re.match(r"^Function name '.+' is already in use$", body["error"]["message"])

    def test_persists_inputs_and_outputs(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="with_params",
            inputs=[
                make_input("a", "string"),
                make_input("b", "integer", required=False, default=0),
            ],
            outputs=[make_output("r", "boolean")],
        )
        created = client.post("/functions", json=payload).json()["data"]
        assert len(created["inputs"]) == 2
        assert created["inputs"][0]["name"] == "a"
        assert created["inputs"][1]["required"] is False
        assert created["outputs"][0]["type"] == "boolean"


class TestCreateStoresNumbersInWireForm:
    """REQ-3.1.3.14: a Function save stores each typed number a client sends in wire form."""

    def test_declarations_and_body_blocks_are_stored_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import (
            BIG,
            SENT_HTTP_NUMBERS,
            STORED_HTTP_NUMBERS,
            TINY,
            http_node,
            http_numbers,
        )
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        register_plugin(HTTPClientPlugin())
        payload = make_function_payload(
            name="wire_numbers",
            inputs=[make_input("rate", "float", required=False, default=TINY)],
            outputs=[{**make_output("total", "integer"), "default": BIG}],
            variables=[
                {"name": "step", "type": "float", "value": 30.0},
                {"name": "half", "type": "float", "value": 2.5},
            ],
            workflow={
                "nodes": [http_node("body", **SENT_HTTP_NUMBERS)],
                "edges": [{"id": "e0", "source": "start-node", "target": "body"}],
            },
        )

        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text
        created = response.json()["data"]
        read = client.get(f"/functions/{created['id']}").json()["data"]

        for definition in (created, read):
            assert [
                definition["inputs"][0]["default"],
                definition["outputs"][0]["default"],
                [local["value"] for local in definition["variables"]],
                http_numbers(definition["workflow"]["nodes"][0]),
            ] == ["0.0000001", "1234567890123456789", ["30.0", 2.5], STORED_HTTP_NUMBERS]


# ---------------------------------------------------------------------------
# DELETE /functions/{id}
# ---------------------------------------------------------------------------


class TestDeleteFunction:
    def test_returns_204_when_no_dependents(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="goner")).json()
        fn_id = created["data"]["id"]
        response = client.delete(f"/functions/{fn_id}")
        assert response.status_code == 204
        # Subsequent GET must return 404.
        assert client.get(f"/functions/{fn_id}").status_code == 404

    def test_returns_404_when_missing(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.delete(f"/functions/{missing_id}")
        assert response.status_code == 404
        body = response.json()
        assert re.match(r"^Function '.+' not found$", body["error"]["message"])


# ---------------------------------------------------------------------------
# Router registration: ensure /functions actually exists.
# ---------------------------------------------------------------------------


class TestRouterRegistration:
    """The Function routers must be registered on the FastAPI app."""

    def test_functions_endpoint_is_routed(self, client: TestClient) -> None:
        response = client.get("/functions")
        # 200 means the route exists and handles the request. A missing router
        # would return 404 Not Found at the FastAPI level with the standard
        # "Not Found" detail, not our anchored error.
        assert response.status_code in (200, 400, 422), response.text

    def test_functions_tag_in_openapi(self, client: TestClient) -> None:
        schema = client.get("/openapi.json").json()
        # All Function endpoints declare the "Functions" tag.
        tagged = False
        for _path, methods in schema.get("paths", {}).items():
            for _method, op in methods.items():
                if "Functions" in op.get("tags", []):
                    tagged = True
                    break
        assert tagged, "no operation tagged 'Functions' in OpenAPI schema"


# pytest module-level guard: ensure the conftest helpers are importable.
def test_conftest_helpers_importable() -> None:
    assert "name" in make_function_payload(name="ok")
    assert make_input(name="x")["type"] == "string"
    assert make_output(name="r")["type"] == "string"


class TestListAllTags:
    def test_returns_empty_when_no_functions(self, client: TestClient) -> None:
        response = client.get("/functions/tags")
        assert response.status_code == 200
        body = response.json()
        assert body["data"] == []

    def test_returns_deduped_sorted_union_across_library(self, client: TestClient) -> None:
        client.post(
            "/functions",
            json=make_function_payload(name="a", tags=["mail", "demo"]),
        )
        client.post(
            "/functions",
            json=make_function_payload(name="b", tags=["payment", "mail"]),
        )
        response = client.get("/functions/tags")
        assert response.status_code == 200
        body = response.json()
        assert body["data"] == ["demo", "mail", "payment"]

    def test_skips_empty_and_non_string_tag_entries(self) -> None:
        """Tag entries that are empty strings or non-strings are filtered out."""
        from wavecore.api.services.functions import _storage
        from wavecore.api.services.functions.service import list_all_tags

        # Hand-craft a Function record with malformed tag entries directly via
        # the storage layer to exercise the service-level filtering.
        _storage.save_new_version(
            "00000000-0000-0000-0000-000000000aaa",
            "1.0.0",
            {
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            },
            {
                "description": "",
                "tags": ["good", "", 7, None, "good"],
                "published_at": "",
                "published_by": "wave",
            },
            name="malformed-tags",
        )
        assert list_all_tags() == ["good"]


class TestStructuralClassification:
    """`_classify_structural_errors` mixed-error branch: name + param errors."""

    def test_mixed_name_and_param_errors_route_to_validation_400(self, client: TestClient) -> None:
        payload = make_function_payload(name="")  # name required
        payload["inputs"] = [{"name": "x", "type": "blob"}]  # invalid type (param)
        response = client.post("/functions", json=payload)
        # Name takes precedence as the leading message → 400.
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["message"] == "Function name is required"
        # Both errors appear in error.details.errors.
        details = body["error"].get("details") or {}
        if isinstance(details, dict):
            errors = details.get("errors") or []
        else:
            errors = details
        messages = [item["message"] for item in errors if isinstance(item, dict)]
        assert "Function name is required" in messages
        assert any("invalid type" in m for m in messages)


pytestmark = pytest.mark.usefixtures("temp_storage_path")
