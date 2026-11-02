"""Settings > Network > SSH Hosts: view, change set, paste parsing, detect, placement defaults."""

import asyncio
import logging
import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

import asyncssh

from wavecore.api.config.instance_settings import HOST_KEY_ACTIONS, whole_number
from wavecore.api.config.write_back import ConfigWriteError
from wavecore.api.exceptions import (
    ConflictException,
    InternalServerException,
    ValidationException,
)
from wavecore.api.services.network._ssh_host_lines import check_addition, parse_host_lines
from wavecore.core.ssh import trusted_hosts

logger = logging.getLogger(__name__)

DETECT_TIMEOUT_SECONDS = 10
_MAX_PORT = 65535
_IDENTIFICATION = b"SSH-2.0-WAVE\r\n"
_PROBE_ALGORITHMS = (
    ("ssh-ed25519",),
    ("ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"),
    ("rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"),
)


@contextmanager
def _readable() -> Iterator[None]:
    try:
        yield
    except trusted_hosts.TrustedHostsUnreadable as exc:
        raise InternalServerException(str(exc)) from exc


def _row(entry: Mapping[str, Any]) -> dict[str, Any]:
    key = asyncssh.import_public_key(entry["public_key"])
    return {
        "id": entry["id"],
        "host": entry["host"],
        "port": entry["port"],
        "key_type": trusted_hosts.key_type_label(key),
        "fingerprint": trusted_hosts.fingerprint(key),
        "added": str(entry["added"]),
    }


def _view(store: Mapping[str, Any]) -> dict[str, Any]:
    rows = [_row(entry) for entry in store["hosts"]]
    rows.sort(key=lambda row: (row["host"], row["port"], row["key_type"]))
    return {"policy": trusted_hosts.policy(), "hosts": rows}


def get_view() -> dict[str, Any]:
    """The policy and every trusted host, ordered by host, port and key type."""
    with _readable():
        return _view(trusted_hosts.load())


def get_policy() -> dict[str, Any]:
    """Lock trusted hosts and the default block action."""
    return trusted_hosts.policy()


def _resolve_policy(policy: Mapping[str, Any], current: Mapping[str, Any]) -> dict[str, Any]:
    """The whole policy a change asks for; Lock turns an unchanged Accept New default to Strict."""
    if not policy:
        return dict(current)
    lock = policy.get("lock_trusted_hosts", current["lock_trusted_hosts"])
    if not isinstance(lock, bool):
        raise ValidationException("Lock trusted hosts must be true or false")
    if "default_block_action" in policy:
        action = policy["default_block_action"]
        if action not in HOST_KEY_ACTIONS:
            raise ValidationException(
                "Default block action must be 'strict', 'accept-new' or 'disabled'"
            )
        if lock and action == "accept-new":
            raise ValidationException(
                "Default block action cannot be 'accept-new' while trusted hosts are locked"
            )
    else:
        action = current["default_block_action"]
        if lock and action == "accept-new":
            action = "strict"
    return {"lock_trusted_hosts": lock, "default_block_action": action}


def _hosts_after(add: list[dict[str, Any]], remove: list[str]) -> dict[str, Any]:
    """The hosts store after the additions and removals; without any, the store as it is."""
    with _readable():
        if not (add or remove):
            return trusted_hosts.load()
        try:
            return trusted_hosts.apply_change(add, remove)
        except trusted_hosts.TrustedHostConflict as exc:
            raise ConflictException(str(exc)) from exc


def _with_port(entry: Mapping[str, Any]) -> dict[str, Any]:
    """The entry with a port written as its digits as the number it stands for."""
    port = whole_number(entry.get("port"), 1, _MAX_PORT)
    return {**entry, "port": entry.get("port") if port is None else port}


def apply_changes(
    policy: dict[str, Any] | None, add: list[dict[str, Any]], remove: list[str]
) -> dict[str, Any]:
    """Check the whole change set, save the policy, then the hosts; returns the view after."""
    previous = trusted_hosts.policy()
    resolved = _resolve_policy(policy or {}, previous)
    for index, entry in enumerate(add, start=1):
        try:
            check_addition(index, entry)
        except ValueError as exc:
            raise ValidationException(str(exc)) from exc
    add = [_with_port(entry) for entry in add]
    changed = {field: value for field, value in resolved.items() if value != previous[field]}
    if changed:
        trusted_hosts.save_policy(changed)
    try:
        store = _hosts_after(add, remove)
    except Exception:
        if changed:
            # The caller gets the hosts error even when the previous policy cannot be put back.
            try:
                trusted_hosts.save_policy({field: previous[field] for field in changed})
            except ConfigWriteError as error:
                logger.warning(
                    "SSH host policy could not be put back after a failed Save; "
                    "the config file keeps the new values: %s",
                    error,
                )
        raise
    return _view(store)


def parse(text: str) -> dict[str, Any]:
    """Pasted known_hosts or ssh-keyscan lines read into entries and per-line reasons."""
    entries, errors = parse_host_lines(text)
    return {
        "entries": [{**entry._asdict(), "host_names": list(entry.host_names)} for entry in entries],
        "errors": [error._asdict() for error in errors],
    }


