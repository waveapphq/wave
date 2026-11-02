"""The address rules of Settings > Network > Proxy and its route decision (REQ-4.7.14)."""

import ipaddress
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import unquote

import regex

from wavecore.api.config.instance_settings import PROXY_ENTRY_KINDS, PROXY_LIST_MODES
from wavecore.connectivity.proxy import ProxyEndpoint, ProxyError
from wavecore.connectivity.url_credentials import mask_url_passwords
from wavecore.connectivity.web_address import WebAddress, WebAddressError, parse_web_address

PATTERN_MATCH_LIMIT_S = 0.1
ONLY_LISTED = PROXY_LIST_MODES[1]

_EXACT, _REGEX = PROXY_ENTRY_KINDS
_ENTRY_LIMIT = 100
_ADDRESS_LIMIT = 256
_HTTP = "http"

_NOT_A_LIST = "The address list must be a list of entries with a kind and an address"
_TOO_MANY = f"The address list holds at most {_ENTRY_LIMIT} entries"
_EXACT_FORM = "An exact address is http:// or https://, a host and an optional port"

_IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
_IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
_RouteRule = Callable[[str, str, int], bool]


def _ip(text: str) -> _IpAddress | None:
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def _is_blank(text: str) -> bool:
    return not text.strip()


def _is_host_name(text: str) -> bool:
    """Whether the text is labels of letters, digits, hyphens and underscores between dots."""
    return all(
        label and all(char.isalnum() or char in "-_" for char in label) for label in text.split(".")
    )


def is_host(text: str) -> bool:
    """Whether the text is an IP address, an IPv6 address in brackets or a host name."""
    if text.startswith("[") and text.endswith("]"):
        return isinstance(_ip(text[1:-1]), ipaddress.IPv6Address)
    return _ip(text) is not None or _is_host_name(text)


def is_local(host: str) -> bool:
    """Whether the host is localhost or a loopback address (127.0.0.0/8, ::1)."""
    address = _ip(host)
    return host.lower() == "localhost" if address is None else address.is_loopback


def _normal_form(scheme: str, host: str, port: int) -> str:
    """Protocol, host in lower case with an IPv6 host compressed, and a port that is no default."""
    address = _ip(host)
    normal_host = host.lower() if address is None else address.compressed
    return WebAddress(scheme, normal_host, port, None, None, "", "", "").origin


def normalize_entry(kind: str, address: str) -> str:
    """One valid entry as it is stored: an Exact address in its normal form, a Regex as typed."""
    if kind != _EXACT:
        return address
    parsed = parse_web_address(address)
    return _normal_form(parsed.scheme, parsed.host, parsed.effective_port)


def _compiled(text: str) -> regex.Pattern[str]:
    return regex.compile(text, regex.IGNORECASE)


def _exact_problem(address: str) -> str | None:
    try:
        parsed = parse_web_address(address)
    except WebAddressError:
        return _EXACT_FORM
    # The parser reads an empty query or fragment as none, so the marks are looked for.
    extra = parsed.username is not None or "?" in address or "#" in address
    if extra or not is_host(parsed.host):
        return _EXACT_FORM
    return "Remove everything after the host and port" if parsed.path else None


def _regex_problem(address: str) -> str | None:
    try:
        _compiled(address)
    except regex.error as error:
        return f"Not a valid regular expression: {error}"
    return None


def _entry_problem(kind: str, address: str) -> str | None:
    """The first rule one entry breaks on its own, in rule order."""
    if kind not in PROXY_ENTRY_KINDS:
        return "Choose Exact or Regex"
    if _is_blank(address):
        return "An address is required"
    if len(address) > _ADDRESS_LIMIT:
        return f"An address must be {_ADDRESS_LIMIT} characters or fewer"
    return _exact_problem(address) if kind == _EXACT else _regex_problem(address)


def is_entry_list(entries: Any) -> bool:
    """Whether the value is a list of entries that each hold a kind and an address as text."""
    return isinstance(entries, list) and all(
        isinstance(entry, Mapping)
        and isinstance(entry.get("kind"), str)
        and isinstance(entry.get("address"), str)
        for entry in entries
    )


