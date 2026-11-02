"""Netcat Plugin: checks ports and talks to them the way nc does (REQ-3.4.1.9, REQ-3.3.4.3)."""

from functools import partial
from typing import Any

from wavecore.core.number_rule import is_integer_value
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins import _netcat_core
from wavecore.plugins._file_paths import resolve_plugin_path
from wavecore.plugins._netcat_core import (
    Dial,
    Log,
    NetcatFailure,
    PreDial,
    parse_ports,
    unreadable_payload,
)
from wavecore.plugins._ports import check_port
from wavecore.plugins._shared_params import (
    check_boolean,
    chosen,
    gate,
    on_error_parameter,
    output_core,
    require_positive,
    select_parameter,
    timeout_parameter,
)
from wavecore.plugins._shared_params import setting as _setting
from wavecore.plugins._ssh_session import open_tunnel_stream, resolve_tunnel
from wavecore.plugins._verb_bridge import log_via
from wavecore.plugins.base import PluginBase

# Each select's wire values in order, then its default.
_CHOICES: dict[str, tuple[list[str], str]] = {
    "ports": (["single", "range"], "single"),
    "pass_when": (["one", "all"], "one"),
    "protocol": (["tcp", "udp"], "tcp"),
    "mode": (["check", "talk"], "check"),
    "send": (["nothing", "text", "file"], "text"),
    "on_error": (["fail", "record"], "fail"),
}
_DEFAULT_TIMEOUT = 10
_DEFAULT_MAX_REPLY_BYTES = 16777216
_LOOPBACK = ("127.0.0.1", "localhost")
_REASONS = (
    "Why the block failed: Unresolved, StartFailed, Tunnel, Closed, Timeout, NoneSucceeded "
    "or NotAllSucceeded; empty otherwise"
)


_select = partial(select_parameter, _CHOICES)
_choice = partial(chosen, _CHOICES)


def _check_single_port(port: Any) -> None:
    if port is None or (isinstance(port, str) and not port.strip()):
        raise ValueError("Missing required parameter: port")
    check_port("port", port, 1)


def _check_port_range(port_range: Any) -> None:
    if port_range is None or not str(port_range).strip():
        raise ValueError("Missing required parameter: port_range")
    parse_ports(str(port_range))


def _check_send(params: dict[str, Any], protocol: str) -> None:
    send = _choice(params, "send")
    if send == "nothing" and protocol == "udp":
        raise ValueError("Parameter 'send' cannot be 'nothing' when protocol is 'udp'")
    if send == "file" and not str(params.get("file") or "").strip():
        raise ValueError("Missing required parameter: file")


def _check_positive_integer(params: dict[str, Any], name: str) -> None:
    value = params.get(name)
    if value is not None and not is_integer_value(value):
        raise ValueError(f"Parameter '{name}' must be an integer")
    require_positive(params, name)


def read_wave_payload(
    path: str, artifacts_dir: str | None, testdata_dirs: list[str] | None
) -> bytes:
    """A File payload read on WAVE; a failure names the value as written (NETCAT-19)."""
    try:
        resolved = resolve_plugin_path(path, artifacts_dir, testdata_dirs, read_only_ok=True)
    except (ValueError, FileNotFoundError) as exc:
        raise NetcatFailure(f"Payload file not found: {path}", "StartFailed") from exc
    except OSError as exc:
        raise unreadable_payload(exc) from exc
    return _netcat_core.read_payload_file(str(resolved), path)


def _tunnel_routes(
    registry: SSHSessionRegistry, host: str, protocol: str, ports: list[int], log: Log
) -> dict[int, Dial]:
    """Each port that is an open tunnel's Local Port, routed through that tunnel's connection."""
    routes: dict[int, Dial] = {}
    for port in ports:
        route = resolve_tunnel(host, port, registry)
        if route is None:
            continue
        if protocol == "udp":
            raise NetcatFailure(
                f"SSH tunnel detected on local port {port}: SSH tunnels carry TCP only, "
                "so UDP cannot go through one",
                "Tunnel",
            )
        log(
            "INFO",
            f"SSH tunnel detected on local port {port}: testing {route.far_host}:{route.far_port} "
            f"from {route.record['host']}",
        )
        routes[port] = partial(
            open_tunnel_stream, route.record, route.far_host, route.far_port, tunnel=route.tunnel
        )
    return routes


def _tunnel_check(params: dict[str, Any], registry: Any) -> PreDial | None:
    """The pre-dial tunnel lookup, only for a loopback Host in a run with SSH sessions."""
    host = str(params["host"])
    if registry is None or host.strip() not in _LOOPBACK:
        return None
    protocol = _setting(params, "protocol", "tcp")
    return partial(_tunnel_routes, registry, host, protocol)


