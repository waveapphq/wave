"""Settings > Network > Certificates service (REQ-4.5.16).

The certificates are in `<data>/network/certificates.yaml` under the suite's temporary data
folder and the public source is in the test's config file; the WAVE host's certificate store
is replaced by a bundle under `tmp_path` or by no store at all.
"""

import datetime
import logging
import os
import re
import warnings
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import certifi
import pytest
import yaml
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID

from tests.plugins.http.tls_material import Credential, make_credential
from wavecore.api.config import get_config
from wavecore.api.exceptions import (
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services import settings_file
from wavecore.api.services.network import certificates
from wavecore.connectivity import trust_store

UTC = datetime.UTC
NOT_BEFORE = datetime.datetime(2025, 7, 1, tzinfo=UTC)
NOT_AFTER = datetime.datetime(2036, 6, 30, 23, 59, 59, tzinfo=UTC)
STORE_CHANGED = datetime.datetime(2026, 9, 14, 12, 0, tzinfo=UTC).timestamp()

HOST_STORE_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt, /etc/pki/tls/certs/ca-bundle.crt, "
    "/etc/ssl/ca-bundle.pem, /etc/pki/tls/cacert.pem, "
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem, /etc/ssl/cert.pem"
)
NO_STORE_MESSAGE = (
    "^"
    + re.escape(f"No certificate store found on this WAVE host: looked in {HOST_STORE_PATHS}")
    + "$"
)
SOURCE_MESSAGE = r"^Public certificate authorities must be 'builtin' or 'host'$"
SOURCE_KEY = "network.certificates.public_source"
HOST_SOURCE_CONFIG = {"network": {"certificates": {"public_source": "host"}}}
PRIVATE_KEY_MESSAGE = "The text contains a private key; paste certificates only"
BAD_BLOCK = "-----BEGIN CERTIFICATE-----\nTm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n"
MISSING_ID = "0" * 64
BUILTIN_COUNT = (
    Path(certifi.where()).read_text(encoding="utf-8").count("-----BEGIN CERTIFICATE-----")
)

ROW_KEYS = {"id", "name", "organization", "type", "expires"}
PARSED_KEYS = {"id", "name", "type", "expires", "expired", "pem", "detail"}
DETAIL_KEYS = {
    "id",
    "name",
    "subject",
    "issuer",
    "type",
    "path_length",
    "valid_from",
    "valid_to",
    "status",
    "days_to_expiry",
    "sha256_fingerprint",
    "serial_number",
    "key",
    "signature_algorithm",
    "key_usage",
    "subject_key_id",
    "authority_key_id",
    "pem",
}


@dataclass(frozen=True)
class _Chain:
    root: Credential
    intermediate: Credential
    leaf: Credential
    expired: Credential


@pytest.fixture(scope="module")
def chain() -> _Chain:
    lab = [(NameOID.ORGANIZATION_NAME, "WAVE Lab")]
    root = make_credential(
        "WAVE Lab Root",
        key_kind="ec256",
        is_ca=True,
        extra_name_attrs=lab,
        not_before=NOT_BEFORE,
        not_after=NOT_AFTER,
    )
    intermediate = make_credential(
        "WAVE Lab Issuing CA",
        issuer=root,
        key_kind="ec256",
        is_ca=True,
        extra_name_attrs=lab,
        not_before=NOT_BEFORE,
        not_after=NOT_AFTER,
    )
    leaf = make_credential(
        "lab.example", issuer=intermediate, key_kind="ec256", not_after=NOT_AFTER
    )
    expired = make_credential(
        "Retired Lab Root",
        key_kind="ec256",
        is_ca=True,
        not_before=datetime.datetime(2015, 1, 1, tzinfo=UTC),
        not_after=datetime.datetime(2020, 1, 1, tzinfo=UTC),
    )
    return _Chain(root, intermediate, leaf, expired)


def _id(credential: Credential) -> str:
    return credential.cert.fingerprint(hashes.SHA256()).hex()


def _root_row(chain: _Chain) -> dict[str, str]:
    return {
        "id": _id(chain.root),
        "name": "WAVE Lab Root",
        "organization": "WAVE Lab",
        "type": "Root",
        "expires": "2036-06-30",
    }


def _intermediate_row(chain: _Chain) -> dict[str, str]:
    return {
        "id": _id(chain.intermediate),
        "name": "WAVE Lab Issuing CA",
        "organization": "WAVE Lab",
        "type": "Intermediate",
        "expires": "2036-06-30",
    }


def _by_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: str(row["id"]))


def _unreadable(path: Path) -> str:
    return rf"^WAVE's additional certificates {re.escape(str(path))} cannot be read: .+$"


