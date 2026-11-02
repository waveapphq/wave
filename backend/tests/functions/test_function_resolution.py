"""Function resolution + missing-version validation tests (REQ-3.1.2.2).

Covers two related backend behaviors:

1. `_load_function_definition` extension: the workbench resolver returns
   the draft body when the node is in edit mode, otherwise resolves to the
   library version pinned by `functionVersion`.

2. Distinct validation codes: the save-validation pipeline surfaces
   `missing_function_id` when the library entry does not exist, and
   `missing_function_version` when the entry exists but the pinned version
   does not. The codes drive distinct FE error envelopes.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_function_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "inputs": overrides.pop("inputs", [{"name": "x", "type": "string", "required": True}]),
        "outputs": overrides.pop("outputs", [{"name": "result", "type": "string"}]),
        "dependencies": overrides.pop("dependencies", {"functions": [], "plugins": []}),
        "workflow": overrides.pop("workflow", {"nodes": [], "edges": []}),
    }


def _make_metadata(**overrides: Any) -> dict[str, Any]:
    return {
        "description": overrides.pop("description", "say hello"),
        "tags": overrides.pop("tags", ["demo"]),
        "changelog": overrides.pop("changelog", "initial"),
        "details": overrides.pop("details", ""),
        "published_at": overrides.pop("published_at", "2026-01-01T00:00:00Z"),
        "published_by": overrides.pop("published_by", "wave"),
    }


def _seed_library_function(name: str = "greet", version: str = "1.0.0") -> str:
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(fn_id, version, _make_function_payload(), _make_metadata(), name=name)
    return fn_id


def _shared_node_data(*, function_id: str, version: str, label: str = "Greet") -> dict[str, Any]:
    return {
        "label": label,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "functionVersion": version,
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }


def _edit_mode_node_data(
    *,
    function_id: str,
    source_version: str,
    draft: dict[str, Any],
    label: str = "Greet",
) -> dict[str, Any]:
    return {
        "label": label,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "functionVersion": source_version,
        "editMode": True,
        "upstreamLink": {
            "functionId": function_id,
            "sourceVersion": source_version,
        },
        "draft": draft,
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }


def _local_node_data(name: str = "LocalGreet") -> dict[str, Any]:
    return {
        "label": name,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "local",
        "localDefinition": {
            "name": name,
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }


def _caller_definition(*, function_id: str, version: str) -> dict[str, Any]:
    """A Function definition whose body calls ``function_id`` at ``version``."""
    return {
        "name": "caller",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "ref-node",
                    "data": _shared_node_data(
                        function_id=function_id, version=version, label="ref"
                    ),
                }
            ],
            "edges": [{"source": "start-node", "target": "ref-node"}],
        },
    }


# ===========================================================================
# `_load_function_definition` - workbench resolver
# ===========================================================================


class TestLoadFunctionDefinitionLocal:
    """Local lifecycle: resolver returns the inlined `localDefinition`."""

    def test_returns_local_definition_for_local_node(self) -> None:
        from wavecore.api.services.workbench.functions import _load_function_definition

        data = _local_node_data(name="L1")
        result = _load_function_definition(data)
        assert result is data["localDefinition"]

    def test_raises_when_local_definition_missing(self) -> None:
        from wavecore.api.services.workbench.functions import _load_function_definition

        data = {
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "local",
        }
        with pytest.raises(RuntimeError):
            _load_function_definition(data)


class TestLoadFunctionDefinitionPinnedVersion:
    """Shared lifecycle: resolver loads the version named by `functionVersion`."""

    def test_returns_pinned_version_definition(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = _seed_library_function()
        # Add a second version with a distinct description so we can verify
        # the resolver returns the pinned version, not the latest.
        save_new_version(
            fn_id,
            "2.0.0",
            _make_function_payload(),
            _make_metadata(description="v2 desc"),
            name="greet",
        )
        data = _shared_node_data(function_id=fn_id, version="1.0.0")
        result = _load_function_definition(data)
        # The pinned version's definition is returned, not the latest.
        assert result["version"] == "1.0.0"
        assert result["description"] == "say hello"

    def test_missing_function_id_raises(self) -> None:
        from wavecore.api.services.workbench.functions import _load_function_definition

        data = _shared_node_data(function_id="", version="1.0.0")
        # functionId is required for shared lifecycle.
        with pytest.raises(RuntimeError):
            _load_function_definition(data)

    def test_missing_version_raises_named_error(self) -> None:
        """The resolver surfaces the canonical version-not-found message."""
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = _seed_library_function()
        data = _shared_node_data(function_id=fn_id, version="9.9.9")
        with pytest.raises(RuntimeError) as excinfo:
            _load_function_definition(data)
        # The resolver propagates the storage layer's exact error wording so
        # the execution engine's catch-and-surface path remains useful.
        message = str(excinfo.value)
        assert f"Function '{fn_id}' version '9.9.9' not found" in message


class TestLoadFunctionDefinitionEditMode:
    """When `editMode: true`, the resolver returns the inline `draft` body."""

    def test_returns_draft_when_edit_mode_active(self) -> None:
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = _seed_library_function()
        draft = {
            "name": "greet",
            "description": "drafted",
            "tags": ["demo"],
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [{"id": "n-draft"}], "edges": []},
        }
        data = _edit_mode_node_data(function_id=fn_id, source_version="1.0.0", draft=draft)
        result = _load_function_definition(data)
        # The DRAFT body is returned, not the source version's body. The draft
        # carries unpublished changes that the engine must execute.
        assert result is data["draft"]
        assert result["description"] == "drafted"

    def test_edit_mode_with_missing_source_falls_back_to_draft(self) -> None:
        """If the source version is gone, the draft is still self-contained.

        'The draft body is what the execution engine runs as long as
        the instance carries editMode: true ... survives library version
        deletion (draft is self-contained)'.
        """
        from wavecore.api.services.functions._storage import (
            delete_function_file,
        )
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = _seed_library_function()
        draft = {
            "name": "greet",
            "description": "drafted",
            "tags": ["demo"],
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        }
        data = _edit_mode_node_data(function_id=fn_id, source_version="1.0.0", draft=draft)
        # Delete the library entry entirely; the draft must still resolve.
        delete_function_file(fn_id)
        result = _load_function_definition(data)
        assert result is data["draft"]


# ===========================================================================
# Distinct validation codes for missing id vs missing version
# ===========================================================================


class TestMissingFunctionIdValidationCode:
    """Save-validation surfaces `missing_function_id` when the library entry is gone."""

    def test_unknown_function_id_surfaces_missing_function_id_code(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        unknown_id = str(uuid.uuid4())
        definition_with_unknown_ref = {
            "name": "caller",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    {
                        "id": "ref-node",
                        "data": {
                            "label": "ref",
                            "nodeType": "function",
                            "elementType": "function",
                            "functionLifecycle": "shared",
                            "functionId": unknown_id,
                            "functionVersion": "1.0.0",
                        },
                    }
                ],
                "edges": [{"source": "start-node", "target": "ref-node"}],
            },
        }
        issues = validate_function_for_save(definition_with_unknown_ref, function_registry={})
        codes = {issue.code for issue in issues}
        assert "MISSING_FUNCTION_ID" in codes

    def test_the_finding_carries_the_function_id_and_the_function_version(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        unknown_id = str(uuid.uuid4())
        issues = validate_function_for_save(
            _caller_definition(function_id=unknown_id, version="1.0.0"), function_registry={}
        )
        findings = [issue for issue in issues if issue.code == "MISSING_FUNCTION_ID"]
        assert len(findings) == 1
        assert re.fullmatch(
            rf"^References unknown Function '{re.escape(unknown_id)}'$", findings[0].message
        )
        assert findings[0].function_id == unknown_id
        assert findings[0].function_version == "1.0.0"


class TestMissingFunctionVersionValidationCode:
    """Save-validation surfaces `missing_function_version` distinct from `missing_function_id`."""

    def test_known_id_unknown_version_surfaces_missing_function_version_code(
        self,
    ) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        fn_id = _seed_library_function()  # creates v1.0.0
        # Build a library registry that mirrors the real shape - the function
        # IS in the registry, but its available_versions does not include the
        # pinned version on the reference node below.
        library_entry = {
            "id": fn_id,
            "name": "greet",
            "description": "say hello",
            "tags": ["demo"],
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
            "available_versions": ["1.0.0"],
        }
        definition_with_bad_pin = {
            "name": "caller",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    {
                        "id": "ref-node",
                        "data": {
                            "label": "ref",
                            "nodeType": "function",
                            "elementType": "function",
                            "functionLifecycle": "shared",
                            "functionId": fn_id,
                            "functionVersion": "9.9.9",
                        },
                    }
                ],
                "edges": [{"source": "start-node", "target": "ref-node"}],
            },
        }
        issues = validate_function_for_save(
            definition_with_bad_pin, function_registry={fn_id: library_entry}
        )
        codes = {issue.code for issue in issues}
        # Distinct from missing_function_id: the id IS known, only the version isn't.
        assert "MISSING_FUNCTION_VERSION" in codes
        assert "MISSING_FUNCTION_ID" not in codes

    def test_message_names_missing_version_without_uuid(self) -> None:
        """The validation issue uses the reworded missing-version wording:
        it names the pinned version and never leaks the raw Function UUID."""
        from wavecore.api.services.functions._storage import validate_function_for_save

        fn_id = _seed_library_function()
        library_entry = {
            "id": fn_id,
            "name": "greet",
            "description": "say hello",
            "tags": ["demo"],
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
            "available_versions": ["1.0.0"],
        }
        definition_with_bad_pin = {
            "name": "caller",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    {
                        "id": "ref-node",
                        "data": {
                            "label": "ref",
                            "nodeType": "function",
                            "elementType": "function",
                            "functionLifecycle": "shared",
                            "functionId": fn_id,
                            "functionVersion": "9.9.9",
                        },
                    }
                ],
                "edges": [],
            },
        }
        issues = validate_function_for_save(
            definition_with_bad_pin, function_registry={fn_id: library_entry}
        )
        version_issues = [i for i in issues if i.code == "MISSING_FUNCTION_VERSION"]
        assert version_issues
        # The reworded message names the pinned version for the no-code author
        # and drops the meaningless raw Function UUID (CANVAS-218).
        message = version_issues[0].message
        assert message == "Pinned version 9.9.9 is no longer available in the library"
        assert fn_id not in message

    def test_the_finding_carries_the_function_id_and_the_function_version(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        fn_id = str(uuid.uuid4())
        library_entry = {"id": fn_id, "name": "greet", "available_versions": ["1.0.0"]}
        issues = validate_function_for_save(
            _caller_definition(function_id=fn_id, version="9.9.9"),
            function_registry={fn_id: library_entry},
        )
        findings = [issue for issue in issues if issue.code == "MISSING_FUNCTION_VERSION"]
        assert len(findings) == 1
        assert re.fullmatch(
            r"^Pinned version 9\.9\.9 is no longer available in the library$", findings[0].message
        )
        assert findings[0].function_id == fn_id
        assert findings[0].function_version == "9.9.9"


class TestKnownVersionDoesNotProduceMissingVersionIssue:
    """Sanity: a node pinned to a version that IS available produces no missing-version issue."""

    def test_known_version_clean_validation(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        fn_id = _seed_library_function()
        library_entry = {
            "id": fn_id,
            "name": "greet",
            "description": "say hello",
            "tags": ["demo"],
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
            "available_versions": ["1.0.0"],
        }
        definition = {
            "name": "caller",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    {
                        "id": "ref-node",
                        "data": {
                            "label": "ref",
                            "nodeType": "function",
                            "elementType": "function",
                            "functionLifecycle": "shared",
                            "functionId": fn_id,
                            "functionVersion": "1.0.0",
                        },
                    }
                ],
                "edges": [],
            },
        }
        issues = validate_function_for_save(definition, function_registry={fn_id: library_entry})
        codes = {issue.code for issue in issues}
        assert "MISSING_FUNCTION_VERSION" not in codes
        assert "MISSING_FUNCTION_ID" not in codes


pytestmark = pytest.mark.usefixtures("temp_storage_path")
