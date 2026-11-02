"""Ping's privilege path: the unprivileged datagram socket, and the refusal (PING-4, PING-5).

No test here opens an ICMP socket; the default opener is driven with the socket constructor
patched, so a machine outside ping_group_range is reproduced rather than required.
"""

import asyncio
import errno
import socket
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.ping.conftest import (
    TARGET,
    LogRecorder,
    exact,
    outputs,
    ping_params,
    refusing_opener,
    resolve_to,
)
from wavecore.plugins import _ping_core
from wavecore.plugins._ping_core import open_socket, run

REMOTE = "build-host-7"
REFUSAL_TAIL = (
    " may not send ICMP echo requests: the operating system refused an unprivileged ICMP "
    "socket. Add this machine's group to net.ipv4.ping_group_range."
)
WAVE_REFUSAL = f"The WAVE server{REFUSAL_TAIL}"
HOST_REFUSAL = f"The execution host '{REMOTE}'{REFUSAL_TAIL}"
REFUSALS = [
    pytest.param(None, id="permission-error"),
    pytest.param(OSError(errno.EACCES, "Permission denied"), id="eacces"),
    pytest.param(OSError(errno.EPERM, "Operation not permitted"), id="eperm"),
]


@contextmanager
def forbid_fallbacks() -> Iterator[tuple[MagicMock, MagicMock]]:
    """A refused opener may not be followed by a socket of the core's own or a TCP dial."""
    # The patch lifts inside the test: pytest-asyncio builds its next loop's self-pipe
    # with socket.socket, so a stand-in that outlives the test breaks the teardown.
    opened, dialed = MagicMock(), MagicMock()
    with patch.object(socket, "socket", opened), patch.object(asyncio, "open_connection", dialed):
        yield opened, dialed


def refusing_constructor() -> MagicMock:
    return MagicMock(side_effect=PermissionError(errno.EPERM, "Operation not permitted"))


class TestTheRefusalFailsTheBlock:
    """A machine that refuses the socket fails the block before any request is sent (PING-5)."""

    async def test_no_request_is_sent_and_nothing_else_is_tried(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, TARGET)

        with forbid_fallbacks() as (opened, dialed):
            with pytest.raises(ValueError, match=exact(WAVE_REFUSAL)):
                await run(ping_params(count=1), log, opener=refusing_opener())

        assert (opened.called, dialed.called) == (False, False)

    @pytest.mark.parametrize("error", REFUSALS)
    async def test_any_operating_system_refusal_is_recorded_the_same_way(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, error: OSError | None
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        params = ping_params(count=1, on_error="record")

        out = outputs(await run(params, log, opener=refusing_opener(error)))

        assert (out["success"], out["error"]) == (False, WAVE_REFUSAL)
        assert (out["reason"], out["__block_warning"]) == ("Unprivileged", True)
        assert log.at("WARN") == [f"Ping failed (Unprivileged): {WAVE_REFUSAL}"]


class TestTheMachineTheMessageNames:
    """The message names WAVE or the execution host it ran on (PING-5)."""

    def test_wave_itself_runs_without_a_remote_host(self) -> None:
        assert _ping_core.REMOTE_HOST is None

    async def test_the_execution_host_wording_names_the_host(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        monkeypatch.setattr(_ping_core, "REMOTE_HOST", REMOTE)
        params = ping_params(count=1, on_error="record")

        out = outputs(await run(params, log, opener=refusing_opener()))

        assert (out["error"], out["reason"]) == (HOST_REFUSAL, "Unprivileged")
        assert log.at("WARN") == [f"Ping failed (Unprivileged): {HOST_REFUSAL}"]

    async def test_the_execution_host_wording_raises_under_fail(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        monkeypatch.setattr(_ping_core, "REMOTE_HOST", REMOTE)

        with pytest.raises(ValueError, match=exact(HOST_REFUSAL)):
            await run(ping_params(count=1), log, opener=refusing_opener())


class TestTheDefaultOpener:
    """open_socket asks for the unprivileged datagram path and never a raw socket (PING-4)."""

    @pytest.mark.parametrize(
        ("family", "proto"),
        [
            pytest.param(socket.AF_INET, socket.IPPROTO_ICMP, id="ipv4"),
            pytest.param(socket.AF_INET6, socket.IPPROTO_ICMPV6, id="ipv6"),
        ],
    )
    def test_it_asks_for_a_datagram_socket_of_the_family_it_was_given(
        self, monkeypatch: pytest.MonkeyPatch, family: int, proto: int
    ) -> None:
        constructor = socket.socket
        calls: list[tuple[Any, ...]] = []
        made: list[Any] = []

        def make(*asked: Any) -> Any:
            """Record what was asked for and hand back a harmless UDP socket, never an ICMP one."""
            calls.append(asked)
            made.append(constructor(socket.AF_INET, socket.SOCK_DGRAM))
            return made[-1]

        monkeypatch.setattr(socket, "socket", make)
        try:
            open_socket(family).close()
        finally:
            for plain in made:
                plain.close()

        assert calls == [(family, socket.SOCK_DGRAM, proto)]
        assert socket.SOCK_RAW not in calls[0]

    def test_a_refused_socket_surfaces_as_an_operating_system_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(socket, "socket", refusing_constructor())

        with pytest.raises(OSError):
            open_socket(socket.AF_INET)

    async def test_a_run_on_the_default_opener_turns_that_refusal_into_the_failure(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        params = ping_params(count=1, on_error="record")

        with patch.object(socket, "socket", refusing_constructor()):
            out = outputs(await run(params, log))

        assert (out["error"], out["reason"]) == (WAVE_REFUSAL, "Unprivileged")
