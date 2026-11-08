"""
Shared SSH session transport tests (REQ-3.4.1.3, REQ-5.1.5, REQ-4.5.14, REQ-4.5.15).

plugins/_ssh_session.py is the shared asyncssh transport for the SSH
Session trio: parameter-to-connect-kwargs mapping (host-key policy,
login sources, keepalive, compression, parent tunnel), the host key check
against WAVE's trusted SSH hosts list with its first-contact record, the safe
connect wrapper, the timed remote run that releases its channel whenever it is
abandoned, safe stdout/stderr decoding, and the server banner reader.
"""

import asyncio
import gc
import inspect
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, call, patch

import asyncssh
import pytest
import yaml

from tests.plugins.netcat.conftest import SSH_HOST, TUNNEL_SESSION, WriterProbe, tunnel_registry
from tests.plugins.ssh.conftest import (
    KEY_CHANGED,
    NOT_TRUSTED_LOCKED,
    NOT_TRUSTED_STRICT,
    SESSION_ID,
    KeyEndpoint,
    LoopbackSSH,
    NoAuthServer,
    ProcessHandler,
    RecordsTheProcess,
    SignalWatcher,
    SlowToHandOver,
    SSHEndpoint,
    channel_connection,
    exits_immediately,
    host_key_refusal,
    known_hosts_lines,
    set_lock,
    ssh_hosts_config,
    ssh_hosts_file,
    ssh_server,
    trust_host,
    trusted_entries,
    tunnel_session,
)
from wavecore.api.services.storage_paths import get_base_path
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins import _ssh_session
from wavecore.plugins._ssh_session import (
    build_connect_kwargs,
    command_timed_out,
    drop_session_on_a_refused_host_key,
    open_connection,
    require_session,
    run_and_release,
    safe_decode,
    server_banner,
)

_PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"
_MODES = pytest.mark.parametrize("mode", ["strict", "accept-new", "disabled"])


async def run_with_timeout(
    connection: Any, command: str, timeout: float, script: str | None = None
) -> Any:
    """The composition both SSH session plugins use, under test as one unit."""
    try:
        async with asyncio.timeout(timeout):
            return await run_and_release(connection, command, script=script)
    except TimeoutError as exc:
        raise command_timed_out(timeout) from exc


def _base_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "host": "node-1.example.com",
        "username": "wave",
        "password": "s3cr3t-pw",
    }
    params.update(overrides)
    return params


def _exported_key(export_format: str, passphrase: str | None) -> str:
    """A fresh ECDSA private key in `export_format`, encrypted when a passphrase is given."""
    key = asyncssh.generate_private_key("ecdsa-sha2-nistp256")
    return key.export_private_key(export_format, passphrase=passphrase).decode()


def _connect_raising_invalid_pem() -> Any:
    """asyncssh.connect failing as it does when a key's text does not parse."""
    return patch(
        "wavecore.plugins._ssh_session.asyncssh.connect",
        new=AsyncMock(side_effect=asyncssh.KeyImportError("Invalid PEM private key")),
    )


def _public_line(key: Any) -> str:
    """The OpenSSH public-key half of a known-hosts entry."""
    return key.convert_to_public().export_public_key("openssh").decode().strip()


def _another_key() -> Any:
    """A host key that is not the one the loopback server presents."""
    return asyncssh.generate_private_key("ssh-ed25519")


def _as_reoffered(key: Any) -> Any:
    """The same key as a later exchange delivers it: decoded afresh, so never the same object."""
    return asyncssh.import_public_key(key.export_public_key("openssh"))


def _old_known_hosts_file() -> Path:
    """Where WAVE once kept its host key record; it is neither read nor written now."""
    return get_base_path() / "ssh" / "known_hosts"


def _key_file(folder: Path, name: str = "id_lab") -> tuple[Path, bytes]:
    """A private key file on the WAVE host and the exact bytes it holds."""
    data = asyncssh.generate_private_key("ssh-ed25519").export_private_key("openssh")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(data)
    return path, data


def _unreadable(path: Path) -> str:
    return "^" + re.escape(f"WAVE's trusted SSH hosts list {path} cannot be read: ") + ".+$"


