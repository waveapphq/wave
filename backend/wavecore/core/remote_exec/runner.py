"""Remote Execution runner (REQ-3.4.1.3).

Drives a persistent remote worker over an already-open asyncssh connection:

- probe asks the host interpreter for its version, machine and libc in one
  command; open_worker refuses what the probe rules out (Python 3.10 or newer),
  pushes the pure-Python bundle, starts the persistent worker process, and
  returns a WorkerHandle that keeps the probe.
- select_wheels picks, from the wheel lock, the prebuilt build of each compiled
  driver package that fits the probed host; push_wheels sends a worker each one
  once, on the first block that needs it (SQL-15).
- run_on_worker sends one plugin-execution request (plain dict in) with an id
  of its own and the trust spec a blank CA uses (REQ-4.5.16) on the worker's
  stdin and waits for the JSON answer carrying that id (return_value / logs /
  status / error). Callers sharing one worker run at
  the same time; one reader per worker routes every answer to its request. A
  canceled wait tells the worker to cancel that one request (REQ-3.2.2.4).
- close_worker tears the worker down; nothing WAVE-authored persists on the
  remote host (agentless).
- stop_worker tells a working remote host to stop everything and go; it is sync
  so a registry teardown can call it.

The interpreter probe rides connection.run(...); the persistent worker rides
connection.create_process(...), matching the shipped SSH session plugins.
"""

import asyncio
import base64
import contextlib
import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wavecore.connectivity.sql.dialects import dialect
from wavecore.core.remote_exec.bundle import build_bundle, worker_bootstrap

NO_INTERPRETER_MSG = "Remote Execution: no compatible Python interpreter on the host"
REMOTE_PYTHON_FLOOR = (3, 10)
# Answers "<major>.<minor> <machine> <libc>"; platform never names musl, its loader does.
_PROBE = (
    '-c "import glob, platform, sys; libc = platform.libc_ver()[0]; '
    "print('%d.%d' % sys.version_info[:2], platform.machine(), 'glibc' if libc == 'glibc' "
    "else 'musl' if glob.glob('/lib/ld-musl-*') else libc or 'unknown')\""
)

WHEELS_DIR = Path(__file__).parents[3] / "vendor" / "wheels"
WHEELS_LOCK = WHEELS_DIR.parent / "wheels.lock"
# The prebuilt packages each compiled driver needs on a remote host, in push order.
COMPILED_PACKAGES: dict[str, tuple[str, ...]] = {
    "oracle": ("oracledb", "cryptography", "cffi", "typing_extensions"),
    "mssql": ("pyopenssl", "cryptography", "cffi", "typing_extensions"),
    "sqlite": ("apsw",),
}

# One bundle carries every remotable plugin; the worker dispatches by plugin id.
_WORKER_BUNDLE_REF = "remote-worker"
# The request line that tells a working remote host to stop what it is doing and go.
STOP_REQUEST = json.dumps({"stop": True}) + "\n"
_NO_ANSWER_DETAIL = "the worker exited without answering"


@dataclass
class WorkerHandle:
    """The live-worker record the registry tracks."""

    process: Any
    host: str
    interpreter: str
    # Requests still waiting for their answer, by request id.
    waiting: dict[str, "asyncio.Future[dict[str, Any]]"] = field(
        default_factory=dict, repr=False, compare=False
    )
    reader: "asyncio.Task[None] | None" = field(default=None, repr=False, compare=False)
    # Why the worker's output ended, once it has.
    stopped: str | None = field(default=None, repr=False, compare=False)
    # What the host runs: {"python": (major, minor), "machine": ..., "libc": ...}.
    probe: dict[str, Any] | None = None
    # The names of the wheels this worker already holds.
    wheels: set[str] = field(default_factory=set, repr=False, compare=False)

    def close(self) -> None:
        """Terminal cleanup: tear down the worker process, best-effort."""
        if self.reader is not None:
            self.reader.cancel()
        with contextlib.suppress(Exception):
            self.process.close()


class UnsupportedHost(RuntimeError):
    """A remote host no carried build of a compiled driver fits (SQL-15)."""


