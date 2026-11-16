"""Every edge of a workflow carries its own id.

A workflow whose edges repeat an id is refused as sent, whichever client sends
it: the create and update saves, their dry runs, the import and its preview,
and a run. The finding names the repeated id once:
``Edge ID '<id>' is used by more than one edge``. Nothing is repaired first,
because the repairs find edges by id. A Local Function body follows the same rule.

REQ-5.2.4.3, REQ-5.2.4.9, REQ-3.1.2.4.
"""

import json
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.services.tests import service as test_service

CODE = "DUPLICATE_EDGE_ID"


def _message(edge_id: str) -> str:
    return f"Edge ID '{edge_id}' is used by more than one edge"


def _log(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": {
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": node_id,
            "config": {"values": {"message": "hi"}},
        },
    }


def _edge(edge_id: str | None, source: str, target: str) -> dict[str, Any]:
    edge: dict[str, Any] = {"source": source, "target": target}
    if edge_id is not None:
        edge["id"] = edge_id
    return edge


def _chain(*edge_ids: str | None) -> dict[str, Any]:
    """start-node, then one log Block per edge id, each edge carrying its given id."""
    targets = [f"log-{index + 1}" for index in range(len(edge_ids))]
    sources = ["start-node", *targets[:-1]]
    return {
        "nodes": [_log(target) for target in targets],
        "edges": [
            _edge(edge_id, source, target)
            for edge_id, source, target in zip(edge_ids, sources, targets, strict=True)
        ],
    }


def _test(workflow: dict[str, Any], name: str = "Edge Ids Test") -> dict[str, Any]:
    return {"name": name, "workflow": workflow, "variables": {}}


