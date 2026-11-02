"""Ping block validation: exact messages for the settings in effect (REQ-3.4.1.9, PING-12)."""

from typing import Any

import pytest

from tests.plugins.ping.conftest import exact
from wavecore.plugins.ping import PingPlugin

ABSENT: Any = object()

HOST = "router.internal"
BASE: dict[str, Any] = {"host": HOST}
BY_REPLIES: dict[str, Any] = {"host": HOST, "pass_when": "min_replies", "min_replies": 2}
BY_RATE: dict[str, Any] = {"host": HOST, "pass_when": "min_rate", "min_rate": 75}

FULL: dict[str, Any] = {
    "host": "  router.internal  ",
    "count": 10,
    "interval": 0.5,
    "packet_size": 1472,
    "timeout": 20,
    "pass_when": "min_replies",
    "min_replies": 8,
    "min_rate": 90,
    "stream_output": True,
    "ip_version": "v4",
    "ttl": 64,
    "dont_fragment": True,
    "source_address": "10.0.0.5",
    "on_error": "record",
}

# Validation fails the block whatever On error says.
ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])

BLANKS = [
    pytest.param(ABSENT, id="absent"),
    pytest.param(None, id="none"),
    pytest.param("", id="empty"),
    pytest.param("   ", id="spaces"),
]


def shaped(base: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The base parameter set with overrides applied; an ABSENT override removes the key."""
    merged = {**base, **overrides}
    return {key: value for key, value in merged.items() if value is not ABSENT}


async def refuses(message: str, params: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=exact(message)):
        await PingPlugin().validate(params)


def enum_message(name: str, values: list[str], value: str) -> str:
    """The wording the shared enum validator raises, built the way it builds it."""
    return f"Parameter '{name}' must be one of: {', '.join(values)}; Actual value was '{value}'."


class TestRequiredRows:
    """Host is always required; the two Pass when rows only while their rule is chosen."""

    @ON_ERROR
    @pytest.mark.parametrize("value", BLANKS)
    async def test_host_missing_or_blank(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, host=value, on_error=on_error)

        await refuses("Missing required parameter: host", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", BLANKS)
    async def test_min_replies_missing_or_blank_under_its_rule(
        self, value: Any, on_error: str
    ) -> None:
        params = shaped(BY_REPLIES, min_replies=value, on_error=on_error)

        await refuses("Missing required parameter: min_replies", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", BLANKS)
    async def test_min_rate_missing_or_blank_under_its_rule(
        self, value: Any, on_error: str
    ) -> None:
        params = shaped(BY_RATE, min_rate=value, on_error=on_error)

        await refuses("Missing required parameter: min_rate", params)


class TestCount:
    """Count is a whole number from 1 to 1000 (PING-12)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [True, 4.0, 1.5, "4"])
    async def test_count_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, count=value, on_error=on_error)

        await refuses("Parameter 'count' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1, 1001])
    async def test_count_outside_its_bounds(self, value: int, on_error: str) -> None:
        params = shaped(BASE, count=value, on_error=on_error)

        await refuses("Parameter 'count' must be between 1 and 1000", params)

    @pytest.mark.parametrize("value", [1, 1000])
    async def test_count_at_its_bounds_passes(self, value: int) -> None:
        await PingPlugin().validate(shaped(BASE, count=value))


class TestInterval:
    """Interval is a number of at least 0.2 seconds (PING-12)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["1", True, float("nan"), float("inf")])
    async def test_interval_not_a_number(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, interval=value, on_error=on_error)

        await refuses("Parameter 'interval' must be a number", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0.1, 0])
    async def test_interval_below_its_floor(self, value: float, on_error: str) -> None:
        params = shaped(BASE, interval=value, on_error=on_error)

        await refuses("Parameter 'interval' must be at least 0.2", params)

    @pytest.mark.parametrize("value", [0.2, 1, 2.5])
    async def test_interval_at_or_above_its_floor_passes(self, value: float) -> None:
        await PingPlugin().validate(shaped(BASE, interval=value))


class TestPacketSize:
    """Packet size is a whole number from 0 to 65507; zero is a legal payload (PING-12)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [True, 56.0, "56"])
    async def test_packet_size_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, packet_size=value, on_error=on_error)

        await refuses("Parameter 'packet_size' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [-1, 65508])
    async def test_packet_size_outside_its_bounds(self, value: int, on_error: str) -> None:
        params = shaped(BASE, packet_size=value, on_error=on_error)

        await refuses("Parameter 'packet_size' must be between 0 and 65507", params)

    @pytest.mark.parametrize("value", [0, 65507])
    async def test_packet_size_at_its_bounds_passes(self, value: int) -> None:
        await PingPlugin().validate(shaped(BASE, packet_size=value))


class TestTimeout:
    """Timeout is a positive whole number of seconds."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["30", 1.5, 30.0, True])
    async def test_timeout_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, timeout=value, on_error=on_error)

        await refuses("Parameter 'timeout' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -5])
    async def test_timeout_not_positive(self, value: int, on_error: str) -> None:
        params = shaped(BASE, timeout=value, on_error=on_error)

        await refuses("Parameter 'timeout' must be positive", params)


class TestMinReplies:
    """Minimum replies is a whole number from 1 to the Count in effect (PING-18)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [True, 2.0, "2"])
    async def test_min_replies_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(BY_REPLIES, min_replies=value, on_error=on_error)

        await refuses("Parameter 'min_replies' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("count", "value", "ceiling"),
        [
            pytest.param(10, 0, 10, id="below-one"),
            pytest.param(10, 11, 10, id="above-count"),
            pytest.param(ABSENT, 5, 4, id="above-default-count"),
            pytest.param(ABSENT, 0, 4, id="below-one-default-count"),
        ],
    )
    async def test_min_replies_outside_one_and_the_count(
        self, count: Any, value: int, ceiling: int, on_error: str
    ) -> None:
        params = shaped(BY_REPLIES, count=count, min_replies=value, on_error=on_error)

        await refuses(f"Parameter 'min_replies' must be between 1 and {ceiling}", params)

    @pytest.mark.parametrize(
        ("count", "value"),
        [
            pytest.param(10, 1, id="one"),
            pytest.param(10, 10, id="equal-to-count"),
            pytest.param(ABSENT, 4, id="equal-to-default-count"),
        ],
    )
    async def test_min_replies_within_the_count_passes(self, count: Any, value: int) -> None:
        await PingPlugin().validate(shaped(BY_REPLIES, count=count, min_replies=value))


