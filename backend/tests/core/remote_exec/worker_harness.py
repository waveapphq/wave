"""The emitted Remote Execution worker run as a local subprocess, shared by the real-worker tests.

The worker text runs as a real subprocess in a session of its own, so a group kill can never
reach the test runner. It runs against a stub import path carrying the synthetic packages, the
vendored launcher and the trust modules that the bundle serves in memory; that keeps a round
trip inside the per-test budget, and the vendoring itself is covered in test_bundle.py.
"""

import asyncio
import json
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager, suppress
from pathlib import Path
from typing import IO, Any

import wavecore
from wavecore.core.remote_exec import bundle

WORKER_REF = "remote-worker"
_PLUGINS_DIR = Path(wavecore.__file__).parent / "plugins"
_CONNECTIVITY_DIR = Path(wavecore.__file__).parent / "connectivity"
# The vendored modules the worker imports at module scope, copied into the stub path.
_STUB_MODULES = ("_process_group", "_local_process", "_local_process_runtime", "_user_patterns")
# The vendored trust modules the worker imports at module scope (REQ-4.5.16), copied when present.
_STUB_CONNECTIVITY_MODULES = ("trust_store", "run_log")

# The synthetic packages the bundle's in-memory loader serves, so the vendored
# launcher imports on a host that has no site-packages of its own.
_SYNTHETIC_PACKAGES = ("wavecore", "wavecore/plugins", "wavecore/connectivity")

# The vendored modules the lean worker still imports at module scope.
_KEPT_IMPORTS = ("_process_group", "_local_process", "trust_store", "run_log")
# The vendored programs the worker writes to disk as it starts.
_WORKER_SOURCE_KEYS = ("_local_process_watchdog", "_python_bridge")

# The line that asks a working worker to stop; it carries no plugin to dispatch.
STOP_REQUEST: dict[str, Any] = {"stop": True}

# Probe plugins patched into the worker. Each writes what the test watches before it blocks,
# because a stopped or canceled request sends no answer.
_PROBE_SOURCE = """
def _sleeper_probe(params, variables, logs):
    import os
    import shutil
    import subprocess
    import tempfile

    workspace = tempfile.mkdtemp(prefix="wave-worker-probe-", dir=params["dir"])
    try:
        child = subprocess.Popen(["/bin/sh", "-c", "sleep 30"])
        with open(params["report"], "w") as handle:
            handle.write("%d %d %s\\n" % (os.getpid(), child.pid, workspace))
        child.wait()
        return {"child": child.pid}
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def _stubborn_probe(params, variables, logs):
    import os
    import signal
    import time

    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    with open(params["report"], "w") as handle:
        handle.write("%d 0 -\\n" % os.getpid())
    time.sleep(30)
    return None


def _crasher_probe(params, variables, logs):
    import os

    os._exit(3)
"""

_PROBE_PATCH = (
    "_PLUGINS = {",
    _PROBE_SOURCE
    + '\n\n_PLUGINS = {"sleeper": _sleeper_probe, "stubborn": _stubborn_probe, '
    + '"crasher": _crasher_probe, ',
)

# A network request waits on its socket far longer than any stop or cancel may take.
NETWORK_REQUEST_TIMEOUT_S = 60
# How long past the stop grace the worker may take to leave.
EXIT_MARGIN_S = 2.0
# The bound every "is it gone yet" poll waits to.
POLL_BOUND_S = 5.0


def stop_grace_s() -> float:
    """The grace the emitted worker gives a stopped request, read from its own text."""
    match = re.search(r"^STOP_GRACE_S = (\d+(?:\.\d+)?)$", bundle._WORKER, re.MULTILINE)
    assert match, "the worker text declares no STOP_GRACE_S"
    return float(match.group(1))


def _vendored_prelude() -> str:
    """The loader-map entries the worker reads at module scope, as the real bundle serves them."""
    root = Path(wavecore.__file__).parent / "plugins"
    sources = {
        f"wavecore.plugins.{name}": (root / f"{name}.py").read_text(encoding="utf-8")
        for name in _WORKER_SOURCE_KEYS
    }
    return f"_WAVE_SOURCES = {sources!r}\n"


def lean_worker_source() -> str:
    """The emitted worker, less the module-scope lines that need a heavy core.

    The launcher and local-process imports are kept: they are the vendored modules
    the stop path and the module-scope watchdog write read. Every dropped core is
    only ever reached from inside a dispatch lambda, so the registry still builds
    and the protocol is untouched.
    """
    source = bundle._WORKER.replace("__PLUGIN_ID__", WORKER_REF).replace("__TRUST_PEM__", "''")
    kept = [
        line
        for line in source.splitlines(keepends=True)
        if not (
            line.startswith("from wavecore.") and not any(name in line for name in _KEPT_IMPORTS)
        )
        and not line.startswith(("helm_cli.", "sql_core."))
    ]
    text = "".join(kept)
    old, new = _PROBE_PATCH
    assert old in text
    return _vendored_prelude() + text.replace(old, new, 1)


