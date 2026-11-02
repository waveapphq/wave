"""Shared Function Block contract resolution (REQ-3.1.2.4).

A Shared Function Block reads its field list from the pinned version in the
library, and that field list feeds the one field check every Block uses. A
top-level Shared Function Block with a missing Required input is blocked; a
stored value whose type or allowed values disagree with the declared input is
blocked. The contract is read from the pinned version, never the latest.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

pytestmark = pytest.mark.usefixtures("temp_storage_path")


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


def _metadata() -> dict[str, Any]:
    return {
        "description": "auth",
        "tags": [],
        "changelog": "v",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }


def _seed_version(
    fn_id: str,
    version: str,
    *,
    inputs: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
    name: str = "auth",
) -> None:
    from wavecore.api.services.functions._storage import save_new_version

    definition = {
        "inputs": inputs,
        "outputs": outputs,
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    save_new_version(fn_id, version, definition, _metadata(), name=name)


def _shared_node(
    *,
    function_id: str,
    function_version: str,
    values: dict[str, Any] | None = None,
    expression_fields: list[str] | None = None,
    node_id: str = "auth-1",
    label: str = "Authenticate",
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": label,
        "elementType": "function",
        "nodeType": "function",
        "version": "1.0.0",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "functionVersion": function_version,
        "config": {"values": values or {}, "outputBindings": {}, "profileBindings": []},
    }
    if expression_fields is not None:
        data["expressionFields"] = expression_fields
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 100},
        "data": data,
    }


def _test_with_nodes(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "name": "T",
        "version": "1.0.0",
        "workflow": {"nodes": nodes, "edges": []},
        "variables": {},
    }


def _find(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e.get("code") == code]


_REQUIRED_INPUT = [{"name": "user_id", "type": "string", "required": True}]
_OUTPUT_TOKEN = [{"name": "token", "type": "string"}]


# ---------------------------------------------------------------------------
# Missing required input on a top-level Shared instance
# ---------------------------------------------------------------------------


class TestSharedInstanceBindingCompleteness:
    def test_unbound_required_input_is_blocked(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0")

        result = _validate_test_data(_test_with_nodes([node]), context="save")
        issues = _find(result, "REQUIRED_PARAM_MISSING")
        assert any(
            re.match(r"^Required parameter 'user_id' is missing$", i["message"]) for i in issues
        ), result["errors"]

    def test_a_required_input_given_a_value_is_clean(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0", values={"user_id": "abc"})

        result = _validate_test_data(_test_with_nodes([node]), context="save")
        missing = [
            i
            for i in _find(result, "REQUIRED_PARAM_MISSING")
            if re.match(r"^Required parameter 'user_id' is missing$", i["message"])
        ]
        assert missing == []

    def test_optional_input_left_unset_is_clean(self) -> None:
        """The required check only flags Required inputs; an unset optional input is fine."""
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(
            fn_id,
            "1.0.0",
            inputs=[
                {"name": "user_id", "type": "string", "required": True},
                {"name": "note", "type": "string", "required": False},
            ],
            outputs=_OUTPUT_TOKEN,
        )
        node = _shared_node(function_id=fn_id, function_version="1.0.0", values={"user_id": "abc"})

        result = _validate_test_data(_test_with_nodes([node]), context="save")
        missing_names = {
            re.sub(r"^Required parameter '([^']+)' is missing$", r"\1", i["message"])
            for i in _find(result, "REQUIRED_PARAM_MISSING")
        }
        assert "note" not in missing_names
        assert "user_id" not in missing_names

    def test_an_expression_gives_the_input_a_value(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(
            function_id=fn_id,
            function_version="1.0.0",
            values={"user_id": "uid"},
            expression_fields=["user_id"],
        )
        test = _test_with_nodes([node])
        test["variables"] = {"uid": {"type": "string", "value": "abc"}}

        result = _validate_test_data(test, context="save")

        assert _find(result, "REQUIRED_PARAM_MISSING") == [], result["errors"]
        assert _find(result, "REQUIRED_PARAM_EMPTY") == [], result["errors"]

    @pytest.mark.parametrize(
        ("value", "expression_fields"),
        [
            pytest.param("   ", None, id="blank-text"),
            pytest.param("   ", ["user_id"], id="blank-expression"),
        ],
    )
    def test_a_blank_value_is_empty(self, value: str, expression_fields: list[str] | None) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(
            function_id=fn_id,
            function_version="1.0.0",
            values={"user_id": value},
            expression_fields=expression_fields,
        )

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        assert [i["message"] for i in _find(result, "REQUIRED_PARAM_EMPTY")] == [
            "Required parameter 'user_id' is empty"
        ]
        assert _find(result, "REQUIRED_PARAM_MISSING") == []

    def test_a_null_value_is_missing(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0", values={"user_id": None})

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        assert [i["message"] for i in _find(result, "REQUIRED_PARAM_MISSING")] == [
            "Required parameter 'user_id' is missing"
        ]

    @pytest.mark.parametrize(
        "declared",
        [
            pytest.param(
                {"name": "user_id", "type": "string", "required": True, "default": "anon"},
                id="required",
            ),
            pytest.param(
                {
                    "name": "user_id",
                    "type": "string",
                    "required": True,
                    "enumValues": ["anon", "admin"],
                    "default": "anon",
                },
                id="enum",
            ),
        ],
    )
    def test_a_stored_default_never_binds_a_required_input(self, declared: dict[str, Any]) -> None:
        """A Function Block never uses a Required input's default (REQ-3.1.2.10)."""
        from wavecore.api.services.functions._storage import load_version
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=[declared], outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0")

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        assert load_version(fn_id, "1.0.0")["inputs"][0]["default"] == "anon"
        assert [i["message"] for i in _find(result, "REQUIRED_PARAM_MISSING")] == [
            "Required parameter 'user_id' is missing"
        ]


