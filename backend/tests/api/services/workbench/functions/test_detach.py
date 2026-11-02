"""Tests for `services.workbench.functions.detach_published_instance`.

Contract:

    services.workbench.functions.detach_published_instance(test_id, node_id)
        Reads the library version the node pins (the latest when it pins none);
        deep-copies its definition into the Test's storage as the node's new
        localDefinition; clears functionId
        from the node; returns the updated node.
        Atomic: rolls back the Test mutation on storage failure.

Error messages are asserted with anchored regex.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from wavecore.api.exceptions import ConflictException, NotFoundException
from wavecore.api.services.functions import _storage as _function_storage
from wavecore.api.services.functions import service as functions_service
from wavecore.api.services.tests import service as test_service

from .conftest import make_local_function_node, make_test_with_function_node


def detach_published_instance(*args: Any, **kwargs: Any) -> Any:
    """Lazy proxy: re-binds to the real implementation at call-time so the
    test module collects without importing the public symbol from
    ``wavecore.api.services.workbench.functions`` up front."""
    from wavecore.api.services.workbench.functions import (
        detach_published_instance as _impl,
    )

    return _impl(*args, **kwargs)


# Anchored regex helpers for the exact strings.
TEST_NOT_FOUND_RE = re.compile(r"^Test '.+' not found$")
NODE_NOT_FOUND_RE = re.compile(r"^Block '.+' not found in Test '.+'$")
NOT_PUBLISHED_REF_RE = re.compile(r"^Block '.+' is not a published Function reference$")
LIBRARY_MISSING_RE = re.compile(r"^Library entry '.+' does not exist$")
PINNED_VERSION_MISSING_RE = re.compile(
    r"^Pinned version 1\.0\.0 is no longer available in the library$"
)


def _seed_published_function(
    *,
    name: str = "Library Fn",
    description: str = "Library record.",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a Published Function via the public service so all defaults apply."""
    payload: dict[str, Any] = {
        "name": name,
        "description": description,
        "tags": tags or [],
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
    definition, _etag = functions_service.create_function(payload)
    return definition


def _seed_library_function(name: str, **body: Any) -> dict[str, Any]:
    """Create a Published Function reading an optional ``count`` with ``body`` keys added."""
    payload: dict[str, Any] = {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [{"name": "count", "type": "integer", "required": False}],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
        **body,
    }
    definition, _etag = functions_service.create_function(payload)
    return definition


def _container_with_shared_node(node_id: str, function_id: str, version: str = "") -> str:
    """Create a Test holding one Shared instance of ``function_id``; returns its id."""
    shared_node = _make_shared_node(node_id=node_id, function_id=function_id)
    if version:
        shared_node["data"]["functionVersion"] = version
    created = test_service.create_test(
        {
            "name": "Container",
            "workflow": {
                "nodes": [shared_node],
                "edges": [{"source": "start-node", "target": node_id}],
            },
            "variables": {},
        }
    )
    return str(created["id"])


def _publish_next_version(function_id: str, name: str, version: str, **body: Any) -> None:
    """Publish ``version`` of ``function_id`` with ``body`` keys over an empty body."""
    _function_storage.save_new_version(
        function_id,
        version,
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            **body,
        },
        {"published_at": "2026-01-01T00:00:00Z", "published_by": "wave"},
        name=name,
    )


