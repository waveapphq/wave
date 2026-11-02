"""Netcat's pass rule: which port states pass the block and what each failure says (REQ-3.3.4.3)."""

import asyncio
import re
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from tests.plugins.netcat.conftest import (
    FAST,
    WAIT,
    Listener,
    LogRecorder,
    free_port,
    netcat_params,
    resolve_to,
)
from wavecore.plugins._netcat_core import run

Listen = Callable[..., Awaitable[Listener]]
Opener = Callable[[str, int], Awaitable[Any]]

TEN_CLOSED = (
    "1 closed, 2 closed, 3 closed, 4 closed, 5 closed, "
    "6 closed, 7 closed, 8 closed, 9 closed, 10 closed"
)


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    return envelope["outputs"]


async def never(host: str, port: int) -> Any:
    await asyncio.Event().wait()


async def refuse(host: str, port: int) -> Any:
    raise ConnectionRefusedError(111, f"Connect call failed ('{host}', {port})")


async def gone(host: str, port: int) -> Any:
    raise TimeoutError


def reaching(target: int) -> Opener:
    """An opener that connects every dial to the loopback listener on `target`."""

    async def opener(host: str, port: int) -> Any:
        return await asyncio.open_connection("127.0.0.1", target)

    return opener


def by_port(openers: dict[int, Opener]) -> Opener:
    """An opener that hands each port to its own stub."""

    async def opener(host: str, port: int) -> Any:
        return await openers[port](host, port)

    return opener


def range_of(port_range: str, **overrides: Any) -> dict[str, Any]:
    return netcat_params(ports="range", port_range=port_range, **overrides)


def states(out: dict[str, Any]) -> list[str]:
    return [row[2] for row in out["results"]["rows"]]


def assert_passed(out: dict[str, Any]) -> None:
    assert (out["success"], out["error"], out["reason"]) == (True, "", "")


async def assert_fails(
    params: dict[str, Any], log: LogRecorder, message: str, reason: str, **seams: Any
) -> None:
    """Fail raises the message; record returns it with its reason and the WARN line."""
    if params["on_error"] == "fail":
        with pytest.raises(ValueError, match=exact(message)):
            await run(params, log, **seams)
        return
    out = outputs(await run(params, log, **seams))
    assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
    assert log[-1] == ("WARN", f"Netcat failed ({reason}): {message}")


@pytest.fixture(params=["fail", "record"])
def on_error(request: pytest.FixtureRequest) -> str:
    return str(request.param)


CLOSED = "Port {p} on 127.0.0.1 is closed: Connection refused"
SINGLE_FAILURES = [
    pytest.param(None, {"protocol": "tcp"}, {}, CLOSED, "Closed", id="closed-tcp"),
    pytest.param(None, {"protocol": "udp"}, {}, CLOSED, "Closed", id="closed-udp"),
    pytest.param(
        7,
        {"timeout": FAST},
        {"opener": never},
        "Port 7 on 127.0.0.1 timed out after 0.05 seconds",
        "Timeout",
        id="timed-out",
    ),
    pytest.param(
        7,
        {"timeout": 10},
        {"opener": gone},
        "Port 7 on 127.0.0.1 timed out after 10 seconds",
        "Timeout",
        id="timed-out-integer-timeout",
    ),
]


