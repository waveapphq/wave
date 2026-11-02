"""Tests for output validation - the no-producer rule (REQ-3.1.2.4, REQ-3.1.2.7).

Contract (output binding well-formedness):

- A declared output that no internal node writes surfaces as a WARNING
  (code OUTPUT_HAS_NO_PRODUCER), never an error.
- Because it is a warning, it blocks NOTHING: save, run, and publish all
  proceed (a contract may legitimately precede the implementation that fills
  it).

The canonical message for the save/body dimension is unchanged - it already
expresses the documented no-producer rule:

    Declared output '<name>' is not written by any block

(The runtime WARN log is covered in tests/api/test_workbench_function_parameter_warn.py.)
"""

import re

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload, make_output

NO_PRODUCER_RE = re.compile(r"^Declared output '.+' is not written by any block$")


def _codes(issues) -> list[str]:
    return [issue.code for issue in issues]


def _output_binding_node(node_id: str, target_var: str) -> dict:
    """A minimal workflow node that writes ``target_var`` via an output binding."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {}, "outputBindings": {"line": target_var}},
        },
    }


# ---------------------------------------------------------------------------
# The no-producer dimension itself
# ---------------------------------------------------------------------------


class TestNoProducerRule:
    def test_unwritten_output_is_a_warning(self) -> None:
        from wavecore.api.services.functions._storage import _validate_output_producer

        definition = {
            "name": "warns",
            "inputs": [],
            "outputs": [{"name": "result", "type": "string"}],
            "workflow": {"nodes": [], "edges": []},
        }
        issues = _validate_output_producer(definition)
        producers = [i for i in issues if i.code == "OUTPUT_HAS_NO_PRODUCER"]
        assert len(producers) == 1
        issue = producers[0]
        assert issue.severity == "warning"
        assert NO_PRODUCER_RE.match(issue.message)
        assert "result" in issue.message

    def test_written_output_has_no_warning(self) -> None:
        from wavecore.api.services.functions._storage import _validate_output_producer

        definition = {
            "name": "ok",
            "inputs": [],
            "outputs": [{"name": "result", "type": "string"}],
            "workflow": {
                "nodes": [_output_binding_node("n1", "result")],
                "edges": [],
            },
        }
        assert "OUTPUT_HAS_NO_PRODUCER" not in _codes(_validate_output_producer(definition))


# ---------------------------------------------------------------------------
# The canonical save pipeline surfaces it as a non-blocking warning
# ---------------------------------------------------------------------------


class TestCanonicalPipelineSeverity:
    def test_pipeline_marks_unproduced_output_as_warning(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        definition = {
            "name": "pipeline_warn",
            "inputs": [],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        }
        issues = validate_function_for_save(definition, function_registry={})
        producers = [i for i in issues if i.code == "OUTPUT_HAS_NO_PRODUCER"]
        assert producers, "no-producer issue must be surfaced by the canonical pipeline"
        assert all(i.severity == "warning" for i in producers)
        # Never an error, so nothing blocks on it.
        assert all(i.severity != "error" for i in producers)


# ---------------------------------------------------------------------------
# Non-blocking everywhere: save proceeds
# ---------------------------------------------------------------------------


class TestSaveProceeds:
    def test_create_with_unproduced_output_returns_201(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="save_with_warn",
            outputs=[make_output("result", "string")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# Non-blocking everywhere: publish (add version) proceeds
# ---------------------------------------------------------------------------


class TestPublishProceeds:
    def test_add_version_with_unproduced_output_succeeds(self, client: TestClient) -> None:
        from wavecore.api.services.functions import service as function_service

        created = client.post(
            "/functions",
            json=make_function_payload(
                name="publish_with_warn",
                outputs=[make_output("result", "string")],
            ),
        ).json()
        fn_id = created["data"]["id"]

        # Contract is unchanged from 1.0.0 (still one unproduced output), so a
        # PATCH bump is allowed. The unproduced output must not block publish.
        draft = make_function_payload(
            name="publish_with_warn",
            outputs=[make_output("result", "string")],
        )
        result = function_service.add_function_version(
            fn_id,
            source_version="1.0.0",
            target_version="1.0.1",
            draft_definition=draft,
            changelog="patch bump; output still unfilled",
            description="",
            tags=[],
            details="",
        )
        assert result["version"] == "1.0.1"


# ---------------------------------------------------------------------------
# Every writer counts, a muted one does not (REQ-3.1.2.7)
# ---------------------------------------------------------------------------

NO_READER_RE = re.compile(r"^Declared input 'n' is not used by any block$")


def _save_issues(definition: dict, code: str) -> list:
    from wavecore.api.services.functions._storage import validate_function_for_save

    return [
        i for i in validate_function_for_save(definition, function_registry={}) if i.code == code
    ]


def _definition(
    *,
    inputs: list | None = None,
    outputs: list | None = None,
    nodes: list | None = None,
) -> dict:
    body = nodes or []
    return {
        "name": "fmt",
        "inputs": inputs or [],
        "outputs": outputs or [],
        "variables": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": body,
            "edges": [{"source": "start-node", "target": n["id"]} for n in body],
        },
    }


def _setter_node(node_id: str, target_var: str) -> dict:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "variableExpressionKeys": [],
            "variableTypes": {target_var: "string"},
            "config": {
                "values": {"variables": {target_var: "done"}},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _muted(node: dict) -> dict:
    return {**node, "data": {**node["data"], "disabled": True}}


def _reader_node(node_id: str, expression: str) -> dict:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "expressionFields": ["message"],
            "config": {
                "values": {"message": expression, "level": "INFO"},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _assert_node(node_id: str, variable: str) -> dict:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "assert",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "mode": "single",
                    "assertions": [
                        {
                            "id": "c1",
                            "type": "literal",
                            "variable": variable,
                            "value_type": "integer",
                            "operator": "equals",
                            "reference_value": "1",
                            "reference_is_expression": False,
                        }
                    ],
                },
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _nested_function_block(node_id: str, expression: str) -> dict:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": _definition(
                inputs=[{"name": "x", "type": "integer"}],
                nodes=[_reader_node("inner", "x")],
            )
            | {"name": "inner"},
            "expressionFields": ["x"],
            "config": {"values": {"x": expression}, "outputBindings": {}, "profileBindings": []},
        },
    }


class TestNoProducerCountsEveryWriter:
    def test_a_variable_setter_write_counts(self) -> None:
        definition = _definition(
            outputs=[{"name": "result", "type": "string"}],
            nodes=[_setter_node("set-result", "result")],
        )

        assert _save_issues(definition, "OUTPUT_HAS_NO_PRODUCER") == []

    def test_a_muted_writer_does_not_count(self) -> None:
        definition = _definition(
            outputs=[{"name": "result", "type": "string"}],
            nodes=[_muted(_output_binding_node("n1", "result"))],
        )

        issues = _save_issues(definition, "OUTPUT_HAS_NO_PRODUCER")

        assert [(i.severity, i.message) for i in issues] == [
            ("warning", "Declared output 'result' is not written by any block")
        ]

    @pytest.mark.parametrize(
        "kind",
        [pytest.param("isExpression", id="expression"), pytest.param("isTemplate", id="template")],
    )
    def test_a_computed_output_counts_as_written(self, kind: str) -> None:
        definition = _definition(
            outputs=[{"name": "result", "type": "string", "default": "'done'", kind: True}],
        )

        assert _save_issues(definition, "OUTPUT_HAS_NO_PRODUCER") == []


# ---------------------------------------------------------------------------
# An input no block uses (REQ-3.1.2.7)
# ---------------------------------------------------------------------------


class TestInputHasNoReader:
    def test_an_unused_input_is_a_warning(self) -> None:
        definition = _definition(inputs=[{"name": "n", "type": "integer"}])

        issues = _save_issues(definition, "INPUT_HAS_NO_READER")

        assert len(issues) == 1
        assert issues[0].severity == "warning"
        assert NO_READER_RE.match(issues[0].message)

    def test_a_used_input_has_no_warning(self) -> None:
        definition = _definition(
            inputs=[{"name": "n", "type": "integer"}],
            nodes=[_reader_node("read-n", "n + 1")],
        )

        assert _save_issues(definition, "INPUT_HAS_NO_READER") == []

    def test_an_input_read_only_by_a_muted_block_is_a_warning(self) -> None:
        definition = _definition(
            inputs=[{"name": "n", "type": "integer"}],
            nodes=[_muted(_reader_node("read-n", "n + 1"))],
        )

        issues = _save_issues(definition, "INPUT_HAS_NO_READER")

        assert [(i.severity, i.message) for i in issues] == [
            ("warning", "Declared input 'n' is not used by any block")
        ]

    def test_an_input_read_only_by_a_condition_row_is_used(self) -> None:
        definition = _definition(
            inputs=[{"name": "n", "type": "integer"}],
            nodes=[_assert_node("check-n", "n")],
        )

        assert _save_issues(definition, "INPUT_HAS_NO_READER") == []

    def test_an_input_read_only_by_a_nested_function_block_is_used(self) -> None:
        definition = _definition(
            inputs=[{"name": "n", "type": "integer"}],
            nodes=[_nested_function_block("inner-block", "n")],
        )

        assert _save_issues(definition, "INPUT_HAS_NO_READER") == []

    def test_create_with_an_unused_input_returns_201(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="save_with_unused_input",
            inputs=[{"name": "n", "type": "integer"}],
        )

        response = client.post("/functions", json=payload)

        assert response.status_code == 201, response.text


pytestmark = pytest.mark.usefixtures("temp_storage_path")