def _make_shared_node(
    *,
    node_id: str,
    function_id: str,
    profile_bindings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Shared Reference",
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "config": {
                "values": {},
                "outputBindings": {},
                "profileBindings": profile_bindings or [],
            },
        },
    }


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestDetachHappyPath:
    def test_node_lifecycle_becomes_local_with_copied_body(self) -> None:
        published = _seed_published_function(name="To Detach")
        shared_node = _make_shared_node(node_id="fn-shared", function_id=published["id"])
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-shared"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        result = detach_published_instance(test_id, "fn-shared")
        node = result["node"]
        assert node["data"]["functionLifecycle"] == "local"
        assert "functionId" not in node["data"]
        local_def = node["data"]["localDefinition"]
        assert local_def["name"] == "To Detach"
        # The body is a deep copy; mutating it must not affect the library entry.
        local_def["name"] = "Mutated"
        library_after, _ = _function_storage.load_function(published["id"])
        assert library_after["name"] == "To Detach"

    def test_library_entry_is_untouched_by_detach(self) -> None:
        """Make Local does not modify the library; the source entry stays."""
        published = _seed_published_function(name="Keep Library")
        shared_node = _make_shared_node(node_id="fn-shared", function_id=published["id"])
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-shared"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        detach_published_instance(test_id, "fn-shared")

        # Library entry still exists with its original name.
        reloaded, _etag = _function_storage.load_function(published["id"])
        assert reloaded["name"] == "Keep Library"

    def test_test_node_persists_with_local_definition(self) -> None:
        published = _seed_published_function(name="Persist Local")
        shared_node = _make_shared_node(node_id="fn-persist", function_id=published["id"])
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-persist"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        detach_published_instance(test_id, "fn-persist")

        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-persist")
        assert node["data"]["functionLifecycle"] == "local"
        assert isinstance(node["data"]["localDefinition"], dict)
        assert node["data"]["localDefinition"]["name"] == "Persist Local"

    def test_profile_bindings_on_instance_are_preserved(self) -> None:
        """Per-instance Profile bindings stay on the Test node across detach."""
        published = _seed_published_function(name="Bound Detach")
        shared_node = _make_shared_node(
            node_id="fn-bound",
            function_id=published["id"],
            profile_bindings=[{"profileId": "prof-A", "bindings": {}}],
        )
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-bound"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        result = detach_published_instance(test_id, "fn-bound")
        node = result["node"]
        bindings = node["data"]["config"]["profileBindings"]
        assert bindings == [{"profileId": "prof-A", "bindings": {}}]

    def test_detach_restores_the_functions_own_variables(self) -> None:
        """The local copy gets the version's own variables back (REQ-3.1.2.1)."""
        variables = [
            {"name": "fn_kept", "type": "string", "value": "kept"},
            {"name": "limit", "type": "integer", "value": 3},
        ]
        published = _seed_library_function("Detach Locals", variables=variables)
        test_id = _container_with_shared_node("fn-vars", published["id"])

        result = detach_published_instance(test_id, "fn-vars")

        assert result["node"]["data"]["localDefinition"].get("variables") == variables
        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-vars")
        assert node["data"]["localDefinition"].get("variables") == variables

    def test_detach_copies_the_pinned_version_not_the_latest(self) -> None:
        pinned_locals = [{"name": "fn_kept", "type": "string", "value": "from 1.0.0"}]
        published = _seed_library_function("Pinned Detach", variables=pinned_locals)
        _publish_next_version(
            published["id"],
            "Pinned Detach",
            "1.1.0",
            inputs=[{"name": "level_str", "type": "string", "required": False}],
            variables=[{"name": "fn_kept", "type": "string", "value": "from 1.1.0"}],
        )
        test_id = _container_with_shared_node("fn-pinned", published["id"], version="1.0.0")

        result = detach_published_instance(test_id, "fn-pinned")

        local_def = result["node"]["data"]["localDefinition"]
        assert [declared["name"] for declared in local_def["inputs"]] == ["count"]
        assert local_def["variables"] == pinned_locals
        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-pinned")
        assert [declared["name"] for declared in node["data"]["localDefinition"]["inputs"]] == [
            "count"
        ]

    @pytest.mark.parametrize(
        ("holder", "declared"),
        [
            pytest.param(
                "outputs",
                {"name": "total", "type": "integer", "isExpression": True, "default": "count * 2"},
                id="expression-output",
            ),
            pytest.param(
                "outputs",
                {
                    "name": "label",
                    "type": "string",
                    "isTemplate": True,
                    "default": "id-{{ count }}",
                },
                id="template-output",
            ),
            pytest.param(
                "variables",
                {"name": "doubled", "type": "integer", "isExpression": True, "value": "count * 2"},
                id="expression-local",
            ),
            pytest.param(
                "variables",
                {"name": "tag", "type": "string", "isTemplate": True, "value": "id-{{ count }}"},
                id="template-local",
            ),
        ],
    )
    def test_detach_keeps_the_kind_keys(self, holder: str, declared: dict[str, Any]) -> None:
        published = _seed_library_function("Detach Kinds", **{holder: [declared]})
        test_id = _container_with_shared_node("fn-kinds", published["id"])

        result = detach_published_instance(test_id, "fn-kinds")

        assert result["node"]["data"]["localDefinition"].get(holder) == [declared]


# ---------------------------------------------------------------------------
# Already-local rejection
# ---------------------------------------------------------------------------