def validate_entries(entries: Any) -> list[dict[str, Any]]:
    """One problem per bad row, or the one problem of the whole list; none when all is valid."""
    if not is_entry_list(entries):
        return [{"row": None, "message": _NOT_A_LIST}]
    if len(entries) > _ENTRY_LIMIT:
        return [{"row": None, "message": _TOO_MANY}]
    problems: list[dict[str, Any]] = []
    first_rows: dict[tuple[str, str], int] = {}
    for row, entry in enumerate(entries, start=1):
        kind, address = entry["kind"], entry["address"]
        message = _entry_problem(kind, address)
        if message is None:
            first_row = first_rows.setdefault((kind, normalize_entry(kind, address)), row)
            if first_row != row:
                message = f"The same address as entry {first_row}"
        if message is not None:
            problems.append({"row": row, "message": message})
    return problems


def _search(pattern: regex.Pattern[str], address: str, limit: float) -> bool | None:
    """Whether the pattern is found in the address; None when the engine ran out of time."""
    try:
        return pattern.search(address, timeout=limit, concurrent=False) is not None
    except TimeoutError:
        return None


def _found(pattern: regex.Pattern[str], address: str) -> bool:
    """Whether the pattern is found in the address, within the time limit of one match."""
    limit = PATTERN_MATCH_LIMIT_S
    started = time.monotonic()
    found = _search(pattern, address, limit)
    if found is None and time.monotonic() - started < limit / 2:
        # The engine counts every thread's CPU time, so a busy process can time out at once.
        found = _search(pattern, address, limit)
    if found is None:
        raise ProxyError(
            f"Proxy address list: the pattern {pattern.pattern} took too long to match {address}"
        )
    return found


def list_rule(mode: str, entries: Sequence[Mapping[str, str]], proxy_local: bool) -> _RouteRule:
    """The Custom decision: True sends an address through the proxy."""
    exact = {
        normalize_entry(_EXACT, entry["address"]) for entry in entries if entry["kind"] == _EXACT
    }
    patterns = [_compiled(entry["address"]) for entry in entries if entry["kind"] == _REGEX]

    def through_proxy(scheme: str, host: str, port: int) -> bool:
        if is_local(host) and not proxy_local:
            return False
        address = _normal_form(scheme, host, port)
        listed = address in exact or any(_found(pattern, address) for pattern in patterns)
        return listed == (mode == ONLY_LISTED)

    return through_proxy


def _without_port(item: str) -> str:
    host, colon, port = item.rpartition(":")
    return (host if colon and port.isdigit() else item).strip("[]")


def _no_proxy_item(item: str) -> _IpNetwork | str:
    """One NO_PROXY item as an address range, else as a host name without its dot and port."""
    text = item.strip().lower()
    for candidate in (text, _without_port(text)):
        try:
            return ipaddress.ip_network(candidate, strict=False)
        except ValueError:
            continue
    return _without_port(text).lstrip(".")


def no_proxy_rule(no_proxy: str) -> _RouteRule:
    """The WAVE host's NO_PROXY decision: True sends an address through the proxy."""
    items = [_no_proxy_item(item) for item in no_proxy.split(",") if not _is_blank(item)]
    everything = items == ["*"]
    names = [item for item in items if isinstance(item, str)]
    networks = [item for item in items if not isinstance(item, str)]

    def through_proxy(scheme: str, host: str, port: int) -> bool:
        if everything or is_local(host):
            return False
        address = _ip(host)
        if address is not None:
            return not any(address in network for network in networks)
        name = host.lower()
        return not any(name == listed or name.endswith(f".{listed}") for listed in names)

    return through_proxy


def _with_protocol(text: str) -> str:
    return text if "://" in text else f"{_HTTP}://{text}"


def masked_host_proxy(text: str) -> str:
    """One WAVE host proxy value as it is written, a password inside it masked."""
    masked = mask_url_passwords(_with_protocol(text))
    return masked if "://" in text else masked.removeprefix(f"{_HTTP}://")


def _unusable(text: str) -> ValueError:
    return ValueError(
        f"This WAVE host's proxy address {masked_host_proxy(text)} is not an http:// address: "
        "choose Custom or turn the proxy off"
    )


def _login_part(part: str | None) -> str | None:
    return unquote(part) if part else None


def parse_host_proxy(text: str) -> ProxyEndpoint:
    """One WAVE host proxy value as a plain http proxy; ValueError when WAVE cannot use it."""
    try:
        parsed = parse_web_address(_with_protocol(text))
    except WebAddressError:
        raise _unusable(text) from None
    if parsed.scheme != _HTTP:
        raise _unusable(text)
    return ProxyEndpoint(
        parsed.host,
        parsed.effective_port,
        _login_part(parsed.username),
        _login_part(parsed.password),
    )