# ---------------------------------------------------------------------------
# Value type and allowed values against the resolved contract
# ---------------------------------------------------------------------------


class TestSharedInstanceFieldValues:
    """The block named in the message is the Function's library name."""

    def test_a_value_of_the_wrong_type_is_blocked(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0", values={"user_id": 123})

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        messages = [i["message"] for i in _find(result, "INVALID_SETTING_TYPE")]
        assert messages == ["Setting 'user_id' of block 'auth' expects string, got integer"]
        assert _find(result, "INVALID_SETTING_TYPE")[0]["node_id"] == "auth-1"

    def test_an_undeclared_field_is_blocked(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        node = _shared_node(
            function_id=fn_id, function_version="1.0.0", values={"user_id": "abc", "nope": 1}
        )

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        assert [i["message"] for i in _find(result, "UNKNOWN_SETTING")] == [
            "Block 'auth' has no setting 'nope'"
        ]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "value", "expected"),
        [
            pytest.param(
                "string",
                ["low", "high"],
                "mid",
                r"^Setting 'level' of block 'auth' must be one of: low, high$",
                id="string",
            ),
            pytest.param(
                "integer",
                [1, 2],
                3,
                r"^Setting 'level' of block 'auth' must be one of: 1, 2$",
                id="integer",
            ),
            pytest.param(
                "float",
                [1.5, 2.5],
                3.5,
                r"^Setting 'level' of block 'auth' must be one of: 1\.5, 2\.5$",
                id="float",
            ),
        ],
    )
    def test_a_value_outside_the_pinned_enum_is_blocked(
        self, value_type: str, allowed: list[Any], value: Any, expected: str
    ) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        level = {
            "name": "level",
            "type": value_type,
            "required": True,
            "enumValues": allowed,
            "default": allowed[0],
        }
        _seed_version(fn_id, "1.0.0", inputs=[level], outputs=_OUTPUT_TOKEN)
        node = _shared_node(function_id=fn_id, function_version="1.0.0", values={"level": value})

        result = _validate_test_data(_test_with_nodes([node]), context="save")

        messages = [i["message"] for i in _find(result, "INVALID_ENUM_VALUE")]
        assert len(messages) == 1, result["errors"]
        assert re.match(expected, messages[0])
        assert _find(result, "INVALID_SETTING_TYPE") == []