class NetcatPlugin(PluginBase):
    """Checks ports and talks to them over TCP or UDP, the way nc does."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        success, error, reason = output_core(
            gated=True,
            success_description="True when the pass rule is met.",
            reason_description=_REASONS,
        )
        talk = gate("mode", "talk")
        return {
            "id": "netcat",
            "name": "Netcat",
            "version": "1.0.0",
            "category": "network",
            "remotable": True,
            "description": (
                "Checks whether ports on a host accept a connection, or connects to a port, "
                "sends a payload and captures the reply, over TCP or UDP the way nc does."
            ),
            "tags": ["netcat", "nc", "network", "port", "tcp", "udp"],
            "parameters": [
                {
                    "name": "host",
                    "type": "string",
                    "required": True,
                    "trim": True,
                    "description": (
                        "The host to reach, by name or IP address. 127.0.0.1 or localhost on "
                        "the Local Port of one of this run's open SSH tunnels tests the "
                        "tunnel's far port instead."
                    ),
                },
                _select("ports", "Single checks one Port; Range checks every port of Port range."),
                {
                    "name": "port",
                    "type": "integer",
                    "required_when": gate("ports", "single"),
                    "show_when": gate("ports", "single"),
                    "description": "The port to reach, from 1 to 65535.",
                },
                {
                    "name": "port_range",
                    "type": "string",
                    "required_when": gate("ports", "range"),
                    "show_when": gate("ports", "range"),
                    "trim": True,
                    "description": (
                        "Ports and ranges separated by commas, for example 22, 80, 8000-8010. "
                        "Ranges expand in ascending order, entries keep their written order "
                        "and a port named twice is checked once."
                    ),
                },
                _select(
                    "pass_when",
                    "One succeeds passes when any port succeeds, as nc does; All succeed "
                    "passes only when every port does. Open and open or filtered succeed.",
                    show_when=gate("ports", "range"),
                ),
                _select(
                    "protocol",
                    "TCP, or UDP, where a port is open only when it replies and closed only "
                    "when it refuses.",
                ),
                _select(
                    "mode",
                    "Check tests whether each port accepts a connection, as nc -z does. Talk "
                    "connects, sends a payload and captures the reply.",
                ),
                _select(
                    "send",
                    "What Talk sends: Nothing reads what the server sends on connect, Text "
                    "sends the text below and File the bytes of a file. UDP needs Text or File.",
                    show_when=talk,
                ),
                {
                    "name": "text",
                    "type": "string",
                    "description": (
                        "The payload, sent as UTF-8. An empty Text sends nothing over TCP and "
                        "one empty datagram over UDP."
                    ),
                },
                {
                    "name": "file",
                    "type": "string",
                    "required_when_all": [talk, gate("send", "file")],
                    "trim": True,
                    "description": (
                        "The payload file: testdata://, artifact:// or an absolute or relative "
                        "path. A testdata:// or artifact:// file is read on WAVE and sent with "
                        "the request, so File works on a remote host too."
                    ),
                },
                timeout_parameter(
                    _DEFAULT_TIMEOUT,
                    "Seconds to wait for the host to resolve, for each connection attempt "
                    "and, in Talk, for the server to take each part of the payload and for "
                    "more of the reply.",
                ),
                {
                    "name": "crlf",
                    "type": "boolean",
                    "default": False,
                    "show_when": talk,
                    "description": "Sends each line ending of the payload as CR LF, as nc -C does.",
                },
                {
                    "name": "close_after_send",
                    "type": "boolean",
                    "default": False,
                    "description": (
                        "Shuts down the sending side once the payload is sent, as nc -N does, so "
                        "a server that waits for the end of its input answers at once. TCP only."
                    ),
                },
                {
                    "name": "max_reply_bytes",
                    "type": "integer",
                    "default": _DEFAULT_MAX_REPLY_BYTES,
                    "minimum": 1,
                    "show_when": talk,
                    "description": (
                        "Reading stops once a port's reply reaches this many bytes, and a WARN "
                        "line says so."
                    ),
                },
                on_error_parameter(
                    "Fail the block on a run-time failure, or record it in Error and Reason "
                    "and continue with Results as measured."
                ),
            ],
            "return_type": "map",
            "output_schema": [
                success,
                {
                    "name": "results",
                    "type": "table",
                    "description": (
                        "One row per port in Port range order: port, protocol, state, reason "
                        "and time_ms, plus reply in Talk."
                    ),
                },
                {
                    "name": "reply",
                    "type": "string",
                    "description": (
                        "The reply as UTF-8 text, invalid bytes replaced (Single in Talk)."
                    ),
                },
                error,
                reason,
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Refuse a misconfigured block, checking only the settings in effect (NETCAT-14)."""
        if not str(_setting(params, "host", "")).strip():
            raise ValueError("Missing required parameter: host")
        if _choice(params, "ports") == "single":
            _check_single_port(params.get("port"))
        else:
            _check_port_range(params.get("port_range"))
            _choice(params, "pass_when")
        protocol = _choice(params, "protocol")
        talking = _choice(params, "mode") == "talk"
        if talking:
            _check_send(params, protocol)
        _check_positive_integer(params, "timeout")
        if talking:
            _check_positive_integer(params, "max_reply_bytes")
            check_boolean(params, "crlf")
            if protocol == "tcp":
                check_boolean(params, "close_after_send")
        _choice(params, "on_error")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the block on WAVE: payload read here, tunnels checked before any dial."""
        params = context["parameters"]
        core_params, payload = params, None
        talking = _setting(params, "mode", "check") == "talk"
        if talking and _setting(params, "send", "text") == "file":
            try:
                payload = read_wave_payload(
                    str(params["file"]).strip(),
                    context.get("artifacts_dir"),
                    context.get("testdata_dirs"),
                )
            except NetcatFailure as exc:
                core_params = {**params, "payload_error": str(exc)}
        envelope = await _netcat_core.run(
            core_params,
            log_via(context["logger"]),
            payload=payload,
            pre_dial=_tunnel_check(params, context.get("ssh_session_registry")),
        )
        outputs: dict[str, Any] = materialize(envelope, context.get("register_secret"))
        return outputs
