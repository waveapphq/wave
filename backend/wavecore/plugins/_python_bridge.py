"""The program WAVE runs inside the block's own interpreter (REQ-3.4.1.2, PYRUN-10).

Standard library only, valid on Python 3.8, and free of every wavecore import: it
travels into whatever interpreter the author names. File descriptor 3 is the only
channel back to WAVE.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import traceback
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

if sys.hexversion < 0x30800F0:
    sys.stderr.write("wave bridge: Python 3.8 or newer is required\n")
    raise SystemExit(2)

CHANNEL_FD = 3
TYPE_KEY = "__wave_type"


def _unsupported(value: Any) -> dict[str, str]:
    """A value JSON cannot carry travels as its own marker, never null, and fails its export."""
    return {TYPE_KEY: "unsupported"}


def _write(payload: dict[str, Any]) -> None:
    line = json.dumps(payload, default=_unsupported) + "\n"
    os.write(CHANNEL_FD, line.encode("utf-8"))


def _cell(value: Any, kind: str) -> Any:
    if kind == "float":
        return Decimal(str(value))
    return value


class _Table:
    """A WAVE table as the script reads it: rows as dicts, and nothing that mutates."""

    def __init__(self, columns: list[str], types: list[str], rows: list[list[Any]]) -> None:
        self._columns = list(columns)
        self._types = list(types)
        self._rows = [list(row) for row in rows]

    @property
    def columns(self) -> list[str]:
        return list(self._columns)

    @property
    def rows(self) -> list[dict[str, Any]]:
        return [self._row(row) for row in self._rows]

    def __len__(self) -> int:
        return len(self._rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        return self._row(self._rows[index])

    def __iter__(self) -> Iterator[dict[str, Any]]:
        return iter(self.rows)

    def _row(self, row: list[Any]) -> dict[str, Any]:
        return {
            self._columns[index]: _cell(row[index], self._types[index])
            for index in range(len(self._columns))
        }

    def _envelope(self) -> dict[str, Any]:
        return {
            TYPE_KEY: "table",
            "columns": list(self._columns),
            "types": list(self._types),
            "rows": [list(row) for row in self._rows],
        }


def _decode(value: Any) -> Any:
    """One typed value from WAVE as the Python object the script reads (PYRUN-5)."""
    if isinstance(value, dict):
        kind = value.get(TYPE_KEY)
        if kind == "decimal":
            return Decimal(value["value"])
        if kind == "table":
            return _Table(value["columns"], value["types"], value["rows"])
        return {key: _decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode(item) for item in value]
    return value


def _encode(value: Any) -> Any:
    """One script global as the typed value WAVE reads back (PYRUN-6)."""
    if isinstance(value, _Table):
        return value._envelope()
    if isinstance(value, Decimal):
        return {TYPE_KEY: "decimal", "value": str(value)}
    if isinstance(value, float):
        return {TYPE_KEY: "decimal", "value": repr(value)}
    if isinstance(value, dict):
        return {str(key): _encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    return value


class _ChannelHandler(logging.Handler):
    """Every record on the root logger reaches the run console (PYRUN-8)."""

    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage()
        if record.exc_info:
            trace = "".join(traceback.format_exception(*record.exc_info))
            message = message + "\n" + trace.rstrip("\n")
        if record.stack_info:
            message = message + "\n" + record.stack_info
        _write({"log": record.levelname, "message": message})


def _channel_ready() -> bool:
    try:
        os.fstat(CHANNEL_FD)
    except OSError:
        return False
    return True


def _install_logging() -> None:
    root = logging.getLogger()
    root.handlers = [_ChannelHandler()]
    root.setLevel(logging.DEBUG)


def _report(exc: BaseException) -> None:
    """The script's own traceback on stderr, without the bridge's frame."""
    frame = exc.__traceback__
    below = frame.tb_next if frame is not None else None
    sys.stderr.write("".join(traceback.format_exception(type(exc), exc, below)))


def _exit_code(code: Any) -> int:
    """The exit code CPython gives sys.exit's value; a non-number is written to stderr, as there."""
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    try:
        text = str(code)
    except Exception as exc:
        # The exit this runs under is no part of that failure, so it is not chained onto it.
        exc.__suppress_context__ = True
        sys.stderr.write("\n")
        _report(exc)
        return 1
    sys.stderr.write(text + "\n")
    return 1


def _namespace(envelope: dict[str, Any]) -> dict[str, Any]:
    namespace: dict[str, Any] = {
        "__name__": "__main__",
        "__file__": envelope["script"],
        "__doc__": None,
        "__package__": None,
    }
    for name, value in envelope["inputs"].items():
        namespace[name] = _decode(value)
    return namespace


def _run(script: str, namespace: dict[str, Any]) -> tuple[str | None, int]:
    """Run the script as __main__; how it ended, unless its own sys.exit travels on (PYRUN-7)."""
    try:
        with open(script, encoding="utf-8") as handle:
            code = compile(handle.read(), script, "exec")
    except SyntaxError as exc:
        _report(exc)
        return f"SyntaxError: {exc.msg} (line {exc.lineno or 1})", 1
    try:
        exec(code, namespace)
    except SystemExit:
        raise
    except BaseException as exc:
        _report(exc)
        return f"{type(exc).__name__}: {exc}", 1
    return None, 0


def _final(
    exports: dict[str, str], namespace: dict[str, Any], error: str | None, exit_code: int
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    missing: list[str] = []
    for name in exports:
        if name in namespace:
            values[name] = _encode(namespace[name])
        else:
            missing.append(name)
    return {"exports": values, "missing": missing, "error": error, "exit_code": exit_code}


def main() -> int:
    """Announce the interpreter, run the script, then hand back what it set."""
    streams: Any = (sys.stdout, sys.stderr)
    for stream in streams:
        # The host's locale never decides the bytes; each stream keeps its own error handling.
        stream.reconfigure(encoding="utf-8", errors=stream.errors)
    if not _channel_ready():
        sys.stderr.write("wave bridge: message channel missing\n")
        return 2
    version = ".".join(str(part) for part in sys.version_info[:3])
    _write({"hello": "wave-bridge", "python": version})
    with open(os.environ["WAVE_BRIDGE_IN"], encoding="utf-8") as handle:
        envelope = json.load(handle)
    script = envelope["script"]
    namespace = _namespace(envelope)
    _install_logging()
    sys.argv = [script] + list(envelope["argv"])
    sys.path[0] = envelope["working_dir"]
    if envelope["mode"] == "file":
        sys.path.insert(1, os.path.dirname(script))
    try:
        error, exit_code = _run(script, namespace)
    except SystemExit as exc:
        # The value is written and recorded here, so the exit carries only the code it stands for.
        code = _exit_code(exc.code)
        _write(_final(envelope["exports"], namespace, None, code))
        exc.code = code
        raise
    _write(_final(envelope["exports"], namespace, error, exit_code))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
