"""Ping Plugin: sends ICMP echo requests the way ping does (REQ-3.4.1.9, REQ-3.3.4.4)."""

import ipaddress
from functools import partial
from typing import Any

from wavecore.core.number_rule import is_integer_value, is_number_value
from wavecore.core.remote_exec.materialize import materialize
from wavecore.plugins import _ping_core
from wavecore.plugins._shared_params import (
    check_boolean,
    chosen,
    on_error_parameter,
    output_core,
    require_positive,
    select_parameter,
    stream_output_parameter,
    timeout_parameter,
)
from wavecore.plugins._shared_params import setting as _setting
from wavecore.plugins._verb_bridge import log_via
from wavecore.plugins.base import PluginBase

# Each select's wire values in order, then its default.
_CHOICES: dict[str, tuple[list[str], str]] = {
    "pass_when": (["any", "all", "min_replies", "min_rate"], "any"),
    "ip_version": (["auto", "v4", "v6"], "auto"),
    "on_error": (["fail", "record"], "fail"),
}
_DEFAULT_COUNT = 4
_MAX_COUNT = 1000
_MIN_INTERVAL = 0.2
_MAX_PACKET_SIZE = 65507
_MAX_TTL = 255
_BY_REPLIES: dict[str, Any] = {"field": "pass_when", "values": ["min_replies"]}
_BY_RATE: dict[str, Any] = {"field": "pass_when", "values": ["min_rate"]}
_REASONS = (
    "Why the block failed: Unprivileged, Unresolved, Source, TooLarge, Timeout, NoReply, "
    "NotAllReplied, TooFewReplies or RateTooLow; empty otherwise"
)


_select = partial(select_parameter, _CHOICES)


def _choice(params: dict[str, Any], name: str) -> str:
    return str(chosen(_CHOICES, params, name))


def _check_present(params: dict[str, Any], name: str) -> None:
    value = params.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"Missing required parameter: {name}")


def _whole_number(params: dict[str, Any], name: str) -> int | None:
    """A set row's whole number; anything else, a boolean included, is refused."""
    value = params.get(name)
    if value is None:
        return None
    if not is_integer_value(value):
        raise ValueError(f"Parameter '{name}' must be an integer")
    return int(value)


def _number(params: dict[str, Any], name: str) -> float | None:
    """A set row's number; anything else, a boolean included, is refused."""
    value = params.get(name)
    if value is None:
        return None
    if not is_number_value(value):
        raise ValueError(f"Parameter '{name}' must be a number")
    return float(value)


def _between(name: str, value: float | None, low: float, high: float) -> None:
    if value is not None and not low <= value <= high:
        raise ValueError(f"Parameter '{name}' must be between {low} and {high}")


def _at_least(name: str, value: float | None, low: float) -> None:
    if value is not None and value < low:
        raise ValueError(f"Parameter '{name}' must be at least {low}")


def _check_source_address(params: dict[str, Any]) -> None:
    written = str(_setting(params, "source_address", "")).strip()
    if not written:
        return
    try:
        ipaddress.ip_address(written)
    except ValueError as exc:
        raise ValueError("Parameter 'source_address' must be an IP address") from exc