class TestSinglePort:
    """Single passes when its one port succeeds (NETCAT-3, NETCAT-8)."""

    @pytest.mark.parametrize(
        ("kind", "protocol", "timeout", "state"),
        [
            pytest.param("tcp-echo", "tcp", WAIT, "open", id="open"),
            pytest.param("udp-silent", "udp", FAST, "open or filtered", id="open-or-filtered"),
        ],
    )
    async def test_open_and_open_or_filtered_pass(
        self,
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        kind: str,
        protocol: str,
        timeout: float,
        state: str,
    ) -> None:
        """NETCAT-8: open or filtered counts as a pass, as nmap reports it."""
        listener = await listen(kind)
        resolve_to(monkeypatch, "127.0.0.1")
        params = netcat_params(listener.port, protocol=protocol, timeout=timeout)
        out = outputs(await run(params, log))
        assert states(out) == [state]
        assert_passed(out)

    @pytest.mark.parametrize(("port", "overrides", "seams", "message", "reason"), SINGLE_FAILURES)
    async def test_a_port_that_does_not_succeed_fails_the_block(
        self,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        on_error: str,
        port: int | None,
        overrides: dict[str, Any],
        seams: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        """A closed port fails with reason Closed, a timed-out port with reason Timeout."""
        resolve_to(monkeypatch, "127.0.0.1")
        port = port or free_port()
        params = netcat_params(port, on_error=on_error, **overrides)
        await assert_fails(params, log, message.format(p=port), reason, **seams)


class TestRangeOneSucceeds:
    """Pass when One succeeds passes when any port succeeds (NETCAT-3)."""

    async def test_one_open_port_passes(self, listen: Listen, log: LogRecorder) -> None:
        echo, closed = await listen("tcp-echo"), free_port()
        out = outputs(await run(range_of(f"{echo.port}, {closed}", pass_when="one"), log))
        assert states(out) == ["open", "closed"]
        assert_passed(out)

    async def test_no_port_succeeding_fails_with_none_succeeded(
        self, log: LogRecorder, on_error: str
    ) -> None:
        params = range_of("1-3", pass_when="one", on_error=on_error)
        message = "No port on 127.0.0.1 succeeded (3 checked)"
        await assert_fails(params, log, message, "NoneSucceeded", opener=refuse)
        assert [line for line in log if line[0] == "INFO"][-1] == ("INFO", "3 closed of 3")


class TestRangeAllSucceed:
    """Pass when All succeed passes only when every port succeeds (NETCAT-3)."""

    @pytest.mark.parametrize(
        ("kinds", "protocol", "timeout", "expected"),
        [
            pytest.param(("tcp-echo", "tcp-echo"), "tcp", WAIT, ["open", "open"], id="tcp"),
            pytest.param(
                ("udp-echo", "udp-silent"), "udp", FAST, ["open", "open or filtered"], id="udp"
            ),
        ],
    )
    async def test_every_port_succeeding_passes(
        self,
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        kinds: tuple[str, str],
        protocol: str,
        timeout: float,
        expected: list[str],
    ) -> None:
        first, second = [await listen(kind) for kind in kinds]
        resolve_to(monkeypatch, "127.0.0.1")
        params = range_of(
            f"{first.port}, {second.port}", pass_when="all", protocol=protocol, timeout=timeout
        )
        out = outputs(await run(params, log))
        assert states(out) == expected
        assert_passed(out)

    async def test_one_closed_port_fails_with_not_all_succeeded(
        self, listen: Listen, log: LogRecorder, on_error: str
    ) -> None:
        echo, closed = await listen("tcp-echo"), free_port()
        params = range_of(f"{echo.port}, {closed}", pass_when="all", on_error=on_error)
        message = f"1 of 2 ports on 127.0.0.1 did not succeed: {closed} closed"
        await assert_fails(params, log, message, "NotAllSucceeded")

    async def test_the_list_names_each_port_with_its_state(
        self, listen: Listen, log: LogRecorder, on_error: str
    ) -> None:
        echo = await listen("tcp-echo")
        opener = by_port({80: reaching(echo.port), 81: refuse, 82: gone})
        params = range_of("80-82", pass_when="all", on_error=on_error)
        message = "2 of 3 ports on 127.0.0.1 did not succeed: 81 closed, 82 timed out"
        await assert_fails(params, log, message, "NotAllSucceeded", opener=opener)

    async def test_the_list_keeps_the_written_order(self, log: LogRecorder, on_error: str) -> None:
        """NETCAT-2: the failed ports are listed as written, not sorted."""
        opener = by_port({81: refuse, 82: gone})
        params = range_of("82, 81", pass_when="all", on_error=on_error)
        message = "2 of 2 ports on 127.0.0.1 did not succeed: 82 timed out, 81 closed"
        await assert_fails(params, log, message, "NotAllSucceeded", opener=opener)

    @pytest.mark.parametrize(
        ("port_range", "message"),
        [
            pytest.param(
                "1-12",
                "12 of 12 ports on 127.0.0.1 did not succeed: 1 closed, 2 closed, 3 closed, "
                "4 closed, 5 closed, 6 closed, 7 closed, 8 closed, 9 closed, 10 closed (+2 more)",
                id="twelve",
            ),
            pytest.param(
                "1-10", f"10 of 10 ports on 127.0.0.1 did not succeed: {TEN_CLOSED}", id="ten"
            ),
        ],
    )
    async def test_the_list_names_the_first_ten_then_counts_the_rest(
        self, log: LogRecorder, on_error: str, port_range: str, message: str
    ) -> None:
        params = range_of(port_range, pass_when="all", on_error=on_error)
        await assert_fails(params, log, message, "NotAllSucceeded", opener=refuse)


class TestPassWhenDefault:
    """Pass when is One succeeds when absent or None (NETCAT-3)."""

    @pytest.mark.parametrize(
        "pass_when", [pytest.param({}, id="absent"), pytest.param({"pass_when": None}, id="none")]
    )
    async def test_one_open_port_passes(
        self, listen: Listen, log: LogRecorder, pass_when: dict[str, Any]
    ) -> None:
        echo, closed = await listen("tcp-echo"), free_port()
        out = outputs(await run(range_of(f"{echo.port}, {closed}", **pass_when), log))
        assert states(out) == ["open", "closed"]
        assert_passed(out)

    @pytest.mark.parametrize(
        "pass_when", [pytest.param({}, id="absent"), pytest.param({"pass_when": None}, id="none")]
    )
    async def test_no_port_succeeding_fails_with_none_succeeded(
        self, log: LogRecorder, on_error: str, pass_when: dict[str, Any]
    ) -> None:
        params = range_of("1-3", on_error=on_error, **pass_when)
        message = "No port on 127.0.0.1 succeeded (3 checked)"
        await assert_fails(params, log, message, "NoneSucceeded", opener=refuse)