class TestBuildConnectKwargsBasics:
    """Host, port, credentials, and timeout mapping."""

    def test_maps_host_username_and_password(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["host"] == "node-1.example.com"
        assert kwargs["username"] == "wave"
        assert kwargs["password"] == "s3cr3t-pw"

    def test_port_defaults_to_22(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["port"] == 22

    def test_explicit_port_is_used(self) -> None:
        kwargs = build_connect_kwargs(_base_params(port=2222), None)

        assert kwargs["port"] == 2222

    def test_connect_timeout_defaults_to_30(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["connect_timeout"] == 30

    def test_explicit_connect_timeout_is_used(self) -> None:
        kwargs = build_connect_kwargs(_base_params(connect_timeout=5), None)

        assert kwargs["connect_timeout"] == 5

    def test_no_password_means_no_password_kwarg(self) -> None:
        params = _base_params()
        del params["password"]
        params["private_key"] = _PEM

        kwargs = build_connect_kwargs(params, None)

        assert "password" not in kwargs


class TestBuildConnectKwargsPrivateKey:
    """WAVE reads the Private Key and hands asyncssh its bytes only (REQ-4.5.4, REQ-3.4.3.12)."""

    def test_an_absolute_key_path_is_read_and_passed_as_bytes(self, tmp_path: Path) -> None:
        path, data = _key_file(tmp_path / "keys")

        kwargs = build_connect_kwargs(_base_params(private_key=str(path)), None)

        assert kwargs["client_keys"] == [data]
        assert isinstance(kwargs["client_keys"][0], bytes)

    def test_a_relative_key_path_starts_at_the_home_folder(self, server_home: Path) -> None:
        _path, data = _key_file(server_home / "keys")

        kwargs = build_connect_kwargs(_base_params(private_key="keys/id_lab"), None)

        assert kwargs["client_keys"] == [data]

    def test_a_dot_dot_segment_is_followed_from_the_home_folder(self, server_home: Path) -> None:
        _path, data = _key_file(server_home / "keys")

        kwargs = build_connect_kwargs(_base_params(private_key="other/../keys/id_lab"), None)

        assert kwargs["client_keys"] == [data]

    def test_pem_content_is_passed_as_bytes(self) -> None:
        kwargs = build_connect_kwargs(_base_params(private_key=_PEM), None)

        assert kwargs["client_keys"] == [_PEM.encode()]

    def test_a_missing_key_file_is_refused_with_its_absolute_path(self, server_home: Path) -> None:
        missing = server_home / "keys" / "id_lab"

        with pytest.raises(ValueError, match=exact(f"Private Key file not found: {missing}")):
            build_connect_kwargs(_base_params(private_key="keys/id_lab"), None)

    def test_the_missing_path_is_shown_with_dot_dot_collapsed(self, server_home: Path) -> None:
        missing = server_home / "keys" / "id_lab"

        with pytest.raises(ValueError, match=exact(f"Private Key file not found: {missing}")):
            build_connect_kwargs(_base_params(private_key="other/../keys/id_lab"), None)

    def test_an_unreadable_key_file_is_refused_with_the_reason(self, server_home: Path) -> None:
        unreadable = server_home / "keys" / "id_lab"
        unreadable.mkdir(parents=True)

        with pytest.raises(
            ValueError,
            match="^" + re.escape(f"Private Key file {unreadable} cannot be read: ") + ".+$",
        ):
            build_connect_kwargs(_base_params(private_key="keys/id_lab"), None)

    def test_passphrase_maps_when_private_key_present(self) -> None:
        kwargs = build_connect_kwargs(_base_params(private_key=_PEM, passphrase="unlock-me"), None)

        assert kwargs["passphrase"] == "unlock-me"

    def test_no_private_key_turns_public_key_login_off(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert "client_keys" in kwargs
        assert kwargs["client_keys"] is None
        assert "passphrase" not in kwargs

    def test_password_and_private_key_can_coexist(self) -> None:
        kwargs = build_connect_kwargs(_base_params(private_key=_PEM), None)

        assert kwargs["password"] == "s3cr3t-pw"
        assert kwargs["client_keys"] == [_PEM.encode()]


class TestBuildConnectKwargsLoginSources:
    """Nothing of the account WAVE runs under takes part in a connection (REQ-4.5.15)."""

    @staticmethod
    def _kwargs(mode: str, **extra: Any) -> dict[str, Any]:
        return build_connect_kwargs(_base_params(host_key_verification=mode), **extra)

    @_MODES
    def test_no_ssh_config_file_is_read(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=None)

        assert kwargs.get("config", "absent") == []

    @_MODES
    def test_no_ssh_agent_is_asked(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=None)

        assert "agent_path" in kwargs
        assert kwargs["agent_path"] is None

    @_MODES
    def test_no_default_key_is_tried_without_a_private_key(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=None)

        assert "client_keys" in kwargs
        assert kwargs["client_keys"] is None

    @_MODES
    def test_no_x509_host_trust_is_loaded(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=None)

        assert "x509_trusted_certs" in kwargs
        assert kwargs["x509_trusted_certs"] is None
        assert "x509_trusted_cert_paths" in kwargs
        assert kwargs["x509_trusted_cert_paths"] is None

    @_MODES
    def test_kerberos_is_off(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=None)

        assert kwargs.get("gss_auth") is False
        assert kwargs.get("gss_kex") is False

    @_MODES
    def test_a_chained_hop_takes_no_account_source_either(self, mode: str) -> None:
        kwargs = self._kwargs(mode, tunnel=MagicMock())

        assert kwargs.get("config", "absent") == []
        assert kwargs.get("agent_path", "absent") is None
        assert kwargs.get("client_keys", "absent") is None
        assert kwargs.get("gss_auth") is False

    @_MODES
    def test_a_session_on_a_tunnel_port_takes_no_account_source_either(self, mode: str) -> None:
        params = _base_params(host="127.0.0.1", port=40022, host_key_verification=mode)

        kwargs = build_connect_kwargs(params, None, host_key_identity=("far.internal", 22))

        assert kwargs.get("config", "absent") == []
        assert kwargs.get("agent_path", "absent") is None
        assert kwargs.get("client_keys", "absent") is None
        assert kwargs.get("gss_kex") is False


class TestBuildConnectKwargsHostKeyPolicy:
    """Host-key verification mode mapping."""

    def test_strict_and_accept_new_install_a_host_key_check(self) -> None:
        for mode in ("strict", "accept-new"):
            kwargs = build_connect_kwargs(_base_params(host_key_verification=mode), None)

            assert isinstance(kwargs["client_factory"], _ssh_session._HostKeyCheck)

    def test_disabled_skips_verification_entirely(self) -> None:
        kwargs = build_connect_kwargs(_base_params(host_key_verification="disabled"), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    def test_a_missing_mode_skips_verification(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs


def _host_key_check(mode: str) -> Any:
    """The check asyncssh consults when it finds no match for the offered host key."""
    return build_connect_kwargs(_base_params(host_key_verification=mode), None)["client_factory"]


class TestHostKeyCheck:
    """First contact, a changed key, and a strict refusal, as asyncssh drives them."""

    def test_first_contact_records_the_key_and_accepts(self) -> None:
        key = _another_key().convert_to_public()

        accepted = _host_key_check("accept-new").validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, key
        )

        assert accepted is True
        assert trusted_entries() == [("node-1.example.com", 22, _public_line(key))]
        assert known_hosts_lines() == [f"node-1.example.com {_public_line(key)}"]

    def test_a_non_default_port_is_recorded_with_the_port(self) -> None:
        key = _another_key().convert_to_public()

        _host_key_check("accept-new").validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 2222, key
        )

        assert trusted_entries() == [("node-1.example.com", 2222, _public_line(key))]
        assert known_hosts_lines() == [f"[node-1.example.com]:2222 {_public_line(key)}"]

    def test_first_contact_never_writes_the_old_known_hosts_file(self) -> None:
        _host_key_check("accept-new").validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert _old_known_hosts_file().exists() is False

    def test_a_changed_key_is_refused(self) -> None:
        trust_host("node-1.example.com", 22, _another_key())
        check = _host_key_check("accept-new")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "key-changed"

    def test_a_changed_key_is_never_recorded(self) -> None:
        original = _another_key()
        trust_host("node-1.example.com", 22, original)

        _host_key_check("accept-new").validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert trusted_entries() == [("node-1.example.com", 22, _public_line(original))]

    def test_strict_refuses_a_host_it_has_never_seen(self) -> None:
        check = _host_key_check("strict")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "host-unknown"

    def test_strict_records_nothing(self) -> None:
        _host_key_check("strict").validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert trusted_entries() == []

    def test_a_changed_key_under_strict_says_so(self) -> None:
        trust_host("node-1.example.com", 22, _another_key())
        check = _host_key_check("strict")

        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert check.refusal == "key-changed"

    def test_the_old_known_hosts_file_is_never_read(self) -> None:
        key = _another_key().convert_to_public()
        old = _old_known_hosts_file()
        old.parent.mkdir(parents=True)
        old.write_text(f"node-1.example.com {_public_line(key)}\n", encoding="utf-8")
        check = _host_key_check("strict")

        accepted = check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, key)

        assert accepted is False
        assert check.refusal == "host-unknown"


class TestHostKeyCheckIsPortSpecific:
    """A host trusted on one port says nothing about the same host on another (REQ-4.5.14)."""

    def test_strict_refuses_a_port_with_no_entry_as_not_trusted(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("db1", 22, key)
        check = _host_key_check("strict")

        accepted = check.validate_host_public_key("db1", "", 2222, _as_reoffered(key))

        assert accepted is False
        assert check.refusal == "host-unknown"

    def test_accept_new_records_the_other_port_as_its_own_entry(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("db1", 22, key)

        accepted = _host_key_check("accept-new").validate_host_public_key(
            "db1", "", 2222, _as_reoffered(key)
        )

        assert accepted is True
        assert trusted_entries() == [
            ("db1", 22, _public_line(key)),
            ("db1", 2222, _public_line(key)),
        ]
        assert sorted(known_hosts_lines()) == sorted(
            [f"db1 {_public_line(key)}", f"[db1]:2222 {_public_line(key)}"]
        )

    def test_a_different_key_on_port_22_is_no_change_for_another_port(self) -> None:
        trust_host("db1", 22, _another_key())
        check = _host_key_check("strict")

        accepted = check.validate_host_public_key(
            "db1", "", 2222, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "host-unknown"

    def test_accept_new_trusts_another_port_whatever_port_22_holds(self) -> None:
        held = _another_key()
        offered = _another_key().convert_to_public()
        trust_host("db1", 22, held)

        accepted = _host_key_check("accept-new").validate_host_public_key("db1", "", 2222, offered)

        assert accepted is True
        assert trusted_entries() == [
            ("db1", 22, _public_line(held)),
            ("db1", 2222, _public_line(offered)),
        ]

    def test_an_entry_on_another_port_says_nothing_about_port_22(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("db1", 2222, key)
        check = _host_key_check("strict")

        accepted = check.validate_host_public_key("db1", "", 22, _as_reoffered(key))

        assert accepted is False
        assert check.refusal == "host-unknown"


class TestHostKeyCheckUnderLock:
    """Lock trusted hosts turns Accept New into Strict at run time (REQ-4.5.14)."""

    def test_accept_new_refuses_an_unknown_host_while_locked(self) -> None:
        set_lock(True)
        check = _host_key_check("accept-new")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal is not None
        assert trusted_entries() == []

    def test_a_locked_check_records_nothing_even_when_asked_to(self) -> None:
        check = _ssh_session._HostKeyCheck(False, None, locked=True)

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal is not None
        assert trusted_entries() == []

    def test_a_trusted_host_is_still_accepted_while_locked(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("node-1.example.com", 22, key)
        set_lock(True)
        check = _host_key_check("accept-new")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _as_reoffered(key)
        )

        assert accepted is True
        assert check.refusal is None

    def test_a_changed_key_while_locked_is_still_a_changed_key(self) -> None:
        trust_host("node-1.example.com", 22, _another_key())
        set_lock(True)
        check = _host_key_check("accept-new")

        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert check.refusal == "key-changed"

    def test_disabled_is_not_affected_by_lock(self) -> None:
        set_lock(True)

        kwargs = build_connect_kwargs(_base_params(host_key_verification="disabled"), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    def test_lock_is_read_at_each_connect(self) -> None:
        key = _another_key().convert_to_public()
        set_lock(True)
        locked = _host_key_check("accept-new")
        assert locked.validate_host_public_key("node-1.example.com", "", 22, key) is False
        set_lock(False)
        unlocked = _host_key_check("accept-new")

        assert unlocked.validate_host_public_key("node-1.example.com", "", 22, key) is True
        assert trusted_entries() == [("node-1.example.com", 22, _public_line(key))]


class TestHostKeyCheckOnALaterExchange:
    """SSH rekeys, so the same check rules on every exchange of one connection."""

    def test_one_check_object_serves_the_whole_connection(self) -> None:
        check = _host_key_check("accept-new")

        assert check() is check

    def test_the_same_key_again_is_trusted(self) -> None:
        key = _another_key().convert_to_public()
        check = _host_key_check("accept-new")
        check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, key)
        reoffered = _as_reoffered(key)
        assert reoffered is not key

        accepted = check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, reoffered)

        assert accepted is True
        assert check.refusal is None

    def test_the_same_key_again_is_not_recorded_twice(self) -> None:
        key = _another_key().convert_to_public()
        check = _host_key_check("accept-new")
        check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, key)
        reoffered = _as_reoffered(key)
        assert reoffered is not key

        accepted = check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, reoffered)

        assert accepted is True
        assert trusted_entries() == [("node-1.example.com", 22, _public_line(key))]

    def test_a_second_key_is_refused_as_a_changed_key(self) -> None:
        check = _host_key_check("accept-new")
        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "key-changed"

    def test_a_second_key_is_never_recorded(self) -> None:
        first = _another_key().convert_to_public()
        check = _host_key_check("accept-new")
        check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, first)

        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert trusted_entries() == [("node-1.example.com", 22, _public_line(first))]


class TestHostKeyCheckWhenAnotherOpenRecordsFirst:
    """Parallel branches connect at once, so the list can gain the host mid-handshake."""

    def test_a_different_key_recorded_meanwhile_is_refused(self) -> None:
        check = _host_key_check("accept-new")
        trust_host("node-1.example.com", 22, _another_key())

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "key-changed"

    def test_a_different_key_recorded_meanwhile_is_never_appended(self) -> None:
        check = _host_key_check("accept-new")
        original = _another_key()
        trust_host("node-1.example.com", 22, original)

        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert trusted_entries() == [("node-1.example.com", 22, _public_line(original))]

    def test_the_same_key_recorded_meanwhile_is_accepted(self) -> None:
        key = _another_key().convert_to_public()
        check = _host_key_check("accept-new")
        trust_host("node-1.example.com", 22, key)

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _as_reoffered(key)
        )

        assert accepted is True
        assert check.refusal is None

    def test_the_same_key_recorded_meanwhile_is_not_appended_again(self) -> None:
        key = _another_key().convert_to_public()
        check = _host_key_check("accept-new")
        trust_host("node-1.example.com", 22, key)

        check.validate_host_public_key("node-1.example.com", "10.0.0.7", 22, _as_reoffered(key))

        assert trusted_entries() == [("node-1.example.com", 22, _public_line(key))]

    def test_a_different_key_recorded_after_the_read_is_refused_and_never_appended(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        original = _another_key()
        trust_host("node-1.example.com", 22, original)
        # Another run's record lands between this check's read of the list and its own record.
        monkeypatch.setattr(_ssh_session, "_trusted_keys", lambda *_args: [])
        check = _host_key_check("accept-new")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "key-changed"
        assert trusted_entries() == [("node-1.example.com", 22, _public_line(original))]

    def test_strict_accepts_a_key_recorded_meanwhile(self) -> None:
        key = _another_key().convert_to_public()
        check = _host_key_check("strict")
        trust_host("node-1.example.com", 22, key)

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _as_reoffered(key)
        )

        assert accepted is True
        assert check.refusal is None


class TestTheRetiredKnownHostsRecordIsGone:
    """WAVE's trusted hosts list is the only record; no known hosts file is read."""

    @pytest.mark.parametrize(
        "name",
        [
            "_ACCOUNT_KNOWN_HOSTS",
            "known_hosts_file",
            "_read_known_hosts",
            "trusted_host_keys",
            "_record_host_key",
        ],
    )
    def test_the_old_symbol_is_deleted(self, name: str) -> None:
        assert not hasattr(_ssh_session, name)

    def test_no_certificate_authority_branch_is_left(self) -> None:
        assert "ca_keys" not in inspect.getsource(_ssh_session)

    @pytest.mark.parametrize(
        "old_text",
        [
            "the host offered a key that differs from the one WAVE recorded for it",
            "the host has no recorded key and the host key policy is 'strict'",
            "SSH known hosts file",
        ],
    )
    def test_the_old_refusal_text_is_gone(self, old_text: str) -> None:
        assert old_text not in inspect.getsource(_ssh_session)


def _live_session(registry: SSHSessionRegistry) -> dict[str, Any]:
    """One registered session whose Connected output is bound to 'conn_ok'."""
    variables: dict[str, Any] = {"conn_ok": True}
    registry.register(
        "ssh_session_1", MagicMock(), None, "node-1", "conn_ok", None, variables, connect_timeout=30
    )
    return variables


def _refuse_a_rekey(check: Any) -> None:
    """Accept a host key on first contact, then refuse a different one on the next exchange."""
    check.validate_host_public_key(
        "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
    )
    check.validate_host_public_key(
        "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
    )


_REKEY_REFUSAL_LOG = (
    f"SSH session 'ssh_session_1' dropped: {host_key_refusal('node-1:22', KEY_CHANGED)}"
)


class TestARefusedRekeyDropsTheSession:
    """A refusal after the session is live must name host keys and leave no live-looking record."""

    def test_the_session_is_closed_and_the_reason_logged(self) -> None:
        registry = SSHSessionRegistry()
        variables = _live_session(registry)
        logger = MagicMock()
        check = _host_key_check("accept-new")
        drop_session_on_a_refused_host_key(check, registry, "ssh_session_1", "node-1:22", logger)
        _refuse_a_rekey(check)

        check.connection_lost(ConnectionError("Connection lost"))

        assert registry.get("ssh_session_1") is None
        assert variables["conn_ok"] is False
        logger.error.assert_called_once_with(_REKEY_REFUSAL_LOG)

    def test_the_rekey_refusal_text_is_exact(self) -> None:
        registry = SSHSessionRegistry()
        _live_session(registry)
        logger = MagicMock()
        check = _host_key_check("strict")
        trust_host("node-1.example.com", 22, _another_key())
        drop_session_on_a_refused_host_key(check, registry, "ssh_session_1", "node-1:22", logger)
        _refuse_a_rekey(check)

        check.connection_lost(None)

        assert logger.error.call_args_list == [
            call(
                "SSH session 'ssh_session_1' dropped: SSH host key verification failed for "
                "node-1:22: the host offered a key that differs from the one in WAVE's trusted "
                "hosts list. Check Settings > Network > SSH Hosts"
            )
        ]

    def test_a_missing_logger_still_closes_the_session(self) -> None:
        registry = SSHSessionRegistry()
        _live_session(registry)
        check = _host_key_check("accept-new")
        drop_session_on_a_refused_host_key(check, registry, "ssh_session_1", "node-1:22", None)
        _refuse_a_rekey(check)

        check.connection_lost(None)

        assert registry.get("ssh_session_1") is None

    def test_a_clean_close_leaves_the_session_alone(self) -> None:
        registry = SSHSessionRegistry()
        logger = MagicMock()
        _live_session(registry)
        check = _host_key_check("accept-new")
        drop_session_on_a_refused_host_key(check, registry, "ssh_session_1", "node-1:22", logger)
        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        check.connection_lost(None)

        assert registry.get("ssh_session_1") is not None
        logger.error.assert_not_called()

    def test_a_refusal_before_anything_was_wired_is_harmless(self) -> None:
        check = _host_key_check("strict")
        check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        check.connection_lost(None)

        assert check.refusal == "host-unknown"

    def test_verification_disabled_leaves_nothing_to_wire(self) -> None:
        registry = SSHSessionRegistry()
        _live_session(registry)

        drop_session_on_a_refused_host_key(
            None, registry, "ssh_session_1", "node-1:22", MagicMock()
        )

        assert registry.get("ssh_session_1") is not None


class TestBuildConnectKwargsKeepalive:
    """Keepalive interval and max-count mapping."""

    def test_keepalive_disabled_by_default(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert "keepalive_interval" not in kwargs
        assert "keepalive_count_max" not in kwargs

    def test_zero_interval_means_disabled(self) -> None:
        kwargs = build_connect_kwargs(_base_params(keep_alive_interval=0), None)

        assert "keepalive_interval" not in kwargs
        assert "keepalive_count_max" not in kwargs

    def test_positive_interval_maps_with_default_max_count(self) -> None:
        kwargs = build_connect_kwargs(_base_params(keep_alive_interval=15), None)

        assert kwargs["keepalive_interval"] == 15
        assert kwargs["keepalive_count_max"] == 3

    def test_explicit_max_count_maps(self) -> None:
        kwargs = build_connect_kwargs(
            _base_params(keep_alive_interval=15, keep_alive_max_count=5), None
        )

        assert kwargs["keepalive_count_max"] == 5


class TestBuildConnectKwargsCompressionAndTunnel:
    """Compression toggle and parent-connection tunnel wiring."""

    def test_compression_off_by_default(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert "compression_algs" not in kwargs

    def test_compression_false_keeps_default(self) -> None:
        kwargs = build_connect_kwargs(_base_params(compression=False), None)

        assert "compression_algs" not in kwargs

    def test_compression_true_requests_zlib(self) -> None:
        kwargs = build_connect_kwargs(_base_params(compression=True), None)

        assert kwargs["compression_algs"] == ["zlib@openssh.com", "zlib"]

    def test_tunnel_none_means_no_tunnel_kwarg(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), None)

        assert "tunnel" not in kwargs

    def test_parent_connection_becomes_the_tunnel(self) -> None:
        parent_conn = MagicMock()

        kwargs = build_connect_kwargs(_base_params(), parent_conn)

        assert kwargs["tunnel"] is parent_conn


class TestBuildConnectKwargsTextDecoding:
    """Every connection replaces a byte that is not UTF-8 instead of refusing it (REQ-4.6.9)."""

    @_MODES
    def test_decode_errors_are_replaced(self, mode: str) -> None:
        kwargs = build_connect_kwargs(_base_params(host_key_verification=mode), None)

        assert kwargs.get("errors") == "replace"

    def test_a_chained_hop_replaces_them_too(self) -> None:
        kwargs = build_connect_kwargs(_base_params(), MagicMock())

        assert kwargs.get("errors") == "replace"

    def test_a_session_on_a_tunnel_port_replaces_them_too(self) -> None:
        params = _base_params(host="127.0.0.1", port=40022)

        kwargs = build_connect_kwargs(params, None, host_key_identity=("far.internal", 22))

        assert kwargs.get("errors") == "replace"


class TestOpenConnection:
    """open_connection - safe asyncssh.connect wrapper."""

    async def test_returns_the_established_connection(self) -> None:
        conn = MagicMock()
        with patch(
            "wavecore.plugins._ssh_session.asyncssh.connect",
            new=AsyncMock(return_value=conn),
        ):
            result = await open_connection(_base_params(), None)

        assert result.connection is conn

    async def test_returns_the_check_that_rules_on_this_connections_later_exchanges(self) -> None:
        with patch(
            "wavecore.plugins._ssh_session.asyncssh.connect",
            new=AsyncMock(return_value=MagicMock()),
        ):
            result = await open_connection(_base_params(host_key_verification="accept-new"), None)

        assert isinstance(result.host_key_check, asyncssh.SSHClient)

    async def test_verification_disabled_means_no_check_to_return(self) -> None:
        with patch(
            "wavecore.plugins._ssh_session.asyncssh.connect",
            new=AsyncMock(return_value=MagicMock()),
        ):
            result = await open_connection(_base_params(host_key_verification="disabled"), None)

        assert result.host_key_check is None

    async def test_connects_with_the_built_kwargs(self) -> None:
        connect_mock = AsyncMock(return_value=MagicMock())
        with patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock):
            await open_connection(_base_params(port=2200), None)

        kwargs = connect_mock.call_args.kwargs
        assert kwargs["host"] == "node-1.example.com"
        assert kwargs["port"] == 2200
        assert kwargs["username"] == "wave"

    async def test_parent_tunnel_reaches_the_connect_call(self) -> None:
        parent_conn = MagicMock()
        connect_mock = AsyncMock(return_value=MagicMock())
        with patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock):
            await open_connection(_base_params(), parent_conn)

        assert connect_mock.call_args.kwargs["tunnel"] is parent_conn

    async def test_failure_raises_safe_connection_error(self) -> None:
        with (
            patch(
                "wavecore.plugins._ssh_session.asyncssh.connect",
                new=AsyncMock(side_effect=OSError("connection refused")),
            ),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1\.example\.com:22 failed: connection refused$",
            ),
        ):
            await open_connection(_base_params(), None)

    async def test_failure_detail_includes_the_explicit_port(self) -> None:
        with (
            patch(
                "wavecore.plugins._ssh_session.asyncssh.connect",
                new=AsyncMock(side_effect=OSError("no route to host")),
            ),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1\.example\.com:2222 failed: no route to host$",
            ),
        ):
            await open_connection(_base_params(port=2222), None)

    async def test_a_wrong_passphrase_that_reads_as_invalid_pem_is_named_as_not_decrypted(
        self,
    ) -> None:
        # A wrong passphrase on a legacy encrypted PEM unpads cleanly about once in 370 tries.
        exported = _exported_key("pkcs1-pem", passphrase="right")
        with (
            _connect_raising_invalid_pem(),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1\.example\.com:22 failed: "
                r"Unable to decrypt PKCS#1 private key$",
            ),
        ):
            await open_connection(_base_params(private_key=exported, passphrase="wrong"), None)

    @pytest.mark.parametrize(
        ("export_format", "passphrase"),
        [("pkcs1-pem", None), ("pkcs8-pem", "right")],
        ids=["unencrypted-legacy-pem", "encrypted-pkcs8"],
    )
    async def test_invalid_pem_keeps_its_reason_outside_a_legacy_encrypted_key(
        self, export_format: str, passphrase: str | None
    ) -> None:
        exported = _exported_key(export_format, passphrase=passphrase)
        with (
            _connect_raising_invalid_pem(),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1\.example\.com:22 failed: "
                r"Invalid PEM private key$",
            ),
        ):
            await open_connection(_base_params(private_key=exported, passphrase="wrong"), None)

    async def test_empty_error_text_falls_back_to_the_exception_class(self) -> None:
        with (
            patch(
                "wavecore.plugins._ssh_session.asyncssh.connect",
                new=AsyncMock(side_effect=ValueError()),
            ),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1\.example\.com:22 failed: ValueError$",
            ),
        ):
            await open_connection(_base_params(), None)

    @pytest.mark.parametrize("mode", ["strict", "accept-new"])
    async def test_an_unreadable_trusted_hosts_list_stops_the_connection(self, mode: str) -> None:
        from wavecore.core.ssh.trusted_hosts import TrustedHostsUnreadable

        ssh_hosts_file().mkdir(parents=True)
        connect_mock = AsyncMock(return_value=MagicMock())

        with (
            patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock),
            pytest.raises(
                (ConnectionError, TrustedHostsUnreadable), match=_unreadable(ssh_hosts_file())
            ),
        ):
            await open_connection(_base_params(host_key_verification=mode), None)

        connect_mock.assert_not_called()


