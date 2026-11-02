"""Tests that node `description` round-trips through POST -> GET unchanged.

Covers:
- POST /tests with `workflow.nodes[].data.description` echoes the field on the response.
- GET /tests/{id} returns the same description.
- PUT /tests/{id} updates the description; subsequent GET reflects it.
- Multiline descriptions are preserved verbatim.
- Whitespace inside the description is preserved.
- A node without a description does not have the key in the returned payload (or it is absent /
  empty).
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.tests import service as test_service


def _reset_storage_and_registry() -> None:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.http_client import HTTPClientPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(HTTPClientPlugin())


def _make_workflow_node(
    *,
    node_id: str = "node-1",
    description: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "elementType": "http-client",
        "nodeType": "plugin",
        "version": "1.0.0",
        "label": "HTTP Probe",
        "config": {"values": {"method": "GET", "url": "http://example.com"}},
    }
    if description is not None:
        data["description"] = description
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": data,
    }


class TestDescriptionRoundTrip:
    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_post_get_simple_description(self, client: TestClient) -> None:
        node = _make_workflow_node(description="Probe gateway")
        response = client.post(
            "/tests",
            json={
                "name": "Round Trip 1",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        assert get_response.status_code == 200
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        assert nodes[0]["data"]["description"] == "Probe gateway"

    def test_post_get_multiline_description(self, client: TestClient) -> None:
        multiline = "Line one\nLine two\nLine three"
        node = _make_workflow_node(description=multiline)
        response = client.post(
            "/tests",
            json={
                "name": "Round Trip Multiline",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        assert get_response.status_code == 200
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        assert nodes[0]["data"]["description"] == multiline

    def test_post_get_whitespace_preserved(self, client: TestClient) -> None:
        ws_desc = "  leading and trailing whitespace  "
        node = _make_workflow_node(description=ws_desc)
        response = client.post(
            "/tests",
            json={
                "name": "Round Trip Whitespace",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        assert nodes[0]["data"]["description"] == ws_desc

    def test_post_get_unicode_description(self, client: TestClient) -> None:
        unicode_desc = "Probe gateway - é, ø, 你好, مرحبا"
        node = _make_workflow_node(description=unicode_desc)
        response = client.post(
            "/tests",
            json={
                "name": "Round Trip Unicode",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        assert nodes[0]["data"]["description"] == unicode_desc

    def test_put_updates_description(self, client: TestClient) -> None:
        node = _make_workflow_node(description="Original")
        post_response = client.post(
            "/tests",
            json={
                "name": "Put Update",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert post_response.status_code == 201
        test_id = post_response.json()["data"]["id"]

        updated_node = _make_workflow_node(description="Updated")
        put_response = client.put(
            f"/tests/{test_id}",
            json={
                "name": "Put Update",
                "workflow": {"nodes": [updated_node], "edges": []},
            },
        )
        assert put_response.status_code == 200

        get_response = client.get(f"/tests/{test_id}")
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        assert nodes[0]["data"]["description"] == "Updated"

    def test_absent_description_on_get_is_absent_or_empty(self, client: TestClient) -> None:
        """A node POSTed without description must not surface a synthesized description."""
        node = _make_workflow_node(description=None)
        post_response = client.post(
            "/tests",
            json={
                "name": "No Desc",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert post_response.status_code == 201
        test_id = post_response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        nodes = get_response.json()["data"]["workflow"]["nodes"]
        # Either the key is absent OR equal to empty string. Either is valid.
        # A non-empty default is a contract violation.
        desc = nodes[0]["data"].get("description", None)
        assert desc in (None, "")

    def test_post_does_not_introduce_displayName(self, client: TestClient) -> None:
        """Negative: the response payload never carries a `displayName` field."""
        node = _make_workflow_node(description="Probe gateway")
        response = client.post(
            "/tests",
            json={
                "name": "No DisplayName Surface",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]
        get_response = client.get(f"/tests/{test_id}")
        node_data = get_response.json()["data"]["workflow"]["nodes"][0]["data"]
        assert "displayName" not in node_data
        assert "display_name" not in node_data

    def test_multiple_nodes_each_keep_their_description(self, client: TestClient) -> None:
        nodes = [
            _make_workflow_node(node_id=f"node-{i}", description=f"Description {i}")
            for i in range(3)
        ]
        response = client.post(
            "/tests",
            json={
                "name": "Multi Node Desc",
                "workflow": {"nodes": nodes, "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        get_response = client.get(f"/tests/{test_id}")
        out_nodes = get_response.json()["data"]["workflow"]["nodes"]
        for i, n in enumerate(out_nodes):
            assert n["data"]["description"] == f"Description {i}"