# ---------------------------------------------------------------------------
# The contract is read from the PINNED version, not the latest
# ---------------------------------------------------------------------------


class TestResolveVersionContract:
    def test_unknown_function_id_resolves_to_none(self) -> None:
        from wavecore.api.services.functions.service import resolve_version_contract

        assert resolve_version_contract(str(uuid.uuid4()), "1.0.0") is None

    def test_unknown_version_resolves_to_none(self) -> None:
        from wavecore.api.services.functions.service import resolve_version_contract

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        assert resolve_version_contract(fn_id, "9.9.9") is None


class TestPinnedVersionContractResolution:
    def test_required_input_resolved_from_pinned_not_latest(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        # v1 requires user_id; v2 (latest) drops the input entirely.
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        _seed_version(fn_id, "2.0.0", inputs=[], outputs=_OUTPUT_TOKEN)

        pinned_v1 = _shared_node(function_id=fn_id, function_version="1.0.0")
        result_v1 = _validate_test_data(_test_with_nodes([pinned_v1]), context="save")
        assert any(
            re.match(r"^Required parameter 'user_id' is missing$", i["message"])
            for i in _find(result_v1, "REQUIRED_PARAM_MISSING")
        ), "pinning v1 must resolve v1's required-input contract"

    def test_no_required_input_when_pinned_to_relaxed_version(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        _seed_version(fn_id, "2.0.0", inputs=[], outputs=_OUTPUT_TOKEN)

        pinned_v2 = _shared_node(function_id=fn_id, function_version="2.0.0")
        result_v2 = _validate_test_data(_test_with_nodes([pinned_v2]), context="save")
        user_id_missing = [
            i
            for i in _find(result_v2, "REQUIRED_PARAM_MISSING")
            if re.match(r"^Required parameter 'user_id' is missing$", i["message"])
        ]
        assert user_id_missing == [], "pinning v2 must NOT inherit v1's required input"

    def test_the_value_type_is_read_from_the_pinned_version(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        integer_id = [{"name": "user_id", "type": "integer", "required": True}]
        _seed_version(fn_id, "1.0.0", inputs=integer_id, outputs=_OUTPUT_TOKEN)
        _seed_version(fn_id, "2.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)

        pinned_v1 = _shared_node(
            function_id=fn_id, function_version="1.0.0", values={"user_id": "abc"}
        )
        pinned_v2 = _shared_node(
            function_id=fn_id, function_version="2.0.0", values={"user_id": "abc"}
        )
        result_v1 = _validate_test_data(_test_with_nodes([pinned_v1]), context="save")
        result_v2 = _validate_test_data(_test_with_nodes([pinned_v2]), context="save")

        assert [i["message"] for i in _find(result_v1, "INVALID_SETTING_TYPE")] == [
            "Setting 'user_id' of block 'auth' expects integer, got string"
        ]
        assert _find(result_v2, "INVALID_SETTING_TYPE") == []

    def test_a_field_the_pinned_version_dropped_is_unknown(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = str(uuid.uuid4())
        _seed_version(fn_id, "1.0.0", inputs=[], outputs=_OUTPUT_TOKEN)
        _seed_version(fn_id, "2.0.0", inputs=_REQUIRED_INPUT, outputs=_OUTPUT_TOKEN)
        pinned_v1 = _shared_node(
            function_id=fn_id, function_version="1.0.0", values={"user_id": "abc"}
        )

        result = _validate_test_data(_test_with_nodes([pinned_v1]), context="save")

        assert [i["message"] for i in _find(result, "UNKNOWN_SETTING")] == [
            "Block 'auth' has no setting 'user_id'"
        ]
