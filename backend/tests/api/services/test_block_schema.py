"""One schema lookup for every Block: plugin, control and Function Block fields and outputs.

REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.4.2.2, REQ-3.5.0.3: a Function Block's fields come from the
definition it runs - the Local definition, the edit-mode draft, or the pinned library version,
never the latest one.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

import pytest

from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.functions import _storage
from wavecore.controls.registry import (
    _registry as control_registry,
)
from wavecore.controls.registry import (
    get_control_implementation,
    register_all_core_controls,
)
from wavecore.core.functions.block_fields import function_block_fields, function_block_outputs
from wavecore.core.plugin_registry import get_plugin, register_plugin
from wavecore.models.enums import ControlId
from wavecore.models.plugins import get_param_attr
from wavecore.plugins.http_client import HTTPClientPlugin

_METADATA: dict[str, Any] = {
    "description": "say hello",
    "tags": [],
    "changelog": "initial",
    "details": "",
    "published_at": "2026-01-01T00:00:00Z",
    "published_by": "wave",
}

_PINNED_BODY: dict[str, Any] = {
    "inputs": [{"name": "who", "type": "string", "required": True, "description": "Who"}],
    "outputs": [{"name": "greeting", "type": "string", "description": "Hello text"}],
    "dependencies": {"functions": [], "plugins": []},
    "workflow": {"nodes": [], "edges": []},
}

_NEWER_BODY: dict[str, Any] = {
    "inputs": [
        {"name": "who", "type": "string", "required": True, "description": "Who"},
        {"name": "loud", "type": "boolean", "required": False, "default": False},
    ],
    "outputs": [
        {"name": "greeting", "type": "string", "description": "Hello text"},
        {"name": "count", "type": "integer", "description": "Letters"},
    ],
    "dependencies": {"functions": [], "plugins": []},
    "workflow": {"nodes": [], "edges": []},
}


@pytest.fixture(autouse=True)
def _registered_blocks() -> None:
    register_all_core_controls(control_registry)
    register_plugin(HTTPClientPlugin())


def _names(items: Iterable[Any]) -> list[str]:
    return [str(get_param_attr(item, "name")) for item in items]


def _seed(versions: dict[str, dict[str, Any]]) -> str:
    function_id = str(uuid.uuid4())
    for version, body in versions.items():
        _storage.save_new_version(function_id, version, body, _METADATA, name="greet")
    return function_id


def _shared_block(function_id: str, version: str | None, **extra: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": "Greet_1",
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "originalLibraryName": "greet",
        "config": {"values": {}, "outputBindings": {}},
    }
    if version is not None:
        data["functionVersion"] = version
    data.update(extra)
    return data


def _local_block(definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "label": "Greet_1",
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "local",
        "localDefinition": definition,
        "config": {"values": {}, "outputBindings": {}},
    }


def _watch_library(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record each library version read; reading the latest version fails the test."""
    read: list[str] = []
    real_load_version = _storage.load_version

    def load_version(function_id: str, version: str) -> dict[str, Any]:
        read.append(version)
        return real_load_version(function_id, version)

    def load_function(function_id: str) -> tuple[dict[str, Any], str]:
        raise AssertionError(f"the latest version of '{function_id}' was read")

    monkeypatch.setattr(_storage, "load_version", load_version)
    monkeypatch.setattr(_storage, "load_function", load_function)
    return read


class TestPluginAndControlBlocks:
    def test_plugin_block_reads_the_plugin_fields_and_outputs(self) -> None:
        plugin = get_plugin("http-client", "1.0.0")
        assert plugin is not None
        metadata = plugin.metadata

        schema = block_schema(
            {
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": {}},
            }
        )

        assert schema.kind == "plugin"
        assert _names(schema.fields) == _names(metadata["parameters"])
        assert _names(schema.outputs) == _names(metadata["output_schema"])
        assert "url" in _names(schema.fields)

    def test_control_block_reads_the_control_fields_and_outputs(self) -> None:
        control = get_control_implementation(ControlId.WAIT_UNTIL, "1.0.0")
        assert control is not None
        metadata = control().metadata

        schema = block_schema(
            {
                "elementType": "wait-until",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": {}},
            }
        )

        assert schema.kind == "control"
        assert _names(schema.fields) == _names(metadata["parameter_schema"])
        assert _names(schema.outputs) == ["passed", "elapsed"]