def saved_entries() -> list[dict[str, Any]]:
    """The host entries as stored, which is what a backup writes."""
    with _readable():
        return list(trusted_hosts.load()["hosts"])


def conflict_key(entry: Mapping[str, Any]) -> tuple[Any, Any, str | None]:
    """Host, port and key type: two entries sharing them cannot both stay."""
    algorithm = str(entry.get("public_key", "")).split(" ", 1)[0]
    port = _with_port(entry)["port"]
    return entry.get("host"), port, trusted_hosts.KEY_TYPE_LABELS.get(algorithm)


def backup_entry_problem(entry: Mapping[str, Any]) -> str | None:
    """The restore preview message for a backed-up entry that cannot be trusted, else None."""
    host, port, key_type = conflict_key(entry)
    addition = {"host": host, "port": port, "key_type": key_type, "key": entry.get("public_key")}
    try:
        check_addition(1, addition)
    except ValueError:
        return f"SSH host {host} port {port}: unreadable key"
    return None


def entry_label(entry: Mapping[str, Any]) -> str:
    """Host, port and key type as one name; empty when the entry has no readable host."""
    host, port, key_type = conflict_key(entry)
    if not host:
        return ""
    label = f"{host} port {port}"
    return f"{label} ({key_type})" if key_type else label


def restore_entries(items: list[dict[str, Any]], conflict_resolution: str) -> dict[str, Any]:
    """Restore backed-up entries; one the preview marks unreadable is never stored."""
    problems = [backup_entry_problem(item) for item in items]
    trusted = [
        _with_port(item) for item, problem in zip(items, problems, strict=True) if problem is None
    ]
    with _readable():
        result = trusted_hosts.restore_entries(trusted, conflict_resolution)
    restored = iter(result["outcomes"])
    outcomes = [next(restored) if problem is None else "fatal" for problem in problems]
    return {**result, "fatal": outcomes.count("fatal"), "outcomes": outcomes}


def placement_defaults() -> dict[str, dict[str, Any]]:
    """Settings a newly placed block is stamped with (REQ-4.5.14)."""
    return {"ssh-session-open": {"host_key_verification": get_policy()["default_block_action"]}}


def _os_reason(exc: OSError) -> str:
    """The operating system's text for the error; asyncio rewords a refused connect."""
    return os.strerror(exc.errno) if exc.errno and exc.errno > 0 else exc.strerror or str(exc)


async def _probe(host: str, port: int, algorithms: tuple[str, ...]) -> asyncssh.SSHKey | None:
    """The host key of one type; None when the host offers no key of it (REQ-4.5.15)."""
    try:
        return await asyncssh.get_server_host_key(
            host, port, server_host_key_algs=list(algorithms), config=[]
        )
    except (asyncssh.DisconnectError, OSError):
        # OpenSSH drops the connection without a disconnect message when it has no key of the type.
        return None


async def _sends_ssh_identification(reader: asyncio.StreamReader) -> bool:
    """Whether the peer sends an SSH identification line; other lines may come first (RFC 4253)."""
    try:
        while line := await reader.readline():
            if line.startswith(b"SSH-"):
                return True
    except (OSError, ValueError):
        return False
    return False


async def _read_host_keys(host: str, port: int) -> list[asyncssh.SSHKey]:
    try:
        reader, writer = await asyncio.open_connection(host, port)
    except OSError as exc:
        raise ValidationException(f"Could not reach {host}:{port}: {_os_reason(exc)}") from exc
    try:
        # A peer that waits for the client to speak first answers this line and shows what it is.
        writer.write(_IDENTIFICATION)
        speaks_ssh = await _sends_ssh_identification(reader)
    finally:
        writer.close()
    if not speaks_ssh:
        raise ValidationException(f"{host}:{port} did not answer as an SSH server")
    results = await asyncio.gather(
        *(_probe(host, port, algorithms) for algorithms in _PROBE_ALGORITHMS)
    )
    return [key for key in results if key is not None]


async def detect_host_keys(host: str, written_port: Any) -> dict[str, Any]:
    """Read the host's ED25519, ECDSA and RSA keys directly, without logging in; writes nothing."""
    host = host.strip()
    if not host:
        raise ValidationException("Host is required")
    port = whole_number(written_port, 1, _MAX_PORT)
    if port is None:
        raise ValidationException(f"Port must be from 1 to {_MAX_PORT}")
    try:
        keys = await asyncio.wait_for(_read_host_keys(host, port), DETECT_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise ValidationException(
            f"Timed out after {DETECT_TIMEOUT_SECONDS} seconds reaching {host}:{port}"
        ) from exc
    if not keys:
        raise ValidationException(f"{host}:{port} offered no ED25519, ECDSA or RSA host key")
    return {
        "entries": [
            {
                "host": host,
                "port": port,
                "key_type": trusted_hosts.key_type_label(key),
                "key": trusted_hosts.public_key_text(key),
                "fingerprint": trusted_hosts.fingerprint(key),
            }
            for key in keys
        ]
    }
