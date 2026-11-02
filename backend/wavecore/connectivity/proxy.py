"""The proxy core every raw-socket transport dials through (REQ-4.7.14, REQ-3.5.3.6)."""

import errno
import ipaddress
import os
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote

from wavecore.connectivity import run_log
from wavecore.connectivity.web_address import basic_authorization, bracketed


class ProxyError(OSError):
    """The one type every proxy failure is raised as."""


@dataclass(frozen=True)
class ProxyEndpoint:
    """One proxy address with its login; the host carries no brackets."""

    host: str
    port: int
    username: str | None
    password: str | None

    @property
    def display(self) -> str:
        """The address as a log line or a failure names it, never with the login."""
        return f"{bracketed(self.host)}:{self.port}"


@dataclass(frozen=True)
class ProxySpec:
    """The effective proxy: one endpoint per protocol and the WAVE host's route decision."""

    https: ProxyEndpoint | None
    http: ProxyEndpoint | None
    through_proxy: Callable[[str, str, int], bool]


@dataclass(frozen=True)
class HelmProxy:
    """Helm's proxy settings for one run, and the chart host helm cannot send through the proxy."""

    env: dict[str, str]
    cluster_proxy_url: str | None
    used: ProxyEndpoint | None
    local_chart_host: str | None = None
    direct_cluster_chart_host: str | None = None


_resolver: Callable[[], ProxySpec | None] | None = None


def set_resolver(resolver: Callable[[], ProxySpec | None] | None) -> None:
    """Register the reader of the effective proxy; None clears it."""
    global _resolver
    _resolver = resolver


def active_proxy() -> ProxySpec | None:
    """The proxy in force now; None where no resolver is registered, as on a remote host."""
    resolver = _resolver
    return None if resolver is None else resolver()


def route_for(scheme: str, host: str, port: int, spec: ProxySpec | None) -> ProxyEndpoint | None:
    """The proxy a target goes through; None for a direct connection."""
    if spec is None or not spec.through_proxy(scheme, host, port):
        return None
    return spec.https if scheme == "https" else spec.http


def connect(host: str, port: int, timeout: float, scheme: str = "https") -> socket.socket:
    """Dial a target: directly, or through a CONNECT tunnel on the proxy its route names."""
    endpoint = route_for(scheme, host, port, active_proxy())
    if endpoint is None:
        return socket.create_connection((host, port), timeout)
    target = f"{bracketed(host.encode('idna').decode('ascii'))}:{port}"
    try:
        sock, answer = _ask_for_tunnel(endpoint, target, timeout)
    except OSError as error:
        raise ProxyError(f"Proxy {endpoint.display} cannot be reached: {error}") from error
    if not answer.startswith("2"):
        sock.close()
        raise ProxyError(f"Proxy {endpoint.display} refused the connection to {target}: {answer}")
    run_log.log_once("DEBUG", f"Using the proxy {endpoint.display}")
    return sock


def _ask_for_tunnel(
    endpoint: ProxyEndpoint, target: str, timeout: float
) -> tuple[socket.socket, str]:
    """Dial the proxy and send CONNECT; return the socket with the proxy's status and reason."""
    lines = [f"CONNECT {target} HTTP/1.1", f"Host: {target}"]
    if endpoint.username:
        login = basic_authorization(endpoint.username, endpoint.password)
        lines.append(f"Proxy-Authorization: {login}")
    sock = socket.create_connection((endpoint.host, endpoint.port), timeout)
    try:
        sock.sendall("\r\n".join([*lines, "", ""]).encode("ascii"))
        # Unbuffered: a byte read past the answer would be lost to the tunnel.
        with sock.makefile("rb", buffering=0) as reader:
            status = reader.readline()
            for line in reader:
                if not line.strip():
                    break
        answer = status.decode("latin-1").strip().partition(" ")[2]
        if not answer:
            raise ConnectionResetError(errno.ECONNRESET, os.strerror(errno.ECONNRESET))
    except OSError:
        sock.close()
        raise
    return sock, answer


def helm_route(
    spec: ProxySpec | None,
    cluster: tuple[str, str, int],
    chart_source: tuple[str, str, int] | None,
) -> HelmProxy:
    """What helm is told for its cluster and its chart source; nothing with no proxy in force."""
    if spec is None:
        return HelmProxy({}, None, None)
    cluster_endpoint = route_for(*cluster, spec)
    cluster_url = None if cluster_endpoint is None else _proxy_url(cluster_endpoint)
    chart_endpoint = None if chart_source is None else route_for(*chart_source, spec)
    if chart_source is None or chart_endpoint is None:
        return HelmProxy({}, cluster_url, cluster_endpoint)
    chart_host = chart_source[1]
    if _is_local(chart_host):
        return HelmProxy({}, cluster_url, cluster_endpoint, local_chart_host=chart_host)
    named = (("HTTPS_PROXY", spec.https), ("HTTP_PROXY", spec.http))
    env = {name: _proxy_url(endpoint) for name, endpoint in named if endpoint is not None}
    if cluster_endpoint is not None:
        return HelmProxy(env, cluster_url, cluster_endpoint)
    if chart_source[2] == cluster[2] and _covers(cluster[1], chart_host):
        return HelmProxy({}, cluster_url, cluster_endpoint, direct_cluster_chart_host=chart_host)
    # The port is always written: helm never matches a bracketed IPv6 entry without one.
    env["NO_PROXY"] = f"{bracketed(cluster[1])}:{cluster[2]}"
    return HelmProxy(env, cluster_url, chart_endpoint)


def _proxy_url(endpoint: ProxyEndpoint) -> str:
    """The proxy address helm reads, the login percent-encoded."""
    login = ""
    if endpoint.username:
        password = quote(endpoint.password or "", safe="")
        login = f"{quote(endpoint.username, safe='')}:{password}@"
    return f"http://{login}{endpoint.display}"


def _ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def _is_local(host: str) -> bool:
    """Whether helm never proxies the host itself: localhost or a loopback address."""
    address = _ip(host)
    return host == "localhost" if address is None else address.is_loopback


def _covers(cluster_host: str, host: str) -> bool:
    """Whether helm's NO_PROXY entry for the cluster's host also takes this host off the proxy."""
    address = _ip(cluster_host)
    if address is not None:
        return _ip(host) == address
    name, parent = host.lower(), cluster_host.lower()
    return name == parent or name.endswith(f".{parent}")