def _findings(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [error for error in errors if error["code"] == CODE]


def _validate(workflow: dict[str, Any], context: str = "save") -> list[dict[str, Any]]:
    return _findings(test_service._validate_test_data(_test(workflow), context=context)["errors"])


def _local_function(workflow: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Local step",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "Local step",
                "inputs": [],
                "outputs": [],
                "variables": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": workflow,
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


@pytest.fixture(autouse=True)
def _log_and_controls() -> Any:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    test_service._clear_storage()
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


class TestTheValidationNamesARepeatedEdgeId:
    def test_two_edges_sharing_an_id_give_one_finding_at_the_repeat(self) -> None:
        assert _validate(_chain("e-1", "e-1")) == [
            {
                "path": "edges[1]",
                "node_id": None,
                "node_label": None,
                "element_type": None,
                "code": CODE,
                "message": _message("e-1"),
                "severity": "error",
                "fix_action": None,
            }
        ]

    def test_an_id_three_edges_share_is_named_once(self) -> None:
        assert [f["message"] for f in _validate(_chain("e-1", "e-1", "e-1"))] == [_message("e-1")]

    def test_each_repeated_id_is_named(self) -> None:
        findings = _validate(_chain("e-1", "e-2", "e-1", "e-2"))

        assert [(f["path"], f["message"]) for f in findings] == [
            ("edges[2]", _message("e-1")),
            ("edges[3]", _message("e-2")),
        ]

    def test_edges_with_their_own_ids_give_no_finding(self) -> None:
        assert _validate(_chain("e-1", "e-2")) == []

    def test_edges_without_an_id_are_not_a_repeated_id(self) -> None:
        assert _validate(_chain(None, None)) == []

    @pytest.mark.parametrize("context", ["load", "import", "run", "save"])
    def test_every_context_reports_it_as_an_error(self, context: str) -> None:
        validation = test_service._validate_test_data(_test(_chain("e-1", "e-1")), context=context)

        assert validation["fatal"] is False
        assert [f["message"] for f in _findings(validation["errors"])] == [_message("e-1")]


class TestTheSaveRefusesARepeatedEdgeId:
    def test_create_refuses_it_and_stores_nothing(self) -> None:
        test_data = _test(_chain("e-1", "e-1"))

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.create_test(test_data)

        assert [(e["code"], e["message"]) for e in refused.value.errors] == [
            (CODE, _message("e-1"))
        ]
        assert test_service._list_all_tests() == []

    def test_update_refuses_it_and_keeps_the_stored_workflow(self) -> None:
        created = test_service.create_test(_test(_chain("e-1", "e-2")))
        update = {"workflow": _chain("e-1", "e-1")}

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.update_test(created["id"], update)

        assert [(e["code"], e["message"]) for e in refused.value.errors] == [
            (CODE, _message("e-1"))
        ]
        stored = test_service.get_test(created["id"])
        assert stored is not None
        assert [edge["id"] for edge in stored["workflow"]["edges"]] == ["e-1", "e-2"]

    def test_nothing_is_repaired_before_the_refusal(self) -> None:
        workflow = _chain("e-1")
        workflow["edges"].append(_edge("e-1", "log-1", "gone"))
        test_data = _test(workflow)

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.create_test(test_data)

        assert [e["code"] for e in refused.value.errors] == ["DANGLING_EDGE", CODE]
        assert test_service._list_all_tests() == []

    def test_the_create_dry_run_reports_it(self) -> None:
        errors = test_service.validate_test_data_for_create(_test(_chain("e-1", "e-1")))

        assert [(e["code"], e["message"]) for e in errors] == [(CODE, _message("e-1"))]

    def test_the_update_dry_run_reports_it(self) -> None:
        created = test_service.create_test(_test(_chain("e-1", "e-2")))

        errors = test_service.validate_test_data_for_update(
            created["id"], {"workflow": _chain("e-1", "e-1")}
        )

        assert [(e["code"], e["message"]) for e in errors] == [(CODE, _message("e-1"))]

    def test_a_local_function_body_with_a_repeated_edge_id_is_refused(self) -> None:
        workflow = {
            "nodes": [_local_function(_chain("b-1", "b-1"))],
            "edges": [_edge("e-1", "start-node", "fn-1")],
        }
        test_data = _test(workflow)

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.create_test(test_data)

        (finding,) = _findings(refused.value.errors)
        assert finding["message"] == _message("b-1")
        assert finding["node_id"] == "fn-1"
        assert test_service._list_all_tests() == []

    def test_post_tests_answers_422_naming_the_id(self, client: TestClient) -> None:
        response = client.post("/tests", json=_test(_chain("e-1", "e-1")))

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["message"] == "Test has 1 validation error(s)"
        assert [(d["code"], d["message"]) for d in error["details"]] == [(CODE, _message("e-1"))]


def _document(workflow: dict[str, Any], name: str = "Imported Edge Ids") -> bytes:
    return yaml.dump(_test(workflow, name)).encode()


class TestTheImportRefusesARepeatedEdgeId:
    def test_the_preview_marks_the_test_fatal_with_the_finding(self) -> None:
        result = test_service.validate_test_import(_document(_chain("e-1", "e-1")), "t.yaml")

        (entry,) = result["tests"]
        assert entry["status"] == "fatal"
        assert [(e["code"], e["message"]) for e in entry["fatal_errors"]] == [
            (CODE, _message("e-1"))
        ]
        assert (result["importable"], result["blocked"]) == (0, 1)

    def test_the_import_refuses_it_and_stores_nothing(self) -> None:
        document = _document(_chain("e-1", "e-1"))

        with pytest.raises(test_service.RepeatedEdgeIdImportError) as refused:
            test_service.import_tests(document, "t.yaml")

        assert refused.value.message == (
            "Cannot import test 'Imported Edge Ids'. " + _message("e-1")
        )
        assert [e["code"] for e in refused.value.errors] == [CODE]
        assert test_service._list_all_tests() == []

    def test_post_tests_import_answers_422_naming_the_id(self, client: TestClient) -> None:
        response = client.post(
            "/tests/import",
            data={"conflict_resolutions": json.dumps({})},
            files={"file": ("t.yaml", _document(_chain("e-1", "e-1")), "application/x-yaml")},
        )

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == CODE
        assert error["message"] == "Cannot import test 'Imported Edge Ids'. " + _message("e-1")
        assert [(d["code"], d["message"]) for d in error["details"]] == [(CODE, _message("e-1"))]
        assert test_service._list_all_tests() == []

    def test_an_import_with_its_own_edge_ids_is_stored(self) -> None:
        result = test_service.import_tests(_document(_chain("e-1", "e-2")), "t.yaml")

        assert result["total_imported"] == 1


def _try_catch(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 100},
        "data": {
            "elementType": "try-catch-finally",
            "nodeType": "control",
            "version": "1.0.0",
            "label": "Try/Catch",
            "config": {"values": {"enable_catch": True, "enable_finally": False}},
        },
    }


def _cross_scope_shares_an_id() -> dict[str, Any]:
    """A Try/Catch whose wire from Start and a cross-scope wire out of its try path share an id."""
    return {
        "nodes": [_try_catch("tc"), _log("try-log"), _log("catch-log"), _log("after-log")],
        "edges": [
            _edge("e-shared", "start-node", "tc"),
            {**_edge("e-try", "tc", "try-log"), "sourceHandle": "try"},
            {**_edge("e-catch", "tc", "catch-log"), "sourceHandle": "catch"},
            {**_edge("e-then", "tc", "after-log"), "sourceHandle": "then"},
            {**_edge("e-shared", "try-log", "after-log"), "targetHandle": "ingress_1"},
        ],
    }


def _stored_raw(workflow: dict[str, Any]) -> str:
    """A Test stored as given: the save would refuse it."""
    created = test_service.create_test(_test(_chain("e-1")))
    test_service._update_raw_test(created["id"], {"workflow": workflow})
    return str(created["id"])


def _stored_workflow(test_id: str) -> dict[str, Any]:
    stored = test_service.get_test(test_id)
    assert stored is not None
    workflow: dict[str, Any] = stored["workflow"]
    return workflow


class TestTheFixRefusesARepeatedEdgeId:
    """Nothing is repaired on a Test whose edges repeat an id, so the Fix refuses it as stored."""

    def test_the_stored_test_offers_a_repair_that_finds_its_edge_by_id(self) -> None:
        test_id = _stored_raw(_cross_scope_shares_an_id())

        validation = test_service.validate_test(test_id, context="load")

        assert validation is not None
        errors = validation["errors"]
        assert [e["message"] for e in _findings(errors)] == [_message("e-shared")]
        assert [
            (e["path"], e["fix_action"]) for e in errors if e["code"] == "CROSS_SCOPE_EDGE"
        ] == [("workflow.edges.e-shared", "Remove the cross-scope edge")]

    def test_fix_refuses_it_and_keeps_every_edge(self) -> None:
        workflow = _cross_scope_shares_an_id()
        test_id = _stored_raw(workflow)

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.fix_test(test_id)

        assert [(e["code"], e["message"]) for e in refused.value.errors] == [
            (CODE, _message("e-shared"))
        ]
        assert _stored_workflow(test_id) == workflow

    def test_fix_refuses_a_local_function_body_that_repeats_an_id(self) -> None:
        workflow = {
            "nodes": [_local_function(_chain("b-1", "b-1")), _log("gone-target")],
            "edges": [_edge("e-1", "start-node", "fn-1"), _edge("e-2", "fn-1", "missing")],
        }
        test_id = _stored_raw(workflow)

        with pytest.raises(test_service.SaveValidationError) as refused:
            test_service.fix_test(test_id)

        (finding,) = refused.value.errors
        assert (finding["code"], finding["message"], finding["node_id"]) == (
            CODE,
            _message("b-1"),
            "fn-1",
        )
        assert _stored_workflow(test_id) == workflow

    def test_post_tests_fix_answers_422_naming_the_id(self, client: TestClient) -> None:
        workflow = _cross_scope_shares_an_id()
        test_id = _stored_raw(workflow)

        response = client.post(f"/tests/{test_id}/fix")

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["message"] == "Test has 1 validation error(s)"
        assert error["code"] == "VALIDATION_ERROR"
        assert [(d["code"], d["message"]) for d in error["details"]] == [
            (CODE, _message("e-shared"))
        ]
        assert _stored_workflow(test_id) == workflow

    def test_fix_still_repairs_a_test_with_its_own_edge_ids(self) -> None:
        workflow = _cross_scope_shares_an_id()
        workflow["edges"][0]["id"] = "e-start"
        test_id = _stored_raw(workflow)

        fixed = test_service.fix_test(test_id)

        assert fixed is not None
        assert [e["id"] for e in _stored_workflow(test_id)["edges"]] == [
            "e-start",
            "e-try",
            "e-catch",
            "e-then",
        ]
