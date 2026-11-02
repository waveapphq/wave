"""A block saved or imported with no Name is named after its type (EXEC-25, EXEC-26).

The default Name is the type's name as the palette shows it, the same name the
console Source uses: the palette table, else the catalog name, else the type id.
"""

from collections.abc import Iterator
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore import plugins
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench.block_source import node_source
from wavecore.controls.registry import _registry as control_registry
from wavecore.controls.registry import register_all_core_controls
from wavecore.core.plugin_registry import clear_registry, register_plugin
from wavecore.plugins.base import PluginBase

# Type id, node type, the Name the block gets.
TYPE_NAMES = [
    pytest.param("for", "control", "For Loop", id="for"),
    pytest.param("csv-parser", "plugin", "CSV", id="csv-parser"),
    pytest.param("ssh-session-exec", "plugin", "SSH Session Exec", id="ssh-session-exec"),
    pytest.param("try-catch-finally", "control", "Try / Catch", id="try-catch-finally"),
    pytest.param("http-client", "plugin", "HTTP", id="http-client"),
    pytest.param("function", "function", "Function", id="function-block"),
    pytest.param("my-custom-block", "plugin", "my-custom-block", id="unknown-to-the-catalog"),
]


@pytest.fixture(autouse=True)
def shipped_blocks() -> Iterator[None]:
    """Every plugin and control WAVE ships, registered as at startup."""
    control_registry.clear()
    register_all_core_controls(control_registry)
    clear_registry()
    for exported_name in plugins.__all__:
        exported = getattr(plugins, exported_name)
        if isinstance(exported, type) and issubclass(exported, PluginBase):
            register_plugin(exported())
    yield
    clear_registry()


def _unnamed(element_type: str | None, node_type: str, node_id: str = "node-1") -> dict[str, Any]:
    data: dict[str, Any] = {"nodeType": node_type, "version": "1.0.0", "label": ""}
    if element_type is not None:
        data["elementType"] = element_type
    return {"id": node_id, "type": "workflowNode", "position": {"x": 100, "y": 100}, "data": data}


def _for_loop(label: str | None) -> dict[str, Any]:
    """A For Loop as the canvas stores it, with the Name given or left out."""
    node = _unnamed("for", "control")
    node["data"]["config"] = {"values": {"mode": "count", "count": 2}}
    if label is None:
        del node["data"]["label"]
    else:
        node["data"]["label"] = label
    return node


class TestTheSaveFixer:
    """What Fix and the save path name a block that has no Name."""

    @pytest.mark.parametrize(("element_type", "node_type", "name"), TYPE_NAMES)
    def test_the_block_is_named_after_its_type(
        self, element_type: str, node_type: str, name: str
    ) -> None:
        nodes = [_unnamed(element_type, node_type)]

        test_service._fix_node_label(nodes, "node-1", "MISSING_LABEL")

        assert nodes[0]["data"]["label"] == name
        assert node_source(nodes[0]) == name

    def test_a_block_with_no_type_is_named_unknown(self) -> None:
        nodes = [_unnamed(None, "plugin")]

        test_service._fix_node_label(nodes, "node-1", "MISSING_LABEL")

        assert nodes[0]["data"]["label"] == "Unknown"

    def test_two_blocks_of_one_type_get_the_same_name(self) -> None:
        nodes = [_unnamed("for", "control", "node-1"), _unnamed("for", "control", "node-2")]

        test_service._fix_node_label(nodes, "node-1", "MISSING_LABEL")
        test_service._fix_node_label(nodes, "node-2", "MISSING_LABEL")

        assert [node["data"]["label"] for node in nodes] == ["For Loop", "For Loop"]

    def test_a_block_that_is_not_there_changes_nothing(self) -> None:
        nodes = [_unnamed("for", "control")]

        test_service._fix_node_label(nodes, "node-9", "MISSING_LABEL")

        assert nodes[0]["data"]["label"] == ""


class TestTheImportFixer:
    """What an import names a block that has no Name, and what it reports."""

    @pytest.mark.parametrize(("element_type", "node_type", "name"), TYPE_NAMES)
    def test_the_block_is_named_after_its_type(
        self, element_type: str, node_type: str, name: str
    ) -> None:
        nodes = [_unnamed(element_type, node_type)]
        applied: list[str] = []

        test_service._import_fix_label(nodes, "node-1", applied)

        assert nodes[0]["data"]["label"] == name
        assert applied == [f"Added name '{name}' to block node-1"]

    def test_a_block_with_no_type_is_named_unknown(self) -> None:
        nodes = [_unnamed(None, "plugin")]
        applied: list[str] = []

        test_service._import_fix_label(nodes, "node-1", applied)

        assert nodes[0]["data"]["label"] == "Unknown"
        assert applied == ["Added name 'Unknown' to block node-1"]

    def test_a_block_that_is_not_there_changes_nothing(self) -> None:
        nodes = [_unnamed("for", "control")]
        applied: list[str] = []

        test_service._import_fix_label(nodes, "node-9", applied)

        assert (nodes[0]["data"]["label"], applied) == ("", [])