def stub_import_path(root: Path) -> Path:
    """A sys.path holding the synthetic packages plus the vendored modules."""
    for package in _SYNTHETIC_PACKAGES:
        directory = root / package
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "__init__.py").write_text("", encoding="utf-8")
    for name in _STUB_MODULES:
        source = _PLUGINS_DIR / f"{name}.py"
        assert source.exists(), f"missing production module: {source}"
        shutil.copy(source, root / "wavecore" / "plugins" / f"{name}.py")
    for name in _STUB_CONNECTIVITY_MODULES:
        source = _CONNECTIVITY_DIR / f"{name}.py"
        if source.exists():
            shutil.copy(source, root / "wavecore" / "connectivity" / f"{name}.py")
    return root


def _worker_argv() -> list[str]:
    return [sys.executable, "-P", "-c", lean_worker_source()]


def _worker_env(stub_path: Path) -> dict[str, str]:
    return {**os.environ, "PYTHONPATH": str(stub_path)}


def _end_session_group(pid: int) -> None:
    # The worker leads its own session, so its pid names a group holding only it and its requests.
    with suppress(ProcessLookupError):
        os.killpg(pid, signal.SIGKILL)


@contextmanager
def worker(stub_path: Path) -> Iterator[subprocess.Popen[bytes]]:
    """One worker in a session of its own, torn down whatever the test does."""
    proc = subprocess.Popen(
        _worker_argv(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_worker_env(stub_path),
        start_new_session=True,
    )
    try:
        yield proc
    finally:
        _end_session_group(proc.pid)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            with suppress(Exception):
                stream.close()  # type: ignore[union-attr]
        with suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=5)


def send(proc: subprocess.Popen[bytes], request: dict[str, Any]) -> None:
    """Write one request line on the worker's session."""
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(request).encode("utf-8") + b"\n")
    proc.stdin.flush()


def cancel(proc: subprocess.Popen[bytes], request_id: str) -> None:
    """Ask the worker to give up one request."""
    send(proc, {"cancel": request_id})


def close_session(proc: subprocess.Popen[bytes]) -> None:
    """Close the session under the worker, the way a dropped SSH session does."""
    assert proc.stdin is not None
    proc.stdin.close()


def read_answer(proc: subprocess.Popen[bytes]) -> dict[str, Any]:
    """The worker's answer to the request just sent."""
    assert proc.stdout is not None
    line = proc.stdout.readline()
    assert line.strip(), "the worker answered nothing"
    parsed: dict[str, Any] = json.loads(line)
    return parsed


def _pump(stream: IO[bytes], lines: "queue.Queue[bytes]") -> None:
    for line in stream:
        lines.put(line)
    lines.put(b"")


class Answers:
    """Every line the worker writes, read on a thread so a missing answer fails, never hangs."""

    def __init__(self, proc: subprocess.Popen[bytes]) -> None:
        assert proc.stdout is not None
        self._lines: queue.Queue[bytes] = queue.Queue()
        threading.Thread(target=_pump, args=(proc.stdout, self._lines), daemon=True).start()

    def next(self, timeout: float = POLL_BOUND_S) -> dict[str, Any]:
        """The next answer the worker writes within the bound."""
        try:
            line = self._lines.get(timeout=timeout)
        except queue.Empty as exc:
            raise AssertionError(f"the worker wrote no answer within {timeout} s") from exc
        assert line.strip(), "the worker ended without answering"
        parsed: dict[str, Any] = json.loads(line)
        return parsed

    def rest(self, timeout: float = POLL_BOUND_S) -> list[bytes]:
        """Every line still unread once the worker's output ends."""
        remaining: list[bytes] = []
        deadline = time.monotonic() + timeout
        while True:
            line = self._lines.get(timeout=max(0.0, deadline - time.monotonic()))
            if not line:
                return remaining
            remaining.append(line)


def sleeper_request(work_dir: Path, request_id: str | None = None) -> dict[str, Any]:
    """A request that starts a real child program and holds until something ends it."""
    work_dir.mkdir(parents=True, exist_ok=True)
    request: dict[str, Any] = {
        "plugin_id": "sleeper",
        "params": {"dir": str(work_dir), "report": str(work_dir / "report")},
        "variables": {},
    }
    if request_id is not None:
        request["id"] = request_id
    return request


def probe_request(plugin_id: str, work_dir: Path, request_id: str) -> dict[str, Any]:
    """A request for one of the other probe plugins, reporting into ``work_dir``."""
    request = sleeper_request(work_dir, request_id)
    request["plugin_id"] = plugin_id
    return request


def quick_request(request_id: str) -> dict[str, Any]:
    """A request the worker answers at once (a plugin it does not carry fails straight away)."""
    return {"id": request_id, "plugin_id": "nope", "params": {}, "variables": {}}


