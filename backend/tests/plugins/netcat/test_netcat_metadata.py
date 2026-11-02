"""Netcat block metadata: identity, backend parameter keys and outputs (REQ-3.4.1.9)."""

from typing import Any

import pytest

from wavecore.plugins._shared_params import on_error_parameter, timeout_parameter
from wavecore.plugins.netcat import NetcatPlugin

PARAM_ORDER = [
    "host",
    "ports",
    "port",
    "port_range",
    "pass_when",
    "protocol",
    "mode",
    "send",
    "text",
    "file",
    "timeout",
    "crlf",
    "close_after_send",
    "max_reply_bytes",
    "on_error",
]

INTEGER_PARAMS = {"port", "timeout", "max_reply_bytes"}
BOOLEAN_PARAMS = {"crlf", "close_after_send"}
PARAM_TYPES = {
    name: (
        "integer" if name in INTEGER_PARAMS else "boolean" if name in BOOLEAN_PARAMS else "string"
    )
    for name in PARAM_ORDER
}

SINGLE_GATE = {"field": "ports", "values": ["single"]}
RANGE_GATE = {"field": "ports", "values": ["range"]}
TALK_GATE = {"field": "mode", "values": ["talk"]}
RECORD_GATE = {"field": "on_error", "values": ["record"]}

# Every key beyond name, type and description, per parameter.
PARAM_KEYS: dict[str, dict[str, Any]] = {
    "host": {"required": True, "trim": True},
    "ports": {"default": "single", "enum_values": ["single", "range"]},
    "port": {"required_when": SINGLE_GATE, "show_when": SINGLE_GATE},
    "port_range": {"required_when": RANGE_GATE, "show_when": RANGE_GATE, "trim": True},
    "pass_when": {"default": "one", "enum_values": ["one", "all"], "show_when": RANGE_GATE},
    "protocol": {"default": "tcp", "enum_values": ["tcp", "udp"]},
    "mode": {"default": "check", "enum_values": ["check", "talk"]},
    "send": {
        "default": "text",
        "enum_values": ["nothing", "text", "file"],
        "show_when": TALK_GATE,
    },
    "text": {},
    "file": {
        "required_when_all": [TALK_GATE, {"field": "send", "values": ["file"]}],
        "trim": True,
    },
    "timeout": {"required": False, "default": 10, "minimum": 1},
    "crlf": {"default": False, "show_when": TALK_GATE},
    "close_after_send": {"default": False},
    "max_reply_bytes": {"default": 16777216, "minimum": 1, "show_when": TALK_GATE},
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
    ("results", "table"),
    ("reply", "string"),
    ("error", "string"),
    ("reason", "string"),
]
OUTPUT_ORDER = [name for name, _ in OUTPUTS]


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in NetcatPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in NetcatPlugin().metadata["output_schema"]}


def _without_description(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "description"}


class TestNetcatIdentity:
    """Identity, remotability and a one-sentence description (NETCAT-1, NETCAT-8)."""

    def test_identity_fields_and_description(self) -> None:
        meta = NetcatPlugin().metadata
        identity = {
            key: meta.get(key)
            for key in ("id", "name", "version", "category", "remotable", "return_type")
        }

        assert identity == {
            "id": "netcat",
            "name": "Netcat",
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
        model = NetcatPlugin().get_plugin_model()

        assert model.id == "netcat"
        assert model.version == "1.0.0"
        assert {p.name for p in model.parameters} == set(PARAM_ORDER)
        assert [o.name for o in model.outputs] == OUTPUT_ORDER


class TestNetcatParameters:
    """Every parameter row carries exactly the backend keys of its wire contract (NETCAT-12)."""

    def test_parameter_order(self) -> None:
        params = NetcatPlugin().metadata["parameters"]

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
            ("timeout", {**timeout_parameter(10, "-"), "minimum": 1}),
            ("on_error", on_error_parameter("-")),
        ],
    )
    def test_shared_rows_keep_the_shared_shape(self, name: str, shared: dict[str, Any]) -> None:
        assert _without_description(_parameters()[name]) == _without_description(shared)

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_no_frontend_only_key(self, name: str) -> None:
        assert FRONTEND_ONLY_KEYS.isdisjoint(_parameters()[name])


class TestNetcatOutputs:
    """Success, Results and Reply always listed; Error and Reason behind Record (NETCAT-7)."""

    def test_output_order(self) -> None:
        outputs = NetcatPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == OUTPUT_ORDER

    @pytest.mark.parametrize(("name", "expected"), OUTPUTS)
    def test_output_type(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_error_and_reason_are_behind_the_record_gate(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["success", "results", "reply"])
    def test_other_outputs_carry_no_show_when(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    @pytest.mark.parametrize("name", OUTPUT_ORDER)
    def test_every_output_has_a_description(self, name: str) -> None:
        description = _outputs()[name]["description"]

        assert isinstance(description, str) and description.strip()
