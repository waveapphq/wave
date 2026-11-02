"""Ping block metadata: identity, backend parameter keys and outputs (REQ-3.4.1.9)."""

from typing import Any

import pytest

from wavecore.plugins._shared_params import (
    on_error_parameter,
    stream_output_parameter,
    timeout_parameter,
)
from wavecore.plugins.ping import PingPlugin

PARAM_ORDER = [
    "host",
    "count",
    "interval",
    "packet_size",
    "timeout",
    "pass_when",
    "min_replies",
    "min_rate",
    "stream_output",
    "ip_version",
    "ttl",
    "dont_fragment",
    "source_address",
    "on_error",
]

FLOAT_PARAMS = {"interval", "min_rate"}
INTEGER_PARAMS = {"count", "packet_size", "timeout", "min_replies", "ttl"}
BOOLEAN_PARAMS = {"stream_output", "dont_fragment"}


def _param_type(name: str) -> str:
    if name in FLOAT_PARAMS:
        return "float"
    if name in INTEGER_PARAMS:
        return "integer"
    return "boolean" if name in BOOLEAN_PARAMS else "string"


PARAM_TYPES = {name: _param_type(name) for name in PARAM_ORDER}

MIN_REPLIES_GATE = {"field": "pass_when", "values": ["min_replies"]}
MIN_RATE_GATE = {"field": "pass_when", "values": ["min_rate"]}
RECORD_GATE = {"field": "on_error", "values": ["record"]}

PASS_WHEN_VALUES = ["any", "all", "min_replies", "min_rate"]
IP_VERSION_VALUES = ["auto", "v4", "v6"]

# Every key beyond name, type and description, per parameter (PING-12, PING-17).
PARAM_KEYS: dict[str, dict[str, Any]] = {
    "host": {"required": True, "trim": True},
    "count": {"default": 4, "minimum": 1, "maximum": 1000},
    "interval": {"default": 1, "minimum": 0.2},
    "packet_size": {"default": 56, "minimum": 0, "maximum": 65507},
    "timeout": {"required": False, "default": 30, "minimum": 1},
    "pass_when": {"default": "any", "enum_values": PASS_WHEN_VALUES},
    "min_replies": {
        "default": 1,
        "minimum": 1,
        "required_when": MIN_REPLIES_GATE,
        "show_when": MIN_REPLIES_GATE,
    },
    "min_rate": {
        "default": 100,
        "minimum": 0,
        "maximum": 100,
        "required_when": MIN_RATE_GATE,
        "show_when": MIN_RATE_GATE,
    },
    "stream_output": {"required": False, "default": False},
    "ip_version": {"default": "auto", "enum_values": IP_VERSION_VALUES},
    "ttl": {"minimum": 1, "maximum": 255},
    "dont_fragment": {"default": False},
    "source_address": {"trim": True},
    "on_error": {"required": False, "default": "fail", "enum_values": ["fail", "record"]},
}

FRONTEND_ONLY_KEYS = {
    "group",
    "label",
    "enum_labels",
    "fileReference",
    "allowedFormats",
    "retainOnHide",
}

OUTPUTS = [
    ("success", "boolean"),
    ("summary", "table"),
    ("replies", "table"),
    ("error", "string"),
    ("reason", "string"),
]
OUTPUT_ORDER = [name for name, _ in OUTPUTS]


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in PingPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in PingPlugin().metadata["output_schema"]}


def _without_description(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "description"}


class TestPingIdentity:
    """Identity, remotability and a one-sentence description (PING-1)."""

    def test_identity_fields_and_description(self) -> None:
        meta = PingPlugin().metadata
        identity = {
            key: meta.get(key)
            for key in ("id", "name", "version", "category", "remotable", "return_type")
        }

        assert identity == {
            "id": "ping",
            "name": "Ping",
            "version": "1.0.0",
            "category": "network",
            "remotable": True,
            "return_type": "map",
        }
        assert meta["remotable"] is True
        description = meta["description"]
        assert isinstance(description, str) and description.strip()
        assert description.endswith(".")
        assert ". " not in description

    def test_metadata_builds_the_plugin_model(self) -> None:
        model = PingPlugin().get_plugin_model()

        assert model.id == "ping"
        assert model.version == "1.0.0"
        assert {p.name for p in model.parameters} == set(PARAM_ORDER)
        assert [o.name for o in model.outputs] == OUTPUT_ORDER


class TestPingParameters:
    """Every parameter row carries exactly the backend keys of its contract (PING-6, PING-7)."""

    def test_parameter_order(self) -> None:
        params = PingPlugin().metadata["parameters"]

        assert [p["name"] for p in params] == PARAM_ORDER

    @pytest.mark.parametrize(("name", "expected"), list(PARAM_TYPES.items()))
    def test_parameter_type(self, name: str, expected: str) -> None:
        assert _parameters()[name]["type"] == expected

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_exact_key_set(self, name: str) -> None:
        expected = {"name": name, "type": PARAM_TYPES[name], **PARAM_KEYS[name]}

        assert _without_description(_parameters()[name]) == expected

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_every_parameter_has_a_description(self, name: str) -> None:
        description = _parameters()[name]["description"]

        assert isinstance(description, str) and description.strip()

    @pytest.mark.parametrize(
        ("name", "shared"),
        [
            ("timeout", {**timeout_parameter(30, "-"), "minimum": 1}),
            ("stream_output", stream_output_parameter("-")),
            ("on_error", on_error_parameter("-")),
        ],
    )
    def test_shared_rows_keep_the_shared_shape(self, name: str, shared: dict[str, Any]) -> None:
        assert _without_description(_parameters()[name]) == _without_description(shared)

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_no_frontend_only_key(self, name: str) -> None:
        assert FRONTEND_ONLY_KEYS.isdisjoint(_parameters()[name])


class TestPingOutputs:
    """Success, Summary and Replies always listed; Error and Reason behind Record (PING-9)."""

    def test_output_order(self) -> None:
        outputs = PingPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == OUTPUT_ORDER

    @pytest.mark.parametrize(("name", "expected"), OUTPUTS)
    def test_output_type(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_error_and_reason_are_behind_the_record_gate(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["success", "summary", "replies"])
    def test_other_outputs_carry_no_show_when(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    @pytest.mark.parametrize("name", OUTPUT_ORDER)
    def test_every_output_has_a_description(self, name: str) -> None:
        description = _outputs()[name]["description"]

        assert isinstance(description, str) and description.strip()
