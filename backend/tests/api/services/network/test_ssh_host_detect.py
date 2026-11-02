"""Detect from host: reading a host's keys without logging in (REQ-4.5.14, REQ-4.5.15)."""

import asyncio
import base64
import inspect
import socket
import struct
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncssh
import pytest

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.network import ssh_hosts

LOOPBACK = "127.0.0.1"
PROBE_ALGORITHMS = {
    frozenset({"ssh-ed25519"}),
    frozenset({"ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"}),
    frozenset({"rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"}),
}

StreamHandler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


class HostKeys:
    """Host keys written under tmp_path, by label, with the key objects they hold."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.keys: dict[str, asyncssh.SSHKey] = {}
        self.paths: dict[str, Path] = {}

    def add(self, label: str, algorithm: str, **options: Any) -> None:
        key = asyncssh.generate_private_key(algorithm, **options)
        path = self.folder / f"ssh_host_{label}_key"
        key.write_private_key(path)
        self.keys[label] = key
        self.paths[label] = path

    def entry(self, label: str, port: int, key_type: str) -> dict[str, Any]:
        key = self.keys[label]
        return {
            "host": LOOPBACK,
            "port": port,
            "key_type": key_type,
            "key": f"{key.get_algorithm()} {base64.b64encode(key.public_data).decode()}",
            "fingerprint": key.get_fingerprint("sha256"),
        }


@pytest.fixture
def host_keys(tmp_path: Path) -> HostKeys:
    folder = tmp_path / "host-keys"
    folder.mkdir()
    keys = HostKeys(folder)
    keys.add("ed25519", "ssh-ed25519")
    keys.add("ecdsa", "ecdsa-sha2-nistp256")
    keys.add("rsa", "ssh-rsa", key_size=1024)
    keys.add("ed448", "ssh-ed448")
    return keys


@pytest.fixture(autouse=True)
def data_folder(tmp_path: Path) -> Path:
    folder = tmp_path / "data"
    folder.mkdir()
    storage_paths.set_base_path(folder)
    return folder


@pytest.fixture
def probe_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Every call made to asyncssh.get_server_host_key, as bound arguments; calls go through."""
    real = asyncssh.get_server_host_key
    signature = inspect.signature(real)
    calls: list[dict[str, Any]] = []

    async def spy(*args: Any, **kwargs: Any) -> Any:
        calls.append(dict(signature.bind(*args, **kwargs).arguments))
        return await real(*args, **kwargs)

    monkeypatch.setattr(asyncssh, "get_server_host_key", spy)
    return calls


@asynccontextmanager
async def ssh_host(*key_paths: Path) -> AsyncIterator[int]:
    """A real SSH server on loopback holding only the given host keys; yields its port."""
    server = await asyncssh.listen(
        LOOPBACK,
        0,
        server_factory=asyncssh.SSHServer,
        server_host_keys=[str(path) for path in key_paths],
    )
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        await server.wait_closed()