class TestThroughTheApi:
    """A For Loop that arrives with no Name is stored as For Loop."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize("label", ["", "   ", None], ids=["empty", "spaces", "missing"])
    def test_a_saved_for_loop_is_stored_as_for_loop(
        self, client: TestClient, label: str | None
    ) -> None:
        document = {"name": "Unnamed loop", "workflow": {"nodes": [_for_loop(label)], "edges": []}}

        created = client.post("/tests", json=document)

        assert created.status_code == 201, created.text
        test_id = created.json()["data"]["id"]
        stored = client.get(f"/tests/{test_id}").json()["data"]["workflow"]["nodes"]
        assert [node["data"]["label"] for node in stored] == ["For Loop"]
        assert [node_source(node) for node in stored] == ["For Loop"]

    def test_a_for_loop_saved_in_a_local_function_is_stored_as_for_loop(
        self, client: TestClient
    ) -> None:
        local = _local_function("fn-1", [_for_loop("")])
        document = {"name": "Unnamed inner loop", "workflow": {"nodes": [local], "edges": []}}

        created = client.post("/tests", json=document)

        assert created.status_code == 201, created.text
        test_id = created.json()["data"]["id"]
        [stored] = client.get(f"/tests/{test_id}").json()["data"]["workflow"]["nodes"]
        body = stored["data"]["localDefinition"]["workflow"]["nodes"]
        assert [node["data"]["label"] for node in body] == ["For Loop"]

    def test_an_imported_for_loop_is_stored_as_for_loop(self, client: TestClient) -> None:
        document = {"name": "Imported loop", "workflow": {"nodes": [_for_loop("")], "edges": []}}
        upload = {"file": ("loop.yaml", yaml.dump(document).encode(), "application/x-yaml")}

        imported = client.post("/tests/import", files=upload)

        assert imported.status_code == 200, imported.text
        [test] = client.get("/tests").json()["data"]
        stored = client.get(f"/tests/{test['id']}").json()["data"]["workflow"]["nodes"]
        assert [node["data"]["label"] for node in stored] == ["For Loop"]
        assert [node_source(node) for node in stored] == ["For Loop"]


def _local_function(node_id: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """A Local Function Block whose body holds ``blocks``."""
    node = _unnamed("function", "function", node_id)
    node["data"].update(
        label="Local",
        functionLifecycle="local",
        localDefinition={
            "name": "Local",
            "inputs": [],
            "outputs": [],
            "workflow": {
                "nodes": blocks,
                "edges": [
                    {"id": f"edge-{block['id']}", "source": "start-node", "target": block["id"]}
                    for block in blocks
                ],
            },
        },
        config={"values": {}, "outputBindings": {}, "profileBindings": []},
    )
    return node


def _body_finding(code: str, node_id: str, *holders: str) -> dict[str, Any]:
    """A finding on a Block inside the Function flows named by ``holders``, outer first."""
    trail = [
        {"node_id": holder, "label": "Local", "element_type": "function"} for holder in holders
    ]
    return {"code": code, "node_id": node_id, "node_label": node_id, "function_path": trail}


class TestFunctionFlowBlocks:
    """A Block with no Name inside a Function flow is named like a root Block."""

    def test_the_save_fixer_names_the_block_after_its_type(self) -> None:
        inner = _unnamed("for", "control", "node-1")
        nodes = [_local_function("fn-1", [inner])]
        removed: set[str] = set()

        test_service._fix_node_errors(
            _body_finding("MISSING_LABEL", "node-1", "fn-1"), nodes, removed
        )

        assert (inner["data"]["label"], removed) == ("For Loop", set())

    def test_the_save_fixer_reaches_a_nested_function_flow(self) -> None:
        inner = _unnamed("csv-parser", "plugin", "node-1")
        nodes = [_local_function("fn-1", [_local_function("fn-2", [inner])])]

        test_service._fix_node_errors(
            _body_finding("MISSING_LABEL", "node-1", "fn-1", "fn-2"), nodes, set()
        )

        assert inner["data"]["label"] == "CSV"

    def test_the_save_fixer_trims_a_long_description(self) -> None:
        inner = _unnamed("for", "control", "node-1")
        inner["data"]["description"] = "d" * 70
        nodes = [_local_function("fn-1", [inner])]

        test_service._fix_node_errors(
            _body_finding("DESCRIPTION_TOO_LONG", "node-1", "fn-1"), nodes, set()
        )

        assert inner["data"]["description"] == "d" * 64

    def test_a_function_flow_finding_never_removes_a_root_block_of_the_same_id(self) -> None:
        root = _unnamed("for", "control", "node-1")
        nodes = [root, _local_function("fn-1", [_unnamed("for", "control", "node-1")])]
        removed: set[str] = set()

        test_service._fix_node_errors(
            _body_finding("UNKNOWN_BLOCK_TYPE", "node-1", "fn-1"), nodes, removed
        )

        assert (removed, root["data"]["label"]) == (set(), "")

    def test_a_trail_to_a_missing_function_block_changes_nothing(self) -> None:
        inner = _unnamed("for", "control", "node-1")
        nodes = [_local_function("fn-1", [inner])]

        test_service._fix_node_errors(
            _body_finding("MISSING_LABEL", "node-1", "fn-9"), nodes, set()
        )

        assert inner["data"]["label"] == ""

    def test_the_import_fixer_names_the_block_and_reports_it(self) -> None:
        inner = _unnamed("for", "control", "node-1")
        test_data = {"workflow": {"nodes": [_local_function("fn-1", [inner])], "edges": []}}

        applied = test_service._apply_import_fixes(
            [_body_finding("MISSING_LABEL", "node-1", "fn-1")], test_data
        )

        assert (inner["data"]["label"], applied) == (
            "For Loop",
            ["Added name 'For Loop' to block node-1"],
        )