def _endpoint_params(endpoint: SSHEndpoint, mode: str) -> dict[str, Any]:
    """Parameters aimed at the loopback server, under one host-key policy."""
    return {
        "host": "127.0.0.1",
        "port": endpoint.port,
        "username": "wave",
        "password": "s3cr3t-pw",
        "host_key_verification": mode,
    }


async def _open_and_hang_up(params: dict[str, Any], tunnel: Any = None) -> None:
    """Complete a real handshake and hang up at once, so a server never waits on it."""
    conn = (await open_connection(params, tunnel)).connection
    conn.close()
    await conn.wait_closed()


async def _connect_and_close(endpoint: SSHEndpoint, mode: str) -> None:
    """Complete a real handshake against the loopback server and hang up."""
    await _open_and_hang_up(_endpoint_params(endpoint, mode))


def _refused_at(endpoint: SSHEndpoint, detail: str) -> str:
    """The exact refusal for the loopback endpoint as Host and Port name it."""
    return exact(host_key_refusal(f"127.0.0.1:{endpoint.port}", detail))


class TestHostKeyVerificationOverARealHandshake:
    """A mocked connection performs no key exchange, so these drive a real asyncssh server."""

    async def test_accept_new_records_the_key_on_first_contact(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [ssh_endpoint.entry()]
        assert known_hosts_lines() == [
            f"[127.0.0.1]:{ssh_endpoint.port} {_public_line(ssh_endpoint.host_key)}"
        ]
        assert _old_known_hosts_file().exists() is False

    async def test_accept_new_reuses_the_record_on_the_next_connection(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await _connect_and_close(ssh_endpoint, "accept-new")

        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [ssh_endpoint.entry()]

    async def test_two_concurrent_first_contacts_record_the_host_once(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await asyncio.gather(
            _connect_and_close(ssh_endpoint, "accept-new"),
            _connect_and_close(ssh_endpoint, "accept-new"),
        )

        assert trusted_entries() == [ssh_endpoint.entry()]

    async def test_accept_new_refuses_a_host_whose_key_changed(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust(_another_key())

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, KEY_CHANGED)):
            await _connect_and_close(ssh_endpoint, "accept-new")

    async def test_strict_refuses_a_host_it_has_never_seen(self, ssh_endpoint: SSHEndpoint) -> None:
        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

        assert trusted_entries() == []

    async def test_the_strict_refusal_text_is_exact(self, ssh_endpoint: SSHEndpoint) -> None:
        message = (
            f"SSH host key verification failed for 127.0.0.1:{ssh_endpoint.port}: the host is "
            "not in WAVE's trusted hosts list and the host key policy is 'strict'. Add it in "
            "Settings > Network > SSH Hosts"
        )

        with pytest.raises(ConnectionError, match=exact(message)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_strict_accepts_a_host_whose_key_was_recorded(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust()

        await _connect_and_close(ssh_endpoint, "strict")

    async def test_strict_refuses_a_host_whose_key_changed(self, ssh_endpoint: SSHEndpoint) -> None:
        ssh_endpoint.trust(_another_key())

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, KEY_CHANGED)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_the_changed_key_refusal_text_is_exact(self, ssh_endpoint: SSHEndpoint) -> None:
        ssh_endpoint.trust(_another_key())
        message = (
            f"SSH host key verification failed for 127.0.0.1:{ssh_endpoint.port}: the host "
            "offered a key that differs from the one in WAVE's trusted hosts list. Check "
            "Settings > Network > SSH Hosts"
        )

        with pytest.raises(ConnectionError, match=exact(message)):
            await _connect_and_close(ssh_endpoint, "accept-new")

    async def test_disabled_connects_without_checking_or_recording(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await _connect_and_close(ssh_endpoint, "disabled")

        assert trusted_entries() == []

    async def test_disabled_connects_even_when_the_recorded_key_differs(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust(_another_key())

        await _connect_and_close(ssh_endpoint, "disabled")

    async def test_the_accounts_own_known_hosts_file_is_ignored(
        self, ssh_endpoint: SSHEndpoint, server_home: Path
    ) -> None:
        account = server_home / ".ssh"
        account.mkdir()
        line = f"[127.0.0.1]:{ssh_endpoint.port} {_public_line(ssh_endpoint.host_key)}\n"
        (account / "known_hosts").write_text(line, encoding="utf-8")

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_the_old_known_hosts_file_in_the_data_folder_is_ignored(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        old = _old_known_hosts_file()
        old.parent.mkdir(parents=True)
        line = f"[127.0.0.1]:{ssh_endpoint.port} {_public_line(ssh_endpoint.host_key)}\n"
        old.write_text(line, encoding="utf-8")

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_an_unreachable_host_still_reports_a_plain_connection_failure(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        params = _endpoint_params(ssh_endpoint, "accept-new")
        params["host"] = "127.0.0.1"
        params["port"] = 1

        with pytest.raises(ConnectionError, match=r"^SSH connection to 127\.0\.0\.1:1 failed: "):
            await open_connection(params, None)


class TestHostKeyVerificationIsPortSpecific:
    """The same host on port 22 and on the server's own port are two entries (REQ-4.5.14)."""

    async def test_strict_refuses_a_port_with_no_entry_as_not_trusted(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        trust_host("127.0.0.1", 22, ssh_endpoint.host_key)

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

        assert ssh_endpoint.offered_passwords == []

    async def test_accept_new_records_the_port_as_its_own_entry(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        trust_host("127.0.0.1", 22, ssh_endpoint.host_key)

        await _connect_and_close(ssh_endpoint, "accept-new")

        public = _public_line(ssh_endpoint.host_key)
        assert trusted_entries() == [("127.0.0.1", 22, public), ssh_endpoint.entry()]
        assert f"[127.0.0.1]:{ssh_endpoint.port} {public}" in known_hosts_lines()

    async def test_a_different_key_on_port_22_is_no_change_for_another_port(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        trust_host("127.0.0.1", 22, _another_key())

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_accept_new_trusts_the_port_whatever_port_22_holds(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        held = _another_key()
        trust_host("127.0.0.1", 22, held)

        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [("127.0.0.1", 22, _public_line(held)), ssh_endpoint.entry()]


class TestHostKeyVerificationUnderLock:
    """Lock trusted hosts: no block adds a host; Disabled is not affected (REQ-4.5.14)."""

    async def test_accept_new_refuses_an_unknown_host_with_the_lock_text(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        set_lock(True)

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_LOCKED)):
            await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == []

    async def test_the_lock_refusal_text_is_exact(self, ssh_endpoint: SSHEndpoint) -> None:
        set_lock(True)
        message = (
            f"SSH host key verification failed for 127.0.0.1:{ssh_endpoint.port}: the host is "
            "not in WAVE's trusted hosts list and trusted hosts are locked. Add it in "
            "Settings > Network > SSH Hosts"
        )

        with pytest.raises(ConnectionError, match=exact(message)):
            await _connect_and_close(ssh_endpoint, "accept-new")

    async def test_a_trusted_host_still_connects_while_locked(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust()
        set_lock(True)

        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [ssh_endpoint.entry()]

    async def test_a_changed_key_while_locked_gets_the_changed_key_text(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust(_another_key())
        set_lock(True)

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, KEY_CHANGED)):
            await _connect_and_close(ssh_endpoint, "accept-new")

    async def test_strict_while_locked_gets_the_strict_text(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        set_lock(True)

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_STRICT)):
            await _connect_and_close(ssh_endpoint, "strict")

    async def test_disabled_connects_and_records_nothing_while_locked(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        set_lock(True)

        await _connect_and_close(ssh_endpoint, "disabled")

        assert trusted_entries() == []

    async def test_unlocking_lets_the_next_connection_record_the_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        set_lock(True)
        with pytest.raises(ConnectionError):
            await _connect_and_close(ssh_endpoint, "accept-new")
        set_lock(False)

        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [ssh_endpoint.entry()]


class TestTheCredentialNeverReachesAnUnverifiedHost:
    """The refusal has to land during key exchange, before the password goes out."""

    async def test_an_accepted_host_does_receive_the_password(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await _connect_and_close(ssh_endpoint, "accept-new")

        assert ssh_endpoint.offered_passwords == ["s3cr3t-pw"]

    async def test_a_changed_key_is_refused_before_the_password_is_sent(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust(_another_key())

        with pytest.raises(ConnectionError):
            await _connect_and_close(ssh_endpoint, "accept-new")

        assert ssh_endpoint.offered_passwords == []

    async def test_an_unrecorded_host_under_strict_never_sees_the_password(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        with pytest.raises(ConnectionError):
            await _connect_and_close(ssh_endpoint, "strict")

        assert ssh_endpoint.offered_passwords == []


class TestHostKeyVerificationAcrossAChain:
    """A hop carried over a parent connection is verified and recorded the same way."""

    async def test_a_chained_hop_records_the_target_on_first_contact(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        opened = await open_connection(_endpoint_params(ssh_endpoint, "accept-new"), None)
        parent = opened.connection
        try:
            hop = (
                await open_connection(_endpoint_params(ssh_endpoint, "accept-new"), parent)
            ).connection
            hop.close()
            await hop.wait_closed()
        finally:
            parent.close()
            await parent.wait_closed()

        assert trusted_entries() == [ssh_endpoint.entry()]

    async def test_a_chained_hop_is_refused_when_the_recorded_key_differs(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust(_another_key())
        opened = await open_connection(_endpoint_params(ssh_endpoint, "disabled"), None)
        parent = opened.connection
        try:
            with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, KEY_CHANGED)):
                await _open_and_hang_up(_endpoint_params(ssh_endpoint, "accept-new"), parent)
        finally:
            parent.close()
            await parent.wait_closed()

    async def test_a_chained_hop_is_refused_while_locked(self, ssh_endpoint: SSHEndpoint) -> None:
        set_lock(True)
        opened = await open_connection(_endpoint_params(ssh_endpoint, "disabled"), None)
        parent = opened.connection
        try:
            with pytest.raises(
                ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_LOCKED)
            ):
                await _open_and_hang_up(_endpoint_params(ssh_endpoint, "accept-new"), parent)
        finally:
            parent.close()
            await parent.wait_closed()

    async def test_a_chained_hop_ignores_the_accounts_ssh_config(
        self, ssh_endpoint: SSHEndpoint, server_home: Path
    ) -> None:
        _account_config(server_home)
        ssh_endpoint.trust()
        opened = await open_connection(_endpoint_params(ssh_endpoint, "strict"), None)
        parent = opened.connection
        try:
            await _open_and_hang_up(_endpoint_params(ssh_endpoint, "strict"), parent)
        finally:
            parent.close()
            await parent.wait_closed()


def _account_config(home: Path) -> None:
    """An SSH config in the account's home that would send 127.0.0.1 somewhere else."""
    folder = home / ".ssh"
    folder.mkdir(exist_ok=True)
    (folder / "config").write_text("Host 127.0.0.1\n  HostName 127.0.0.2\n", encoding="utf-8")


def _key_login(endpoint: KeyEndpoint) -> dict[str, Any]:
    """Login to the key-only server naming no Private Key and no password."""
    return {
        "host": "127.0.0.1",
        "port": endpoint.port,
        "username": "wave",
        "password": "",
        "host_key_verification": "disabled",
    }


class TestTheAccountsSSHFilesNeverTakePart:
    """A connection logs in only with what its block names, over a real handshake (REQ-4.5.15)."""

    async def test_the_accounts_ssh_config_is_not_read(
        self, ssh_endpoint: SSHEndpoint, server_home: Path
    ) -> None:
        _account_config(server_home)
        ssh_endpoint.trust()

        await _connect_and_close(ssh_endpoint, "strict")

        assert ssh_endpoint.offered_passwords == ["s3cr3t-pw"]

    async def test_the_accounts_default_key_is_never_offered(
        self, key_endpoint: KeyEndpoint, server_home: Path
    ) -> None:
        key = asyncssh.generate_private_key("ssh-ed25519")
        key_endpoint.authorize(key)
        folder = server_home / ".ssh"
        folder.mkdir()
        (folder / "id_ed25519").write_bytes(key.export_private_key("openssh"))

        with pytest.raises(
            ConnectionError,
            match=rf"^SSH connection to 127\.0\.0\.1:{key_endpoint.port} failed: .+$",
        ):
            await _open_and_hang_up(_key_login(key_endpoint))

        assert key_endpoint.offered_keys == []

    async def test_the_accounts_ssh_agent_is_never_asked(
        self,
        key_endpoint: KeyEndpoint,
        tmp_path_factory: pytest.TempPathFactory,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        asked: list[bool] = []

        async def agent(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            asked.append(True)
            writer.close()

        socket_path = tmp_path_factory.mktemp("agent") / "agent.sock"
        server = await asyncio.start_unix_server(agent, path=str(socket_path))
        monkeypatch.setenv("SSH_AUTH_SOCK", str(socket_path))
        try:
            with pytest.raises(
                ConnectionError,
                match=rf"^SSH connection to 127\.0\.0\.1:{key_endpoint.port} failed: .+$",
            ):
                await _open_and_hang_up(_key_login(key_endpoint))
        finally:
            server.close()
            await server.wait_closed()

        assert asked == []
        assert key_endpoint.offered_keys == []


class TestSafeDecode:
    """safe_decode - stdout/stderr normalization."""

    def test_string_passes_through(self) -> None:
        assert safe_decode("hello\n") == "hello\n"

    def test_bytes_decode_as_utf8(self) -> None:
        assert safe_decode("café".encode()) == "café"

    def test_invalid_utf8_does_not_raise(self) -> None:
        result = safe_decode(b"\xff\xfe")

        assert isinstance(result, str)

    def test_none_becomes_empty_string(self) -> None:
        assert safe_decode(None) == ""

    def test_empty_bytes_become_empty_string(self) -> None:
        assert safe_decode(b"") == ""

    def test_non_string_value_is_stringified(self) -> None:
        assert safe_decode(5) == "5"


class TestServerBanner:
    """server_banner - remote identification string."""

    def test_reads_the_server_version_extra_info(self) -> None:
        conn = MagicMock()
        conn.get_extra_info.return_value = "SSH-2.0-OpenSSH_9.6"

        assert server_banner(conn) == "SSH-2.0-OpenSSH_9.6"
        conn.get_extra_info.assert_called_once_with("server_version")

    def test_missing_banner_becomes_empty_string(self) -> None:
        conn = MagicMock()
        conn.get_extra_info.return_value = None

        assert server_banner(conn) == ""


class TestRequireSession:
    """require_session - shared lookup-or-raise for the SSH session family."""

    def test_returns_the_live_session_record(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        registry.register("ssh_session_live", conn, None, "node-1", None, None, connect_timeout=30)

        record = require_session(registry, "ssh_session_live")

        assert record is registry.get("ssh_session_live")
        assert record["connection"] is conn

    def test_unknown_session_raises_the_canonical_message(self) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_missing' not found or already closed$",
        ):
            require_session(registry, "ssh_session_missing")

    def test_closed_session_raises(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "ssh_session_gone", MagicMock(), None, "node-1", None, None, connect_timeout=30
        )
        registry.close("ssh_session_gone")

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_gone' not found or already closed$",
        ):
            require_session(registry, "ssh_session_gone")

    def test_missing_registry_raises(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_x' not found or already closed$",
        ):
            require_session(None, "ssh_session_x")

    def test_custom_label_is_used_in_the_message(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Parent SSH session 'ssh_session_parent' not found or already closed$",
        ):
            require_session(None, "ssh_session_parent", label="Parent SSH session")

    def test_custom_label_still_returns_the_record(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "ssh_session_parent", MagicMock(), None, "node-1", None, None, connect_timeout=30
        )

        record = require_session(registry, "ssh_session_parent", label="Parent SSH session")

        assert record is registry.get("ssh_session_parent")


_TIMED_OUT = r"^Command execution timed out after 0\.5 seconds$"


async def _never_finishes(*_args: Any, **_kwargs: Any) -> Any:
    """Hangs until the caller's timeout cancels it, which is how a real timeout arrives."""
    await asyncio.sleep(3600)


async def _poll_until(predicate: Callable[[], bool]) -> None:
    """Wait for a background task to reach a state, so a spec never races it."""
    for _ in range(500):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the awaited condition never became true")


def _hanging_connection() -> tuple[MagicMock, MagicMock, asyncio.Event]:
    """A connection whose started command never exits, plus an event set once it is running."""
    running = asyncio.Event()

    async def waits_forever(*_args: Any, **_kwargs: Any) -> Any:
        running.set()
        await asyncio.sleep(3600)

    process = MagicMock()
    process.stdin = MagicMock()
    process.wait = AsyncMock(side_effect=waits_forever)
    connection = MagicMock()
    connection.create_process = AsyncMock(return_value=process)
    return connection, process, running


def _slow_to_open_connection() -> tuple[MagicMock, MagicMock, asyncio.Event]:
    """A connection that takes 0.3s to hand the channel over, plus a released event."""
    released = asyncio.Event()
    process = MagicMock()
    process.stdin = MagicMock()
    process.wait = AsyncMock(side_effect=_never_finishes)
    process.close.side_effect = released.set
    connection = MagicMock()
    connection.opening = asyncio.Event()

    async def slow_create(_command: str) -> Any:
        connection.opening.set()
        await asyncio.sleep(0.3)
        return process

    connection.create_process = slow_create
    return connection, process, released


def _released_calls(process: MagicMock) -> list[str]:
    """The release calls made on the process, in order."""
    names = [name for name, _args, _kwargs in process.method_calls]
    return [name for name in names if name in ("kill", "close")]


class TestCommandTimedOut:
    """The wording both SSH session Blocks report when a command outlives its Timeout."""

    def test_a_one_second_bound_is_named_in_the_singular(self) -> None:
        assert str(command_timed_out(1)) == "Command execution timed out after 1 second"

    def test_any_other_bound_is_named_in_the_plural(self) -> None:
        assert str(command_timed_out(2)) == "Command execution timed out after 2 seconds"


class TestRunWithTimeout:
    """run_with_timeout - a real timeout must stop the remote command and free the slot."""

    async def test_signals_the_command_then_closes_the_channel(self) -> None:
        connection, process, _running = _hanging_connection()

        with pytest.raises(TimeoutError, match=_TIMED_OUT):
            await run_with_timeout(connection, "sleep 100", 0.5)

        assert _released_calls(process) == ["kill", "close"]

    async def test_a_refused_signal_still_closes_the_channel(self) -> None:
        connection, process, _running = _hanging_connection()
        process.kill.side_effect = asyncssh.ConnectionLost("Connection lost")

        with pytest.raises(TimeoutError, match=_TIMED_OUT):
            await run_with_timeout(connection, "sleep 100", 0.5)

        assert process.close.called is True

    async def test_a_failing_close_does_not_replace_the_timeout(self) -> None:
        connection, process, _running = _hanging_connection()
        process.close.side_effect = asyncssh.ConnectionLost("Connection lost")

        with pytest.raises(TimeoutError, match=_TIMED_OUT):
            await run_with_timeout(connection, "sleep 100", 0.5)

    async def test_a_channel_that_never_opened_has_nothing_to_release(self) -> None:
        connection = MagicMock()
        connection.create_process = AsyncMock(side_effect=asyncssh.ConnectionLost("Channel gone"))

        with pytest.raises(asyncssh.ConnectionLost, match=r"^Channel gone$"):
            await run_with_timeout(connection, "sleep 100", 0.5)

    async def test_a_timeout_during_channel_creation_still_releases_the_channel(self) -> None:
        connection, process, released = _slow_to_open_connection()

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 0\.1 seconds$"):
            await run_with_timeout(connection, "sleep 100", 0.1)

        gc.collect()  # the abandoned creation must survive collection to be released
        await asyncio.wait_for(released.wait(), timeout=10)
        assert process.kill.called is True


class TestRunWithTimeoutUnderCancellation:
    """Immediate Stop cancels the task; the channel is released without the stop waiting."""

    async def test_cancellation_signals_the_command_and_closes_the_channel(self) -> None:
        connection, process, running = _hanging_connection()
        task = asyncio.create_task(run_with_timeout(connection, "sleep 100", 3600))
        await asyncio.wait_for(running.wait(), timeout=10)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=10)

        assert _released_calls(process) == ["kill", "close"]

    async def test_cancellation_never_waits_on_the_channel_or_the_remote(self) -> None:
        connection, process, running = _hanging_connection()
        process.wait_closed = AsyncMock(side_effect=_never_finishes)
        task = asyncio.create_task(run_with_timeout(connection, "sleep 100", 3600))
        await asyncio.wait_for(running.wait(), timeout=10)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=10)

        assert process.wait_closed.await_count == 0
        assert process.wait.await_count == 1

    async def test_cancellation_during_channel_creation_still_releases_the_channel(self) -> None:
        connection, process, released = _slow_to_open_connection()
        task = asyncio.create_task(run_with_timeout(connection, "sleep 100", 3600))
        await asyncio.wait_for(connection.opening.wait(), timeout=10)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=10)

        gc.collect()  # the abandoned creation must survive collection to be released
        await asyncio.wait_for(released.wait(), timeout=10)
        assert process.kill.called is True


class TestRunWithTimeoutAgainstARealSSHChannel:
    """Drives a real asyncssh channel, where a mocked connection cannot reach the cleanup."""

    async def test_output_and_exit_code_come_back_over_a_real_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        async def reports_and_exits(process: Any) -> None:
            process.stdout.write("hello\n")
            process.stderr.write("warn\n")
            process.exit(3)

        async with loopback_ssh(reports_and_exits) as conn:
            result = await run_with_timeout(conn, "report", 30)

        assert (result.stdout, result.stderr, result.exit_status) == ("hello\n", "warn\n", 3)

    async def test_timeout_signals_the_remote_and_closes_the_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = RecordsTheProcess(conn)

            with pytest.raises(TimeoutError, match=_TIMED_OUT):
                await run_with_timeout(recorder, "report", 0.5)

            await watcher.assert_killed_and_closed(recorder)

    async def test_cancellation_signals_the_remote_and_closes_the_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = RecordsTheProcess(conn)
            task = asyncio.create_task(run_with_timeout(recorder, "report", 3600))
            await _poll_until(lambda: recorder.process is not None)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=10)

            await watcher.assert_killed_and_closed(recorder)

    async def test_a_timeout_before_the_channel_is_handed_over_still_releases_it(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = SlowToHandOver(conn)

            with pytest.raises(
                TimeoutError, match=r"^Command execution timed out after 0\.1 seconds$"
            ):
                await run_with_timeout(recorder, "report", 0.1)

            assert recorder.opened.is_set() is True
            await watcher.assert_killed_and_closed(recorder)

    async def test_cancellation_before_the_channel_is_handed_over_still_releases_it(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = SlowToHandOver(conn)
            task = asyncio.create_task(run_with_timeout(recorder, "report", 3600))
            await asyncio.wait_for(recorder.opened.wait(), timeout=10)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=10)

            await watcher.assert_killed_and_closed(recorder)


_REPLACED_OUTPUT = ("Grüße \ufffd\n", "cafe\ufffd\n", 0)


async def _prints_bytes_that_are_not_utf8(process: Any) -> None:
    """A remote command whose two streams each hold one byte that is not UTF-8."""
    process.stdout.write("Grüße ".encode() + b"\xff\n")
    process.stderr.write(b"cafe\xe9\n")
    process.exit(0)


@asynccontextmanager
async def _connected_as_wave_connects(handler: ProcessHandler) -> AsyncIterator[Any]:
    """A live connection opened with build_connect_kwargs, to a server that writes raw bytes."""
    async with ssh_server(NoAuthServer, process_factory=handler, encoding=None) as port:
        params = {
            "host": "127.0.0.1",
            "port": port,
            "username": "wave",
            "host_key_verification": "disabled",
        }
        async with asyncssh.connect(**build_connect_kwargs(params, None)) as conn:
            yield conn


# Each test starts a real loopback SSH server and channel.
class TestOutputThatIsNotUTF8AgainstARealSSHChannel:
    """A byte that is not UTF-8 shows as U+FFFD and the session stays usable (REQ-4.6.9)."""

    async def test_the_stray_byte_comes_back_as_the_replacement_character(self) -> None:
        async with _connected_as_wave_connects(_prints_bytes_that_are_not_utf8) as conn:
            result = await run_with_timeout(conn, "report", 30)

        assert (result.stdout, result.stderr, result.exit_status) == _REPLACED_OUTPUT

    async def test_the_session_runs_its_next_command(self) -> None:
        async with _connected_as_wave_connects(_prints_bytes_that_are_not_utf8) as conn:
            await run_with_timeout(conn, "report", 30)
            result = await run_with_timeout(conn, "report", 30)

        assert (result.stdout, result.stderr, result.exit_status) == _REPLACED_OUTPUT


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _tunnel_session(connection: Any) -> dict[str, Any]:
    """A live session record riding `connection`, as the registry holds it."""
    registry = SSHSessionRegistry()
    registry.register(
        "ssh_session_tunnel", connection, None, "bastion.internal", None, None, connect_timeout=30
    )
    return require_session(registry, "ssh_session_tunnel")


class _GatedChannelOpen:
    """An SSH connection whose channel open waits on a gate, then hands over its writer."""

    def __init__(self) -> None:
        self.gate, self.opening, self.closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        self.handed_over = False
        self.writer = MagicMock()
        self.writer.close.side_effect = self.closed.set
        self.connection = MagicMock(open_connection=AsyncMock(side_effect=self._open))

    async def _open(self, _host: str, _port: int) -> tuple[Any, Any]:
        self.opening.set()
        await self.gate.wait()
        self.handed_over = True
        return MagicMock(), self.writer


class TestOpenTunnelChannel:
    """open_tunnel_channel - a cancel-safe TCP channel to a tunnel's far end (NETCAT-9)."""

    async def test_opens_the_channel_on_the_session_connection(self) -> None:
        """The far host and port go positionally to the asyncssh connection."""
        reader, writer = MagicMock(), MagicMock()
        connection = MagicMock(open_connection=AsyncMock(return_value=(reader, writer)))

        opened = await _ssh_session.open_tunnel_channel(
            _tunnel_session(connection), "db.internal.net", 5432
        )

        opened_reader, opened_writer = opened
        assert opened_reader is reader
        assert opened_writer is writer
        assert connection.open_connection.call_args.args == ("db.internal.net", 5432)
        assert writer.close.call_count == 0

    @pytest.mark.parametrize(
        ("code", "reason"),
        [(2, "Connection refused"), (1, "Port forwarding not permitted")],
        ids=["connect failed", "administratively prohibited"],
    )
    async def test_a_refused_channel_carries_the_ssh_server_reason(
        self, code: int, reason: str
    ) -> None:
        """Any ChannelOpenError becomes a refusal whose text is the server's reason."""
        connection = MagicMock(
            open_connection=AsyncMock(side_effect=asyncssh.ChannelOpenError(code, reason))
        )

        with pytest.raises(ConnectionRefusedError, match=exact(reason)) as refused:
            await _ssh_session.open_tunnel_channel(
                _tunnel_session(connection), "db.internal.net", 5432
            )

        assert refused.value.errno is None
        assert isinstance(refused.value.__cause__, asyncssh.ChannelOpenError)

    async def test_a_timeout_releases_the_channel_once_it_opens(self) -> None:
        """The caller's bound ends the open, and the late channel is closed once (NETCAT-6)."""
        gated = _GatedChannelOpen()

        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.05):
                await _ssh_session.open_tunnel_channel(
                    _tunnel_session(gated.connection), "db.internal.net", 5432
                )

        assert gated.writer.close.call_count == 0
        gated.gate.set()
        await asyncio.wait_for(gated.closed.wait(), 1)
        assert gated.writer.close.call_count == 1

    async def test_a_cancel_while_opening_never_waits_and_releases_the_channel(self) -> None:
        """Stop ends the open at once; the late channel is closed once it opens (NETCAT-6)."""
        gated = _GatedChannelOpen()
        task = asyncio.create_task(
            _ssh_session.open_tunnel_channel(
                _tunnel_session(gated.connection), "db.internal.net", 5432
            )
        )
        await asyncio.wait_for(gated.opening.wait(), 1)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)

        assert task.done() is True
        assert gated.handed_over is False
        assert gated.writer.close.call_count == 0
        gated.gate.set()
        await asyncio.wait_for(gated.closed.wait(), 1)
        assert gated.writer.close.call_count == 1


LOST = "Connection lost"


def _channel(reader: Any = None, writer: Any = None) -> MagicMock:
    """An SSH connection whose channel open hands over `reader` and `writer`."""
    reader = MagicMock(read=AsyncMock(return_value=b"")) if reader is None else reader
    writer = MagicMock(drain=AsyncMock()) if writer is None else writer
    return MagicMock(open_connection=AsyncMock(return_value=(reader, writer)))


async def _open_stream(connection: Any) -> tuple[Any, Any]:
    return await _ssh_session.open_tunnel_stream(
        _tunnel_session(connection), "db.internal.net", 5432
    )


class TestOpenTunnelStream:
    """open_tunnel_stream - a tunnel channel whose lost SSH connection is a reset (NETCAT-9)."""

    async def test_the_streams_carry_the_channel_traffic(self) -> None:
        reader = MagicMock(read=AsyncMock(return_value=b"pong"))
        writer = MagicMock(drain=AsyncMock())

        stream_reader, stream_writer = await _open_stream(_channel(reader, writer))
        stream_writer.write(b"ping")
        await stream_writer.drain()
        stream_writer.write_eof()
        received = await stream_reader.read(1024)
        stream_writer.close()

        assert received == b"pong"
        assert reader.read.await_args_list == [((1024,),)]
        assert writer.write.call_args_list == [((b"ping",),)]
        assert (writer.drain.await_count, writer.write_eof.call_count) == (1, 1)
        assert writer.close.call_count == 1

    @pytest.mark.parametrize(
        ("side", "method", "call"),
        [
            ("reader", "read", lambda stream: stream[0].read(1024)),
            ("writer", "write", lambda stream: stream[1].write(b"ping")),
            ("writer", "drain", lambda stream: stream[1].drain()),
            ("writer", "write_eof", lambda stream: stream[1].write_eof()),
        ],
        ids=["read", "write", "drain", "write_eof"],
    )
    @pytest.mark.parametrize(
        "failure",
        [lambda: asyncssh.ConnectionLost(LOST), lambda: asyncssh.DisconnectError(11, LOST)],
        ids=["connection lost", "disconnected"],
    )
    async def test_an_ssh_failure_becomes_a_reset_with_the_library_words(
        self,
        side: str,
        method: str,
        call: Callable[[Any], Any],
        failure: Callable[[], Exception],
    ) -> None:
        error = failure()
        failing = MagicMock()
        kind = AsyncMock if method in ("read", "drain") else MagicMock
        setattr(failing, method, kind(side_effect=error))
        stream = await _open_stream(_channel(**{side: failing}))

        with pytest.raises(ConnectionResetError, match=exact(LOST)) as reset:
            outcome = call(stream)
            if asyncio.iscoroutine(outcome):
                await outcome

        assert reset.value.errno is None
        assert reset.value.__cause__ is error

    async def test_close_aborts_the_channel_so_unsent_data_never_holds_it_open(self) -> None:
        """asyncssh's own close waits for the far end to take buffered data (NETCAT-6)."""
        writer = MagicMock(drain=AsyncMock())
        _, stream_writer = await _open_stream(_channel(writer=writer))

        stream_writer.close()

        assert [name for name, _, _ in writer.mock_calls] == ["channel.abort", "close"]

    async def test_an_os_error_passes_through_unchanged(self) -> None:
        broken = BrokenPipeError("Channel not open for sending")
        writer = MagicMock(write=MagicMock(side_effect=broken))
        _, stream_writer = await _open_stream(_channel(writer=writer))

        with pytest.raises(BrokenPipeError) as raised:
            stream_writer.write(b"ping")

        assert raised.value is broken

    async def test_a_connection_lost_before_the_channel_opens_is_a_reset(self) -> None:
        """Any SSH failure but a refusal closes the port with the library's words."""
        lost = asyncssh.ConnectionLost(LOST)
        connection = MagicMock(open_connection=AsyncMock(side_effect=lost))

        with pytest.raises(ConnectionResetError, match=exact(LOST)) as reset:
            await _ssh_session.open_tunnel_channel(
                _tunnel_session(connection), "db.internal.net", 5432
            )

        assert reset.value.errno is None
        assert reset.value.__cause__ is lost

    async def test_a_refused_channel_is_still_a_refusal(self) -> None:
        refused = asyncssh.ChannelOpenError(2, "Connection refused")
        connection = MagicMock(open_connection=AsyncMock(side_effect=refused))

        with pytest.raises(ConnectionRefusedError, match=exact("Connection refused")):
            await _open_stream(connection)


FAR_DB = ("db.internal.net", 5432)
GREETING = b"220 db ready\r\n"


@asynccontextmanager
async def _destination(greeting: bytes = b"", hang_up: bool = False) -> AsyncIterator[int]:
    """A loopback TCP destination (yields its port) that greets, then hangs up or awaits EOF."""

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        with suppress(ConnectionError):
            writer.write(greeting)
            await writer.drain()
            if not hang_up:
                await reader.read()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        await server.wait_closed()


class _SeesEOF(asyncio.StreamReaderProtocol):
    """A stream protocol that sets `eof` once the far end's EOF has arrived."""

    def __init__(self, reader: asyncio.StreamReader) -> None:
        super().__init__(reader)
        self.eof = asyncio.Event()

    def eof_received(self) -> bool:
        keep_open = bool(super().eof_received())
        self.eof.set()
        return keep_open


class _FarEnd(NamedTuple):
    reader: asyncio.StreamReader
    writer: WriterProbe
    eof: asyncio.Event


class _FarEnds:
    """An SSH connection stand-in whose channels are loopback sockets that report their EOF."""

    def __init__(self, port: int) -> None:
        self.port = port
        self.channels: list[_FarEnd] = []
        self.opens: list[tuple[bool, ...]] = []
        self.connection = MagicMock(open_connection=AsyncMock(side_effect=self._open))
        self.connection.is_closed.return_value = False

    async def _open(self, _host: str, _port: int) -> tuple[Any, Any]:
        # Each open notes which earlier channels were already closed, to pin the order.
        self.opens.append(tuple(channel.writer.closed.is_set() for channel in self.channels))
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        protocol = _SeesEOF(reader)
        transport, _ = await loop.create_connection(lambda: protocol, "127.0.0.1", self.port)
        writer = WriterProbe(asyncio.StreamWriter(transport, protocol, reader, loop))
        self.channels.append(_FarEnd(reader, writer, protocol.eof))
        return reader, writer

    async def far_end_closed(self, index: int = 0) -> _FarEnd:
        """The channel once its far end's EOF has arrived (1 s bound)."""
        await asyncio.wait_for(self.channels[index].eof.wait(), 1)
        return self.channels[index]


async def _hang_up(writers: list[WriterProbe]) -> None:
    """Close every channel a stand-in opened and wait until each socket is closed."""
    for writer in writers:
        writer.close()
        with suppress(ConnectionError):
            await writer.wait_closed()


async def _hold(registry: SSHSessionRegistry) -> tuple[tuple[Any, Any], dict[str, Any]]:
    """Open a pair as Validate Target does and hold it on tunnel 't1'; returns (pair, tunnel)."""
    record = require_session(registry, SESSION_ID)
    held = await _ssh_session.open_tunnel_stream(record, *FAR_DB)
    registry.add_tunnel(SESSION_ID, "t1", MagicMock(), 19446, "db.internal.net:5432", held=held)
    return held, record["tunnels"]["t1"]


class TestOpenTunnelStreamWithNothingHeld:
    """open_tunnel_stream - with no tunnel, or a tunnel holding nothing, a fresh channel opens."""

    @pytest.mark.parametrize("tunnel", ["omitted", None], ids=["omitted", "none"])
    async def test_no_tunnel_opens_a_fresh_channel(self, tunnel: Any) -> None:
        async with _destination() as port:
            connection = channel_connection(port)
            record = require_session(tunnel_session(connection), SESSION_ID)
            try:
                if tunnel == "omitted":
                    await _ssh_session.open_tunnel_stream(record, *FAR_DB)
                else:
                    await _ssh_session.open_tunnel_stream(record, *FAR_DB, tunnel=tunnel)

                assert connection.open_connection.await_args_list == [call(*FAR_DB)]
                assert connection.channels.closed() == [False]
            finally:
                await _hang_up(connection.channels.writers)

    async def test_a_tunnel_holding_nothing_opens_a_fresh_channel(self) -> None:
        async with _destination() as port:
            connection = channel_connection(port)
            registry = tunnel_session(connection)
            registry.add_tunnel(SESSION_ID, "t1", MagicMock(), 19446, "db.internal.net:5432")
            record = require_session(registry, SESSION_ID)
            try:
                await _ssh_session.open_tunnel_stream(
                    record, *FAR_DB, tunnel=record["tunnels"]["t1"]
                )

                assert connection.open_connection.await_args_list == [call(*FAR_DB)]
                assert record["tunnels"]["t1"]["held"] is None
            finally:
                await _hang_up(connection.channels.writers)


class TestOpenTunnelStreamTakesTheHeldPair:
    """open_tunnel_stream - the first client takes the pair Validate Target holds (SSHTUN-7)."""

    async def test_an_open_held_pair_is_handed_over_without_a_new_channel(self) -> None:
        async with _destination() as port:
            connection = channel_connection(port)
            registry = tunnel_session(connection)
            try:
                held, tunnel = await _hold(registry)

                taken = await _ssh_session.open_tunnel_stream(
                    require_session(registry, SESSION_ID), *FAR_DB, tunnel=tunnel
                )

                assert taken[0] is held[0]
                assert taken[1] is held[1]
                assert connection.open_connection.await_count == 1
                assert tunnel["held"] is None
                assert connection.channels.closed() == [False]
            finally:
                await _hang_up(connection.channels.writers)

    async def test_the_pair_is_taken_once_and_the_next_client_gets_a_fresh_channel(self) -> None:
        async with _destination() as port:
            connection = channel_connection(port)
            registry = tunnel_session(connection)
            record = require_session(registry, SESSION_ID)
            try:
                held, tunnel = await _hold(registry)
                await _ssh_session.open_tunnel_stream(record, *FAR_DB, tunnel=tunnel)

                fresh = await _ssh_session.open_tunnel_stream(record, *FAR_DB, tunnel=tunnel)

                assert fresh[0] is not held[0]
                assert fresh[1] is not held[1]
                assert connection.open_connection.await_count == 2
                assert tunnel["held"] is None
                assert connection.channels.closed() == [False, False]
            finally:
                await _hang_up(connection.channels.writers)

    async def test_a_held_pair_whose_far_end_closed_is_closed_before_a_fresh_one_opens(
        self,
    ) -> None:
        async with _destination(hang_up=True) as port:
            far = _FarEnds(port)
            registry = tunnel_session(far.connection)
            try:
                held, tunnel = await _hold(registry)
                assert (await far.far_end_closed()).reader.at_eof() is True

                fresh = await _ssh_session.open_tunnel_stream(
                    require_session(registry, SESSION_ID), *FAR_DB, tunnel=tunnel
                )

                assert far.opens == [(), (True,)]
                assert fresh[0] is not held[0]
                assert fresh[1] is not held[1]
                assert len(far.channels) == 2
                assert tunnel["held"] is None
            finally:
                await _hang_up([channel.writer for channel in far.channels])

    async def test_bytes_sent_before_the_far_end_closed_still_reach_the_first_client(
        self,
    ) -> None:
        async with _destination(GREETING, hang_up=True) as port:
            far = _FarEnds(port)
            registry = tunnel_session(far.connection)
            try:
                held, tunnel = await _hold(registry)
                assert (await far.far_end_closed()).reader.at_eof() is False

                taken = await _ssh_session.open_tunnel_stream(
                    require_session(registry, SESSION_ID), *FAR_DB, tunnel=tunnel
                )

                assert taken[0] is held[0]
                assert taken[1] is held[1]
                assert far.opens == [()]
                assert tunnel["held"] is None
                assert await taken[0].read(1024) == GREETING
                assert await taken[0].read(1024) == b""
                assert far.channels[0].writer.closed.is_set() is False
            finally:
                await _hang_up([channel.writer for channel in far.channels])

    async def test_a_refusal_after_a_closed_held_pair_keeps_its_cause(self) -> None:
        """The held pair is still closed, and the refusal reads as any other."""
        async with _destination(hang_up=True) as port:
            far = _FarEnds(port)
            registry = tunnel_session(far.connection)
            refusal = asyncssh.ChannelOpenError(2, "Connection refused")
            try:
                _, tunnel = await _hold(registry)
                await far.far_end_closed()
                far.connection.open_connection.side_effect = refusal

                with pytest.raises(
                    ConnectionRefusedError, match=exact("Connection refused")
                ) as refused:
                    await _ssh_session.open_tunnel_stream(
                        require_session(registry, SESSION_ID), *FAR_DB, tunnel=tunnel
                    )

                assert refused.value.__cause__ is refusal
                assert far.channels[0].writer.closed.is_set() is True
                assert tunnel["held"] is None
            finally:
                await _hang_up([channel.writer for channel in far.channels])


class TestTunnelReaderAtEOF:
    """_TunnelReader.at_eof - EOF received and nothing left unread, as the wrapped reader says."""

    @pytest.mark.parametrize("at_eof", [True, False])
    def test_the_wrapped_reader_answers(self, at_eof: bool) -> None:
        wrapped = MagicMock()
        wrapped.at_eof.return_value = at_eof

        assert _ssh_session._TunnelReader(wrapped).at_eof() is at_eof
        wrapped.at_eof.assert_called_once_with()

    async def test_unread_bytes_keep_it_false_until_they_are_read(self) -> None:
        wrapped = asyncio.StreamReader()
        wrapped.feed_data(GREETING)
        wrapped.feed_eof()
        reader = _ssh_session._TunnelReader(wrapped)

        assert reader.at_eof() is False
        assert await reader.read(1024) == GREETING
        assert reader.at_eof() is True


TUNNEL_LOCAL_PORT = 15432


def _tunnels(tunnels: dict[int, str]) -> SSHSessionRegistry:
    """One open session holding a tunnel per local port -> remote destination."""
    return tunnel_registry(tunnels, MagicMock())


class TestResolveTunnel:
    """resolve_tunnel - a loopback Host on a tunnel's Local Port routes through it (SQL-15)."""

    def test_the_route_is_a_named_tuple_of_record_far_end_and_tunnel(self) -> None:
        assert _ssh_session.TunnelRoute._fields == ("record", "far_host", "far_port", "tunnel")

    def test_the_route_carries_the_tunnel_record_itself(self) -> None:
        """So a Netcat block on the Local Port can take the pair the tunnel holds (SSHTUN-7)."""
        registry = _tunnels(
            {TUNNEL_LOCAL_PORT: "db.internal:5432", TUNNEL_LOCAL_PORT + 1: "cache.internal:6379"}
        )

        route = _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT + 1, registry)

        assert route is not None
        record = registry.get(TUNNEL_SESSION)
        assert record is not None
        assert route.tunnel is record["tunnels"][f"t{TUNNEL_LOCAL_PORT + 1}"]

    @pytest.mark.parametrize(
        "host", ["127.0.0.1", "localhost", "  localhost  "], ids=["address", "name", "trimmed"]
    )
    def test_a_loopback_host_on_a_tunnel_port_routes_to_the_far_end(self, host: str) -> None:
        registry = _tunnels({TUNNEL_LOCAL_PORT: "db.internal:5432"})

        route = _ssh_session.resolve_tunnel(host, TUNNEL_LOCAL_PORT, registry)

        assert isinstance(route, _ssh_session.TunnelRoute)
        assert route.record is registry.get(TUNNEL_SESSION)
        assert (route.far_host, route.far_port) == ("db.internal", 5432)
        assert type(route.far_port) is int

    def test_an_ipv6_far_host_splits_on_the_last_colon(self) -> None:
        registry = _tunnels({TUNNEL_LOCAL_PORT: "fd00::5:5432"})

        route = _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT, registry)

        assert route is not None
        assert (route.far_host, route.far_port) == ("fd00::5", 5432)

    def test_the_tunnel_on_the_given_port_is_the_one_chosen(self) -> None:
        registry = _tunnels(
            {TUNNEL_LOCAL_PORT: "db.internal:5432", TUNNEL_LOCAL_PORT + 1: "cache.internal:6379"}
        )

        route = _ssh_session.resolve_tunnel("localhost", TUNNEL_LOCAL_PORT + 1, registry)

        assert route is not None
        assert (route.far_host, route.far_port) == ("cache.internal", 6379)

    @pytest.mark.parametrize(
        "host",
        ["db.example", "127.0.0.2", "10.0.0.5", ""],
        ids=["name", "other loopback", "ip", "empty"],
    )
    def test_a_host_that_is_not_loopback_has_no_route(self, host: str) -> None:
        registry = _tunnels({TUNNEL_LOCAL_PORT: "db.internal:5432"})

        assert _ssh_session.resolve_tunnel(host, TUNNEL_LOCAL_PORT, registry) is None

    def test_no_registry_means_no_route(self) -> None:
        assert _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT, None) is None

    def test_a_port_with_no_tunnel_has_no_route(self) -> None:
        registry = _tunnels({TUNNEL_LOCAL_PORT: "db.internal:5432"})

        assert _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT + 1, registry) is None

    def test_a_closed_tunnel_has_no_route(self) -> None:
        registry = _tunnels({TUNNEL_LOCAL_PORT: "db.internal:5432"})
        assert registry.close_tunnel(f"t{TUNNEL_LOCAL_PORT}") is True

        assert _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT, registry) is None

    def test_a_registry_with_no_session_has_no_route(self) -> None:
        assert (
            _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT, SSHSessionRegistry())
            is None
        )

    def test_the_lookup_opens_nothing_on_the_ssh_connection(self) -> None:
        connection = MagicMock()
        registry = tunnel_registry({TUNNEL_LOCAL_PORT: "db.internal:5432"}, connection)

        _ssh_session.resolve_tunnel("127.0.0.1", TUNNEL_LOCAL_PORT, registry)

        assert connection.mock_calls == []


FAR_HOST = "far.internal"
LOCAL_PORT = 40022


def _route(far_host: str, far_port: int) -> Any:
    """The route resolve_tunnel gives for a tunnel on LOCAL_PORT forwarding to far_host:far_port."""
    registry = tunnel_registry({LOCAL_PORT: f"{far_host}:{far_port}"}, MagicMock())
    route = _ssh_session.resolve_tunnel("127.0.0.1", LOCAL_PORT, registry)
    assert route is not None
    return route


class TestHostKeyIdentity:
    """host_key_identity - the far host and port a tunnel session's host key is kept under."""

    @pytest.mark.parametrize(
        ("far_host", "far_port"),
        [(FAR_HOST, 22), (FAR_HOST, 2222), ("10.0.0.9", 22), ("fd00::5", 5432)],
        ids=["name", "name and port", "address", "ipv6"],
    )
    def test_the_identity_is_the_far_host_and_port(self, far_host: str, far_port: int) -> None:
        route = _route(far_host, far_port)

        assert _ssh_session.host_key_identity(route) == (far_host, far_port)

    @pytest.mark.parametrize("far_host", ["127.0.0.1", "localhost", "::1"])
    @pytest.mark.parametrize("far_port", [22, 2200])
    def test_a_loopback_far_host_is_the_tunnel_sessions_own_host(
        self, far_host: str, far_port: int
    ) -> None:
        route = _route(far_host, far_port)

        assert _ssh_session.host_key_identity(route) == (SSH_HOST, far_port)

    def test_a_loopback_far_end_on_a_session_opened_through_a_tunnel_is_its_far_host(
        self,
    ) -> None:
        registry = tunnel_registry({LOCAL_PORT: f"{FAR_HOST}:22"}, MagicMock())
        first = _ssh_session.resolve_tunnel("127.0.0.1", LOCAL_PORT, registry)
        assert first is not None
        far_host, _far_port = _ssh_session.host_key_identity(first)
        registry.register(
            "inner",
            MagicMock(),
            None,
            "127.0.0.1",
            None,
            None,
            connect_timeout=30,
            host_identity=far_host,
        )
        registry.add_tunnel("inner", "t-inner", MagicMock(), LOCAL_PORT + 1, "127.0.0.1:2200")

        second = _ssh_session.resolve_tunnel("127.0.0.1", LOCAL_PORT + 1, registry)
        assert second is not None

        assert _ssh_session.host_key_identity(second) == (FAR_HOST, 2200)


class TestHostKeyTarget:
    """host_key_target - what a host key refusal names."""

    def test_an_identity_names_the_far_host_through_the_tunnel(self) -> None:
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT)

        assert _ssh_session.host_key_target(params, (FAR_HOST, 2222)) == (
            f"{FAR_HOST}:2222 through the SSH tunnel on 127.0.0.1:{LOCAL_PORT}"
        )

    def test_no_identity_names_the_host_and_port_as_given(self) -> None:
        params = _base_params(port=2222)

        assert _ssh_session.host_key_target(params, None) == "node-1.example.com:2222"

    @pytest.mark.parametrize("blank", ["absent", None, ""], ids=["absent", "none", "empty"])
    def test_a_blank_port_is_22(self, blank: Any) -> None:
        params = _base_params(host="localhost")
        if blank != "absent":
            params["port"] = blank

        assert _ssh_session.host_key_target(params, None) == "localhost:22"
        assert _ssh_session.host_key_target(params, (FAR_HOST, 22)) == (
            f"{FAR_HOST}:22 through the SSH tunnel on localhost:22"
        )


class TestTrustNothing:
    """_trust_nothing - under an identity asyncssh trusts no record by itself."""

    @pytest.mark.parametrize("port", [LOCAL_PORT, 22, None])
    def test_no_host_ca_or_revoked_keys_are_returned(self, port: int | None) -> None:
        assert _ssh_session._trust_nothing("127.0.0.1", "127.0.0.1", port) == ([], [], [])


def _identity_check(mode: str, identity: tuple[str, int]) -> Any:
    """The check for a session on LOCAL_PORT whose host key belongs to `identity`."""
    return _ssh_session._HostKeyCheck(mode == "accept-new", identity)


def _offered_on_the_local_port(check: Any, key: Any) -> bool:
    """asyncssh offers the key under the address and port it actually connected to."""
    accepted: bool = check.validate_host_public_key("127.0.0.1", "127.0.0.1", LOCAL_PORT, key)
    return accepted


class TestHostKeyCheckUnderAnIdentity:
    """_HostKeyCheck with an identity rules on the far host and port, never the loopback port."""

    def test_first_contact_is_recorded_under_the_far_host(self) -> None:
        key = _another_key().convert_to_public()

        accepted = _offered_on_the_local_port(_identity_check("accept-new", (FAR_HOST, 22)), key)

        assert accepted is True
        assert trusted_entries() == [(FAR_HOST, 22, _public_line(key))]

    def test_a_far_port_other_than_22_is_recorded_with_the_port(self) -> None:
        key = _another_key().convert_to_public()

        _offered_on_the_local_port(_identity_check("accept-new", (FAR_HOST, 2222)), key)

        assert trusted_entries() == [(FAR_HOST, 2222, _public_line(key))]
        assert known_hosts_lines() == [f"[{FAR_HOST}]:2222 {_public_line(key)}"]

    def test_strict_accepts_the_key_recorded_under_the_far_host(self) -> None:
        key = _another_key().convert_to_public()
        trust_host(FAR_HOST, 2222, key)
        check = _identity_check("strict", (FAR_HOST, 2222))

        accepted = _offered_on_the_local_port(check, _as_reoffered(key))

        assert accepted is True
        assert check.refusal is None

    @pytest.mark.parametrize("mode", ["strict", "accept-new"])
    def test_a_different_key_recorded_under_the_far_host_is_refused(self, mode: str) -> None:
        original = _another_key()
        trust_host(FAR_HOST, 22, original)
        check = _identity_check(mode, (FAR_HOST, 22))

        accepted = _offered_on_the_local_port(check, _another_key().convert_to_public())

        assert accepted is False
        assert check.refusal == "key-changed"
        assert trusted_entries() == [(FAR_HOST, 22, _public_line(original))]

    def test_strict_refuses_a_far_host_with_no_record(self) -> None:
        check = _identity_check("strict", (FAR_HOST, 22))

        accepted = _offered_on_the_local_port(check, _another_key().convert_to_public())

        assert accepted is False
        assert check.refusal == "host-unknown"
        assert trusted_entries() == []

    def test_a_key_recorded_under_the_loopback_port_does_not_count_for_the_far_host(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("127.0.0.1", LOCAL_PORT, key)
        check = _identity_check("strict", (FAR_HOST, 22))

        accepted = _offered_on_the_local_port(check, _as_reoffered(key))

        assert accepted is False
        assert check.refusal == "host-unknown"

    def test_a_later_exchange_may_only_reoffer_the_accepted_key(self) -> None:
        key = _another_key().convert_to_public()
        check = _identity_check("accept-new", (FAR_HOST, 22))
        _offered_on_the_local_port(check, key)

        assert _offered_on_the_local_port(check, _as_reoffered(key)) is True
        assert _offered_on_the_local_port(check, _another_key().convert_to_public()) is False
        assert check.refusal == "key-changed"
        assert trusted_entries() == [(FAR_HOST, 22, _public_line(key))]

    def test_a_direct_session_to_the_far_host_later_finds_the_same_record(self) -> None:
        key = _another_key().convert_to_public()
        _offered_on_the_local_port(_identity_check("accept-new", (FAR_HOST, 22)), key)
        direct = _ssh_session._HostKeyCheck(False)

        accepted = direct.validate_host_public_key(FAR_HOST, "10.0.0.9", 22, _as_reoffered(key))

        assert accepted is True
        assert direct.refusal is None

    def test_a_locked_identity_check_records_nothing_under_the_far_host(self) -> None:
        check = _ssh_session._HostKeyCheck(False, (FAR_HOST, 22), locked=True)

        accepted = _offered_on_the_local_port(check, _another_key().convert_to_public())

        assert accepted is False
        assert check.refusal is not None
        assert trusted_entries() == []

    def test_a_far_port_with_no_entry_is_not_trusted_through_port_22(self) -> None:
        key = _another_key().convert_to_public()
        trust_host(FAR_HOST, 22, key)
        check = _identity_check("strict", (FAR_HOST, 2222))

        accepted = _offered_on_the_local_port(check, _as_reoffered(key))

        assert accepted is False
        assert check.refusal == "host-unknown"


class TestBuildConnectKwargsUnderAnIdentity:
    """build_connect_kwargs with a tunnel identity (SSH-8)."""

    @pytest.mark.parametrize("mode", ["strict", "accept-new"])
    def test_asyncssh_trusts_nothing_by_itself_and_the_check_rules(self, mode: str) -> None:
        trust_host("127.0.0.1", LOCAL_PORT, _another_key())
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT, host_key_verification=mode)

        kwargs = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 22))

        assert kwargs["known_hosts"] is _ssh_session._trust_nothing
        assert isinstance(kwargs["client_factory"], _ssh_session._HostKeyCheck)

    def test_the_connection_still_goes_to_the_local_port(self) -> None:
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT, host_key_verification="strict")

        kwargs = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 22))

        assert (kwargs["host"], kwargs["port"]) == ("127.0.0.1", LOCAL_PORT)

    def test_the_installed_check_records_under_the_identity(self) -> None:
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT, host_key_verification="accept-new")
        key = _another_key().convert_to_public()

        check = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 2222))[
            "client_factory"
        ]
        _offered_on_the_local_port(check, key)

        assert trusted_entries() == [(FAR_HOST, 2222, _public_line(key))]

    def test_the_installed_check_records_nothing_under_the_identity_while_locked(self) -> None:
        set_lock(True)
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT, host_key_verification="accept-new")

        check = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 2222))[
            "client_factory"
        ]

        assert _offered_on_the_local_port(check, _another_key().convert_to_public()) is False
        assert trusted_entries() == []

    def test_disabled_skips_verification_even_with_an_identity(self) -> None:
        params = _base_params(host="127.0.0.1", port=LOCAL_PORT, host_key_verification="disabled")

        kwargs = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 22))

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    def test_no_identity_checks_the_host_and_port_as_given(self) -> None:
        key = _another_key().convert_to_public()
        trust_host("node-1.example.com", 22, key)
        params = _base_params(host_key_verification="strict")

        check = build_connect_kwargs(params, None, host_key_identity=None)["client_factory"]

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _as_reoffered(key)
        )
        assert accepted is True
        assert check.refusal is None