def _parse_probe(stdout: Any) -> dict[str, Any] | None:
    """The probed version, machine and libc, or None when the reply is not a probe answer."""
    # A login banner or a MOTD lands on stdout ahead of the answer; the last line is it.
    lines = [line for line in str(stdout or "").splitlines() if line.strip()]
    words = lines[-1].split() if lines else []
    if len(words) != 3:
        return None
    parts = words[0].split(".")
    try:
        version = (int(parts[0]), int(parts[1]))
    except (IndexError, ValueError):
        return None
    return {"python": version, "machine": words[1], "libc": words[2]}


async def probe(connection: Any, interpreter: str = "python3") -> dict[str, Any]:
    """Ask the host interpreter what it is; refuse a missing, unreadable or too old one."""
    reply = await connection.run(f"{interpreter} {_PROBE}")
    if getattr(reply, "exit_status", 1) != 0:
        raise RuntimeError(NO_INTERPRETER_MSG)
    found = _parse_probe(getattr(reply, "stdout", ""))
    if found is None:
        raise RuntimeError(f"Remote interpreter '{interpreter}' did not report a readable version")
    major, minor = found["python"]
    if found["python"] < REMOTE_PYTHON_FLOOR:
        raise RuntimeError(
            f"Remote interpreter '{interpreter}' is Python {major}.{minor}; "
            "Remote Execution needs Python 3.10 or newer"
        )
    return found


def _lock_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = json.loads(WHEELS_LOCK.read_text(encoding="utf-8"))["wheels"]
    return rows


def _fitting(
    rows: list[dict[str, Any]], package: str, python: str, machine: str, libc: str
) -> dict[str, Any] | None:
    """The lock row of a package built for this Python on this machine and libc."""
    return next(
        (
            row
            for row in rows
            if row["package"] == package
            and python in row["python"]
            and row["machine"] in (machine, "any")
            and row["libc"] in (libc, "any")
        ),
        None,
    )


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def _unsupported_message(
    rows: list[dict[str, Any]], database_type: str, found: tuple[str, str, str], host: str
) -> str:
    """Names the host, the type, what the host has and every host WAVE carries the type for."""
    packages = COMPILED_PACKAGES[database_type]
    pythons = {python for row in rows for python in row["python"]}
    machines = {row["machine"] for row in rows} - {"any"}
    libcs = {row["libc"] for row in rows} - {"any"}
    carried = [
        (python, machine, libc)
        for python in pythons
        for machine in machines
        for libc in libcs
        if all(_fitting(rows, package, python, machine, libc) for package in packages)
    ]
    versions = sorted({python for python, _machine, _libc in carried}, key=_version_key)
    span = versions[0] if len(versions) == 1 else f"{versions[0]}-{versions[-1]}"
    platforms = ", ".join(sorted({f"{machine} / {libc}" for _python, machine, libc in carried}))
    python, machine, libc = found
    return (
        f"{host} cannot run {dialect(database_type).NAME}: it has Python {python} on "
        f"{machine} / {libc}; WAVE carries Python {span} on {platforms}"
    )


def select_wheels(probe: dict[str, Any], database_type: str, host: str) -> list[Path]:
    """The one carried build of each package the type's driver needs that fits the host."""
    if database_type not in COMPILED_PACKAGES:
        return []
    rows = _lock_rows()
    major, minor = probe["python"]
    found = (f"{major}.{minor}", str(probe["machine"]), str(probe["libc"]))
    picked = [_fitting(rows, package, *found) for package in COMPILED_PACKAGES[database_type]]
    paths: list[Path] = []
    for row in picked:
        if row is None:
            raise UnsupportedHost(_unsupported_message(rows, database_type, found, host))
        paths.append(WHEELS_DIR / row["file"])
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(
                f"Remote wheel {path.name} is missing from {WHEELS_DIR}: "
                "run scripts/fetch-remote-wheels.sh"
            )
    return paths


def wheel_frame(paths: list[Path]) -> str:
    """One worker input line carrying every wheel by name, its bytes in base64."""
    wheels = [
        {"name": path.name, "data": base64.b64encode(path.read_bytes()).decode("ascii")}
        for path in paths
    ]
    return json.dumps({"wheels": wheels}) + "\n"


async def push_wheels(worker: WorkerHandle, paths: list[Path]) -> None:
    """Send the worker the wheels it does not hold yet, in one line ahead of the next request."""
    fresh = [path for path in paths if path.name not in worker.wheels]
    if not fresh:
        return
    worker.process.stdin.write(wheel_frame(fresh))
    # Recorded before the drain, so a block awaiting it meanwhile never sends them twice.
    worker.wheels.update(path.name for path in fresh)
    await worker.process.stdin.drain()