@asynccontextmanager
async def tcp_listener(handler: StreamHandler) -> AsyncIterator[int]:
    """A plain TCP listener on loopback; every connection it accepted is closed on exit."""
    writers: list[asyncio.StreamWriter] = []

    async def tracked(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writers.append(writer)
        try:
            await handler(reader, writer)
        finally:
            writer.close()

    server = await asyncio.start_server(tracked, LOOPBACK, 0)
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        for writer in writers:
            writer.close()
        server.close()
        await server.wait_closed()


async def _answers_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readline()
    writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
    await writer.drain()


async def _drops_after_banner(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """OpenSSH with no key of an asked type: it sends its banner, then closes, no disconnect."""
    writer.write(b"SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.13\r\n")
    await writer.drain()
    await reader.readline()


async def _greets_then_drops(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    writer.write(b"Authorized use only\r\n")
    await _drops_after_banner(reader, writer)


async def _resets_after_banner(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await _drops_after_banner(reader, writer)
    _reset(writer)


async def _sends_one_long_line(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readline()
    writer.write(b"x" * 70_000)
    await writer.drain()


async def _resets_at_once(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readline()
    _reset(writer)


def _reset(writer: asyncio.StreamWriter) -> None:
    sock = writer.get_extra_info("socket")
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    writer.transport.abort()


@pytest.fixture
def probes_to(monkeypatch: pytest.MonkeyPatch) -> Callable[[int], None]:
    """Send every probe except the ED25519 one to the given port; the banner check stays put."""
    real = asyncssh.get_server_host_key

    def redirect(port: int) -> None:
        async def probe(host: str, probe_port: int, **options: Any) -> Any:
            if "ssh-ed25519" not in options["server_host_key_algs"]:
                probe_port = port
            return await real(host, probe_port, **options)

        monkeypatch.setattr(asyncssh, "get_server_host_key", probe)

    return redirect


async def _stays_silent(reader: asyncio.StreamReader, _writer: asyncio.StreamWriter) -> None:
    await reader.read()


def _closed_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((LOOPBACK, 0))
        return int(sock.getsockname()[1])


def _store_file(data_folder: Path) -> Path:
    return data_folder / "network" / "ssh_hosts.yaml"


class TestKeysRead:
    async def test_all_three_types_in_order_with_their_fingerprints(
        self, host_keys: HostKeys
    ) -> None:
        paths = host_keys.paths
        async with ssh_host(paths["rsa"], paths["ecdsa"], paths["ed25519"]) as port:
            result = await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert result == {
            "entries": [
                host_keys.entry("ed25519", port, "ED25519"),
                host_keys.entry("ecdsa", port, "ECDSA"),
                host_keys.entry("rsa", port, "RSA"),
            ]
        }

    async def test_a_host_with_only_an_ed25519_key_yields_one_entry(
        self, host_keys: HostKeys
    ) -> None:
        async with ssh_host(host_keys.paths["ed25519"]) as port:
            result = await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert result == {"entries": [host_keys.entry("ed25519", port, "ED25519")]}

    async def test_a_port_sent_as_its_digits_is_read_as_the_number(
        self, host_keys: HostKeys
    ) -> None:
        async with ssh_host(host_keys.paths["ed25519"]) as port:
            result = await ssh_hosts.detect_host_keys(LOOPBACK, str(port))

        assert result == {"entries": [host_keys.entry("ed25519", port, "ED25519")]}

    async def test_a_host_offering_no_supported_type_is_refused(self, host_keys: HostKeys) -> None:
        async with ssh_host(host_keys.paths["ed448"]) as port:
            with pytest.raises(
                ValidationException,
                match=rf"^127\.0\.0\.1:{port} offered no ED25519, ECDSA or RSA host key$",
            ):
                await ssh_hosts.detect_host_keys(LOOPBACK, port)

    @pytest.mark.parametrize("drop", [_drops_after_banner, _resets_after_banner])
    async def test_types_the_host_drops_the_connection_for_are_skipped(
        self, host_keys: HostKeys, probes_to: Callable[[int], None], drop: StreamHandler
    ) -> None:
        async with (
            ssh_host(host_keys.paths["ed25519"]) as port,
            tcp_listener(drop) as drop_port,
        ):
            probes_to(drop_port)
            result = await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert result == {"entries": [host_keys.entry("ed25519", port, "ED25519")]}

    @pytest.mark.parametrize("drop", [_drops_after_banner, _greets_then_drops])
    async def test_a_host_that_drops_every_probe_offers_no_supported_type(
        self, drop: StreamHandler
    ) -> None:
        async with tcp_listener(drop) as port:
            with pytest.raises(
                ValidationException,
                match=rf"^127\.0\.0\.1:{port} offered no ED25519, ECDSA or RSA host key$",
            ):
                await ssh_hosts.detect_host_keys(LOOPBACK, port)


class TestReachFailures:
    async def test_a_closed_port_cannot_be_reached(self) -> None:
        port = _closed_port()

        with pytest.raises(
            ValidationException, match=rf"^Could not reach 127\.0\.0\.1:{port}: .+$"
        ):
            await ssh_hosts.detect_host_keys(LOOPBACK, port)

    @pytest.mark.parametrize("answer", [_answers_http, _sends_one_long_line, _resets_at_once])
    async def test_a_peer_that_is_not_an_ssh_server_is_named(self, answer: StreamHandler) -> None:
        async with tcp_listener(answer) as port:
            with pytest.raises(
                ValidationException,
                match=rf"^127\.0\.0\.1:{port} did not answer as an SSH server$",
            ):
                await ssh_hosts.detect_host_keys(LOOPBACK, port)

    async def test_a_silent_peer_times_out_at_the_bound(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(ssh_hosts, "DETECT_TIMEOUT_SECONDS", 0.2)

        async with tcp_listener(_stays_silent) as port:
            with pytest.raises(
                ValidationException,
                match=rf"^Timed out after .+ seconds reaching 127\.0\.0\.1:{port}$",
            ):
                await ssh_hosts.detect_host_keys(LOOPBACK, port)

    def test_the_whole_detect_is_bounded_at_ten_seconds(self) -> None:
        assert ssh_hosts.DETECT_TIMEOUT_SECONDS == 10


class TestInputChecks:
    @pytest.mark.parametrize("host", ["", "   "])
    async def test_a_blank_host_is_refused_before_any_probe(
        self, host: str, probe_calls: list[dict[str, Any]]
    ) -> None:
        with pytest.raises(ValidationException, match=r"^Host is required$"):
            await ssh_hosts.detect_host_keys(host, 22)

        assert probe_calls == []

    @pytest.mark.parametrize("port", [0, 65536, True, 22.0, "22.0", "+22", " 22", "65536", None])
    async def test_a_port_out_of_range_is_refused_before_any_probe(
        self, port: Any, probe_calls: list[dict[str, Any]]
    ) -> None:
        with pytest.raises(ValidationException, match=r"^Port must be from 1 to 65535$"):
            await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert probe_calls == []


class TestNoAccountSources:
    async def test_every_probe_passes_an_empty_config_list_and_no_proxy(
        self, host_keys: HostKeys, probe_calls: list[dict[str, Any]]
    ) -> None:
        paths = host_keys.paths
        async with ssh_host(paths["ed25519"], paths["ecdsa"], paths["rsa"]) as port:
            await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert len(probe_calls) == 3
        for call in probe_calls:
            assert call["host"] == LOOPBACK
            assert call["port"] == port
            assert call["config"] == []
            assert call.get("tunnel", ()) in ((), None)
            assert call.get("proxy_command", ()) in ((), None)
        assert {frozenset(call["server_host_key_algs"]) for call in probe_calls} == (
            PROBE_ALGORITHMS
        )

    async def test_the_account_ssh_config_is_never_read(
        self, host_keys: HostKeys, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Read, this config would send the probe to 127.0.0.2, where nothing listens.
        (server_home / ".ssh").mkdir()
        (server_home / ".ssh" / "config").write_text(
            "Host 127.0.0.1\n    HostName 127.0.0.2\n", encoding="utf-8"
        )
        monkeypatch.setenv("HOME", str(server_home))

        async with ssh_host(host_keys.paths["ed25519"]) as port:
            result = await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert result == {"entries": [host_keys.entry("ed25519", port, "ED25519")]}


class TestWritesNothing:
    async def test_a_detect_leaves_the_trusted_hosts_store_untouched(
        self, host_keys: HostKeys, data_folder: Path
    ) -> None:
        async with ssh_host(host_keys.paths["ed25519"], host_keys.paths["rsa"]) as port:
            result = await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert [entry["key_type"] for entry in result["entries"]] == ["ED25519", "RSA"]
        assert not _store_file(data_folder).exists()

    async def test_a_failed_detect_leaves_the_trusted_hosts_store_untouched(
        self, data_folder: Path
    ) -> None:
        port = _closed_port()

        with pytest.raises(
            ValidationException, match=rf"^Could not reach 127\.0\.0\.1:{port}: .+$"
        ):
            await ssh_hosts.detect_host_keys(LOOPBACK, port)

        assert not _store_file(data_folder).exists()
