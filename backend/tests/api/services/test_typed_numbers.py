"""The stored form of each typed number a Test or Function save writes.

REQ-3.1.3.14: every Block field, typed setting entry, setter row, compare-to value and
declaration that declares an integer or float keeps each valid number in its wire form, at any
Function depth.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from wavecore.api.services.functions import _storage
from wavecore.api.services.typed_numbers import store_definition_numbers, store_workflow_numbers
from wavecore.controls.registry import _registry as control_registry
from wavecore.controls.registry import register_all_core_controls
from wavecore.core.plugin_registry import register_plugin
from wavecore.plugins.http_client import HTTPClientPlugin

_TINY = 1e-07
_BIG = 1234567890123456789


@pytest.fixture(autouse=True)
def _registered_blocks() -> None:
    register_all_core_controls(control_registry)
    register_plugin(HTTPClientPlugin())


def _http(**values: Any) -> dict[str, Any]:
    return {
        "id": "http",
        "data": {
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"method": "GET", "url": "http://example.com", **values}},
        },
    }


def _setter(**rows: Any) -> dict[str, Any]:
    return {
        "id": "set",
        "data": {
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "variableTypes": {name: "float" for name in rows},
            "config": {"values": {"variables": rows}},
        },
    }


def _values(node: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = node["data"]["config"]["values"]
    return values


def _definition(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": "scale",
        "inputs": [
            {"name": "rate", "type": "float", "required": False, "default": _TINY},
            "not-a-declaration",
        ],
        "outputs": [{"name": "total", "type": "integer", "default": _BIG}],
        "variables": [{"name": "step", "type": "float", "value": 30.0}],
        "workflow": {"nodes": list(nodes), "edges": []},
    }


def _declared(definition: dict[str, Any]) -> list[Any]:
    return [
        definition["inputs"][0]["default"],
        definition["inputs"][1],
        definition["outputs"][0]["default"],
        definition["variables"][0]["value"],
    ]


_STORED_DECLARED = ["0.0000001", "not-a-declaration", "1234567890123456789", "30.0"]


class TestBlocks:
    def test_a_plugin_block_stores_its_number_fields(self) -> None:
        node = _http(retry_delay=_TINY, max_size=_BIG, retry_backoff_factor=2.5, timeout=30)

        store_workflow_numbers({"nodes": [node]})

        assert _values(node) == {
            "method": "GET",
            "url": "http://example.com",
            "retry_delay": "0.0000001",
            "max_size": "1234567890123456789",
            "retry_backoff_factor": 2.5,
            "timeout": 30,
        }

    def test_a_control_block_stores_its_literal_rows(self) -> None:
        node = _setter(rate=_TINY, whole=30.0)

        store_workflow_numbers({"nodes": [node]})

        assert _values(node) == {"variables": {"rate": "0.0000001", "whole": "30.0"}}

    def test_an_expression_field_keeps_its_source(self) -> None:
        node = _http(retry_delay=_TINY)
        node["data"]["expressionFields"] = ["retry_delay"]
        node["data"]["templateFields"] = ["max_size"]

        store_workflow_numbers({"nodes": [node]})

        assert _values(node)["retry_delay"] == _TINY

    @pytest.mark.parametrize(
        "node",
        [
            "not-a-node",
            {"id": "n", "data": "not-data"},
            {"id": "n", "data": {"elementType": "http-client", "config": "x"}},
            {"id": "n", "data": {"elementType": "http-client", "config": {"values": [_TINY]}}},
        ],
        ids=["text", "data-text", "config-text", "values-list"],
    )
    def test_a_block_of_another_shape_stays_as_given(self, node: Any) -> None:
        workflow = {"nodes": [node]}

        store_workflow_numbers(workflow)

        assert workflow == {"nodes": [node]}

    def test_a_workflow_of_another_shape_holds_no_blocks(self) -> None:
        store_workflow_numbers(None)


class TestFunctionBlocks:
    def test_a_local_function_stores_its_declarations_body_and_block_values(self) -> None:
        body_http = _http(retry_delay=_TINY)
        definition = _definition(body_http)
        block = {
            "id": "fn",
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "local",
                "localDefinition": definition,
                "config": {"values": {"rate": _TINY}},
            },
        }

        store_workflow_numbers({"nodes": [block]})

        assert _declared(definition) == _STORED_DECLARED
        assert _values(body_http)["retry_delay"] == "0.0000001"
        assert _values(block) == {"rate": "0.0000001"}

    def test_a_typed_list_input_stores_each_item_by_its_element_type(self) -> None:
        block = {
            "id": "fn",
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "local",
                "localDefinition": {"inputs": [{"name": "ids", "type": "array"}]},
                "elementTypes": {"ids": ["integer", "float"]},
                "config": {"values": {"ids": [_BIG, _TINY]}},
            },
        }

        store_workflow_numbers({"nodes": [block]})

        assert _values(block) == {"ids": ["1234567890123456789", "0.0000001"]}

    def test_an_edit_mode_draft_stores_its_declarations_and_body(self) -> None:
        body_setter = _setter(rate=_TINY)
        draft = _definition(body_setter)
        block = {
            "id": "fn",
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": str(uuid.uuid4()),
                "editMode": True,
                "draft": draft,
                "config": {"values": {"rate": 30.0}},
            },
        }

        store_workflow_numbers({"nodes": [block]})

        assert _declared(draft) == _STORED_DECLARED
        assert _values(body_setter) == {"variables": {"rate": "0.0000001"}}
        assert _values(block) == {"rate": "30.0"}

    def test_a_shared_function_block_reads_its_fields_from_the_pinned_version(self) -> None:
        function_id = str(uuid.uuid4())
        _storage.save_new_version(function_id, "1.0.0", _definition(), {}, name="scale")
        block = {
            "id": "fn",
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": function_id,
                "functionVersion": "1.0.0",
                "config": {"values": {"rate": _TINY}},
            },
        }

        store_workflow_numbers({"nodes": [block]})

        assert _values(block) == {"rate": "0.0000001"}


class TestFunctionDefinitions:
    def test_a_definition_stores_its_declarations_and_blocks(self) -> None:
        body_http = _http(max_size=_BIG)
        definition = _definition(body_http)

        store_definition_numbers(definition)

        assert _declared(definition) == _STORED_DECLARED
        assert _values(body_http)["max_size"] == "1234567890123456789"

    def test_declarations_of_another_shape_stay_as_given(self) -> None:
        definition: dict[str, Any] = {"inputs": "rate", "workflow": "none"}

        store_definition_numbers(definition)

        assert definition == {"inputs": "rate", "workflow": "none"}