def _worker_command(interpreter: str) -> str:
    """The remote command that runs the stdin bootstrap under the interpreter in UTF-8 mode."""
    return f'{interpreter} -X utf8 -c "{worker_bootstrap()}"'


def _stopped_text(detail: str) -> str:
    return f"Remote Execution worker on the host stopped: {detail.strip() or _NO_ANSWER_DETAIL}"


async def _stopped_message(process: Any) -> str:
    """The host's own complaint is on stderr and is the only thing the user can act on."""
    return _stopped_text(await process.stderr.read())


async def open_worker(connection: Any, host: str, interpreter: str = "python3") -> WorkerHandle:
    """Validate the interpreter, push the bundle over stdin, start the worker named ``host``.

    The vendored worker payload is too large for a command-line argument, so
    it rides stdin behind a tiny bootstrap: a byte-count line, then the source.
    """
    found = await probe(connection, interpreter)
    payload = build_bundle(_WORKER_BUNDLE_REF)
    source = payload.decode("utf-8")
    process = await connection.create_process(_worker_command(interpreter))
    try:
        process.stdin.write(f"{len(payload)}\n")
        process.stdin.write(source)
        await process.stdin.drain()
    except OSError as exc:
        # A worker that died mid-push breaks the pipe with no message of its own.
        raise RuntimeError(await _stopped_message(process)) from exc
    return WorkerHandle(process=process, host=host, interpreter=interpreter, probe=found)


async def _read_answers(worker: WorkerHandle) -> None:
    """Route every answer to the request waiting on its id; fail them all once the output ends."""
    proc = worker.process
    try:
        while line := await proc.stdout.readline():
            answer: dict[str, Any] = json.loads(line)
            waiting = worker.waiting.get(str(answer.pop("id", None)))
            if waiting is not None and not waiting.done():
                waiting.set_result(answer)
        stopped = await _stopped_message(proc)
    except Exception as exc:
        stopped = _stopped_text(str(exc))
    worker.stopped = stopped
    for waiting in worker.waiting.values():
        if not waiting.done():
            waiting.set_exception(RuntimeError(stopped))


def _ensure_reader(worker: WorkerHandle) -> None:
    if worker.reader is None:
        worker.reader = asyncio.create_task(_read_answers(worker))


async def run_on_worker(
    worker: WorkerHandle,
    plugin_id: str,
    params: dict[str, Any],
    variables: dict[str, Any],
    trust: dict[str, Any],
) -> dict[str, Any]:
    """Execute one plugin remotely under the WAVE host's trust spec; JSON response out."""
    if worker.stopped is not None:
        raise RuntimeError(worker.stopped)
    request_id = uuid.uuid4().hex
    request = {
        "id": request_id,
        "plugin_id": plugin_id,
        "params": params,
        "variables": variables,
        "trust": trust,
    }
    answer: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
    worker.waiting[request_id] = answer
    proc = worker.process
    try:
        _ensure_reader(worker)
        proc.stdin.write(json.dumps(request) + "\n")
        await proc.stdin.drain()
        return await answer
    except asyncio.CancelledError:
        # The remote host is still working on this request; it must not outlive the cancel.
        with contextlib.suppress(Exception):
            proc.stdin.write(json.dumps({"cancel": request_id}) + "\n")
        raise
    finally:
        worker.waiting.pop(request_id, None)


def stop_worker(worker: WorkerHandle) -> None:
    """Tell the remote host's worker to stop and end its input, best-effort; the close follows."""
    proc = worker.process
    with contextlib.suppress(Exception):
        proc.stdin.write(STOP_REQUEST)
        proc.stdin.write_eof()


async def close_worker(worker: WorkerHandle) -> None:
    """Best-effort graceful teardown; nothing WAVE-authored persists on the remote host."""
    proc = worker.process
    with contextlib.suppress(Exception):
        proc.stdin.write_eof()
    with contextlib.suppress(Exception):
        proc.close()
    with contextlib.suppress(Exception):
        await proc.wait_closed()
    if worker.reader is not None:
        worker.reader.cancel()
        # Never re-raises the reader's own cancel, so a cancel of this teardown still goes up.
        await asyncio.wait({worker.reader})
