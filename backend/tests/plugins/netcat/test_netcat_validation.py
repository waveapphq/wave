"""Netcat block validation: exact messages for the settings in effect (REQ-3.4.1.9, NETCAT-14)."""

import re
from typing import Any

import pytest

from wavecore.plugins.netcat import NetcatPlugin

ABSENT: Any = object()

SINGLE: dict[str, Any] = {"host": "db.example", "port": 5432}
RANGE: dict[str, Any] = {"host": "db.example", "ports": "range", "port_range": "22, 80"}
TALK: dict[str, Any] = {"host": "db.example", "port": 7, "mode": "talk"}

# Validation fails the block whatever On error says.
ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def shaped(base: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The base parameter set with overrides applied; an ABSENT override removes the key."""
    merged = {**base, **overrides}
    return {key: value for key, value in merged.items() if value is not ABSENT}


async def refuses(message: str, params: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=exact(message)):
        await NetcatPlugin().validate(params)


def blank_values(*values: str | None) -> list[Any]:
    """Absent first, then the given blank values, each with a readable id."""
    ids = {None: "none", "": "empty"}
    cases = [pytest.param(ABSENT, id="absent")]
    return cases + [pytest.param(v, id=ids.get(v) or f"spaces-{len(v or '')}") for v in values]


class TestRequiredRows:
    """Host, Port, Port range and File are required while their rows are in effect."""

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_host_missing_or_blank(self, value: Any, on_error: str) -> None:
        params = shaped(SINGLE, host=value, on_error=on_error)

        await refuses("Missing required parameter: host", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "  "))
    async def test_port_missing_or_blank_in_single(self, value: Any, on_error: str) -> None:
        params = shaped(SINGLE, port=value, on_error=on_error)

        await refuses("Missing required parameter: port", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_port_range_missing_or_blank_in_range(self, value: Any, on_error: str) -> None:
        params = shaped(RANGE, port_range=value, on_error=on_error)

        await refuses("Missing required parameter: port_range", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "  "))
    async def test_file_missing_or_blank_in_talk_file(self, value: Any, on_error: str) -> None:
        params = shaped(TALK, send="file", file=value, on_error=on_error)

        await refuses("Missing required parameter: file", params)


class TestPortValues:
    """Port is an integer from 1 to 65535; Port range entries follow the grammar (NETCAT-2)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, 65536, "abc", "80", True])
    async def test_port_outside_bounds_or_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(SINGLE, port=value, on_error=on_error)

        await refuses("Parameter 'port' must be between 1 and 65535", params)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("port_range", "message"),
        [
            ("22,,80", "Parameter 'port_range' has an invalid entry: ''"),
            ("70000", "Parameter 'port_range' must be between 1 and 65535"),
            ("10-5", "Parameter 'port_range' has a range that runs backward: '10-5'"),
        ],
    )
    async def test_port_range_entry_messages(
        self, port_range: str, message: str, on_error: str
    ) -> None:
        params = shaped(RANGE, port_range=port_range, on_error=on_error)

        await refuses(message, params)


class TestChoices:
    """Every select holds one of its wire values; the message lists them in order."""

    @ON_ERROR
    @pytest.mark.parametrize(
        ("base", "name", "value", "values"),
        [
            pytest.param(SINGLE, "ports", "both", "single, range", id="ports"),
            pytest.param(RANGE, "pass_when", "any", "one, all", id="pass_when"),
            pytest.param(SINGLE, "protocol", "sctp", "tcp, udp", id="protocol"),
            pytest.param(SINGLE, "mode", "listen", "check, talk", id="mode"),
            pytest.param(TALK, "send", "stdin", "nothing, text, file", id="send"),
        ],
    )
    async def test_value_outside_its_choices(
        self, base: dict[str, Any], name: str, value: str, values: str, on_error: str
    ) -> None:
        params = shaped(base, on_error=on_error, **{name: value})

        await refuses(
            f"Parameter '{name}' must be one of: {values}; Actual value was '{value}'.", params
        )

    async def test_a_long_value_is_shown_by_its_length(self) -> None:
        params = shaped(SINGLE, mode="x" * 60)

        await refuses(
            "Parameter 'mode' must be one of: check, talk; Actual value was a 60-character value.",
            params,
        )

    async def test_on_error_outside_its_choices(self) -> None:
        params = shaped(SINGLE, on_error="ignore")

        await refuses(
            "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'.",
            params,
        )

    @ON_ERROR
    async def test_send_nothing_over_udp_in_talk(self, on_error: str) -> None:
        params = shaped(TALK, send="nothing", protocol="udp", on_error=on_error)

        await refuses("Parameter 'send' cannot be 'nothing' when protocol is 'udp'", params)