def _stored(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded


def _entries(credentials: list[Credential]) -> list[dict[str, str]]:
    return [
        {"id": _id(item), "pem": item.cert_pem, "added": "2026-09-01T08:00:00+00:00"}
        for item in credentials
    ]


def _write_store(path: Path, credentials: list[Credential]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump({"certificates": _entries(credentials)}), encoding="utf-8")


def _write_store_with_a_source(path: Path, source: str, credentials: list[Credential]) -> None:
    """A data file carrying a source key, which WAVE does not read."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump({"public_source": source, "certificates": _entries(credentials)}),
        encoding="utf-8",
    )


def _config_source(config_on_disk: Callable[[], dict[str, Any]]) -> Any:
    """The public source as the config file holds it on disk right now."""
    return config_on_disk().get("network", {}).get("certificates", {}).get("public_source")


def _read_only_message(path: Path) -> str:
    message = f"Settings cannot be saved: the config file {path} is read-only"
    return f"^{re.escape(message)}$"


def _source_config(source: str) -> dict[str, Any]:
    return {"network": {"certificates": {"public_source": source}}}


def _logged_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == certificates.__name__ and record.levelno == logging.WARNING
    ]


def _deny_writes(monkeypatch: pytest.MonkeyPatch, path: Path, denied: list[Any]) -> None:
    """From this call on `os.access` refuses writing `path` and records each refusal."""
    real_access = os.access
    target = path.resolve()

    def access(candidate: Any, mode: int, **kwargs: Any) -> bool:
        if mode & os.W_OK and Path(os.fspath(candidate)).resolve() == target:
            denied.append(candidate)
            return False
        return real_access(candidate, mode, **kwargs)

    monkeypatch.setattr(os, "access", access)


def _bundle() -> list[x509.Certificate]:
    # certifi ships a root with a non-positive serial that cryptography warns about.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return x509.load_pem_x509_certificates(Path(certifi.where()).read_bytes())


def _load_error(block: str) -> str:
    """What cryptography says when it refuses ``block``."""
    with pytest.raises(ValueError) as refused:
        x509.load_pem_x509_certificate(block.encode("utf-8"))
    return str(refused.value)


def _expected_name(cert: x509.Certificate) -> str:
    for oid in (NameOID.COMMON_NAME, NameOID.ORGANIZATION_NAME):
        values = cert.subject.get_attributes_for_oid(oid)
        if values:
            return str(values[0].value)
    raise AssertionError("every bundled authority has a CN or an O")


@pytest.fixture
def store_file(temp_storage_path: Path) -> Path:
    return temp_storage_path / "network" / "certificates.yaml"


@pytest.fixture
def no_host_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(trust_store, "locate_host_store", lambda: None)


@pytest.fixture
def host_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, chain: _Chain) -> Path:
    path = tmp_path / "ca-certificates.crt"
    path.write_text(chain.root.cert_pem + chain.intermediate.cert_pem, encoding="utf-8")
    os.utime(path, (STORE_CHANGED, STORE_CHANGED))
    monkeypatch.setattr(trust_store, "locate_host_store", lambda: path)
    return path


@pytest.fixture
def certifi_june_2026(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(certifi, "__version__", "2026.06.17")


@pytest.fixture
def writes(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    calls: list[Path] = []
    real_write = settings_file.write

    def spy(path: Path, values: dict[str, Any]) -> None:
        calls.append(Path(path))
        real_write(path, values)

    monkeypatch.setattr(settings_file, "write", spy)
    return calls


class TestView:
    @pytest.mark.usefixtures("no_host_store")
    def test_the_source_is_read_from_the_config(self, load_config: Callable[..., Any]) -> None:
        load_config(HOST_SOURCE_CONFIG)

        assert certificates.get_view()["settings"]["public_source"] == "host"

    @pytest.mark.usefixtures("no_host_store")
    def test_a_source_left_in_the_data_file_is_not_read(
        self, chain: _Chain, store_file: Path
    ) -> None:
        _write_store_with_a_source(store_file, "host", [chain.root])

        view = certificates.get_view()

        assert view["settings"]["public_source"] == "builtin"
        assert view["additional"] == [_root_row(chain)]

    @pytest.mark.usefixtures("no_host_store", "certifi_june_2026")
    def test_default_view(self) -> None:
        assert certificates.get_view() == {
            "settings": {
                "public_source": "builtin",
                "builtin": {"label": "June 2026", "count": BUILTIN_COUNT},
                "host_store": {"path": None, "count": 0, "last_changed": None},
            },
            "additional": [],
        }

    @pytest.mark.usefixtures("no_host_store")
    def test_saved_certificates_are_rows(self, chain: _Chain) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem, chain.intermediate.cert_pem], [])

        rows = certificates.get_view()["additional"]

        assert _by_id(rows) == _by_id([_root_row(chain), _intermediate_row(chain)])

    def test_the_view_summarizes_the_host_store(self, host_store: Path) -> None:
        assert certificates.get_view()["settings"]["host_store"] == {
            "path": str(host_store),
            "count": 2,
            "last_changed": "2026-09-14",
        }

    @pytest.mark.usefixtures("no_host_store")
    def test_an_unreadable_file_is_an_internal_error(self, store_file: Path) -> None:
        store_file.mkdir(parents=True)

        with pytest.raises(InternalServerException, match=_unreadable(store_file)):
            certificates.get_view()


class TestBuiltin:
    @pytest.mark.usefixtures("certifi_june_2026")
    def test_label_and_count_come_from_certifi(self) -> None:
        assert certificates.builtin_label() == ("June 2026", BUILTIN_COUNT)

    @pytest.mark.parametrize(
        ("version", "label"),
        [("2025.01.31", "January 2025"), ("2024.12.14", "December 2024")],
    )
    def test_the_label_follows_the_certifi_version(
        self, monkeypatch: pytest.MonkeyPatch, version: str, label: str
    ) -> None:
        monkeypatch.setattr(certifi, "__version__", version)

        assert certificates.builtin_label() == (label, BUILTIN_COUNT)

    def test_the_count_is_the_bundled_certificate_count(self) -> None:
        assert BUILTIN_COUNT == len(_bundle())
        assert certificates.builtin_label()[1] == BUILTIN_COUNT

    def test_rows_list_every_bundled_authority(self) -> None:
        rows = certificates.builtin_rows()

        assert len(rows) == BUILTIN_COUNT
        assert all(set(row) == ROW_KEYS for row in rows)
        assert {row["type"] for row in rows} == {"Root"}
        assert {row["id"] for row in rows} == {
            cert.fingerprint(hashes.SHA256()).hex() for cert in _bundle()
        }

    def test_row_names_take_the_common_name_else_the_organization(self) -> None:
        names = {row["id"]: row["name"] for row in certificates.builtin_rows()}

        for cert in _bundle():
            assert names[cert.fingerprint(hashes.SHA256()).hex()] == _expected_name(cert)

    @pytest.mark.usefixtures("certifi_june_2026")
    def test_an_unreadable_authority_is_left_out_and_logged(
        self,
        monkeypatch: pytest.MonkeyPatch,
        chain: _Chain,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        pem = chain.root.cert_pem + BAD_BLOCK + chain.intermediate.cert_pem
        monkeypatch.setattr(trust_store, "builtin_pem", lambda: pem)

        with caplog.at_level(logging.WARNING, logger=certificates.__name__):
            rows = certificates.builtin_rows()

        assert rows == [_root_row(chain), _intermediate_row(chain)]
        assert certificates.builtin_label() == ("June 2026", 2)
        assert _logged_warnings(caplog) == [
            f"Built-in certificate 2 cannot be read and is left out: {_load_error(BAD_BLOCK)}"
        ]


class TestHostStoreSummary:
    def test_path_count_and_last_changed(self, host_store: Path) -> None:
        assert certificates.host_store_summary() == {
            "path": str(host_store),
            "count": 2,
            "last_changed": "2026-09-14",
        }

    @pytest.mark.usefixtures("no_host_store")
    def test_no_store(self) -> None:
        assert certificates.host_store_summary() == {
            "path": None,
            "count": 0,
            "last_changed": None,
        }


@pytest.mark.usefixtures("no_host_store")
class TestApplyChanges:
    def test_additions_are_stored_with_id_pem_and_added(
        self, chain: _Chain, store_file: Path
    ) -> None:
        view = certificates.apply_changes(
            None, [chain.root.cert_pem, chain.intermediate.cert_pem], []
        )

        stored = _stored(store_file)
        assert set(stored) == {"certificates"}
        pems = {
            _id(chain.root): chain.root.cert_pem,
            _id(chain.intermediate): chain.intermediate.cert_pem,
        }
        assert {entry["id"] for entry in stored["certificates"]} == set(pems)
        for entry in stored["certificates"]:
            assert set(entry) == {"id", "pem", "added"}
            assert entry["pem"] == pems[entry["id"]]
            added = datetime.datetime.fromisoformat(entry["added"])
            assert added.utcoffset() == datetime.timedelta(0)
        assert view == certificates.get_view()

    def test_removal(self, chain: _Chain) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem, chain.intermediate.cert_pem], [])

        view = certificates.apply_changes(None, [], [_id(chain.root)])

        assert view["additional"] == [_intermediate_row(chain)]

    def test_removing_a_missing_id_is_a_no_op(self, chain: _Chain, store_file: Path) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])
        before = _stored(store_file)["certificates"]

        certificates.apply_changes(None, [], [MISSING_ID])

        assert _stored(store_file)["certificates"] == before

    def test_adding_a_stored_certificate_is_a_no_op(self, chain: _Chain, store_file: Path) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])
        before = _stored(store_file)["certificates"]

        certificates.apply_changes(None, [chain.root.cert_pem], [])

        assert _stored(store_file)["certificates"] == before

    def test_removals_apply_before_additions(self, chain: _Chain) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])

        view = certificates.apply_changes(None, [chain.root.cert_pem], [_id(chain.root)])

        assert view["additional"] == [_root_row(chain)]

    def test_an_expired_ca_certificate_is_accepted(self, chain: _Chain) -> None:
        view = certificates.apply_changes(None, [chain.expired.cert_pem], [])

        assert [row["id"] for row in view["additional"]] == [_id(chain.expired)]

    def test_one_write_per_change_set(
        self, chain: _Chain, store_file: Path, writes: list[Path]
    ) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])
        writes.clear()

        certificates.apply_changes(
            "builtin", [chain.intermediate.cert_pem, chain.expired.cert_pem], [_id(chain.root)]
        )

        assert writes == [store_file]

    @pytest.mark.parametrize("value", ["system", "Builtin", "", 1, True, ["builtin"]])
    def test_an_unknown_source_is_refused(self, value: Any) -> None:
        with pytest.raises(ValidationException, match=SOURCE_MESSAGE):
            certificates.apply_changes(value, [], [])

    def test_the_host_store_is_refused_when_this_wave_host_has_none(self) -> None:
        with pytest.raises(ValidationException, match=NO_STORE_MESSAGE):
            certificates.apply_changes("host", [], [])

    @pytest.mark.parametrize(
        "make_text",
        [
            lambda chain: "not a certificate",
            lambda chain: "",
            lambda chain: chain.root.cert_pem + chain.intermediate.cert_pem,
            lambda chain: chain.root.key_pem,
            lambda chain: chain.root.cert_pem + chain.root.key_pem,
            lambda chain: BAD_BLOCK,
        ],
        ids=[
            "garbage",
            "empty",
            "two-certificates",
            "private-key",
            "with-private-key",
            "bad-block",
        ],
    )
    def test_an_addition_that_is_not_one_pem_certificate(
        self, chain: _Chain, make_text: Callable[[_Chain], str]
    ) -> None:
        with pytest.raises(ValidationException, match=r"^Addition 1: not a PEM certificate$"):
            certificates.apply_changes(None, [make_text(chain)], [])

    def test_additions_are_numbered_in_request_order(self, chain: _Chain) -> None:
        with pytest.raises(ValidationException, match=r"^Addition 2: not a PEM certificate$"):
            certificates.apply_changes(None, [chain.root.cert_pem, "not a certificate"], [])

    def test_an_addition_that_is_not_a_ca_certificate(self, chain: _Chain) -> None:
        with pytest.raises(ValidationException, match=r"^Addition 1: not a CA certificate$"):
            certificates.apply_changes(None, [chain.leaf.cert_pem], [])

    def test_a_later_addition_that_is_not_a_ca_certificate(self, chain: _Chain) -> None:
        with pytest.raises(ValidationException, match=r"^Addition 2: not a CA certificate$"):
            certificates.apply_changes(None, [chain.root.cert_pem, chain.leaf.cert_pem], [])

    @pytest.mark.parametrize(
        ("source", "make_additions"),
        [
            ("system", lambda chain: [chain.expired.cert_pem]),
            ("host", lambda chain: [chain.expired.cert_pem]),
            (None, lambda chain: [chain.expired.cert_pem, "not a certificate"]),
            (None, lambda chain: [chain.expired.cert_pem, chain.leaf.cert_pem]),
        ],
        ids=["unknown-source", "no-host-store", "not-pem", "not-ca"],
    )
    def test_a_refused_change_set_leaves_the_file_unchanged(
        self,
        chain: _Chain,
        store_file: Path,
        writes: list[Path],
        source: Any,
        make_additions: Callable[[_Chain], list[str]],
    ) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem, chain.intermediate.cert_pem], [])
        before = store_file.read_bytes()
        writes.clear()

        with pytest.raises(ValidationException):
            certificates.apply_changes(source, make_additions(chain), [_id(chain.root)])

        assert store_file.read_bytes() == before
        assert writes == []

    def test_a_refused_change_set_creates_no_file(self, store_file: Path) -> None:
        with pytest.raises(ValidationException):
            certificates.apply_changes(None, ["not a certificate"], [])

        assert not store_file.exists()

    def test_an_unreadable_file_is_an_internal_error(self, chain: _Chain, store_file: Path) -> None:
        store_file.mkdir(parents=True)

        with pytest.raises(InternalServerException, match=_unreadable(store_file)):
            certificates.apply_changes(None, [chain.root.cert_pem], [])


class TestHostSource:
    @pytest.mark.usefixtures("host_store")
    def test_the_host_store_is_saved_in_the_config_file(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        view = certificates.apply_changes("host", [], [])

        assert view["settings"]["public_source"] == "host"
        assert _config_source(config_on_disk) == "host"
        assert get_config().get(SOURCE_KEY) == "host"

    @pytest.mark.usefixtures("host_store")
    def test_a_source_only_change_writes_no_data_file(
        self, store_file: Path, writes: list[Path]
    ) -> None:
        certificates.apply_changes("host", [], [])

        assert writes == []
        assert not store_file.exists()

    @pytest.mark.usefixtures("host_store")
    def test_back_to_the_builtin_list(self, config_on_disk: Callable[[], dict[str, Any]]) -> None:
        certificates.apply_changes("host", [], [])

        view = certificates.apply_changes("builtin", [], [])

        assert view["settings"]["public_source"] == "builtin"
        assert _config_source(config_on_disk) == "builtin"

    @pytest.mark.usefixtures("host_store")
    def test_an_omitted_source_keeps_the_current_one(self, chain: _Chain) -> None:
        certificates.apply_changes("host", [], [])

        view = certificates.apply_changes(None, [chain.root.cert_pem], [])

        assert view["settings"]["public_source"] == "host"

    @pytest.mark.usefixtures("host_store")
    def test_the_saved_source_survives_a_restart(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        certificates.apply_changes("host", [], [])
        assert _config_source(config_on_disk) == "host"

        load_config()

        assert certificates.get_view()["settings"]["public_source"] == "host"
        assert certificates.current_trust_spec().source == "host"


class TestTwoStoreSave:
    """One Save: the source goes to the config file first, the certificates to the data file."""

    @pytest.mark.usefixtures("host_store")
    def test_source_and_additions_write_both_stores(
        self, chain: _Chain, store_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        view = certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert _config_source(config_on_disk) == "host"
        stored = _stored(store_file)
        assert set(stored) == {"certificates"}
        assert [entry["id"] for entry in stored["certificates"]] == [_id(chain.root)]
        assert view["settings"]["public_source"] == "host"
        assert view["additional"] == [_root_row(chain)]

    @pytest.mark.usefixtures("host_store")
    def test_the_config_file_is_written_before_the_data_file(
        self,
        chain: _Chain,
        monkeypatch: pytest.MonkeyPatch,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        seen: list[Any] = []
        real_write = settings_file.write

        def spy(path: Path, values: Mapping[str, Any]) -> None:
            seen.append(_config_source(config_on_disk))
            real_write(path, values)

        monkeypatch.setattr(settings_file, "write", spy)

        certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert seen == ["host"]

    @pytest.mark.usefixtures("host_store")
    def test_a_failed_data_write_restores_the_previous_source(
        self,
        chain: _Chain,
        store_file: Path,
        monkeypatch: pytest.MonkeyPatch,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        seen: list[Any] = []

        def refuse(path: Path, values: Mapping[str, Any]) -> None:
            seen.append(_config_source(config_on_disk))
            raise OSError("disk full")

        monkeypatch.setattr(settings_file, "write", refuse)

        with pytest.raises(OSError, match=r"^disk full$"):
            certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert seen == ["host"]
        assert _config_source(config_on_disk) == "builtin"
        assert get_config().get(SOURCE_KEY) == "builtin"
        assert not store_file.exists()

    @pytest.mark.usefixtures("host_store")
    def test_a_failed_data_write_restores_a_saved_host_source(
        self,
        chain: _Chain,
        monkeypatch: pytest.MonkeyPatch,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(HOST_SOURCE_CONFIG)

        def refuse(path: Path, values: Mapping[str, Any]) -> None:
            raise OSError("disk full")

        monkeypatch.setattr(settings_file, "write", refuse)

        with pytest.raises(OSError, match=r"^disk full$"):
            certificates.apply_changes("builtin", [chain.root.cert_pem], [])

        assert _config_source(config_on_disk) == "host"
        assert get_config().get(SOURCE_KEY) == "host"
        assert certificates.current_trust_spec().source == "host"

    @pytest.mark.usefixtures("no_host_store")
    @pytest.mark.parametrize("source", [None, "builtin"], ids=["omitted", "same"])
    def test_a_source_that_does_not_change_leaves_the_config_file_alone(
        self, chain: _Chain, store_file: Path, config_file: Path, source: str | None
    ) -> None:
        before = config_file.read_bytes()

        certificates.apply_changes(source, [chain.root.cert_pem], [])

        assert config_file.read_bytes() == before
        assert set(_stored(store_file)) == {"certificates"}

    @pytest.mark.usefixtures("host_store")
    def test_a_refused_change_set_leaves_both_stores_unchanged(
        self, chain: _Chain, store_file: Path, config_file: Path, writes: list[Path]
    ) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])
        data_before = store_file.read_bytes()
        config_before = config_file.read_bytes()
        writes.clear()

        with pytest.raises(ValidationException, match=r"^Addition 1: not a CA certificate$"):
            certificates.apply_changes("host", [chain.leaf.cert_pem], [_id(chain.root)])

        assert config_file.read_bytes() == config_before
        assert store_file.read_bytes() == data_before
        assert writes == []
        assert set(_stored(store_file)) == {"certificates"}
        assert certificates.get_view()["settings"]["public_source"] == "builtin"

    @pytest.mark.usefixtures("host_store")
    def test_a_read_only_config_refuses_the_save_and_writes_nothing(
        self, chain: _Chain, store_file: Path, read_only_config: Path, writes: list[Path]
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        before = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(read_only_config)):
            certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert read_only_config.read_bytes() == before
        assert get_config().get(SOURCE_KEY) == "builtin"
        assert writes == []
        assert not store_file.exists()

    @pytest.mark.usefixtures("no_host_store")
    def test_the_saved_source_sent_again_is_not_refused_on_a_read_only_config(
        self, store_file: Path, load_config: Callable[..., Any], read_only_config: Path
    ) -> None:
        load_config(_source_config("builtin"))
        before = read_only_config.read_bytes()

        view = certificates.apply_changes("builtin", [], [])

        assert view["settings"]["public_source"] == "builtin"
        assert read_only_config.read_bytes() == before
        assert not store_file.exists()

    @pytest.mark.usefixtures("host_store")
    def test_additions_with_the_saved_source_are_saved_on_a_read_only_config(
        self,
        chain: _Chain,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
    ) -> None:
        load_config(HOST_SOURCE_CONFIG)
        before = read_only_config.read_bytes()

        view = certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert read_only_config.read_bytes() == before
        assert get_config().get(SOURCE_KEY) == "host"
        assert view["additional"] == [_root_row(chain)]
        assert set(_stored(store_file)) == {"certificates"}

    @pytest.mark.usefixtures("host_store")
    @pytest.mark.parametrize(("saved", "requested"), [("builtin", "host"), ("host", "builtin")])
    @pytest.mark.parametrize("with_addition", [False, True], ids=["source-only", "with-addition"])
    def test_an_unreadable_data_file_keeps_the_saved_source(
        self,
        chain: _Chain,
        store_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        saved: str,
        requested: str,
        with_addition: bool,
    ) -> None:
        load_config(_source_config(saved))
        store_file.mkdir(parents=True)
        additions = [chain.root.cert_pem] if with_addition else []

        with pytest.raises(InternalServerException, match=_unreadable(store_file)):
            certificates.apply_changes(requested, additions, [])

        assert _config_source(config_on_disk) == saved
        assert get_config().get(SOURCE_KEY) == saved

    @pytest.mark.usefixtures("host_store")
    def test_a_failed_restore_still_raises_the_original_error(
        self, chain: _Chain, config_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        denied: list[Any] = []

        def refuse(path: Path, values: Mapping[str, Any]) -> None:
            _deny_writes(monkeypatch, config_file, denied)
            raise OSError("disk full")

        monkeypatch.setattr(settings_file, "write", refuse)

        with pytest.raises(OSError, match=r"^disk full$"):
            certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert denied

    @pytest.mark.usefixtures("host_store")
    def test_a_source_that_cannot_be_put_back_is_logged_as_one_warning(
        self,
        chain: _Chain,
        config_file: Path,
        monkeypatch: pytest.MonkeyPatch,
        config_on_disk: Callable[[], dict[str, Any]],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        def refuse(path: Path, values: Mapping[str, Any]) -> None:
            _deny_writes(monkeypatch, config_file, [])
            raise OSError("disk full")

        monkeypatch.setattr(settings_file, "write", refuse)

        with (
            caplog.at_level(logging.WARNING, logger=certificates.__name__),
            pytest.raises(OSError, match=r"^disk full$"),
        ):
            certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert _logged_warnings(caplog) == [
            "Public certificate source could not be put back after a failed Save; "
            "the config file keeps the new value: "
            f"Settings cannot be saved: the config file {config_file} is read-only"
        ]
        assert _config_source(config_on_disk) == "host"
        assert get_config().get(SOURCE_KEY) == "host"

    @pytest.mark.usefixtures("host_store")
    def test_a_source_that_is_put_back_logs_no_warning(
        self,
        chain: _Chain,
        monkeypatch: pytest.MonkeyPatch,
        config_on_disk: Callable[[], dict[str, Any]],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        def refuse(path: Path, values: Mapping[str, Any]) -> None:
            raise OSError("disk full")

        monkeypatch.setattr(settings_file, "write", refuse)

        with (
            caplog.at_level(logging.WARNING, logger=certificates.__name__),
            pytest.raises(OSError, match=r"^disk full$"),
        ):
            certificates.apply_changes("host", [chain.root.cert_pem], [])

        assert _logged_warnings(caplog) == []
        assert _config_source(config_on_disk) == "builtin"

    @pytest.mark.usefixtures("no_host_store")
    def test_a_source_left_in_the_data_file_is_gone_after_the_next_write(
        self, chain: _Chain, store_file: Path
    ) -> None:
        _write_store_with_a_source(store_file, "host", [chain.root])

        view = certificates.apply_changes(None, [chain.intermediate.cert_pem], [])

        stored = _stored(store_file)
        assert set(stored) == {"certificates"}
        assert {entry["id"] for entry in stored["certificates"]} == {
            _id(chain.root),
            _id(chain.intermediate),
        }
        assert view["settings"]["public_source"] == "builtin"


class TestParse:
    def test_parsed_certificates_carry_detail_and_expired(
        self, chain: _Chain, store_file: Path
    ) -> None:
        result = certificates.parse_text(chain.root.cert_pem + chain.expired.cert_pem)

        assert result["errors"] == []
        current, retired = result["certificates"]
        assert set(current) == PARSED_KEYS
        assert {key: current[key] for key in PARSED_KEYS - {"detail"}} == {
            "id": _id(chain.root),
            "name": "WAVE Lab Root",
            "type": "Root",
            "expires": "2036-06-30",
            "expired": False,
            "pem": chain.root.cert_pem,
        }
        assert set(current["detail"]) == DETAIL_KEYS
        assert current["detail"]["id"] == _id(chain.root)
        assert current["detail"]["pem"] == chain.root.cert_pem
        assert current["detail"]["status"] == "valid"
        assert retired["id"] == _id(chain.expired)
        assert retired["expired"] is True
        assert retired["detail"]["status"] == "expired"
        assert not store_file.exists()

    def test_errors_carry_index_and_message(self, chain: _Chain) -> None:
        result = certificates.parse_text(chain.leaf.cert_pem + chain.root.cert_pem)

        assert [item["id"] for item in result["certificates"]] == [_id(chain.root)]
        assert result["errors"] == [{"index": 1, "message": "Certificate 1: not a CA certificate"}]

    def test_a_private_key_refuses_everything(self, chain: _Chain) -> None:
        result = certificates.parse_text(chain.root.cert_pem + chain.root.key_pem)

        assert result == {
            "certificates": [],
            "errors": [{"index": None, "message": PRIVATE_KEY_MESSAGE}],
        }

    def test_blank_text(self) -> None:
        assert certificates.parse_text("  \n") == {"certificates": [], "errors": []}

    def test_the_pem_is_re_encoded_by_wave(self, chain: _Chain) -> None:
        pasted = "# WAVE Lab Root\r\n" + chain.root.cert_pem.replace("\n", "\r\n")

        result = certificates.parse_text(pasted)

        assert [item["pem"] for item in result["certificates"]] == [chain.root.cert_pem]

    def test_a_der_file(self, chain: _Chain) -> None:
        result = certificates.parse_file("root.cer", chain.root.der)

        assert result["errors"] == []
        assert [item["pem"] for item in result["certificates"]] == [chain.root.cert_pem]
        assert result["certificates"][0]["detail"]["id"] == _id(chain.root)

    def test_a_pem_file_with_two_certificates(self, chain: _Chain) -> None:
        data = (chain.root.cert_pem + chain.intermediate.cert_pem).encode()

        result = certificates.parse_file("chain.pem", data)

        assert [item["id"] for item in result["certificates"]] == [
            _id(chain.root),
            _id(chain.intermediate),
        ]

    def test_a_junk_file(self, store_file: Path) -> None:
        assert certificates.parse_file("leaf.bin", b"\x00\x01 junk") == {
            "certificates": [],
            "errors": [{"index": None, "message": "leaf.bin is not a PEM or DER certificate file"}],
        }
        assert not store_file.exists()


class TestCertificateDetail:
    @pytest.mark.usefixtures("no_host_store")
    def test_a_saved_additional_certificate(self, chain: _Chain) -> None:
        certificates.apply_changes(None, [chain.intermediate.cert_pem], [])

        detail = certificates.certificate_detail(_id(chain.intermediate))

        assert set(detail) == DETAIL_KEYS
        assert detail["id"] == _id(chain.intermediate)
        assert detail["name"] == "WAVE Lab Issuing CA"
        assert detail["type"] == "Intermediate"
        assert detail["status"] == "valid"
        assert detail["pem"] == chain.intermediate.cert_pem

    def test_a_builtin_certificate(self) -> None:
        bundled = _bundle()[0]
        certificate_id = bundled.fingerprint(hashes.SHA256()).hex()

        detail = certificates.certificate_detail(certificate_id)

        assert detail["id"] == certificate_id
        assert detail["name"] == _expected_name(bundled)
        assert detail["type"] == "Root"
        assert detail["pem"] == bundled.public_bytes(serialization.Encoding.PEM).decode()

    def test_an_unknown_id(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Certificate with ID 'x' not found$"):
            certificates.certificate_detail("x")

    @pytest.mark.usefixtures("no_host_store")
    def test_a_removed_certificate_is_not_found(self, chain: _Chain) -> None:
        certificates.apply_changes(None, [chain.intermediate.cert_pem], [])
        certificates.apply_changes(None, [], [_id(chain.intermediate)])
        message = rf"^Certificate with ID '{_id(chain.intermediate)}' not found$"

        with pytest.raises(NotFoundException, match=message):
            certificates.certificate_detail(_id(chain.intermediate))


@pytest.mark.usefixtures("certifi_june_2026")
class TestTrustSpec:
    def test_no_file_is_the_builtin_list_alone(self) -> None:
        assert certificates.current_trust_spec() == trust_store.TrustSpec(
            source="builtin", additional_pem="", additional_count=0, builtin_label="June 2026"
        )

    def test_the_file_is_read_at_call_time(self, chain: _Chain, store_file: Path) -> None:
        assert certificates.current_trust_spec().additional_count == 0
        _write_store(store_file, [chain.root, chain.intermediate])

        spec = certificates.current_trust_spec()

        assert spec.source == "builtin"
        assert spec.additional_count == 2
        assert spec.builtin_label == "June 2026"
        anchors = x509.load_pem_x509_certificates(spec.additional_pem.encode())
        assert set(anchors) == {chain.root.cert, chain.intermediate.cert}

    def test_the_source_is_read_from_the_config(self, load_config: Callable[..., Any]) -> None:
        load_config(HOST_SOURCE_CONFIG)

        assert certificates.current_trust_spec() == trust_store.TrustSpec(
            source="host", additional_pem="", additional_count=0, builtin_label="June 2026"
        )

    def test_a_saved_source_reaches_the_spec_at_call_time(self) -> None:
        assert certificates.current_trust_spec().source == "builtin"

        get_config().save({SOURCE_KEY: "host"})

        assert certificates.current_trust_spec().source == "host"

    def test_a_source_left_in_the_data_file_is_not_read(
        self, chain: _Chain, store_file: Path
    ) -> None:
        _write_store_with_a_source(store_file, "host", [chain.root])

        spec = certificates.current_trust_spec()

        assert spec.source == "builtin"
        assert spec.additional_count == 1

    @pytest.mark.usefixtures("host_store")
    def test_saved_changes_reach_the_spec(self, chain: _Chain) -> None:
        certificates.apply_changes("host", [chain.root.cert_pem], [])

        spec = certificates.current_trust_spec()

        assert spec.source == "host"
        assert spec.additional_count == 1
        assert x509.load_pem_x509_certificates(spec.additional_pem.encode()) == [chain.root.cert]


@pytest.mark.usefixtures("certifi_june_2026")
class TestRegisterTrustResolver:
    def test_the_active_spec_is_read_from_the_file(self, chain: _Chain, store_file: Path) -> None:
        certificates.register_trust_resolver()
        _write_store(store_file, [chain.root])

        spec = trust_store.active_spec()

        assert spec == certificates.current_trust_spec()
        assert spec.source == "builtin"
        assert spec.additional_count == 1

    def test_the_active_spec_takes_its_source_from_the_config(
        self, load_config: Callable[..., Any]
    ) -> None:
        certificates.register_trust_resolver()
        load_config(HOST_SOURCE_CONFIG)

        assert trust_store.active_spec().source == "host"


class TestReset:
    def test_reset_returns_to_the_builtin_list_without_additions(
        self, host_store: Path, chain: _Chain
    ) -> None:
        certificates.apply_changes("host", [chain.root.cert_pem, chain.intermediate.cert_pem], [])

        certificates.reset()

        view = certificates.get_view()
        assert view["settings"]["public_source"] == "builtin"
        assert view["additional"] == []

    @pytest.mark.usefixtures("no_host_store")
    def test_reset_without_a_file(self) -> None:
        certificates.reset()

        view = certificates.get_view()
        assert view["settings"]["public_source"] == "builtin"
        assert view["additional"] == []

    @pytest.mark.usefixtures("host_store")
    def test_reset_saves_the_builtin_source_in_the_config_file(
        self, chain: _Chain, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        certificates.apply_changes("host", [chain.root.cert_pem], [])
        assert _config_source(config_on_disk) == "host"

        certificates.reset()

        assert _config_source(config_on_disk) == "builtin"
        assert get_config().get(SOURCE_KEY) == "builtin"

    @pytest.mark.usefixtures("host_store")
    def test_reset_leaves_an_empty_certificate_list_in_the_data_file(
        self, chain: _Chain, store_file: Path
    ) -> None:
        certificates.apply_changes("host", [chain.root.cert_pem, chain.intermediate.cert_pem], [])

        certificates.reset()

        assert _stored(store_file) == {"certificates": []}

    @pytest.mark.usefixtures("no_host_store")
    def test_reset_on_a_fresh_install_leaves_the_builtin_source_and_no_certificates(
        self, store_file: Path
    ) -> None:
        certificates.reset()

        assert get_config().get(SOURCE_KEY) == "builtin"
        assert _stored(store_file) == {"certificates": []}

    @pytest.mark.usefixtures("no_host_store")
    def test_reset_with_a_read_only_config_is_refused_and_keeps_the_certificates(
        self,
        chain: _Chain,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
        writes: list[Path],
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        load_config(HOST_SOURCE_CONFIG)
        _write_store(store_file, [chain.root])
        config_before = read_only_config.read_bytes()
        data_before = store_file.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(read_only_config)):
            certificates.reset()

        assert read_only_config.read_bytes() == config_before
        assert store_file.read_bytes() == data_before
        assert writes == []
        assert get_config().get(SOURCE_KEY) == "host"


def _item(credential: Credential, added: str = "2026-01-05T08:00:00+00:00") -> dict[str, Any]:
    return {"id": _id(credential), "pem": credential.cert_pem, "added": added}


@pytest.mark.usefixtures("no_host_store")
class TestRestoreCertificates:
    def test_new_certificates_are_imported(self, chain: _Chain) -> None:
        result = certificates.restore_certificates([_item(chain.root), _item(chain.intermediate)])

        assert result == {
            "imported": 2,
            "skipped": 0,
            "fatal": 0,
            "outcomes": ["imported", "imported"],
        }
        assert _by_id(certificates.get_view()["additional"]) == _by_id(
            [_root_row(chain), _intermediate_row(chain)]
        )

    def test_existing_ids_are_skipped(self, chain: _Chain, store_file: Path) -> None:
        certificates.apply_changes(None, [chain.root.cert_pem], [])
        [kept] = _stored(store_file)["certificates"]

        result = certificates.restore_certificates(
            [_item(chain.root, added="2020-01-01T00:00:00+00:00"), _item(chain.intermediate)]
        )

        assert result == {
            "imported": 1,
            "skipped": 1,
            "fatal": 0,
            "outcomes": ["skipped", "imported"],
        }
        entries = _stored(store_file)["certificates"]
        assert [entry for entry in entries if entry["id"] == _id(chain.root)] == [kept]
        assert {entry["id"] for entry in entries} == {_id(chain.root), _id(chain.intermediate)}

    def test_an_item_that_is_not_a_certificate_is_fatal(self) -> None:
        item = {"id": MISSING_ID, "pem": "not a certificate", "added": "2026-01-05T08:00:00+00:00"}

        result = certificates.restore_certificates([item])

        assert result == {"imported": 0, "skipped": 0, "fatal": 1, "outcomes": ["fatal"]}
        assert certificates.get_view()["additional"] == []

    def test_the_result_holds_one_outcome_per_entry_in_input_order(
        self, chain: _Chain, store_file: Path
    ) -> None:
        _write_store(store_file, [chain.root])

        result = certificates.restore_certificates(
            [_item(chain.intermediate), _item(chain.root), _item(chain.expired)]
        )

        outcomes = ["imported", "skipped", "imported"]
        assert result == {"imported": 2, "skipped": 1, "fatal": 0, "outcomes": outcomes}
        assert {entry["id"] for entry in _stored(store_file)["certificates"]} == {
            _id(chain.root),
            _id(chain.intermediate),
            _id(chain.expired),
        }

    @pytest.mark.parametrize("pem", ["not a certificate", BAD_BLOCK], ids=["text", "bad-block"])
    def test_an_item_that_is_not_a_certificate_gives_fatal_and_is_not_stored(
        self, chain: _Chain, store_file: Path, pem: str
    ) -> None:
        item = {"id": MISSING_ID, "pem": pem, "added": "2026-01-05T08:00:00+00:00"}

        result = certificates.restore_certificates(
            [_item(chain.root), item, _item(chain.intermediate)]
        )

        outcomes = ["imported", "fatal", "imported"]
        assert result == {"imported": 2, "skipped": 0, "fatal": 1, "outcomes": outcomes}
        assert {entry["id"] for entry in _stored(store_file)["certificates"]} == {
            _id(chain.root),
            _id(chain.intermediate),
        }

    def test_restore_writes_only_the_certificates(self, chain: _Chain, store_file: Path) -> None:
        _write_store_with_a_source(store_file, "host", [chain.root])

        certificates.restore_certificates([_item(chain.intermediate)])

        stored = _stored(store_file)
        assert set(stored) == {"certificates"}
        assert {entry["id"] for entry in stored["certificates"]} == {
            _id(chain.root),
            _id(chain.intermediate),
        }

    def test_restore_leaves_the_source_alone(
        self, chain: _Chain, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(HOST_SOURCE_CONFIG)
        before = config_file.read_bytes()

        certificates.restore_certificates([_item(chain.root)])

        assert config_file.read_bytes() == before
        assert certificates.get_view()["settings"]["public_source"] == "host"
