"""Tests for per-instance Profile bindings on Function nodes.

Contract (FN-LC-10):

    Add profile_bindings field on workflow NODES (instances), not on the
    library entry. The library entry never carries profile bindings.

This file asserts the round-trip contract: when a Local Function node carrying
profileBindings is published, the bindings are stripped from the library
record; when the same library entry is detached back into a Test, the bindings
on the Test node are preserved (because they live on the instance, not the
library).
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services.functions import _storage as _function_storage
from wavecore.api.services.functions import service as functions_service
from wavecore.api.services.tests import service as test_service


def publish_local_function(*args: Any, **kwargs: Any) -> Any:
    """Lazy proxy that imports the implementation on first call."""
    from wavecore.api.services.workbench.functions import (
        publish_local_function as _impl,
    )

    return _impl(*args, **kwargs)


def detach_published_instance(*args: Any, **kwargs: Any) -> Any:
    """Lazy proxy that imports the implementation on first call."""
    from wavecore.api.services.workbench.functions import (
        detach_published_instance as _impl,
    )

    return _impl(*args, **kwargs)


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


def _make_local_function_node_with_bindings(
    bindings: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Bound Function",
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "Bound Function",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": ["log"]},
                "workflow": {
                    "nodes": [
                        {
                            "id": "inner_log",
                            "type": "workflowNode",
                            "data": {
                                "label": "inner_log",
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "config": {
                                    "values": {"message": "'hi'", "level": "INFO"},
                                    "outputBindings": {},
                                },
                                "expressionFields": ["message"],
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "inner_log"}],
                },
            },
            "config": {
                "values": {},
                "outputBindings": {},
                "profileBindings": bindings,
            },
        },
    }


def _seed_test_with_node(node: dict[str, Any]) -> str:
    created = test_service.create_test(
        {
            "name": "Container",
            "workflow": {
                "nodes": [node],
                "edges": [{"source": "start-node", "target": node["id"]}],
            },
            "variables": {},
        }
    )
    return created["id"]


# ---------------------------------------------------------------------------
# Publish strips profileBindings from the library record
# ---------------------------------------------------------------------------


class TestPublishStripsLibraryBindings:
    def test_library_entry_has_no_profile_bindings(self) -> None:
        node = _make_local_function_node_with_bindings([{"profileId": "prof-A", "bindings": {}}])
        test_id = _seed_test_with_node(node)

        result = publish_local_function(
            test_id,
            "fn-1",
            {
                "name": "Bound Function",
                "description": "",
                "tags": [],
                "changelog": "",
                "details": "",
            },
        )
        function_id = result["function_id"]
        definition, _etag = _function_storage.load_function(function_id)
        # Library record never carries profileBindings (camelCase or snake_case).
        assert "profileBindings" not in definition
        assert "profile_bindings" not in definition
        # Nested local fields also have no instance bindings (deep check on
        # the library entry's workflow): inner nodes have their own configs,
        # but none of them is a Function-instance config carrying bindings
        # for the published Function itself.

    def test_test_node_keeps_bindings_after_publish(self) -> None:
        node = _make_local_function_node_with_bindings(
            [{"profileId": "prof-A", "bindings": {"endpoint": "https://example.com"}}]
        )
        test_id = _seed_test_with_node(node)

        publish_local_function(
            test_id,
            "fn-1",
            {
                "name": "Bound Function",
                "description": "",
                "tags": [],
                "changelog": "",
                "details": "",
            },
        )

        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node_after = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-1")
        bindings = node_after["data"]["config"]["profileBindings"]
        assert bindings == [
            {"profileId": "prof-A", "bindings": {"endpoint": "https://example.com"}}
        ]


# ---------------------------------------------------------------------------
# Detach preserves the instance's profileBindings
# ---------------------------------------------------------------------------


class TestDetachPreservesInstanceBindings:
    def test_bindings_survive_detach(self) -> None:
        # Seed a Published Function via the library API directly so we can
        # control its definition shape; then attach a shared node to a Test
        # with its own per-instance profileBindings.
        definition, _etag = functions_service.create_function(
            {
                "name": "Library Fn",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": ["log"]},
                "workflow": {
                    "nodes": [
                        {
                            "id": "inner_log",
                            "type": "workflowNode",
                            "data": {
                                "label": "inner_log",
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "config": {
                                    "values": {"message": "'hi'", "level": "INFO"},
                                    "outputBindings": {},
                                },
                                "expressionFields": ["message"],
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "inner_log"}],
                },
            }
        )
        shared_node: dict[str, Any] = {
            "id": "fn-shared",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "Shared Reference",
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": definition["id"],
                "config": {
                    "values": {},
                    "outputBindings": {},
                    "profileBindings": [{"profileId": "prof-X", "bindings": {}}],
                },
            },
        }
        test_id = _seed_test_with_node(shared_node)

        result = detach_published_instance(test_id, "fn-shared")
        bindings = result["node"]["data"]["config"]["profileBindings"]
        assert bindings == [{"profileId": "prof-X", "bindings": {}}]

    def test_library_entry_remains_binding_free_after_detach(self) -> None:
        """Detach must not mutate the library entry's profile-bindings shape."""
        definition, _etag = functions_service.create_function(
            {
                "name": "Library Fn 2",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            }
        )
        shared_node = {
            "id": "fn-x",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "Ref",
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": definition["id"],
                "config": {
                    "values": {},
                    "outputBindings": {},
                    "profileBindings": [{"profileId": "prof-Y", "bindings": {}}],
                },
            },
        }
        test_id = _seed_test_with_node(shared_node)

        detach_published_instance(test_id, "fn-x")

        reloaded, _ = _function_storage.load_function(definition["id"])
        assert "profileBindings" not in reloaded
        assert "profile_bindings" not in reloaded


# ---------------------------------------------------------------------------
# Round-trip: publish then detach
# ---------------------------------------------------------------------------


class TestRoundTripBindings:
    def test_publish_then_detach_preserves_bindings(self) -> None:
        node = _make_local_function_node_with_bindings(
            [{"profileId": "prof-rt", "bindings": {"k": "v"}}]
        )
        test_id = _seed_test_with_node(node)

        publish_local_function(
            test_id,
            "fn-1",
            {
                "name": "Round Trip",
                "description": "",
                "tags": [],
                "changelog": "",
                "details": "",
            },
        )
        # Bindings survived publish.
        after_publish = test_service.get_test(test_id)
        assert after_publish is not None
        after_pub_node = next(n for n in after_publish["workflow"]["nodes"] if n["id"] == "fn-1")
        assert after_pub_node["data"]["config"]["profileBindings"] == [
            {"profileId": "prof-rt", "bindings": {"k": "v"}}
        ]

        detach_result = detach_published_instance(test_id, "fn-1")
        assert detach_result["node"]["data"]["config"]["profileBindings"] == [
            {"profileId": "prof-rt", "bindings": {"k": "v"}}
        ]


pytestmark = pytest.mark.usefixtures("temp_storage_path")
