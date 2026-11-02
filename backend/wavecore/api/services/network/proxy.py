"""Settings > Network > Proxy: the setting, its rules and the proxy in force (REQ-4.7.14)."""

import copy
import os
from collections.abc import Callable, Iterator, Mapping
from typing import Any, NamedTuple

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import (
    PROXY_LIST_MODES,
    PROXY_PORT_MAX,
    PROXY_PORT_MIN,
    PROXY_SOURCES,
    SECTION_DEFAULTS,
    whole_number_fault,
)
from wavecore.api.exceptions import ValidationException
from wavecore.api.services.network import _proxy_addresses
from wavecore.connectivity import run_log
from wavecore.connectivity.proxy import ProxyEndpoint, ProxyError, ProxySpec, set_resolver
from wavecore.connectivity.url_credentials import mask_url_passwords
from wavecore.core import plugin_registry
from wavecore.core.secrets.cipher import SecretDecryptionError
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.sealing import seal_value
from wavecore.plugins.base import PROXY_SUPPORT_VALUES, declared_proxy_support

_SECTION = "network.proxy"
_HOST_SOURCE, _CUSTOM_SOURCE = PROXY_SOURCES
_PROXY_VARIABLES = {"https": "https_proxy", "http": "http_proxy"}
_NO_PROXY = "no_proxy"
_NULL_MEANS_OMITTED = ("username", "password")
_DEFAULTS: Mapping[str, Any] = SECTION_DEFAULTS["network"]["proxy"]
# What the page shows under Custom only.
_CUSTOM_SETTINGS = tuple(key for key in _DEFAULTS if key not in ("enabled", "source"))
_HOST_LIMIT = 253
_LOGIN_LIMIT = 255

_PORT_RANGE = f"Port must be a whole number from {PROXY_PORT_MIN} to {PROXY_PORT_MAX}"
_LOCAL_SWITCH = "Use the proxy for local addresses too must be true or false"
_HOST_FORM = "IP or Hostname must be an IP address or a host name, with no protocol and no port"
_ONLY_NEEDS_AN_ENTRY = 'Add at least one address, or choose "All addresses except the list"'
_NO_HOST_VARIABLE = (
    "This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off"
)
_DIRECT_WARNING = (
    "The proxy is on with WAVE host's settings, "
    "but this WAVE host sets no HTTPS_PROXY or HTTP_PROXY: connecting directly"
)

# A broken rule: the field it is about, the list row when it is about one, and its message.
_Failure = tuple[str, int | None, str]


class _HostProxy(NamedTuple):
    """The WAVE host's proxy for one protocol: its endpoint, or why WAVE cannot use its value."""

    endpoint: ProxyEndpoint | None = None
    refusal: str | None = None


_NOT_SET = _HostProxy()


def _host_variable(name: str) -> str | None:
    """One WAVE host variable, read now: its uppercase spelling, else its lowercase one."""
    return os.environ.get(name.upper()) or os.environ.get(name) or None


def _host_proxy(variable: str) -> _HostProxy:
    value = _host_variable(variable)
    if value is None:
        return _NOT_SET
    try:
        return _HostProxy(_proxy_addresses.parse_host_proxy(value))
    except ValueError as error:
        return _HostProxy(refusal=str(error))


def _host_proxies() -> dict[str, _HostProxy]:
    """What the WAVE host's HTTPS_PROXY and HTTP_PROXY hold now, by the protocol each serves."""
    return {protocol: _host_proxy(variable) for protocol, variable in _PROXY_VARIABLES.items()}


def _shown(variable: str, mask: Callable[[str], str]) -> str | None:
    value = _host_variable(variable)
    return None if value is None else mask(value)


def host_values() -> dict[str, str | None]:
    """The WAVE host's three proxy variables as the page shows them, passwords masked."""
    proxies = {
        variable: _shown(variable, _proxy_addresses.masked_host_proxy)
        for variable in _PROXY_VARIABLES.values()
    }
    return {**proxies, _NO_PROXY: _shown(_NO_PROXY, mask_url_passwords)}


def _hidden(values: Mapping[str, Any]) -> tuple[str, ...]:
    """The settings the page does not show for these values (NET-10)."""
    if values["enabled"] is False:
        return tuple(key for key in _DEFAULTS if key != "enabled")
    return _CUSTOM_SETTINGS if values["source"] == _HOST_SOURCE else ()


def _on_the_page(values: Mapping[str, Any]) -> dict[str, Any]:
    """The values as the page holds them: what it hides is at its default (REQ-4.7.16)."""
    return {**values, **{key: copy.deepcopy(_DEFAULTS[key]) for key in _hidden(values)}}