class TestMinRate:
    """Minimum rate is a number from 0 to 100 percent (PING-12)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["50", True])
    async def test_min_rate_not_a_number(self, value: Any, on_error: str) -> None:
        params = shaped(BY_RATE, min_rate=value, on_error=on_error)

        await refuses("Parameter 'min_rate' must be a number", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [-0.1, 100.5])
    async def test_min_rate_outside_its_bounds(self, value: float, on_error: str) -> None:
        params = shaped(BY_RATE, min_rate=value, on_error=on_error)

        await refuses("Parameter 'min_rate' must be between 0 and 100", params)

    @pytest.mark.parametrize("value", [0, 100, 99.5])
    async def test_min_rate_at_its_bounds_passes(self, value: float) -> None:
        await PingPlugin().validate(shaped(BY_RATE, min_rate=value))


class TestAdvancedRows:
    """TTL, Source address and the two switches, checked only while they are set (PING-7)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [True, 64.0, "64"])
    async def test_ttl_not_an_integer(self, value: Any, on_error: str) -> None:
        params = shaped(BASE, ttl=value, on_error=on_error)

        await refuses("Parameter 'ttl' must be an integer", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, 256])
    async def test_ttl_outside_its_bounds(self, value: int, on_error: str) -> None:
        params = shaped(BASE, ttl=value, on_error=on_error)

        await refuses("Parameter 'ttl' must be between 1 and 255", params)

    @pytest.mark.parametrize("value", [1, 255])
    async def test_ttl_at_its_bounds_passes(self, value: int) -> None:
        await PingPlugin().validate(shaped(BASE, ttl=value))

    @ON_ERROR
    @pytest.mark.parametrize("value", ["gateway.internal", "10.0.0", "300.1.1.1", "10.0.0.5/24"])
    async def test_source_address_is_not_an_ip_address(self, value: str, on_error: str) -> None:
        params = shaped(BASE, source_address=value, on_error=on_error)

        await refuses("Parameter 'source_address' must be an IP address", params)

    @pytest.mark.parametrize("value", ["10.0.0.5", "fe80::1", "  10.0.0.5  "])
    async def test_source_address_literal_passes(self, value: str) -> None:
        await PingPlugin().validate(shaped(BASE, source_address=value))

    @ON_ERROR
    @pytest.mark.parametrize("name", ["dont_fragment", "stream_output"])
    @pytest.mark.parametrize("value", ["yes", 1, 0])
    async def test_switch_not_a_boolean(self, name: str, value: Any, on_error: str) -> None:
        params = shaped(BASE, on_error=on_error, **{name: value})

        await refuses(f"Parameter '{name}' must be a boolean", params)