class TestDetachAlreadyLocal:
    def test_local_node_raises_conflict(self) -> None:
        fn_node = make_local_function_node(node_id="fn-local", fn_name="Already Local")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        with pytest.raises(ConflictException, match=NOT_PUBLISHED_REF_RE):
            detach_published_instance(test_id, "fn-local")

    def test_plugin_node_raises_conflict(self) -> None:
        plugin_node = {
            "id": "plug-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "plug",
                "nodeType": "plugin",
                "elementType": "log",
                "version": "1.0.0",
                "config": {
                    "values": {"message": "'hi'", "level": "INFO"},
                    "outputBindings": {},
                },
                "expressionFields": ["message"],
            },
        }
        created = test_service.create_test(
            {
                "name": "Plug Container",
                "workflow": {
                    "nodes": [plugin_node],
                    "edges": [{"source": "start-node", "target": "plug-1"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        with pytest.raises(ConflictException, match=NOT_PUBLISHED_REF_RE):
            detach_published_instance(test_id, "plug-1")


# ---------------------------------------------------------------------------
# Missing library entry
# ---------------------------------------------------------------------------


class TestDetachMissingLibraryEntry:
    def test_shared_node_with_missing_function_id_raises_not_found(self) -> None:
        ghost_id = "00000000-0000-0000-0000-00000000beef"
        shared_node = _make_shared_node(node_id="fn-ghost", function_id=ghost_id)
        # The save pipeline rejects a missing library entry (REQ-3.1.2.4), so the
        # broken state is persisted directly.
        test_id = "11111111-1111-1111-1111-1111111100be"
        test_service._save_test(
            {
                "id": test_id,
                "name": "Ghost",
                "version": "1.0.0",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-ghost"}],
                },
                "variables": {},
            }
        )

        with pytest.raises(NotFoundException, match=LIBRARY_MISSING_RE):
            detach_published_instance(test_id, "fn-ghost")

    def test_missing_pinned_version_raises_not_found(self) -> None:
        published = _seed_library_function("Gone Version")
        _publish_next_version(published["id"], "Gone Version", "1.1.0")
        test_id = _container_with_shared_node("fn-gone", published["id"], version="1.0.0")
        _function_storage.delete_version(published["id"], "1.0.0")

        with pytest.raises(NotFoundException, match=PINNED_VERSION_MISSING_RE):
            detach_published_instance(test_id, "fn-gone")

        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-gone")
        assert node["data"]["functionLifecycle"] == "shared"


# ---------------------------------------------------------------------------
# Test / node lookup
# ---------------------------------------------------------------------------


class TestDetachLookupErrors:
    def test_unknown_test_id_raises_not_found(self) -> None:
        missing_test = "00000000-0000-0000-0000-000000000000"
        with pytest.raises(NotFoundException, match=TEST_NOT_FOUND_RE):
            detach_published_instance(missing_test, "fn-x")

    def test_unknown_node_id_raises_not_found(self) -> None:
        published = _seed_published_function()
        shared_node = _make_shared_node(node_id="fn-real", function_id=published["id"])
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-real"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]
        with pytest.raises(NotFoundException, match=NODE_NOT_FOUND_RE):
            detach_published_instance(test_id, "fn-missing")


# ---------------------------------------------------------------------------
# Atomicity: Test mutation failure rolls back the partial detach
# ---------------------------------------------------------------------------


class TestDetachAtomicity:
    def test_test_mutation_failure_rolls_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If saving the mutated Test fails, the node must remain in the shared state."""
        published = _seed_published_function(name="Atomic Detach")
        shared_node = _make_shared_node(node_id="fn-atomic", function_id=published["id"])
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-atomic"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        original_save = test_service._save_test

        def _exploding_save(test: dict[str, Any]) -> None:
            nodes = (test.get("workflow") or {}).get("nodes") or []
            if nodes and nodes[0].get("data", {}).get("functionLifecycle") == "local":
                raise OSError("disk full")
            original_save(test)

        monkeypatch.setattr(test_service, "_save_test", _exploding_save)

        with pytest.raises(OSError):
            detach_published_instance(test_id, "fn-atomic")

        # Library entry untouched.
        reloaded_lib, _ = _function_storage.load_function(published["id"])
        assert reloaded_lib["name"] == "Atomic Detach"

        # Test node still shared.
        reloaded_test = test_service.get_test(test_id)
        assert reloaded_test is not None
        node = next(n for n in reloaded_test["workflow"]["nodes"] if n["id"] == "fn-atomic")
        assert node["data"]["functionLifecycle"] == "shared"
        assert node["data"]["functionId"] == published["id"]


pytestmark = pytest.mark.usefixtures("temp_storage_path")
