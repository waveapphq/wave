"""Settings > Network > Certificates: public source, Additional Certificates (REQ-4.5.16)."""

import dataclasses
import datetime
import functools
import logging
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml
from cryptography import x509

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import PUBLIC_SOURCES
from wavecore.api.config.write_back import ConfigWriteError
from wavecore.api.exceptions import (
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services import settings_file, storage_paths
from wavecore.api.services.network import certificate_facts
from wavecore.api.services.network.certificate_facts import ParseError
from wavecore.connectivity import trust_store

logger = logging.getLogger(__name__)

_SOURCE_KEY = "network.certificates.public_source"
_DEFAULTS: dict[str, Any] = {"certificates": []}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _source() -> str:
    """The public source the running config holds."""
    return str(get_config().network.certificates.public_source)


def _load(path: Path) -> list[dict[str, Any]]:
    """The Additional Certificates the data file holds."""
    try:
        return list(settings_file.read(path, _DEFAULTS)["certificates"])
    except (OSError, ValueError, yaml.YAMLError) as exc:
        raise InternalServerException(
            f"WAVE's additional certificates {path} cannot be read: {exc}"
        ) from exc


@functools.lru_cache(maxsize=1)
def _builtin_certificates(pem: str) -> tuple[x509.Certificate, ...]:
    return tuple(x509.load_pem_x509_certificates(pem.encode("utf-8")))


def _builtin() -> tuple[x509.Certificate, ...]:
    return _builtin_certificates(trust_store.builtin_pem())


def _stored_certificate(entry: dict[str, Any]) -> x509.Certificate:
    return x509.load_pem_x509_certificate(str(entry["pem"]).encode("utf-8"))


def builtin_label() -> tuple[str, int]:
    """The built-in list's release month and its certificate count."""
    return trust_store.builtin_list_label(), len(_builtin())


def builtin_rows() -> list[dict[str, Any]]:
    """One row per authority in WAVE's built-in list."""
    return [certificate_facts.row_of(cert) for cert in _builtin()]


def host_store_summary() -> dict[str, Any]:
    """The WAVE host's store: path, certificate count, and the date it last changed."""
    path = trust_store.locate_host_store()
    if path is None:
        return {"path": None, "count": 0, "last_changed": None}
    text = path.read_text(encoding="utf-8", errors="replace")
    changed = datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.UTC)
    return {
        "path": str(path),
        "count": certificate_facts.certificate_count(text),
        "last_changed": changed.date().isoformat(),
    }


def _view(entries: Sequence[dict[str, Any]]) -> dict[str, Any]:
    label, count = builtin_label()
    return {
        "settings": {
            "public_source": _source(),
            "builtin": {"label": label, "count": count},
            "host_store": host_store_summary(),
        },
        "additional": [certificate_facts.row_of(_stored_certificate(entry)) for entry in entries],
    }


def get_view() -> dict[str, Any]:
    """The page view: the chosen public source, both source summaries, the saved rows."""
    return _view(_load(storage_paths.get_certificates_file_path()))


def _no_store_message() -> str:
    looked_in = ", ".join(trust_store.HOST_STORE_PATHS)
    return f"No certificate store found on {trust_store.WAVE_HOST}: looked in {looked_in}"


def _checked_source(public_source: Any) -> str | None:
    if public_source is None:
        return None
    if not isinstance(public_source, str) or public_source not in PUBLIC_SOURCES:
        raise ValidationException("Public certificate authorities must be 'builtin' or 'host'")
    if public_source == trust_store.HOST and trust_store.locate_host_store() is None:
        raise ValidationException(_no_store_message())
    return public_source


def _addition(number: int, text: str) -> x509.Certificate:
    try:
        return certificate_facts.single_ca_certificate(text)
    except certificate_facts.NotCACertificate as exc:
        raise ValidationException(f"Addition {number}: not a CA certificate") from exc
    except certificate_facts.InvalidCertificate as exc:
        raise ValidationException(f"Addition {number}: not a PEM certificate") from exc


def _entry(cert: x509.Certificate, added: str) -> dict[str, Any]:
    return {
        "id": certificate_facts.certificate_id(cert),
        "pem": certificate_facts.pem_of(cert),
        "added": added,
    }


def _entries_after(additions: list[x509.Certificate], remove: list[str]) -> list[dict[str, Any]]:
    """The saved entries after the removals and additions; without any, the entries as they are."""
    path = storage_paths.get_certificates_file_path()
    with settings_file.locked(path):
        entries = _load(path)
        if not (additions or remove):
            return entries
        removed = set(remove)
        entries = [entry for entry in entries if entry["id"] not in removed]
        known = {entry["id"] for entry in entries}
        added = _now().isoformat(timespec="seconds")
        for cert in additions:
            entry = _entry(cert, added)
            if entry["id"] not in known:
                known.add(entry["id"])
                entries.append(entry)
        settings_file.write(path, {"certificates": entries})
    return entries