@contextmanager
def silent_listener() -> Iterator[socket.socket]:
    """A local socket that takes connections and answers only when a test says so."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(4)
        listener.settimeout(POLL_BOUND_S)
        yield listener


def network_request(listener: socket.socket, request_id: str | None = None) -> dict[str, Any]:
    """An HTTP request that blocks in a network read until the listener answers."""
    port = listener.getsockname()[1]
    request: dict[str, Any] = {
        "plugin_id": "http-client",
        "params": {
            "method": "GET",
            "url": f"http://127.0.0.1:{port}/",
            "timeout": NETWORK_REQUEST_TIMEOUT_S,
        },
        "variables": {},
    }
    if request_id is not None:
        request["id"] = request_id
    return request


def accept_request(listener: socket.socket) -> socket.socket:
    """The connection of a request that has sent all of its HTTP request and now waits."""
    connection, _address = listener.accept()
    connection.settimeout(POLL_BOUND_S)
    received = b""
    while b"\r\n\r\n" not in received:
        chunk = connection.recv(4096)
        assert chunk, "the worker hung up before sending its request"
        received += chunk
    return connection


@contextmanager
def awaiting_answer(listener: socket.socket) -> Iterator[socket.socket]:
    """Held open while the worker has sent its whole request and waits on the reply."""
    with accept_request(listener) as connection:
        yield connection


def respond(connection: socket.socket, body: bytes = b"ok") -> None:
    """Answer a held HTTP request."""
    head = f"HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
    connection.sendall(head.encode("ascii") + body)


def peer_closed(connection: socket.socket) -> bool:
    """Whether the request on the other end of the connection hung up within the bound."""
    try:
        return connection.recv(1) == b""
    except (ConnectionResetError, TimeoutError):
        return False


def await_probe(work_dir: Path, timeout: float = POLL_BOUND_S) -> tuple[int, int, Path]:
    """The request pid, child pid and workspace an in-flight probe reported before blocking."""
    report = work_dir / "report"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if report.exists():
            text = report.read_text(encoding="utf-8").strip()
            if text:
                request_pid, child_pid, workspace = text.split(" ", 2)
                return int(request_pid), int(child_pid), Path(workspace)
        time.sleep(0.002)
    raise AssertionError("the worker never started the probe")


def is_gone(pid: int) -> bool:
    """Whether a pid is gone or a zombie: nothing of it is still running."""
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as handle:
            state = handle.read().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return True
    return state == "Z"


def await_true(check: Callable[[], bool], timeout: float = POLL_BOUND_S) -> bool:
    """Poll a check until it holds or the bound passes."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.002)
    return check()


def await_gone(pid: int, timeout: float = POLL_BOUND_S) -> bool:
    return await_true(lambda: is_gone(pid), timeout)


def await_exit(proc: subprocess.Popen[bytes], timeout: float = POLL_BOUND_S) -> int:
    """The worker's own exit; a worker that outlives its stop never returns."""
    return proc.wait(timeout=timeout)


class _AsyncStdin:
    def __init__(self, writer: asyncio.StreamWriter) -> None:
        self._writer = writer

    def write(self, data: str) -> None:
        self._writer.write(data.encode("utf-8"))

    async def drain(self) -> None:
        await self._writer.drain()

    def write_eof(self) -> None:
        self._writer.write_eof()


class _AsyncReader:
    def __init__(self, reader: asyncio.StreamReader) -> None:
        self._reader = reader

    async def readline(self) -> str:
        return (await self._reader.readline()).decode("utf-8")

    async def read(self) -> str:
        return (await self._reader.read()).decode("utf-8")


class AsyncWorkerProcess:
    """The local worker behind the text-mode stream shape of an asyncssh client process."""

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None
        self.proc = proc
        self.stdin = _AsyncStdin(proc.stdin)
        self.stdout = _AsyncReader(proc.stdout)
        self.stderr = _AsyncReader(proc.stderr)

    def close(self) -> None:
        # A closed channel reaches the worker as the end of its input.
        with suppress(Exception):
            self.stdin.write_eof()

    async def wait_closed(self) -> None:
        with suppress(TimeoutError):
            await asyncio.wait_for(self.proc.wait(), timeout=stop_grace_s() + EXIT_MARGIN_S)


@asynccontextmanager
async def async_worker(stub_path: Path) -> AsyncIterator[AsyncWorkerProcess]:
    """One local worker driven through asyncio, torn down whatever the test does."""
    proc = await asyncio.create_subprocess_exec(
        *_worker_argv(),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_worker_env(stub_path),
        start_new_session=True,
        limit=1 << 24,
    )
    try:
        yield AsyncWorkerProcess(proc)
    finally:
        _end_session_group(proc.pid)
        with suppress(TimeoutError):
            await asyncio.wait_for(proc.wait(), timeout=5)
