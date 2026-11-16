"""The BE edit-mode enter/drop endpoints do not exist (REQ-3.1.2.2).

Edit-mode entry and drop are client-side store mutations that persist only
through the normal Test Save:

POST   /tests/{test_id}/functions/{node_id}/edit-mode  -> 404 (no route)
DELETE /tests/{test_id}/functions/{node_id}/edit-mode  -> 404 (no route)

A missing route returns FastAPI's default ``{"detail": "Not Found"}`` envelope,
which distinguishes it from the custom ``{"success": false, "error": {...}}``
404 for a missing Test. The scenarios below seed a real Published instance, so a
plain 404-for-missing-entity would falsely pass.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.tests import service as test_service


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _seed_library_function(name: str = "greet", version: str = "1.0.0") -> str:
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(
        fn_id,
        version,
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "say hello",
            "tags": [],
            "changelog": "initial",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )
    return fn_id


def _shared_function_node(*, node_id: str, function_id: str, version: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Greet",
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": version,
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _seed_test_with_published_node(node_id: str = "fn-1") -> str:
    fn_id = _seed_library_function()
    test_id = str(uuid.uuid4())
    test_service._save_test(
        {
            "id": test_id,
            "name": "Container",
            "version": "1.0.0",
            "workflow": {
                "nodes": [
                    _shared_function_node(node_id=node_id, function_id=fn_id, version="1.0.0")
                ],
                "edges": [{"source": "start-node", "target": node_id}],
            },
            "variables": {},
        }
    )
    return test_id


class TestEnterEditModeHasNoRoute:
    def test_post_edit_mode_answers_the_default_404(self, client: TestClient) -> None:
        test_id = _seed_test_with_published_node("fn-1")
        response = client.post(f"/tests/{test_id}/functions/fn-1/edit-mode")
        assert response.status_code == 404, response.text
        # FastAPI's default body for an unregistered route (not the custom envelope).
        assert response.json() == {"detail": "Not Found"}


class TestDropEditModeHasNoRoute:
    def test_delete_edit_mode_answers_the_default_404(self, client: TestClient) -> None:
        test_id = _seed_test_with_published_node("fn-1")
        response = client.delete(f"/tests/{test_id}/functions/fn-1/edit-mode")
        assert response.status_code == 404, response.text
        assert response.json() == {"detail": "Not Found"}


pytestmark = pytest.mark.usefixtures("temp_storage_path")