_BLANKS = pytest.mark.parametrize("blank", ["absent", None, ""], ids=["absent", "none", "empty"])


def _with_blank(name: str, blank: Any, **overrides: Any) -> dict[str, Any]:
    """Base parameters with `name` left out, None or empty."""
    params = _base_params(**overrides)
    params.pop(name, None)
    if blank != "absent":
        params[name] = blank
    return params


class TestBuildConnectKwargsBlankNumberRows:
    """A numeric row left blank connects with its default (SSH-9)."""

    @_BLANKS
    def test_a_blank_port_is_22(self, blank: Any) -> None:
        assert build_connect_kwargs(_with_blank("port", blank), None)["port"] == 22

    @_BLANKS
    def test_a_blank_connect_timeout_is_30(self, blank: Any) -> None:
        kwargs = build_connect_kwargs(_with_blank("connect_timeout", blank), None)

        assert kwargs["connect_timeout"] == 30

    def test_the_default_connection_timeout_is_named_once_as_30(self) -> None:
        assert _ssh_session.DEFAULT_CONNECT_TIMEOUT == 30

    @_BLANKS
    def test_a_blank_connect_timeout_is_the_named_default(
        self, blank: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_ssh_session, "DEFAULT_CONNECT_TIMEOUT", 45)

        kwargs = build_connect_kwargs(_with_blank("connect_timeout", blank), None)

        assert kwargs["connect_timeout"] == 45

    @_BLANKS
    def test_a_blank_keepalive_interval_is_0_so_no_keepalive(self, blank: Any) -> None:
        kwargs = build_connect_kwargs(
            _with_blank("keep_alive_interval", blank, keep_alive_max_count=5), None
        )

        assert "keepalive_interval" not in kwargs
        assert "keepalive_count_max" not in kwargs

    @_BLANKS
    def test_a_blank_keepalive_max_count_is_3(self, blank: Any) -> None:
        kwargs = build_connect_kwargs(
            _with_blank("keep_alive_max_count", blank, keep_alive_interval=15), None
        )

        assert kwargs["keepalive_interval"] == 15
        assert kwargs["keepalive_count_max"] == 3