def apply_changes(public_source: Any, add: list[str], remove: list[str]) -> dict[str, Any]:
    """Validate the whole change set, save the source, then write removals and additions."""
    source = _checked_source(public_source)
    additions = [_addition(number, text) for number, text in enumerate(add, start=1)]
    previous = _source()
    changed = source not in (None, previous)
    if changed:
        get_config().save({_SOURCE_KEY: source})
    try:
        entries = _entries_after(additions, remove)
    except Exception:
        if changed:
            # The caller gets the data error even when the previous source cannot be put back.
            try:
                get_config().save({_SOURCE_KEY: previous})
            except ConfigWriteError as error:
                logger.warning(
                    "Public certificate source could not be put back after a failed Save; "
                    "the config file keeps the new value: %s",
                    error,
                )
        raise
    return _view(entries)


def _parsed(
    result: tuple[list[x509.Certificate], list[ParseError]],
) -> dict[str, Any]:
    certificates, errors = result
    now = _now()
    parsed = []
    for cert in certificates:
        row = certificate_facts.row_of(cert)
        detail = certificate_facts.detail_of(cert, now)
        parsed.append(
            {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "expires": row["expires"],
                "expired": detail["status"] == "expired",
                "pem": detail["pem"],
                "detail": detail,
            }
        )
    return {"certificates": parsed, "errors": [dataclasses.asdict(error) for error in errors]}


def parse_text(text: str) -> dict[str, Any]:
    """Pasted PEM text as preview rows with their detail; writes nothing."""
    return _parsed(certificate_facts.parse_text(text))


def parse_file(file_name: str, data: bytes) -> dict[str, Any]:
    """A chosen PEM or DER file as preview rows with their detail; writes nothing."""
    return _parsed(certificate_facts.parse_file(file_name, data))


def certificate_detail(certificate_id: str) -> dict[str, Any]:
    """A saved Additional Certificate's detail, else a built-in authority's."""
    for entry in _load(storage_paths.get_certificates_file_path()):
        if entry["id"] == certificate_id:
            return certificate_facts.detail_of(_stored_certificate(entry), _now())
    for cert in _builtin():
        if certificate_facts.certificate_id(cert) == certificate_id:
            return certificate_facts.detail_of(cert, _now())
    raise NotFoundException(f"Certificate with ID '{certificate_id}' not found")


def current_trust_spec() -> trust_store.TrustSpec:
    """What a blank CA trusts now, read from the saved settings."""
    pems = [str(entry["pem"]) for entry in _load(storage_paths.get_certificates_file_path())]
    return trust_store.TrustSpec(
        source=_source(),
        additional_pem="".join(pems),
        additional_count=len(pems),
        builtin_label=trust_store.builtin_list_label(),
    )


def register_trust_resolver() -> None:
    """Make the saved settings the trust every blank-CA connection on the WAVE host uses."""
    trust_store.set_resolver(current_trust_spec)


def reset() -> None:
    """Back to WAVE's built-in list with no Additional Certificates."""
    get_config().save({_SOURCE_KEY: trust_store.BUILTIN})
    settings_file.write(storage_paths.get_certificates_file_path(), _DEFAULTS)


def saved_entries() -> list[dict[str, Any]]:
    """The Additional Certificates as stored, which is what a backup writes."""
    return _load(storage_paths.get_certificates_file_path())


def conflict_key(entry: Mapping[str, Any]) -> str:
    """The SHA-256 id of a backed-up entry's certificate; raises ValueError when it has none."""
    pem = str(entry.get("pem", ""))
    return certificate_facts.certificate_id(certificate_facts.single_ca_certificate(pem))


def backup_entry_problem(entry: Mapping[str, Any]) -> str | None:
    """The restore preview message for a backed-up entry that is not one CA certificate."""
    try:
        conflict_key(entry)
    except ValueError:
        return f"Certificate {entry.get('id')}: not a valid certificate"
    return None


def _restore_one(entries: list[dict[str, Any]], known: set[str], item: Mapping[str, Any]) -> str:
    try:
        cert = certificate_facts.single_ca_certificate(str(item.get("pem", "")))
    except ValueError:
        return "fatal"
    entry = _entry(cert, str(item.get("added") or _now().isoformat(timespec="seconds")))
    if entry["id"] in known:
        return "skipped"
    known.add(entry["id"])
    entries.append(entry)
    return "imported"


def restore_certificates(items: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Add backed-up certificates by SHA-256 id; one already saved is skipped in every mode."""
    counts = {"imported": 0, "skipped": 0, "fatal": 0}
    outcomes: list[str] = []
    path = storage_paths.get_certificates_file_path()
    with settings_file.locked(path):
        entries = _load(path)
        known = {entry["id"] for entry in entries}
        for item in items:
            outcome = _restore_one(entries, known, item)
            counts[outcome] += 1
            outcomes.append(outcome)
        settings_file.write(path, {"certificates": entries})
    return {**counts, "outcomes": outcomes}