class TestNumbersAndSwitches:
    """Timeout and Max reply size are positive integers; CRLF and Close after sending booleans."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["10", 1.5, 10.0, True])
    async def test_timeout_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(SINGLE, timeout=value, on_error=on_error)

        await refuses("Parameter 'timeout' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1])
    async def test_timeout_not_positive(self, value: int, on_error: str) -> None:
        params = shaped(SINGLE, timeout=value, on_error=on_error)

        await refuses("Parameter 'timeout' must be positive", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", ["4", 2.0, False])
    async def test_max_reply_bytes_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(TALK, max_reply_bytes=value, on_error=on_error)

        await refuses("Parameter 'max_reply_bytes' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -5])
    async def test_max_reply_bytes_not_positive(self, value: int, on_error: str) -> None:
        params = shaped(TALK, max_reply_bytes=value, on_error=on_error)

        await refuses("Parameter 'max_reply_bytes' must be positive", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", ["yes", 1])
    async def test_crlf_not_a_boolean(self, value: Any, on_error: str) -> None:
        params = shaped(TALK, crlf=value, on_error=on_error)

        await refuses("Parameter 'crlf' must be a boolean", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", ["true", 0])
    async def test_close_after_send_not_a_boolean(self, value: Any, on_error: str) -> None:
        params = shaped(TALK, protocol="tcp", close_after_send=value, on_error=on_error)

        await refuses("Parameter 'close_after_send' must be a boolean", params)


class TestSettingsInEffect:
    """A row hidden by Ports, Mode, Send or Protocol is not validated (NETCAT-14)."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(shaped(SINGLE, send="nothing", protocol="udp"), id="nothing-udp-check"),
            pytest.param(shaped(RANGE, port=0), id="invalid-port-in-range"),
            pytest.param(shaped(SINGLE, port_range=""), id="blank-port-range-in-single"),
            pytest.param(shaped(TALK, send="text"), id="no-file-with-send-text"),
            pytest.param(shaped(SINGLE, max_reply_bytes=0), id="max-reply-zero-in-check"),
            pytest.param(
                shaped(TALK, protocol="udp", close_after_send="yes"),
                id="close-after-send-over-udp",
            ),
            pytest.param(shaped(SINGLE, pass_when="any"), id="pass-when-in-single"),
            pytest.param(shaped(SINGLE, send="stdin"), id="send-in-check"),
            pytest.param(shaped(SINGLE, crlf="yes"), id="crlf-in-check"),
            pytest.param(shaped(SINGLE, send="file"), id="file-missing-with-send-file-in-check"),
            pytest.param(
                shaped(SINGLE, close_after_send="yes"), id="close-after-send-in-tcp-check"
            ),
            pytest.param(
                shaped(SINGLE, max_reply_bytes="abc"), id="max-reply-not-an-integer-in-check"
            ),
        ],
    )
    async def test_hidden_row_passes(self, params: dict[str, Any]) -> None:
        await NetcatPlugin().validate(params)


class TestValidConfigurations:
    """Complete configurations pass; absent or None settings take their defaults."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(dict(SINGLE), id="single-check-minimal"),
            pytest.param(
                shaped(RANGE, mode="talk", protocol="udp", send="text", text="ping"),
                id="range-talk-udp-text",
            ),
            pytest.param(shaped(TALK, send="file", file="testdata://payload.bin"), id="talk-file"),
            pytest.param(
                shaped(SINGLE, ports=None, protocol=None, mode=None, timeout=None, on_error=None),
                id="none-top-rows",
            ),
            pytest.param(shaped(RANGE, pass_when=None), id="none-pass-when"),
            pytest.param(
                shaped(TALK, send=None, crlf=None, close_after_send=None, max_reply_bytes=None),
                id="none-talk-rows",
            ),
        ],
    )
    async def test_configuration_passes(self, params: dict[str, Any]) -> None:
        await NetcatPlugin().validate(params)