def _unset_endpoint_params(endpoint: SSHEndpoint) -> dict[str, Any]:
    """Parameters aimed at the loopback server, carrying no host key setting at all."""
    params = _endpoint_params(endpoint, "strict")
    del params["host_key_verification"]
    return params


class TestConnectingWithoutAHostKeySetting:
    """A block that carries no host key setting connects with verification off (REQ-4.5.14)."""

    @_BLANKS
    def test_verification_is_skipped(self, blank: Any) -> None:
        kwargs = build_connect_kwargs(_with_blank("host_key_verification", blank), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    @_BLANKS
    def test_verification_is_skipped_on_a_tunnels_local_port(self, blank: Any) -> None:
        params = _with_blank("host_key_verification", blank, host="127.0.0.1", port=LOCAL_PORT)

        kwargs = build_connect_kwargs(params, None, host_key_identity=(FAR_HOST, 22))

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    def test_verification_is_skipped_while_trusted_hosts_are_locked(self) -> None:
        set_lock(True)

        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    def test_the_settings_default_is_not_applied_at_connect(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(False, "strict"))

        kwargs = build_connect_kwargs(_base_params(), None)

        assert kwargs["known_hosts"] is None
        assert "client_factory" not in kwargs

    async def test_there_is_no_check_to_return(self) -> None:
        with patch(
            "wavecore.plugins._ssh_session.asyncssh.connect",
            new=AsyncMock(return_value=MagicMock()),
        ):
            result = await open_connection(_base_params(), None)

        assert result.host_key_check is None

    async def test_an_unreadable_trusted_hosts_list_does_not_stop_the_connection(self) -> None:
        ssh_hosts_file().mkdir(parents=True)
        connect_mock = AsyncMock(return_value=MagicMock())

        with patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock):
            await open_connection(_base_params(), None)

        connect_mock.assert_awaited_once()

    async def test_an_unknown_host_is_connected_and_never_recorded(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        await _open_and_hang_up(_unset_endpoint_params(ssh_endpoint))

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == ["s3cr3t-pw"]

    async def test_a_host_whose_trusted_key_differs_is_still_connected(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        held = _another_key()
        ssh_endpoint.trust(held)

        await _open_and_hang_up(_unset_endpoint_params(ssh_endpoint))

        assert trusted_entries() == [ssh_endpoint.entry(held)]


class TestTheLockIsReadFromTheConfig:
    """Lock trusted hosts comes from the config file, never from the list file (REQ-4.5.14)."""

    def test_a_lock_in_the_config_file_makes_accept_new_refuse_an_unknown_host(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(True, "strict"))
        check = _host_key_check("accept-new")

        accepted = check.validate_host_public_key(
            "node-1.example.com", "10.0.0.7", 22, _another_key().convert_to_public()
        )

        assert accepted is False
        assert check.refusal == "host-locked"
        assert trusted_entries() == []

    async def test_a_lock_in_the_config_file_refuses_with_the_lock_text(
        self, ssh_endpoint: SSHEndpoint, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(True, "strict"))

        with pytest.raises(ConnectionError, match=_refused_at(ssh_endpoint, NOT_TRUSTED_LOCKED)):
            await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == []

    async def test_a_policy_left_in_the_list_file_does_not_lock(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        leftover = {"lock_trusted_hosts": True, "default_block_action": "strict"}
        ssh_hosts_file().parent.mkdir(parents=True, exist_ok=True)
        ssh_hosts_file().write_text(
            yaml.safe_dump({"policy": leftover, "hosts": []}), encoding="utf-8"
        )

        await _connect_and_close(ssh_endpoint, "accept-new")

        assert trusted_entries() == [ssh_endpoint.entry()]


@asynccontextmanager
async def _sftp_ready_session(*, subsystem: bool = True) -> AsyncIterator[dict[str, Any]]:
    """A live session record on a loopback server, with or without an sftp subsystem."""
    options: dict[str, Any] = {"process_factory": exits_immediately}
    if subsystem:
        options["sftp_factory"] = asyncssh.SFTPServer
    async with (
        ssh_server(NoAuthServer, **options) as port,
        asyncssh.connect("127.0.0.1", port, username="wave", known_hosts=None) as connection,
    ):
        yield _tunnel_session(connection)


class _HeldSFTPOpen:
    """Opens a real SFTP client on a live connection, then holds it until released."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self.client: Any = None
        self.opened = asyncio.Event()
        self.release = asyncio.Event()

    async def start_sftp_client(self) -> Any:
        self.client = await self._connection.start_sftp_client()
        self.opened.set()
        await self.release.wait()
        return self.client


class _GatedSFTPOpen:
    """An SSH connection whose SFTP start waits on a gate, then hands over its client."""

    def __init__(self) -> None:
        self.gate, self.opening, self.closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        self.handed_over = False
        self.client = MagicMock()
        self.client.exit.side_effect = self.closed.set
        self.connection = MagicMock(start_sftp_client=AsyncMock(side_effect=self._start))

    async def _start(self) -> Any:
        self.opening.set()
        await self.gate.wait()
        self.handed_over = True
        return self.client


class TestOpenSFTPClient:
    """open_sftp_client - one SFTP channel on the session, released however the caller gives up."""

    async def test_opens_a_working_sftp_client_on_the_session(self, tmp_path: Path) -> None:
        (tmp_path / "hello.txt").write_text("hello over sftp", encoding="utf-8")

        async with _sftp_ready_session() as record:
            client = await _ssh_session.open_sftp_client(record)
            try:
                async with client.open(str(tmp_path / "hello.txt")) as remote:
                    data = await remote.read()
            finally:
                _ssh_session.close_sftp_client(client)
                await asyncio.wait_for(client.wait_closed(), 5)

        assert isinstance(client, asyncssh.SFTPClient)
        assert data == "hello over sftp"

    async def test_a_refused_subsystem_is_sftp_unavailable_with_the_server_reason(self) -> None:
        async with _sftp_ready_session(subsystem=False) as record:
            with pytest.raises(
                _ssh_session.SFTPUnavailable, match=exact("Session request failed")
            ) as raised:
                await _ssh_session.open_sftp_client(record)

        assert raised.value.detail == "Session request failed"

    @pytest.mark.parametrize(
        "failure",
        [
            asyncssh.ChannelOpenError(asyncssh.OPEN_CONNECT_FAILED, "SSH connection closed"),
            asyncssh.SFTPError(asyncssh.FX_BAD_MESSAGE, "Unsupported version: 7"),
            asyncssh.SFTPConnectionLost("Connection lost"),
        ],
        ids=["channel refused", "not an sftp server", "lost while starting"],
    )
    async def test_a_channel_or_sftp_error_at_start_is_sftp_unavailable(
        self, failure: asyncssh.Error
    ) -> None:
        connection = MagicMock(start_sftp_client=AsyncMock(side_effect=failure))

        with pytest.raises(_ssh_session.SFTPUnavailable) as raised:
            await _ssh_session.open_sftp_client(_tunnel_session(connection))

        assert raised.value.detail == failure.reason
        assert str(raised.value) == failure.reason

    async def test_sftp_unavailable_carries_its_detail(self) -> None:
        error = _ssh_session.SFTPUnavailable("Session request failed")

        assert isinstance(error, Exception)
        assert error.detail == "Session request failed"
        assert str(error) == "Session request failed"

    async def test_a_timeout_releases_the_client_once_it_opens(self) -> None:
        gated = _GatedSFTPOpen()

        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.05):
                await _ssh_session.open_sftp_client(_tunnel_session(gated.connection))

        assert gated.client.exit.call_count == 0
        gated.gate.set()
        await asyncio.wait_for(gated.closed.wait(), 1)
        assert gated.client.exit.call_count == 1

    async def test_a_cancel_while_opening_never_waits_and_releases_the_client(self) -> None:
        gated = _GatedSFTPOpen()
        task = asyncio.create_task(_ssh_session.open_sftp_client(_tunnel_session(gated.connection)))
        await asyncio.wait_for(gated.opening.wait(), 1)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)

        assert task.done() is True
        assert gated.handed_over is False
        assert gated.client.exit.call_count == 0
        gated.gate.set()
        await asyncio.wait_for(gated.closed.wait(), 1)
        assert gated.client.exit.call_count == 1

    async def test_a_real_client_abandoned_by_a_timeout_is_closed_once_it_opens(self) -> None:
        async with _sftp_ready_session() as record:
            held = _HeldSFTPOpen(record["connection"])

            with pytest.raises(TimeoutError):
                async with asyncio.timeout(0.05):
                    await _ssh_session.open_sftp_client({**record, "connection": held})
            await asyncio.wait_for(held.opened.wait(), 5)
            held.release.set()

            await asyncio.wait_for(held.client.wait_closed(), 5)

    async def test_a_real_client_abandoned_by_a_stop_is_closed_once_it_opens(self) -> None:
        async with _sftp_ready_session() as record:
            held = _HeldSFTPOpen(record["connection"])
            task = asyncio.create_task(
                _ssh_session.open_sftp_client({**record, "connection": held})
            )
            await asyncio.wait_for(held.opened.wait(), 5)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 1)
            held.release.set()

            await asyncio.wait_for(held.client.wait_closed(), 5)


class TestCloseSFTPClient:
    """close_sftp_client - ends the SFTP channel without waiting and without raising."""

    def test_exits_the_client(self) -> None:
        client = MagicMock()

        assert _ssh_session.close_sftp_client(client) is None
        assert client.exit.call_args_list == [()]

    def test_never_waits(self) -> None:
        assert inspect.iscoroutinefunction(_ssh_session.close_sftp_client) is False

    @pytest.mark.parametrize(
        "failure",
        [
            asyncssh.SFTPConnectionLost("Connection lost"),
            BrokenPipeError("Channel not open for sending"),
            RuntimeError("anything"),
        ],
        ids=["connection lost", "broken pipe", "anything"],
    )
    def test_never_raises(self, failure: Exception) -> None:
        client = MagicMock()
        client.exit.side_effect = failure

        _ssh_session.close_sftp_client(client)

        assert client.exit.call_count == 1

    async def test_a_real_client_closes_and_the_session_stays_open(self) -> None:
        async with _sftp_ready_session() as record:
            client = await _ssh_session.open_sftp_client(record)

            _ssh_session.close_sftp_client(client)
            await asyncio.wait_for(client.wait_closed(), 5)

            assert record["connection"].is_closed() is False
            again = await _ssh_session.open_sftp_client(record)
            _ssh_session.close_sftp_client(again)
            await asyncio.wait_for(again.wait_closed(), 5)


_NOT_UTF8 = "bar\udce9.txt"


def _cannot_be_sent(label: str, line: int, column: int) -> str:
    return exact(
        f"{label} has a character at line {line}, column {column} that cannot be encoded as "
        "UTF-8, so nothing was sent to the remote host: remove or replace it"
    )


class _RecordsWhatArrives:
    """A remote side that keeps each command it was started with and the script it read."""

    def __init__(self) -> None:
        self.arrived: list[tuple[str, bytes]] = []

    async def handle(self, process: Any) -> None:
        script = await process.stdin.read() if process.command == "sh -s" else b""
        self.arrived.append((process.command, script))
        process.exit(0)


class TestTextThatCannotBeEncoded:
    """Text UTF-8 cannot carry is refused before any of it is sent (REQ-4.6.9)."""

    @pytest.mark.parametrize("text", ["", "echo ok", "echo Grüße ✓\n"])
    def test_text_that_encodes_passes(self, text: str) -> None:
        _ssh_session.require_utf8("Script", text)

    @pytest.mark.parametrize(
        ("label", "text", "line", "column"),
        [
            ("Script", f"ls {_NOT_UTF8}\n", 1, 7),
            ("Command", f"cd /srv\nls\nrm {_NOT_UTF8}", 3, 7),
            ("Interpreter", "\udcff", 1, 1),
        ],
        ids=["first line", "third line", "first character"],
    )
    def test_the_refusal_names_the_text_and_where_the_character_is(
        self, label: str, text: str, line: int, column: int
    ) -> None:
        with pytest.raises(ValueError, match=_cannot_be_sent(label, line, column)) as raised:
            _ssh_session.require_utf8(label, text)

        assert type(raised.value) is ValueError
        assert isinstance(raised.value.__cause__, UnicodeEncodeError)

    async def test_a_script_that_cannot_be_encoded_starts_no_remote_process(self) -> None:
        remote = _RecordsWhatArrives()

        async with _connected_as_wave_connects(remote.handle) as conn:
            with pytest.raises(ValueError, match=_cannot_be_sent("Script", 1, 7)):
                await run_with_timeout(conn, "sh -s", 30, script=f"ls {_NOT_UTF8}\n")
            await run_with_timeout(conn, "sh -s", 30, script="ls\n")

        assert remote.arrived == [("sh -s", b"ls\n")]

    async def test_a_command_that_cannot_be_encoded_starts_no_remote_process(self) -> None:
        remote = _RecordsWhatArrives()

        async with _connected_as_wave_connects(remote.handle) as conn:
            with pytest.raises(ValueError, match=_cannot_be_sent("Command", 1, 7)):
                await run_with_timeout(conn, f"ls {_NOT_UTF8}", 30)
            await run_with_timeout(conn, "ls", 30)

        assert remote.arrived == [("ls", b"")]

    async def test_text_that_encodes_arrives_unchanged(self) -> None:
        remote = _RecordsWhatArrives()

        async with _connected_as_wave_connects(remote.handle) as conn:
            await run_with_timeout(conn, "sh -s", 30, script="echo Grüße ✓\n")

        assert remote.arrived == [("sh -s", "echo Grüße ✓\n".encode())]
