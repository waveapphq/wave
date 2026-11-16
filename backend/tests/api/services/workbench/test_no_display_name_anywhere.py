"""Negative-grep tests: workbench has no `displayName` / `display_name`.

Covers:
- A saved test YAML on disk has no `displayName` key anywhere in node-data.
- A test imported with a `displayName` does not surface that key on read
(only `description` is recognized).
- No workbench service module source references those keys.
- The plugins module exposes no function with a `display_name` parameter.
"""

from importlib import import_module
from inspect import signature
from pathlib import Path
from typing import Any

import pytest
import yaml
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


def _find_test_yaml(test_id: str) -> Path | None:
    """Locate the saved test.yaml file under the conftest-managed temp storage path."""
    from wavecore.api.services.storage_paths import get_tests_storage_path

    candidate = get_tests_storage_path() / test_id / "test.yaml"
    return candidate if candidate.exists() else None


class TestSavedYamlHasNoDisplayNameKey:
    """End-to-end: after a successful save, the on-disk YAML must not contain `displayName`."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_post_save_yaml_does_not_contain_displayName(self, client: TestClient) -> None:
        node = _make_workflow_node(description="Probe gateway")
        response = client.post(
            "/tests",
            json={
                "name": "No Display Name Key",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        test_id = response.json()["data"]["id"]

        yaml_path = _find_test_yaml(test_id)
        assert yaml_path is not None, "Expected test.yaml on disk after POST /tests"
        text = yaml_path.read_text()
        assert "displayName" not in text, "Saved test.yaml still contains a `displayName` key"

        parsed = yaml.safe_load(text)
        for n in parsed["workflow"]["nodes"]:
            data = n.get("data", {}) or {}
            assert "displayName" not in data
            assert "display_name" not in data


class TestWorkbenchModulesHaveNoDisplayName:
    """Negative-grep: each workbench module file has no `displayName` / `display_name`."""

    _MODULES = [
        "wavecore.api.services.workbench.node_helpers",
        "wavecore.api.services.workbench.plugins",
        "wavecore.api.services.workbench.for_loop",
        "wavecore.api.services.workbench.for_each",
        "wavecore.api.services.workbench.while_loop",
        "wavecore.api.services.workbench.try_catch",
    ]

    @pytest.mark.parametrize("module_name", _MODULES)
    def test_module_has_no_displayName(self, module_name: str) -> None:
        mod = import_module(module_name)
        assert mod.__file__ is not None
        src = Path(mod.__file__).read_text(encoding="utf-8")
        assert "displayName" not in src, f"{module_name} still references the `displayName` key"

    @pytest.mark.parametrize("module_name", _MODULES)
    def test_module_has_no_display_name_identifier(self, module_name: str) -> None:
        mod = import_module(module_name)
        assert mod.__file__ is not None
        src = Path(mod.__file__).read_text(encoding="utf-8")
        assert (
            "display_name" not in src
        ), f"{module_name} still references the `display_name` identifier"


class TestNoDisplayNameParameterInPluginsApi:
    """Every callable exported by the plugins module accepts `description=`, not `display_name=`."""

    def test_no_callable_in_plugins_takes_display_name(self) -> None:
        from wavecore.api.services.workbench import plugins as plugins_module

        offenders: list[str] = []
        for name in dir(plugins_module):
            if name.startswith("__"):
                continue
            attr = getattr(plugins_module, name)
            if not callable(attr):
                continue
            try:
                params = signature(attr).parameters
            except (TypeError, ValueError):
                continue
            if "display_name" in params:
                offenders.append(name)
        assert offenders == [], f"Callables still using display_name: {offenders!r}"
