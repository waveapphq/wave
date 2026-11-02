"""WAVE's trusted SSH hosts: the list in the data folder, the policy in the config (REQ-4.5.14)."""

import base64
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncssh
import yaml

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import SECTION_DEFAULTS
from wavecore.api.services import settings_file, storage_paths

KEY_TYPE_LABELS: dict[str, str] = {
    "ssh-ed25519": "ED25519",
    "ecdsa-sha2-nistp256": "ECDSA",
    "ecdsa-sha2-nistp384": "ECDSA",
    "ecdsa-sha2-nistp521": "ECDSA",
    "ssh-rsa": "RSA",
}
_DEFAULT_PORT = 22


class TrustedHostsUnreadable(Exception):
    """The list file exists but cannot be read."""


class TrustedHostConflict(Exception):
    """A host, port and key type would hold a second, different key."""


_STORE_DEFAULTS: dict[str, Any] = {"hosts": []}
_POLICY_DEFAULTS: dict[str, Any] = SECTION_DEFAULTS["network"]["ssh_hosts"]


def _read(path: Path) -> dict[str, Any]:
    try:
        store = settings_file.read(path, _STORE_DEFAULTS)
    except (OSError, yaml.YAMLError, ValueError) as exc:
        error = next(iter(str(exc).splitlines()), type(exc).__name__)
        raise TrustedHostsUnreadable(
            f"WAVE's trusted SSH hosts list {path} cannot be read: {error}"
        ) from exc
    store["hosts"] = list(store["hosts"] or [])
    return store


def load() -> dict[str, Any]:
    """The stored host entries."""
    return _read(storage_paths.get_ssh_hosts_file_path())


def policy() -> dict[str, Any]:
    """Lock trusted hosts and the default block action, as the running config holds them."""
    return get_config().section("network.ssh_hosts")


def save_policy(policy: Mapping[str, Any]) -> None:
    """Write the given policy fields to the config file, then make them the running policy."""
    get_config().save({f"network.ssh_hosts.{field}": value for field, value in policy.items()})


def reset_policy() -> None:
    """Put the default policy back; the host entries stay."""
    save_policy(_POLICY_DEFAULTS)


def public_key_text(key: asyncssh.SSHKey) -> str:
    """The key as WAVE's list stores it: `<algorithm> <base64>`, no comment."""
    return f"{key.get_algorithm()} {base64.b64encode(key.public_data).decode()}"


def key_type_label(key: asyncssh.SSHKey) -> str:
    """ED25519, ECDSA or RSA."""
    return KEY_TYPE_LABELS[key.get_algorithm()]


def fingerprint(key: asyncssh.SSHKey) -> str:
    """`SHA256:` plus the unpadded base64 digest, as ssh-keygen prints it."""
    return str(key.get_fingerprint("sha256"))


def _pattern(host: str, port: int) -> str:
    return host if port == _DEFAULT_PORT else f"[{host}]:{port}"


def known_hosts_bytes() -> bytes:
    """The list as OpenSSH known_hosts text."""
    lines = [f"{_pattern(e['host'], e['port'])} {e['public_key']}\n" for e in load()["hosts"]]
    return "".join(lines).encode()


def is_locked() -> bool:
    """Whether Lock trusted hosts is on in the running config."""
    return bool(policy()["lock_trusted_hosts"])


def _label_of(public_key: str) -> str | None:
    return KEY_TYPE_LABELS.get(public_key.split()[0])


def _slot(hosts: list[dict[str, Any]], host: str, port: int, public_key: str) -> int | None:
    """Index of the entry holding this host, port and key type."""
    label = _label_of(public_key)
    for index, entry in enumerate(hosts):
        if (entry["host"], entry["port"], _label_of(entry["public_key"])) == (host, port, label):
            return index
    return None


def _new_entry(host: str, port: int, public_key: str) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "host": host,
        "port": port,
        "public_key": public_key,
        "added": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def _add(hosts: list[dict[str, Any]], host: str, port: int, public_key: str) -> bool:
    """Append a new entry; an identical one is a no-op and another key of its type a conflict."""
    index = _slot(hosts, host, port, public_key)
    if index is None:
        hosts.append(_new_entry(host, port, public_key))
        return True
    if hosts[index]["public_key"] == public_key:
        return False
    raise TrustedHostConflict(
        f"{host} port {port} already has a trusted {_label_of(public_key)} key; "
        "remove it before adding another"
    )


def record_first_contact(host: str, port: int, key: asyncssh.SSHKey) -> None:
    """Add the key an accept-new connection met first; raises TrustedHostConflict if raced."""
    path = storage_paths.get_ssh_hosts_file_path()
    with settings_file.locked(path):
        hosts = _read(path)["hosts"]
        if _add(hosts, host, port, public_key_text(key)):
            settings_file.write(path, {"hosts": hosts})


def apply_change(add: Sequence[Mapping[str, Any]], remove: Sequence[str]) -> dict[str, Any]:
    """Removals, then additions, in one write; nothing written on a conflict."""
    path = storage_paths.get_ssh_hosts_file_path()
    with settings_file.locked(path):
        removed = set(remove)
        hosts = [entry for entry in _read(path)["hosts"] if entry["id"] not in removed]
        for item in add:
            key = asyncssh.import_public_key(item["key"])
            _add(hosts, item["host"], item["port"], public_key_text(key))
        store = {"hosts": hosts}
        settings_file.write(path, store)
    return store


def clear_hosts() -> int:
    """Empty the host entries; returns how many were removed."""
    path = storage_paths.get_ssh_hosts_file_path()
    with settings_file.locked(path):
        count = len(_read(path)["hosts"])
        settings_file.write(path, {"hosts": []})
    return count


def _restore_one(hosts: list[dict[str, Any]], item: Mapping[str, Any], overwrite: bool) -> str:
    public_key = public_key_text(asyncssh.import_public_key(item["public_key"]))
    if _label_of(public_key) is None:
        raise ValueError("unsupported key type")
    host, port = item["host"], item["port"]
    index = _slot(hosts, host, port, public_key)
    if index is None:
        hosts.append(_new_entry(host, port, public_key))
        return "imported"
    if overwrite and hosts[index]["public_key"] != public_key:
        hosts[index] = _new_entry(host, port, public_key)
        return "imported"
    return "skipped"


def restore_entries(items: Sequence[Mapping[str, Any]], conflict_resolution: str) -> dict[str, Any]:
    """Backup restore keyed by host, port and key type; only `overwrite` replaces a key."""
    counts = {"imported": 0, "skipped": 0, "fatal": 0}
    outcomes: list[str] = []
    path = storage_paths.get_ssh_hosts_file_path()
    with settings_file.locked(path):
        hosts = _read(path)["hosts"]
        for item in items:
            try:
                outcome = _restore_one(hosts, item, conflict_resolution == "overwrite")
            except (KeyError, TypeError, ValueError):
                outcome = "fatal"
            counts[outcome] += 1
            outcomes.append(outcome)
        settings_file.write(path, {"hosts": hosts})
    return {**counts, "outcomes": outcomes}