def get_settings() -> dict[str, Any]:
    """The Proxy settings the page shows; the password shows only as ``password_set``."""
    settings = _on_the_page(get_config().section(_SECTION))
    sealed = settings.pop("password")
    return {**settings, "password_set": sealed is not None, "host_values": host_values()}


def _merged(subset: Mapping[str, Any]) -> tuple[dict[str, Any], str | None]:
    """The values the page shows with the sent ones over them, and the password when one is
    sent. A setting the page hides for the result goes back to its default (REQ-4.7.16)."""
    stored = _on_the_page(get_config().section(_SECTION))
    sent = {
        key: value
        for key, value in subset.items()
        if key in stored and not (key in _NULL_MEANS_OMITTED and value is None)
    }
    new_password = sent.pop("password", None)
    values = _on_the_page({**stored, **sent})
    return values, None if "password" in _hidden(values) else new_password


def _type_failures(values: Mapping[str, Any]) -> Iterator[_Failure]:
    if not isinstance(values["enabled"], bool):
        yield "enabled", None, "Use a proxy must be true or false"
    if values["source"] not in PROXY_SOURCES:
        yield "source", None, "Source must be 'host' or 'custom'"
    if values["list_mode"] not in PROXY_LIST_MODES:
        yield "list_mode", None, "Use the proxy for must be 'except' or 'only'"
    if not isinstance(values["proxy_local_addresses"], bool):
        yield "proxy_local_addresses", None, _LOCAL_SWITCH
    if not isinstance(values["host"], str):
        yield "host", None, "IP or Hostname must be text"


def _host_failures(host: Any, custom: bool) -> Iterator[_Failure]:
    if not isinstance(host, str):
        return
    if not host:
        if custom:
            yield "host", None, "IP or Hostname is required when the source is Custom"
        return
    if len(host) > _HOST_LIMIT:
        yield "host", None, f"IP or Hostname must be {_HOST_LIMIT} characters or fewer"
    if not _proxy_addresses.is_host(host):
        yield "host", None, _HOST_FORM


def _port_failures(port: Any, custom: bool) -> Iterator[_Failure]:
    if port is None:
        if custom:
            yield "port", None, "Port is required when the source is Custom"
        return
    if whole_number_fault(port, PROXY_PORT_MIN, PROXY_PORT_MAX):
        yield "port", None, _PORT_RANGE


def _login_failures(username: str, new_password: str | None) -> Iterator[_Failure]:
    if len(username) > _LOGIN_LIMIT:
        yield "username", None, f"Username must be {_LOGIN_LIMIT} characters or fewer"
    if ":" in username:
        yield "username", None, "Username must not contain a colon"
    if new_password and len(new_password) > _LOGIN_LIMIT:
        yield "password", None, f"Password must be {_LOGIN_LIMIT} characters or fewer"
    if new_password and not username:
        yield "username", None, "Username is required when a proxy password is set"


def _host_source_failures() -> Iterator[_Failure]:
    proxies = _host_proxies().values()
    if all(proxy == _NOT_SET for proxy in proxies):
        yield "source", None, _NO_HOST_VARIABLE
    for proxy in proxies:
        if proxy.refusal is not None:
            yield "source", None, proxy.refusal


def _failures(values: Mapping[str, Any], new_password: str | None) -> Iterator[_Failure]:
    """Every rule the values break, in rule order."""
    on = values["enabled"] is True
    custom = on and values["source"] == _CUSTOM_SOURCE
    entries = values["entries"]
    shaped = _proxy_addresses.is_entry_list(entries)
    listed = [
        ("entries", problem["row"], problem["message"])
        for problem in _proxy_addresses.validate_entries(entries)
    ]
    yield from _type_failures(values)
    if not shaped:
        yield from listed
    yield from _host_failures(values["host"], custom)
    yield from _port_failures(values["port"], custom)
    yield from _login_failures(values["username"], new_password)
    if shaped:
        yield from listed
    only_listed = values["list_mode"] == _proxy_addresses.ONLY_LISTED
    if shaped and custom and only_listed and not entries:
        yield "entries", None, _ONLY_NEEDS_AN_ENTRY
    if on and values["source"] == _HOST_SOURCE:
        yield from _host_source_failures()


def _problems(values: Mapping[str, Any], new_password: str | None) -> list[dict[str, Any]]:
    """The first broken rule of each field and of each list row, in rule order."""
    first: dict[tuple[str, int | None], str] = {}
    for field, row, message in _failures(values, new_password):
        first.setdefault((field, row), message)
    return [
        {"field": field, "row": row, "message": message} for (field, row), message in first.items()
    ]