class TestLocalFunctionBlock:
    def test_local_block_reads_its_own_definition(self) -> None:
        definition = {
            "inputs": [
                {"name": "who", "type": "string", "required": True},
                {"name": "retries", "type": "integer", "required": False, "default": 3},
            ],
            "outputs": [{"name": "greeting", "type": "string", "description": "", "secret": False}],
            "variables": [],
            "workflow": {"nodes": [], "edges": []},
        }

        schema = block_schema(_local_block(definition))

        assert schema.kind == "function"
        assert _names(schema.fields) == ["who", "retries"]
        assert schema.fields == function_block_fields(definition)
        assert schema.outputs == function_block_outputs(definition)


class TestSharedFunctionBlock:
    def test_pinned_block_reads_its_version_never_the_newer_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        function_id = _seed({"1.0.0": _PINNED_BODY, "1.1.0": _NEWER_BODY})
        assert _storage.load_function(function_id)[0]["version"] == "1.1.0"
        pinned = _storage.load_version(function_id, "1.0.0")
        read = _watch_library(monkeypatch)

        schema = block_schema(_shared_block(function_id, "1.0.0"))

        assert schema.kind == "function"
        assert _names(schema.fields) == ["who"]
        assert _names(schema.outputs) == ["greeting"]
        assert schema.fields == function_block_fields(pinned)
        assert schema.outputs == function_block_outputs(pinned)
        assert "1.1.0" not in read

    def test_block_in_edit_mode_reads_its_draft(self) -> None:
        function_id = _seed({"1.0.0": _PINNED_BODY})
        draft = {"name": "greet", **_NEWER_BODY}

        schema = block_schema(_shared_block(function_id, "1.0.0", editMode=True, draft=draft))

        assert schema.kind == "function"
        assert _names(schema.fields) == ["who", "loud"]
        assert schema.fields == function_block_fields(draft)
        assert schema.outputs == function_block_outputs(draft)

    def test_block_out_of_edit_mode_reads_its_version_not_a_left_draft(self) -> None:
        function_id = _seed({"1.0.0": _PINNED_BODY})
        draft = {"name": "greet", **_NEWER_BODY}

        schema = block_schema(_shared_block(function_id, "1.0.0", editMode=False, draft=draft))

        assert _names(schema.fields) == ["who"]
        assert _names(schema.outputs) == ["greeting"]

    @pytest.mark.parametrize("version", ["9.9.9", None], ids=["missing-version", "no-version"])
    def test_block_with_no_readable_version_has_no_fields_or_outputs(
        self, monkeypatch: pytest.MonkeyPatch, version: str | None
    ) -> None:
        function_id = _seed({"1.0.0": _PINNED_BODY, "1.1.0": _NEWER_BODY})
        _watch_library(monkeypatch)

        schema = block_schema(_shared_block(function_id, version))

        assert schema.kind == "function"
        assert list(schema.fields) == []
        assert list(schema.outputs) == []

    def test_block_of_an_unknown_function_has_no_fields_or_outputs(self) -> None:
        schema = block_schema(_shared_block("no-such-function", "1.0.0"))

        assert schema.kind == "function"
        assert list(schema.fields) == []
        assert list(schema.outputs) == []


_DICT_PARAMETERS: list[dict[str, Any]] = [
    {"name": "url", "type": "string", "required": True, "description": "Where", "trim": True},
    {
        "name": "level",
        "type": "string",
        "required": False,
        "default": "low",
        "enum_values": ["low", "high"],
        "description": "How loud",
        "trim": False,
    },
]
_DICT_OUTPUTS: list[dict[str, Any]] = [
    {"name": "token", "type": "string", "description": "Issued token", "secret": True},
    {"name": "status", "type": "integer", "description": "Status code", "secret": False},
]
_FIELD_KEYS = ("name", "type", "required", "default", "enum_values", "description", "trim")
_OUTPUT_KEYS = ("name", "type", "description", "secret")


