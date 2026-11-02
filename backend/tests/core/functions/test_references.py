"""The Function reference walker and its id rewrite (REQ-3.1.2.3, REQ-3.1.2.5)."""

import copy
from typing import Any

import pytest

from wavecore.core.functions.references import (
    FunctionReference,
    iter_blocks,
    iter_function_references,
    nested_function_workflows,
    referenced_function_ids,
    remap_function_ids,
)


def _block(node_id: str, **data: Any) -> dict[str, Any]:
    return {"id": node_id, "type": "workflowNode", "position": {"x": 0, "y": 0}, "data": data}


def _log(node_id: str) -> dict[str, Any]:
    return _block(
        node_id,
        label=node_id,
        elementType="log",
        nodeType="plugin",
        config={"values": {"message": "'hi'", "level": "INFO"}, "outputBindings": {}},
    )


def _library(node_id: str, function_id: str, **extra: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": node_id,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "functionVersion": "1.0.0",
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }
    return _block(node_id, **{**data, **extra})


def _body(nodes: list[dict[str, Any]], functions: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": "Body",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": functions or [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": []},
    }


def _local(
    node_id: str, nodes: list[dict[str, Any]], functions: list[str] | None = None
) -> dict[str, Any]:
    return _block(
        node_id,
        label=node_id,
        elementType="function",
        nodeType="function",
        functionLifecycle="local",
        localDefinition=_body(nodes, functions),
        config={"values": {}, "outputBindings": {}, "profileBindings": []},
    )


def _editing(node_id: str, function_id: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return _library(
        node_id,
        function_id,
        editMode=True,
        upstreamLink={"functionId": function_id, "sourceVersion": "1.0.0"},
        draft=_body(nodes),
    )


def _workflow(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {"nodes": list(nodes), "edges": []}


def _layered_workflow() -> dict[str, Any]:
    """Blocks at the top level, in a Local body, in a draft and two levels deep."""
    return _workflow(
        _library("top", "fn-top"),
        _local(
            "local",
            [
                _library("in-local", "fn-local"),
                _local("nested", [_library("deep", "fn-deep")]),
                _log("after-nested"),
            ],
        ),
        _editing("editing", "fn-edit", [_library("in-draft", "fn-draft")]),
        _log("last"),
    )


def _linked_everywhere(function_id: str) -> dict[str, Any]:
    """One Function id in every place the rewrite covers."""
    return _workflow(
        _library("top", function_id),
        _local("local", [_library("in-local", function_id)], functions=[function_id]),
        _editing("editing", function_id, [_library("in-draft", function_id)]),
    )


def _data(workflow: dict[str, Any], index: int = 0) -> dict[str, Any]:
    return workflow["nodes"][index]["data"]


class TestNestedFunctionWorkflows:
    """The bodies one block nests."""

    def test_a_local_function_block_yields_its_body(self) -> None:
        block = _local("local", [_log("inner")])

        assert nested_function_workflows(block) == [block["data"]["localDefinition"]["workflow"]]

    def test_an_edit_mode_block_yields_its_draft(self) -> None:
        block = _editing("editing", "fn-a", [_log("inner")])

        assert nested_function_workflows(block) == [block["data"]["draft"]["workflow"]]

    @pytest.mark.parametrize(
        "block",
        [
            pytest.param(_log("plain"), id="plugin"),
            pytest.param(_library("call", "fn-a"), id="library-function"),
        ],
    )
    def test_a_plain_block_yields_nothing(self, block: dict[str, Any]) -> None:
        assert nested_function_workflows(block) == []


class TestIterBlocks:
    """Every block of a workflow, at every depth."""

    def test_every_block_is_yielded_depth_first_in_document_order(self) -> None:
        blocks = list(iter_blocks(_layered_workflow()))

        assert [block["id"] for block in blocks] == [
            "top",
            "local",
            "in-local",
            "nested",
            "deep",
            "after-nested",
            "editing",
            "in-draft",
            "last",
        ]


class TestIterFunctionReferences:
    """One reference per library Function block."""

    def test_a_top_level_library_block_is_one_reference(self) -> None:
        call = _library("call", "fn-a", label="Call A", functionVersion="1.2.0")

        references = list(iter_function_references(_workflow(_log("first"), call)))

        assert len(references) == 1
        reference = references[0]
        assert isinstance(reference, FunctionReference)
        assert reference.function_id == "fn-a"
        assert reference.version == "1.2.0"
        assert reference.node_id == "call"
        assert reference.node_label == "Call A"
        assert not reference.disabled

    def test_element_type_function_marks_a_library_block_too(self) -> None:
        call = _library("call", "fn-a")
        del call["data"]["nodeType"]

        references = list(iter_function_references(_workflow(call)))

        assert [reference.node_id for reference in references] == ["call"]

    def test_a_library_block_inside_a_local_body_is_found(self) -> None:
        workflow = _workflow(_local("local", [_library("inner", "fn-a", label="Inner call")]))

        references = list(iter_function_references(workflow))

        assert [(ref.function_id, ref.node_id, ref.node_label) for ref in references] == [
            ("fn-a", "inner", "Inner call")
        ]

    def test_a_library_block_inside_a_draft_is_found(self) -> None:
        workflow = _workflow(_editing("editing", "fn-edit", [_library("inner", "fn-a")]))

        references = list(iter_function_references(workflow))

        assert [(ref.function_id, ref.node_id) for ref in references] == [
            ("fn-edit", "editing"),
            ("fn-a", "inner"),
        ]

    def test_a_local_function_block_is_not_a_reference(self) -> None:
        local = _local("local", [_log("inner")])
        local["data"].update(functionId="fn-a", functionVersion="1.0.0")

        assert list(iter_function_references(_workflow(local))) == []

    @pytest.mark.parametrize(
        "function_id_field",
        [
            pytest.param({"functionId": ""}, id="empty"),
            pytest.param({"functionId": None}, id="null"),
            pytest.param({}, id="missing"),
        ],
    )
    def test_a_block_with_an_empty_function_id_is_not_a_reference(
        self, function_id_field: dict[str, Any]
    ) -> None:
        call = _library("call", "fn-a")
        del call["data"]["functionId"]
        call["data"].update(function_id_field)

        assert list(iter_function_references(_workflow(call))) == []

    def test_the_label_and_the_disabled_flag_come_from_the_block(self) -> None:
        blank = _library("blank-label", "fn-a", label="   ")
        unlabeled = _library("no-label", "fn-a")
        del unlabeled["data"]["label"]
        workflow = _workflow(
            _library("off", "fn-a", label="Call off", disabled=True),
            _library("on", "fn-a", label="Call on", disabled=False),
            blank,
            unlabeled,
        )

        references = list(iter_function_references(workflow))

        assert [reference.node_label for reference in references] == ["Call off", "Call on", "", ""]
        assert [reference.node_id for reference in references] == [
            "off",
            "on",
            "blank-label",
            "no-label",
        ]
        assert references[0].disabled is True
        assert references[1].disabled is False

    @pytest.mark.parametrize("label", [None, 7, ["Call A"]], ids=["null", "number", "list"])
    def test_a_label_that_is_not_text_is_no_name(self, label: Any) -> None:
        call = _library("call", "fn-a", label=label)

        (reference,) = iter_function_references(_workflow(call))

        assert (reference.node_id, reference.node_label) == ("call", "")

    def test_references_come_in_walk_order(self) -> None:
        references = list(iter_function_references(_layered_workflow()))

        assert [reference.node_id for reference in references] == [
            "top",
            "in-local",
            "deep",
            "editing",
            "in-draft",
        ]

    def test_library_id_is_never_read(self) -> None:
        call = _library("call", "fn-a")
        del call["data"]["functionId"]
        call["data"]["libraryId"] = "fn-a"

        assert list(iter_function_references(_workflow(call))) == []


class TestReferencedFunctionIds:
    """The Function ids a body uses."""

    def test_the_ids_of_every_depth_come_back_as_a_set(self) -> None:
        ids = referenced_function_ids(_layered_workflow())

        assert isinstance(ids, set)
        assert ids == {"fn-top", "fn-local", "fn-deep", "fn-edit", "fn-draft"}


class TestRemapFunctionIds:
    """A copy of a workflow with its Function ids rewritten through a map."""

    def test_a_top_level_function_id_is_rewritten(self) -> None:
        workflow = _workflow(_library("call", "fn-old"))

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert _data(result)["functionId"] == "fn-new"

    def test_a_block_inside_a_local_body_is_rewritten(self) -> None:
        workflow = _workflow(_local("local", [_library("inner", "fn-old")]))

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert _data(_data(result)["localDefinition"]["workflow"])["functionId"] == "fn-new"

    def test_a_block_inside_a_draft_is_rewritten(self) -> None:
        workflow = _workflow(_editing("editing", "fn-edit", [_library("inner", "fn-old")]))

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert _data(_data(result)["draft"]["workflow"])["functionId"] == "fn-new"

    def test_the_upstream_link_is_rewritten(self) -> None:
        workflow = _workflow(_editing("editing", "fn-old", []))

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert _data(result)["upstreamLink"] == {"functionId": "fn-new", "sourceVersion": "1.0.0"}

    def test_a_local_definitions_dependency_list_is_rewritten(self) -> None:
        workflow = _workflow(_local("local", [], functions=["fn-old", "fn-kept"]))

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        dependencies = _data(result)["localDefinition"]["dependencies"]
        assert dependencies["functions"] == ["fn-new", "fn-kept"]

    def test_an_id_outside_the_map_is_left(self) -> None:
        workflow = _linked_everywhere("fn-kept")

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert result == _linked_everywhere("fn-kept")

    def test_the_input_is_not_changed(self) -> None:
        workflow = _linked_everywhere("fn-old")
        before = copy.deepcopy(workflow)

        result = remap_function_ids(workflow, {"fn-old": "fn-new"})

        assert workflow == before
        assert result == _linked_everywhere("fn-new")

    def test_library_id_is_not_touched(self) -> None:
        call = _library("call", "fn-old", libraryId="fn-old")

        result = remap_function_ids(_workflow(call), {"fn-old": "fn-new"})

        assert _data(result)["functionId"] == "fn-new"
        assert _data(result)["libraryId"] == "fn-old"