class TestChoices:
    """Every select holds one of its wire values; the message lists them in order."""

    @ON_ERROR
    @pytest.mark.parametrize(
        ("name", "values", "value"),
        [
            pytest.param(
                "pass_when", ["any", "all", "min_replies", "min_rate"], "some", id="pass_when"
            ),
            pytest.param("ip_version", ["auto", "v4", "v6"], "v5", id="ip_version"),
        ],
    )
    async def test_value_outside_its_choices(
        self, name: str, values: list[str], value: str, on_error: str
    ) -> None:
        params = shaped(BASE, on_error=on_error, **{name: value})

        await refuses(enum_message(name, values, value), params)

    async def test_on_error_outside_its_choices(self) -> None:
        params = shaped(BASE, on_error="ignore")

        await refuses(enum_message("on_error", ["fail", "record"], "ignore"), params)


class TestSettingsInEffect:
    """A row the Pass when rule does not use, or that is unset, is not validated (PING-3)."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(shaped(BASE, min_replies="abc"), id="min-replies-under-any"),
            pytest.param(shaped(BASE, pass_when="all", min_replies=0), id="min-replies-under-all"),
            pytest.param(shaped(BY_RATE, min_replies=9999), id="min-replies-under-rate"),
            pytest.param(shaped(BASE, min_rate="abc"), id="min-rate-under-any"),
            pytest.param(shaped(BASE, pass_when="all", min_rate=-5), id="min-rate-under-all"),
            pytest.param(shaped(BY_REPLIES, min_rate=250), id="min-rate-under-replies"),
            pytest.param(shaped(BASE, min_replies=ABSENT), id="min-replies-absent-under-any"),
            pytest.param(shaped(BASE, ttl=None), id="ttl-none"),
            pytest.param(shaped(BASE, source_address=None), id="source-address-none"),
            pytest.param(shaped(BASE, source_address=""), id="source-address-empty"),
            pytest.param(shaped(BASE, source_address="   "), id="source-address-spaces"),
        ],
    )
    async def test_row_not_in_effect_passes(self, params: dict[str, Any]) -> None:
        await PingPlugin().validate(params)


class TestValidConfigurations:
    """Complete configurations pass; absent or None settings take their defaults."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(dict(BASE), id="minimal"),
            pytest.param(dict(FULL), id="full"),
            pytest.param(shaped(BASE, host="  router.internal  "), id="host-with-spaces"),
            pytest.param(dict(BY_RATE), id="rate-rule"),
            pytest.param(
                shaped(
                    BASE,
                    count=None,
                    interval=None,
                    packet_size=None,
                    timeout=None,
                    pass_when=None,
                    min_replies=None,
                    min_rate=None,
                    stream_output=None,
                    ip_version=None,
                    ttl=None,
                    dont_fragment=None,
                    source_address=None,
                    on_error=None,
                ),
                id="every-optional-row-none",
            ),
        ],
    )
    async def test_configuration_passes(self, params: dict[str, Any]) -> None:
        await PingPlugin().validate(params)
