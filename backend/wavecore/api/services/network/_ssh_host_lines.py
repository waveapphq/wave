"""known_hosts and ssh-keyscan line parsing, and the check of one host addition (REQ-4.5.14)."""

import base64
import re
from collections.abc import Mapping
from typing import Any, NamedTuple

import asyncssh
from asyncssh.public_key import decode_ssh_public_key

from wavecore.api.config.instance_settings import whole_number_fault
from wavecore.core.ssh.trusted_hosts import KEY_TYPE_LABELS, fingerprint, public_key_text

_NOT_A_LINE = "not a known_hosts line"
_HASHED = "hashed host name, run ssh-keyscan without -H and paste again"
_MARKER = "@cert-authority and @revoked lines are not supported"
_WILDCARD = "wildcard host patterns are not supported"
_BAD_PORT = "invalid port, use [host]:port with a port from 1 to 65535"
_UNREADABLE = "unreadable key"
_KEY_TYPE_PREFIXES = ("ssh-", "ecdsa-", "sk-")
_KEY_TYPES = frozenset(KEY_TYPE_LABELS.values())
_BRACKETED = re.compile(r"\[(?P<host>[^\]]*)\]:(?P<port>.*)")
_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_DEFAULT_PORT = 22
_MAX_PORT = 65535


class ParsedHost(NamedTuple):
    """One good line: its host names on one port and the key they share."""

    host_names: tuple[str, ...]
    port: int
    key_type: str
    key: str
    fingerprint: str


class LineError(NamedTuple):
    """Why a line (numbered from 1 over the whole text) was not read."""

    line: int
    message: str


def _is_hashed(host: str) -> bool:
    return host.startswith("|1|")


def _is_wildcard(host: str) -> bool:
    return "*" in host or "?" in host or host.startswith("!")


def _host_and_port(name: str) -> tuple[str, int]:
    match = _BRACKETED.fullmatch(name)
    if match is None:
        return name, _DEFAULT_PORT
    port = match["port"]
    if not (port.isascii() and port.isdigit()) or not 1 <= int(port) <= _MAX_PORT:
        raise ValueError(_BAD_PORT)
    return match["host"], int(port)


def _key_of(algorithm: str, blob: str) -> asyncssh.SSHKey:
    try:
        key = decode_ssh_public_key(base64.b64decode(blob, validate=True))
    except ValueError as exc:
        raise ValueError(_UNREADABLE) from exc
    if key.get_algorithm() != algorithm:
        raise ValueError(f"key type {algorithm} does not match the key")
    return key


def _parse_line(line: str) -> list[ParsedHost]:
    if line.startswith(("@cert-authority", "@revoked")):
        raise ValueError(_MARKER)
    fields = line.split()
    if len(fields) < 3:
        raise ValueError(_NOT_A_LINE)
    host_field, algorithm, blob = fields[:3]
    if algorithm not in KEY_TYPE_LABELS and not algorithm.startswith(_KEY_TYPE_PREFIXES):
        raise ValueError(_NOT_A_LINE)
    if _is_hashed(host_field):
        raise ValueError(_HASHED)
    names = host_field.split(",")
    if any(_is_wildcard(name) for name in names):
        raise ValueError(_WILDCARD)
    by_port: dict[int, list[str]] = {}
    for name in names:
        host, port = _host_and_port(name)
        by_port.setdefault(port, []).append(host)
    if algorithm not in KEY_TYPE_LABELS:
        raise ValueError(f"unsupported key type {algorithm}")
    key = _key_of(algorithm, blob)
    return [
        ParsedHost(
            tuple(hosts), port, KEY_TYPE_LABELS[algorithm], public_key_text(key), fingerprint(key)
        )
        for port, hosts in by_port.items()
    ]


def parse_host_lines(text: str) -> tuple[list[ParsedHost], list[LineError]]:
    """Good entries in text order beside one reason per bad line; exact repeats are dropped."""
    entries: list[ParsedHost] = []
    errors: list[LineError] = []
    for number, raw in enumerate(_LINE_BREAK.split(text), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            parsed = _parse_line(line)
        except ValueError as exc:
            errors.append(LineError(number, str(exc)))
            continue
        for entry in parsed:
            if entry not in entries:
                entries.append(entry)
    return entries, errors


def _addition_problem(entry: Mapping[str, Any]) -> str | None:
    host, port, key_type = entry.get("host"), entry.get("port"), entry.get("key_type")
    if not isinstance(host, str) or not host.strip():
        return "host is required"
    if _is_hashed(host):
        return _HASHED
    if _is_wildcard(host):
        return _WILDCARD
    if whole_number_fault(port, 1, _MAX_PORT):
        return f"port must be from 1 to {_MAX_PORT}"
    if key_type not in _KEY_TYPES:
        return f"unsupported key type {key_type}"
    try:
        key = asyncssh.import_public_key(str(entry.get("key")))
    except ValueError:
        return _UNREADABLE
    if KEY_TYPE_LABELS.get(key.get_algorithm()) != key_type:
        return f"key type {key_type} does not match the key"
    return None


def check_addition(index: int, entry: Mapping[str, Any]) -> None:
    """Raise ValueError naming addition `index` when the entry cannot be trusted as given."""
    reason = _addition_problem(entry)
    if reason is not None:
        raise ValueError(f"Addition {index}: {reason}")