class PingPlugin(PluginBase):
    """Sends ICMP echo requests to one host and reports what came back."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        success, error, reason = output_core(
            gated=True,
            success_description="True when the replies met the Pass when rule.",
            reason_description=_REASONS,
        )
        return {
            "id": "ping",
            "name": "Ping",
            "version": "1.0.0",
            "category": "network",
            "remotable": True,
            "description": (
                "Sends ICMP echo requests to one host and reports what came back, "
                "the way ping does."
            ),
            "tags": ["ping", "icmp", "network", "reachability", "latency"],
            "parameters": [
                {
                    "name": "host",
                    "type": "string",
                    "required": True,
                    "trim": True,
                    "description": (
                        "The host to reach, by name or IP address. One host per block; a "
                        "host that does not resolve fails the block."
                    ),
                },
                {
                    "name": "count",
                    "type": "integer",
                    "default": _DEFAULT_COUNT,
                    "minimum": 1,
                    "maximum": _MAX_COUNT,
                    "description": (
                        f"How many echo requests to send, from 1 to {_MAX_COUNT}, as ping -c "
                        "does."
                    ),
                },
                {
                    "name": "interval",
                    "type": "float",
                    "default": 1,
                    "minimum": _MIN_INTERVAL,
                    "description": (
                        f"Seconds between requests, at least {_MIN_INTERVAL}, as ping -i does."
                    ),
                },
                {
                    "name": "packet_size",
                    "type": "integer",
                    "default": 56,
                    "minimum": 0,
                    "maximum": _MAX_PACKET_SIZE,
                    "description": (
                        f"Payload bytes in each request, from 0 to {_MAX_PACKET_SIZE}, as "
                        "ping -s does. The wire size adds 28 bytes over IPv4 and 48 over IPv6."
                    ),
                },
                timeout_parameter(
                    30,
                    "Seconds the whole block may take, resolving the host included. It is "
                    "the real bound on the run, whatever Count and Interval would take.",
                ),
                _select(
                    "pass_when",
                    "Any reply passes on one answer, which is ping's own rule. All replies "
                    "needs every request answered; the other two set a count or a rate.",
                ),
                {
                    "name": "min_replies",
                    "type": "integer",
                    "default": 1,
                    "minimum": 1,
                    "required_when": dict(_BY_REPLIES),
                    "show_when": dict(_BY_REPLIES),
                    "description": "How many requests must be answered for the block to pass.",
                },
                {
                    "name": "min_rate",
                    "type": "float",
                    "default": 100,
                    "minimum": 0,
                    "maximum": 100,
                    "required_when": dict(_BY_RATE),
                    "show_when": dict(_BY_RATE),
                    "description": (
                        "The percentage of requests that must be answered for the block to pass."
                    ),
                },
                stream_output_parameter(
                    "Write a line to the run console for each reply as it arrives, and a "
                    "warning for each request that went unanswered."
                ),
                _select(
                    "ip_version",
                    "Which address of the host to ping: Auto takes the first the resolver "
                    "returns, IPv4 and IPv6 force the family, as ping -4 and ping -6 do.",
                ),
                {
                    "name": "ttl",
                    "type": "integer",
                    "minimum": 1,
                    "maximum": _MAX_TTL,
                    "description": (
                        f"How many hops a request may take, from 1 to {_MAX_TTL}, as ping -t "
                        "does. Empty leaves the system default."
                    ),
                },
                {
                    "name": "dont_fragment",
                    "type": "boolean",
                    "default": False,
                    "description": (
                        "Forbid fragmenting the request, as ping -M do does, so a packet too "
                        "large for the path fails the block and reports the path size."
                    ),
                },
                {
                    "name": "source_address",
                    "type": "string",
                    "trim": True,
                    "description": (
                        "The local IP address requests leave from, as ping -I does. It takes "
                        "an address, never an interface name."
                    ),
                },
                on_error_parameter(
                    "Fail the block on a run-time failure, or record it in Error and Reason "
                    "and continue with Summary and Replies as measured."
                ),
            ],
            "return_type": "map",
            "output_schema": [
                success,
                {
                    "name": "summary",
                    "type": "table",
                    "description": (
                        "One row: sent, received, loss_percent and the round-trip "
                        "rtt_min_ms, rtt_avg_ms, rtt_max_ms and rtt_mdev_ms."
                    ),
                },
                {
                    "name": "replies",
                    "type": "table",
                    "description": (
                        "One row per request: seq, source, bytes, ttl, time_ms and status."
                    ),
                },
                error,
                reason,
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Refuse a misconfigured block: what is missing, then what is the wrong kind of
        value, then what is out of range - checking only the settings in effect (PING-3)."""
        if not str(_setting(params, "host", "")).strip():
            raise ValueError("Missing required parameter: host")
        rule = _choice(params, "pass_when")
        by_replies, by_rate = rule == "min_replies", rule == "min_rate"
        if by_replies:
            _check_present(params, "min_replies")
        if by_rate:
            _check_present(params, "min_rate")
        count = _whole_number(params, "count")
        interval = _number(params, "interval")
        packet_size = _whole_number(params, "packet_size")
        _whole_number(params, "timeout")
        min_replies = _whole_number(params, "min_replies") if by_replies else None
        min_rate = _number(params, "min_rate") if by_rate else None
        check_boolean(params, "stream_output")
        _choice(params, "ip_version")
        ttl = _whole_number(params, "ttl")
        check_boolean(params, "dont_fragment")
        _check_source_address(params)
        _choice(params, "on_error")
        _between("count", count, 1, _MAX_COUNT)
        _at_least("interval", interval, _MIN_INTERVAL)
        _between("packet_size", packet_size, 0, _MAX_PACKET_SIZE)
        require_positive(params, "timeout")
        _between("min_replies", min_replies, 1, _DEFAULT_COUNT if count is None else count)
        _between("min_rate", min_rate, 0, 100)
        _between("ttl", ttl, 1, _MAX_TTL)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the block on WAVE: the core opens the socket and paces its own sends."""
        envelope = await _ping_core.run(context["parameters"], log_via(context["logger"]))
        outputs: dict[str, Any] = materialize(envelope, context.get("register_secret"))
        return outputs