def _refusal(problem: Mapping[str, Any]) -> str:
    """A problem as a Save or a block run reports it: a list row is named in front."""
    if problem["row"] is None:
        return str(problem["message"])
    return f"Entry {problem['row']}: {problem['message']}"


def validate_settings(**subset: Any) -> list[dict[str, Any]]:
    """Every problem of a partial update over the stored settings; writes nothing."""
    return _problems(*_merged(subset))


def _normal_entry(entry: Mapping[str, str]) -> dict[str, str]:
    kind = entry["kind"]
    return {"kind": kind, "address": _proxy_addresses.normalize_entry(kind, entry["address"])}


def update_settings(**subset: Any) -> dict[str, Any]:
    """Check a partial update and save what differs; returns the settings in force."""
    values, new_password = _merged(subset)
    problems = _problems(values, new_password)
    if problems:
        raise ValidationException(_refusal(problems[0]))
    values["entries"] = [_normal_entry(entry) for entry in values["entries"]]
    if new_password is not None:
        values["password"] = seal_value(new_password or None)
    if not values["username"]:
        values["password"] = None
    get_config().save_changed(_SECTION, values)
    return get_settings()


def _custom_password(stored: Mapping[str, Any]) -> str | None:
    """The stored Custom password in plain text; ProxyError when it cannot be unsealed."""
    sealed = stored["password"]
    if sealed is None:
        return None
    try:
        return str(get_cipher().unseal(sealed))
    except SecretDecryptionError as error:
        raise ProxyError(str(error)) from error


def _custom_spec(stored: Mapping[str, Any]) -> ProxySpec:
    """The stored Custom proxy; ProxyError with the Save text when the Save rules refuse it."""
    problems = _problems(stored, None)
    if problems:
        raise ProxyError(_refusal(problems[0]))
    endpoint = ProxyEndpoint(
        stored["host"].strip("[]"),
        stored["port"],
        stored["username"] or None,
        _custom_password(stored),
    )
    through_proxy = _proxy_addresses.list_rule(
        stored["list_mode"], stored["entries"], stored["proxy_local_addresses"]
    )
    return ProxySpec(endpoint, endpoint, through_proxy)


def _host_spec() -> ProxySpec | None:
    """The WAVE host's own proxies, read now; a value WAVE cannot use fails only its requests."""
    proxies = _host_proxies()
    if all(proxy == _NOT_SET for proxy in proxies.values()):
        run_log.log_once("WARNING", _DIRECT_WARNING)
        return None
    proxied = _proxy_addresses.no_proxy_rule(_host_variable(_NO_PROXY) or "")

    def through_proxy(scheme: str, host: str, port: int) -> bool:
        if not proxied(scheme, host, port):
            return False
        refusal = proxies[scheme].refusal
        if refusal is not None:
            raise ProxyError(refusal)
        return True

    return ProxySpec(proxies["https"].endpoint, proxies["http"].endpoint, through_proxy)


def current_proxy_spec() -> ProxySpec | None:
    """The proxy in force now, read from the saved settings; None for direct connections."""
    stored = get_config().section(_SECTION)
    if not stored["enabled"]:
        return None
    if stored["source"] == _HOST_SOURCE:
        return _host_spec()
    return _custom_spec(stored)


def passwords_in_force() -> list[str]:
    """Every proxy password a request can send now; never fails on what the settings hold."""
    stored = get_config().section(_SECTION)
    if not stored["enabled"]:
        return []
    if stored["source"] == _HOST_SOURCE:
        endpoints = [proxy.endpoint for proxy in _host_proxies().values()]
        return [endpoint.password for endpoint in endpoints if endpoint and endpoint.password]
    try:
        password = _custom_password(stored)
    except ProxyError:
        return []
    return [] if password is None else [password]


def register_proxy_resolver() -> None:
    """Make the saved settings the proxy every web request from the WAVE host follows."""
    set_resolver(current_proxy_spec)


def block_lists() -> dict[str, list[dict[str, str]]]:
    """Every registered plugin once, under what it declares about the Proxy setting."""
    lists: dict[str, list[dict[str, str]]] = {support: [] for support in PROXY_SUPPORT_VALUES}
    for plugin in plugin_registry.list_plugins():
        metadata = plugin.metadata
        block = {key: str(metadata[key]) for key in ("id", "name", "category")}
        lists[declared_proxy_support(metadata)].append(block)
    return lists


def reset() -> None:
    """Back to the defaults: no proxy."""
    defaults = copy.deepcopy(dict(_DEFAULTS))
    get_config().save({f"{_SECTION}.{key}": value for key, value in defaults.items()})