class _StubPlugin:
    """A registered plugin declaring the same rows as dicts or as models."""

    def __init__(self, plugin_id: str, parameters: list[Any], outputs: list[Any]) -> None:
        self._metadata = {
            "id": plugin_id,
            "name": plugin_id,
            "version": "1.0.0",
            "category": "system",
            "description": "stub",
            "parameters": parameters,
            "output_schema": outputs,
        }

    @property
    def metadata(self) -> dict[str, Any]:
        return self._metadata

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        return {}

    async def cleanup(self) -> None:
        pass


def _rows(items: Iterable[Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    return [{key: get_param_attr(item, key) for key in keys} for item in items]


def _plugin_block(plugin_id: str) -> dict[str, Any]:
    return {
        "elementType": plugin_id,
        "nodeType": "plugin",
        "version": "1.0.0",
        "config": {"values": {}},
    }


class TestModelAndDictDeclarations:
    def test_a_plugin_declared_with_models_gives_the_same_fields_and_outputs(self) -> None:
        from wavecore.models.plugins import OutputField, PluginParameter

        register_plugin(_StubPlugin("dict-form-plugin", _DICT_PARAMETERS, _DICT_OUTPUTS))
        register_plugin(
            _StubPlugin(
                "model-form-plugin",
                [PluginParameter(**row) for row in _DICT_PARAMETERS],
                [OutputField(**row) for row in _DICT_OUTPUTS],
            )
        )

        dict_schema = block_schema(_plugin_block("dict-form-plugin"))
        model_schema = block_schema(_plugin_block("model-form-plugin"))

        assert _rows(model_schema.fields, _FIELD_KEYS) == _rows(_DICT_PARAMETERS, _FIELD_KEYS)
        assert _rows(model_schema.fields, _FIELD_KEYS) == _rows(dict_schema.fields, _FIELD_KEYS)
        assert _rows(model_schema.outputs, _OUTPUT_KEYS) == _DICT_OUTPUTS
        assert _rows(dict_schema.outputs, _OUTPUT_KEYS) == _DICT_OUTPUTS


class TestUnknownBlocks:
    def test_an_unknown_plugin_has_no_fields_or_outputs(self) -> None:
        schema = block_schema(_plugin_block("no-such-plugin"))

        assert schema.kind == "plugin"
        assert list(schema.fields) == []
        assert list(schema.outputs) == []

    def test_an_unknown_control_has_no_fields_or_outputs(self) -> None:
        schema = block_schema(
            {
                "elementType": "no-such-control",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": {}},
            }
        )

        assert schema.kind == "control"
        assert list(schema.fields) == []
        assert list(schema.outputs) == []


def _refuse_library_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: Any) -> Any:
        raise AssertionError(f"the library was read for {args!r}")

    monkeypatch.setattr(_storage, "load_version", refuse)
    monkeypatch.setattr(_storage, "load_function", refuse)


class TestSharedFunctionBlockFromAGivenRegistry:
    def test_the_pinned_version_is_read_from_the_given_registry(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        function_id = str(uuid.uuid4())
        entry = {
            "id": function_id,
            "name": "greet",
            "version": "1.0.0",
            "available_versions": ["1.0.0"],
            **_NEWER_BODY,
        }
        _refuse_library_reads(monkeypatch)

        schema = block_schema(_shared_block(function_id, "1.0.0"), registry={function_id: entry})

        assert schema.kind == "function"
        assert _names(schema.fields) == ["who", "loud"]
        assert schema.fields == function_block_fields(entry)
        assert schema.outputs == function_block_outputs(entry)

    def test_a_registry_holding_a_newer_version_never_replaces_the_pin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        function_id = _seed({"1.0.0": _PINNED_BODY, "1.1.0": _NEWER_BODY})
        newer = {
            "id": function_id,
            "name": "greet",
            "version": "1.1.0",
            "available_versions": ["1.0.0", "1.1.0"],
            **_NEWER_BODY,
        }

        schema = block_schema(_shared_block(function_id, "1.0.0"), registry={function_id: newer})

        assert _names(schema.fields) == ["who"]
        assert _names(schema.outputs) == ["greeting"]

    def test_the_registry_is_a_keyword_argument(self) -> None:
        with pytest.raises(TypeError):
            block_schema(_shared_block("no-such-function", "1.0.0"), {})
