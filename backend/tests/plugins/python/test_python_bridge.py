"""The bridge program in isolation (REQ-3.4.1.2).

PYRUN-10: the bridge runs inside whatever interpreter the author names, so it stays on the
standard library and on syntax Python 3.8 accepts. PYRUN-5, PYRUN-6, PYRUN-8 and PYRUN-9: fd 3
carries the hello line, one line per logging record and the final export message, while the
script itself runs as `__main__` with the Working Directory first on `sys.path`.

Two layers: a real child interpreter, which is the behavioral contract, and the same program
in process with its channel pointed at a file this process owns.
"""

import ast
import json
import logging
import os
import py_compile
import re
import runpy
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from wavecore.plugins import _python_bridge
from wavecore.plugins._python_bridge import (
    _channel_ready,
    _ChannelHandler,
    _decode,
    _encode,
    _exit_code,
    _final,
    _install_logging,
    _namespace,
    _report,
    _run,
    _Table,
    _write,
    main,
)

BRIDGE_PATH = Path(str(_python_bridge.__file__))
SOURCE = BRIDGE_PATH.read_text(encoding="utf-8")

CHANNEL_REDIRECT = 'exec 3>"$1"\nshift\nexec "$@"\n'

HELLO: dict[str, Any] = {
    "hello": "wave-bridge",
    "python": ".".join(str(part) for part in sys.version_info[:3]),
}

CHANNEL_MISSING = "wave bridge: message channel missing"
TOO_OLD = "wave bridge: Python 3.8 or newer is required"

FINAL_KEYS = ["error", "exit_code", "exports", "missing"]

READINGS: dict[str, Any] = {
    "__wave_type": "table",
    "columns": ["sensor", "temp_c", "count", "ok"],
    "types": ["string", "float", "integer", "boolean"],
    "rows": [["a1", "21.5", 3, True], ["b7", "18.25", 0, False]],
}

SHOWN_ROWS = [
    {"sensor": "str:a1", "temp_c": "Decimal:21.5", "count": "int:3", "ok": "bool:True"},
    {"sensor": "str:b7", "temp_c": "Decimal:18.25", "count": "int:0", "ok": "bool:False"},
]

SCALAR_INPUTS: dict[str, Any] = {
    "text": "hello",
    "count": 7,
    "ratio": {"__wave_type": "decimal", "value": "1.5"},
    "exact": {"__wave_type": "decimal", "value": "0.1000000000000000000000001"},
    "flag": True,
    "nothing": None,
    "items": ["a", 1, True],
    "pairs": {"k": "v", "n": 2},
}

# An interpreter that reports itself as 3.7: the bridge source is compiled first, then the
# version the guard reads is moved back, so the guard runs on this machine's own Python.
FAKE_OLD_INTERPRETER = """\
import sys

bridge = sys.argv[1]
sys.argv = [bridge] + sys.argv[2:]
with open(bridge, encoding="utf-8") as handle:
    code = compile(handle.read(), bridge, "exec")
sys.version_info = (3, 7, 17, "final", 0)
sys.hexversion = 0x30711F0
exec(code, {"__name__": "__main__", "__file__": bridge})
"""

PATH_PROBE = "import json, sys\nprint(json.dumps(sys.path))\n"

ARGV_PROBE = "import json, sys\nprint(json.dumps(sys.argv))\n"

NAME_PROBE = "print(__name__)\n"

SYNTAX_ERROR_SCRIPT = "a = 1\nb = 2\nc = = 3\n"

EXIT_WITH_TEXT_SCRIPT = "import sys\nsys.stderr.write('before\\n')\nsys.exit('stopping here')\n"

EXIT_WITH_UNPRINTABLE_SCRIPT = """\
import sys


class Unprintable:
    def __str__(self):
        raise ValueError("no text")


total = 3
sys.exit(Unprintable())
"""

LOGGING_SCRIPT = """\
import logging

logging.debug("d %d", 1)
logging.info("i")
logging.warning("w")
logging.error("e")
logging.critical("c")
logging.getLogger("child.of.root").info("from a child")
"""

EXPECTED_LOGS = [
    {"log": "DEBUG", "message": "d 1"},
    {"log": "INFO", "message": "i"},
    {"log": "WARNING", "message": "w"},
    {"log": "ERROR", "message": "e"},
    {"log": "CRITICAL", "message": "c"},
    {"log": "INFO", "message": "from a child"},
]

TABLE_PROBE = """\
import json

MUTATORS = [
    "add", "add_row", "append", "clear", "extend", "insert", "pop", "popitem",
    "remove", "reverse", "set", "setdefault", "sort", "update",
]


def shown(row):
    return {key: type(value).__name__ + ":" + str(value) for key, value in row.items()}


rows = list(readings)
first = readings[0]
print(json.dumps({
    "iterated": [shown(row) for row in rows],
    "row_type": type(rows[0]).__name__,
    "indexed": shown(first),
    "length": len(readings),
    "columns": readings.columns,
    "rows_attr": [shown(row) for row in readings.rows],
    "public": sorted(name for name in dir(type(readings)) if not name.startswith("_")),
    "mutators": sorted(name for name in MUTATORS if hasattr(readings, name)),
    "item_writes": sorted(
        name for name in ("__setitem__", "__delitem__") if hasattr(readings, name)
    ),
}))
"""

EXPORT_SCRIPT = """\
from decimal import Decimal

text = "ok"
count = 4
ratio = 2.5
exact = Decimal("0.1")
flag = False
items = [1, 2]
pairs = {"a": 1}
grid = [{"id": 1, "ok": True}]
from_input = readings
"""

EXPORT_TYPES: dict[str, str] = {
    "text": "string",
    "count": "integer",
    "ratio": "float",
    "exact": "float",
    "flag": "boolean",
    "items": "array",
    "pairs": "map",
    "grid": "table",
    "from_input": "table",
    "never_set": "string",
    "also_missing": "integer",
}

GREETING = "Grüße 測試"
GREETING_LINE = f"{GREETING}\n".encode()

GREETING_ON_STDOUT = f'print("{GREETING}")\n'

GREETING_ON_STDERR = f'import sys\n\nsys.stderr.write("{GREETING}\\n")\n'


@dataclass(frozen=True)
class BridgeRun:
    """One bridge process: its streams, its exit code and every fd-3 message it wrote."""

    stdout: str
    stderr: str
    exit_code: int
    messages: list[dict[str, Any]]
    script: str
    working_dir: str

    @property
    def final(self) -> dict[str, Any]:
        """The last fd-3 line: the export message."""
        return self.messages[-1]

    @property
    def logs(self) -> list[dict[str, Any]]:
        """Every logging line, in the order the records were emitted."""
        return [message for message in self.messages if "log" in message]


def child_environment(envelope_path: Path) -> dict[str, str]:
    """The environment the plugin hands the interpreter, with the coverage hooks out of the way."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("COV_CORE_")}
    env["WAVE_BRIDGE_IN"] = str(envelope_path)
    return env


@dataclass(frozen=True)
class BridgeInput:
    """What the plugin lays out before a launch: the script, the envelope, the working directory."""

    script: Path
    envelope: Path
    working_dir: Path


def prepare_bridge(
    tmp_path: Path,
    body: str,
    *,
    mode: str = "source",
    inputs: dict[str, Any] | None = None,
    exports: dict[str, str] | None = None,
    arguments: list[str] | None = None,
) -> BridgeInput:
    """Write the script and the WAVE_BRIDGE_IN envelope in the shape the plugin writes them."""
    working_dir = tmp_path / "work"
    working_dir.mkdir(exist_ok=True)
    folder = tmp_path / ("private" if mode == "source" else "scripts")
    folder.mkdir(exist_ok=True)
    script = folder / "script.py"
    script.write_text(body, encoding="utf-8")

    envelope_path = tmp_path / "bridge-in.json"
    envelope_path.write_text(
        json.dumps(
            {
                "version": 1,
                "mode": mode,
                "script": str(script),
                "working_dir": str(working_dir),
                "argv": arguments or [],
                "inputs": inputs or {},
                "exports": exports or {},
            }
        ),
        encoding="utf-8",
    )
    return BridgeInput(script=script, envelope=envelope_path, working_dir=working_dir)


def run_bridge(
    tmp_path: Path,
    body: str,
    *,
    mode: str = "source",
    inputs: dict[str, Any] | None = None,
    exports: dict[str, str] | None = None,
    arguments: list[str] | None = None,
    interpreter: list[str] | None = None,
    channel: bool = True,
) -> BridgeRun:
    """Start the bridge over one script the way the plugin does: fd 3 open, WAVE_BRIDGE_IN set."""
    prepared = prepare_bridge(
        tmp_path, body, mode=mode, inputs=inputs, exports=exports, arguments=arguments
    )

    command = [
        *(interpreter or [sys.executable]),
        str(BRIDGE_PATH),
        str(prepared.script),
        *(arguments or []),
    ]
    channel_path = tmp_path / "channel.jsonl"
    if channel:
        command = ["/bin/sh", "-c", CHANNEL_REDIRECT, "sh", str(channel_path), *command]

    done = subprocess.run(
        command,
        cwd=str(prepared.working_dir),
        env=child_environment(prepared.envelope),
        capture_output=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )
    written = channel_path.read_text(encoding="utf-8") if channel_path.exists() else ""
    return BridgeRun(
        stdout=done.stdout,
        stderr=done.stderr,
        exit_code=done.returncode,
        messages=[json.loads(line) for line in written.splitlines() if line.strip()],
        script=str(prepared.script),
        working_dir=str(prepared.working_dir),
    )


def printed_bytes(
    tmp_path: Path, body: str, host_env: dict[str, str]
) -> subprocess.CompletedProcess[bytes]:
    """Run one script under the bridge in host_env; its two streams come back as raw bytes."""
    prepared = prepare_bridge(tmp_path, body)
    bridge = [sys.executable, str(BRIDGE_PATH), str(prepared.script)]
    return subprocess.run(
        ["/bin/sh", "-c", CHANNEL_REDIRECT, "sh", str(tmp_path / "channel.jsonl"), *bridge],
        cwd=str(prepared.working_dir),
        env={**host_env, "WAVE_BRIDGE_IN": str(prepared.envelope)},
        capture_output=True,
        timeout=60,
        check=False,
    )


def probe_source(names: list[str]) -> str:
    """A script that reports the Python type and the text of each global it was handed."""
    return (
        "import json\n"
        f"_names = {names!r}\n"
        "print(json.dumps({\n"
        "    name: {\n"
        "        'type': type(globals()[name]).__name__,\n"
        "        'module': type(globals()[name]).__module__,\n"
        "        'text': str(globals()[name]),\n"
        "    }\n"
        "    for name in _names\n"
        "}))\n"
    )


def described(type_name: str, module: str, text: str) -> dict[str, str]:
    """One probe entry: the Python class a value arrived as and how it prints."""
    return {"type": type_name, "module": module, "text": text}


def imported_roots(source: str) -> set[str]:
    """The top-level package of every module the source imports."""
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").split(".")[0])
    return roots


def first_running_statement(source: str) -> ast.stmt | None:
    """The first module-level statement that is neither the docstring nor an import."""
    for index, node in enumerate(ast.parse(source).body):
        docstring = (
            index == 0 and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
        )
        if docstring or isinstance(node, ast.Import | ast.ImportFrom):
            continue
        return node
    return None


class TestTheBridgeTravelsToAnyInterpreter:
    """PYRUN-10: the program is copied into a foreign interpreter, so it leans on nothing."""

    def test_the_source_was_found(self) -> None:
        assert SOURCE.strip()

    def test_it_parses_under_python_38_syntax(self) -> None:
        assert ast.parse(SOURCE, feature_version=(3, 8))

    def test_py_compile_compiles_the_file(self, tmp_path: Path) -> None:
        assert py_compile.compile(
            str(BRIDGE_PATH), cfile=str(tmp_path / "bridge.pyc"), doraise=True
        )

    def test_it_imports_only_the_standard_library(self) -> None:
        assert imported_roots(SOURCE) <= set(sys.stdlib_module_names)

    def test_it_imports_nothing_from_wavecore(self) -> None:
        assert "wavecore" not in imported_roots(SOURCE)

    def test_it_makes_no_relative_import(self) -> None:
        assert not [
            node
            for node in ast.walk(ast.parse(SOURCE))
            if isinstance(node, ast.ImportFrom) and node.level
        ]

    def test_the_version_guard_runs_before_anything_else(self) -> None:
        guard = first_running_statement(SOURCE)

        assert isinstance(guard, ast.If)
        assert "version_info" in ast.dump(guard.test) or "hexversion" in ast.dump(guard.test)


class TestAnInterpreterOlderThan38IsRefused:
    """The 3.8 floor is checked before the bridge does anything else (PYRUN-10)."""

    @pytest.fixture(scope="class")
    def refused(self, tmp_path_factory: pytest.TempPathFactory) -> BridgeRun:
        tmp_path = tmp_path_factory.mktemp("old-interpreter")
        launcher = tmp_path / "fake_old_interpreter.py"
        launcher.write_text(FAKE_OLD_INTERPRETER, encoding="utf-8")
        return run_bridge(
            tmp_path,
            "print('never reached')\n",
            interpreter=[sys.executable, str(launcher)],
        )

    def test_it_names_the_floor_on_stderr(self, refused: BridgeRun) -> None:
        assert refused.stderr.strip() == TOO_OLD

    def test_it_exits_two(self, refused: BridgeRun) -> None:
        assert refused.exit_code == 2

    def test_it_never_announces_itself(self, refused: BridgeRun) -> None:
        assert refused.messages == []

    def test_the_script_never_runs(self, refused: BridgeRun) -> None:
        assert refused.stdout == ""


class TestTheMessageChannelIsRequired:
    """fd 3 is the only way back to WAVE, so the bridge refuses to start without it."""

    @pytest.fixture(scope="class")
    def refused(self, tmp_path_factory: pytest.TempPathFactory) -> BridgeRun:
        return run_bridge(
            tmp_path_factory.mktemp("no-channel"),
            "print('never reached')\n",
            channel=False,
        )

    def test_it_names_the_missing_channel_on_stderr(self, refused: BridgeRun) -> None:
        assert refused.stderr.strip() == CHANNEL_MISSING

    def test_it_exits_two(self, refused: BridgeRun) -> None:
        assert refused.exit_code == 2

    def test_the_script_never_runs(self, refused: BridgeRun) -> None:
        assert refused.stdout == ""


class TestTheBridgeAnnouncesItself:
    """The hello line is the interpreter probe: the plugin fails the block without it."""

    def test_the_first_line_is_the_hello(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "pass\n")

        assert run.messages[0] == HELLO

    def test_the_hello_is_written_before_the_script_is_compiled(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, SYNTAX_ERROR_SCRIPT)

        assert run.messages[0] == HELLO

    def test_no_other_line_carries_a_hello(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, LOGGING_SCRIPT)

        assert [message for message in run.messages if "hello" in message] == [HELLO]


class TestTypedInputsBecomeGlobals:
    """PYRUN-5: every value kind of the envelope arrives as the Python object it maps to."""

    @pytest.fixture(scope="class")
    def decoded(self, tmp_path_factory: pytest.TempPathFactory) -> dict[str, dict[str, str]]:
        run = run_bridge(
            tmp_path_factory.mktemp("typed-inputs"),
            probe_source(sorted(SCALAR_INPUTS)),
            inputs=SCALAR_INPUTS,
        )
        assert run.exit_code == 0, run.stderr
        parsed: dict[str, dict[str, str]] = json.loads(run.stdout)
        return parsed

    def test_a_string_arrives_as_str(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["text"] == described("str", "builtins", "hello")

    def test_an_integer_arrives_as_int(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["count"] == described("int", "builtins", "7")

    def test_a_float_arrives_as_decimal(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["ratio"] == described("Decimal", "decimal", "1.5")

    def test_a_float_keeps_every_digit(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["exact"]["text"] == "0.1000000000000000000000001"

    def test_a_boolean_arrives_as_bool(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["flag"] == described("bool", "builtins", "True")

    def test_null_arrives_as_none(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["nothing"] == described("NoneType", "builtins", "None")

    def test_an_array_arrives_as_list(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["items"] == described("list", "builtins", "['a', 1, True]")

    def test_a_map_arrives_as_dict(self, decoded: dict[str, dict[str, str]]) -> None:
        assert decoded["pairs"] == described("dict", "builtins", "{'k': 'v', 'n': 2}")


class TestTheBridgeTable:
    """PYRUN-5: a table reads the way it reads in an expression, and never changes."""

    @pytest.fixture(scope="class")
    def probed(self, tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
        run = run_bridge(
            tmp_path_factory.mktemp("bridge-table"),
            TABLE_PROBE,
            inputs={"readings": READINGS},
        )
        assert run.exit_code == 0, run.stderr
        parsed: dict[str, Any] = json.loads(run.stdout)
        return parsed

    def test_rows_iterate_as_dicts(self, probed: dict[str, Any]) -> None:
        assert probed["row_type"] == "dict"

    def test_iteration_hands_back_every_row_in_order(self, probed: dict[str, Any]) -> None:
        assert probed["iterated"] == SHOWN_ROWS

    def test_the_table_indexes_a_row(self, probed: dict[str, Any]) -> None:
        assert probed["indexed"] == SHOWN_ROWS[0]

    def test_a_float_cell_is_an_exact_decimal(self, probed: dict[str, Any]) -> None:
        assert probed["iterated"][1]["temp_c"] == "Decimal:18.25"

    def test_len_counts_the_rows(self, probed: dict[str, Any]) -> None:
        assert probed["length"] == 2

    def test_columns_names_the_columns_in_order(self, probed: dict[str, Any]) -> None:
        assert probed["columns"] == READINGS["columns"]

    def test_rows_holds_the_same_row_dicts(self, probed: dict[str, Any]) -> None:
        assert probed["rows_attr"] == SHOWN_ROWS

    def test_it_has_no_mutating_method(self, probed: dict[str, Any]) -> None:
        assert probed["mutators"] == []

    def test_it_refuses_item_assignment_and_deletion(self, probed: dict[str, Any]) -> None:
        assert probed["item_writes"] == []

    def test_it_exposes_nothing_but_columns_and_rows(self, probed: dict[str, Any]) -> None:
        assert probed["public"] == ["columns", "rows"]


class TestHowTheScriptRuns:
    """PYRUN-9: the script is the program, and the Working Directory leads its module path."""

    def test_the_script_runs_as_main(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, NAME_PROBE)

        assert run.stdout == "__main__\n"

    def test_argv_is_the_script_then_the_arguments(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, ARGV_PROBE, arguments=["one", "two"])

        assert json.loads(run.stdout) == [run.script, "one", "two"]

    def test_the_working_directory_leads_the_module_path(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, PATH_PROBE)

        assert json.loads(run.stdout)[0] == run.working_dir

    def test_the_bridge_own_folder_is_off_the_module_path(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, PATH_PROBE)

        assert str(BRIDGE_PATH.parent) not in json.loads(run.stdout)

    def test_source_mode_keeps_the_private_folder_off_the_module_path(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, PATH_PROBE)

        assert str(Path(run.script).parent) not in json.loads(run.stdout)

    def test_file_mode_puts_the_script_folder_on_the_module_path(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, PATH_PROBE, mode="file")

        path = json.loads(run.stdout)
        assert path[0] == run.working_dir
        assert str(Path(run.script).parent) in path

    def test_a_module_in_the_working_directory_imports_by_name(self, tmp_path: Path) -> None:
        working_dir = tmp_path / "work"
        working_dir.mkdir()
        (working_dir / "helpers.py").write_text("NAME = 'from helpers'\n", encoding="utf-8")

        run = run_bridge(tmp_path, "import helpers\nprint(helpers.NAME)\n")

        assert run.stdout == "from helpers\n"


class TestTheFinalMessage:
    """PYRUN-6 and PYRUN-7: one last line says what came back and how the script ended."""

    def test_it_carries_exactly_four_keys(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "total = 3\n", exports={"total": "integer"})

        assert sorted(run.final) == FINAL_KEYS

    def test_a_normal_end_reports_no_error(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "total = 3\n", exports={"total": "integer"})

        assert run.final == {"exports": {"total": 3}, "missing": [], "error": None, "exit_code": 0}

    def test_a_normal_end_exits_zero(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "total = 3\n", exports={"total": "integer"})

        assert run.exit_code == 0

    def test_sys_exit_records_its_code(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "import sys\nsys.exit(3)\n")

        assert run.final["exit_code"] == 3
        assert run.final["error"] is None
        assert run.exit_code == 3

    def test_a_bare_sys_exit_is_zero(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "import sys\nsys.exit()\n")

        assert run.final["exit_code"] == 0
        assert run.exit_code == 0

    def test_sys_exit_zero_is_zero(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "import sys\nsys.exit(0)\n")

        assert run.final["exit_code"] == 0
        assert run.exit_code == 0

    def test_sys_exit_none_is_zero_and_writes_nothing(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "import sys\nsys.exit(None)\n")

        assert run.final["exit_code"] == 0
        assert run.exit_code == 0
        assert run.stderr == ""

    def test_sys_exit_with_a_number_writes_nothing(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "import sys\nsys.exit(3)\n")

        assert run.stderr == ""

    def test_sys_exit_with_text_writes_it_as_the_last_stderr_line(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, EXIT_WITH_TEXT_SCRIPT)

        assert run.stderr == "before\nstopping here\n"

    def test_sys_exit_with_text_exits_one_with_no_error(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, EXIT_WITH_TEXT_SCRIPT)

        assert run.final["exit_code"] == 1
        assert run.final["error"] is None
        assert run.exit_code == 1

    def test_an_exit_value_whose_text_raises_writes_that_traceback(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, EXIT_WITH_UNPRINTABLE_SCRIPT)

        assert run.stderr.startswith("\nTraceback (most recent call last):\n")
        assert run.stderr.endswith("ValueError: no text\n")
        assert f'File "{BRIDGE_PATH}"' not in run.stderr
        assert run.final["error"] is None
        assert run.exit_code == 1

    def test_an_uncaught_exception_is_named_with_its_type(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "raise ValueError('boom')\n")

        assert run.final["error"] == "ValueError: boom"

    def test_an_uncaught_exception_exits_one(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "raise ValueError('boom')\n")

        assert run.final["exit_code"] == 1
        assert run.exit_code == 1

    def test_an_uncaught_exception_writes_its_traceback_to_stderr(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, "raise ValueError('boom')\n")

        assert "Traceback (most recent call last)" in run.stderr
        assert "ValueError: boom" in run.stderr

    def test_a_syntax_error_names_its_line(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, SYNTAX_ERROR_SCRIPT)

        assert re.fullmatch(r"SyntaxError: .+ \(line 3\)", run.final["error"])

    def test_a_syntax_error_exits_one_with_nothing_read(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, SYNTAX_ERROR_SCRIPT, exports={"total": "integer"})

        assert run.final["exit_code"] == 1
        assert run.final["exports"] == {}
        assert run.final["missing"] == ["total"]


class TestExportsAreEncoded:
    """PYRUN-6: each export travels in the typed envelope, never as printed text."""

    @pytest.fixture(scope="class")
    def final(self, tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
        run = run_bridge(
            tmp_path_factory.mktemp("exports"),
            EXPORT_SCRIPT,
            inputs={"readings": READINGS},
            exports=EXPORT_TYPES,
        )
        assert run.exit_code == 0, run.stderr
        return run.final

    def test_a_string_export_is_plain_json(self, final: dict[str, Any]) -> None:
        assert final["exports"]["text"] == "ok"

    def test_an_integer_export_is_plain_json(self, final: dict[str, Any]) -> None:
        assert final["exports"]["count"] == 4

    def test_a_float_export_travels_as_an_exact_decimal(self, final: dict[str, Any]) -> None:
        assert final["exports"]["ratio"] == {"__wave_type": "decimal", "value": "2.5"}

    def test_a_decimal_export_keeps_its_text(self, final: dict[str, Any]) -> None:
        assert final["exports"]["exact"] == {"__wave_type": "decimal", "value": "0.1"}

    def test_a_boolean_export_is_plain_json(self, final: dict[str, Any]) -> None:
        assert final["exports"]["flag"] is False

    def test_an_array_export_is_plain_json(self, final: dict[str, Any]) -> None:
        assert final["exports"]["items"] == [1, 2]

    def test_a_map_export_is_plain_json(self, final: dict[str, Any]) -> None:
        assert final["exports"]["pairs"] == {"a": 1}

    def test_a_list_of_dicts_stays_an_array(self, final: dict[str, Any]) -> None:
        assert final["exports"]["grid"] == [{"id": 1, "ok": True}]

    def test_a_table_export_uses_the_table_envelope(self, final: dict[str, Any]) -> None:
        assert final["exports"]["from_input"] == READINGS

    def test_names_the_script_never_set_are_listed_as_missing(self, final: dict[str, Any]) -> None:
        assert final["missing"] == ["never_set", "also_missing"]

    def test_a_missing_name_is_absent_from_the_exports(self, final: dict[str, Any]) -> None:
        assert "never_set" not in final["exports"]
        assert "also_missing" not in final["exports"]


class TestExportsSurviveAFailure:
    """PYRUN-6: the globals exist after a raise and after sys.exit, so they are still read."""

    def test_exports_are_read_after_an_uncaught_exception(self, tmp_path: Path) -> None:
        run = run_bridge(
            tmp_path,
            "total = 3\nraise ValueError('boom')\n",
            exports={"total": "integer"},
        )

        assert run.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": "ValueError: boom",
            "exit_code": 1,
        }

    def test_exports_are_read_after_sys_exit(self, tmp_path: Path) -> None:
        run = run_bridge(
            tmp_path,
            "import sys\ntotal = 3\nsys.exit(2)\n",
            exports={"total": "integer"},
        )

        assert run.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": None,
            "exit_code": 2,
        }

    def test_exports_are_read_after_sys_exit_with_text(self, tmp_path: Path) -> None:
        run = run_bridge(
            tmp_path,
            "import sys\ntotal = 3\nsys.exit('stopping here')\n",
            exports={"total": "integer"},
        )

        assert run.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": None,
            "exit_code": 1,
        }

    def test_exports_are_read_when_the_exit_value_has_no_text(self, tmp_path: Path) -> None:
        run = run_bridge(tmp_path, EXIT_WITH_UNPRINTABLE_SCRIPT, exports={"total": "integer"})

        assert run.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": None,
            "exit_code": 1,
        }


class TestNoneAndAnUncarriableValueTravelApart:
    """PYRUN-6: None travels as null, so a value JSON cannot carry needs a marker of its own."""

    def test_none_is_null_and_a_value_json_cannot_carry_is_not(self, tmp_path: Path) -> None:
        run = run_bridge(
            tmp_path,
            "nothing = None\nhandle = object()\n",
            exports={"nothing": "string", "handle": "string"},
        )

        assert run.exit_code == 0, run.stderr
        assert run.final["missing"] == []
        assert run.final["exports"]["nothing"] is None
        assert run.final["exports"]["handle"] is not None


class TestTheLoggingRelay:
    """PYRUN-8: every record on the root logger reaches WAVE over the same channel."""

    @pytest.fixture(scope="class")
    def logged(self, tmp_path_factory: pytest.TempPathFactory) -> BridgeRun:
        run = run_bridge(tmp_path_factory.mktemp("logging"), LOGGING_SCRIPT)
        assert run.exit_code == 0, run.stderr
        return run

    def test_every_level_reaches_the_channel(self, logged: BridgeRun) -> None:
        assert logged.logs == EXPECTED_LOGS

    def test_one_line_per_record(self, logged: BridgeRun) -> None:
        assert len(logged.logs) == len(EXPECTED_LOGS)

    def test_the_arguments_are_formatted_into_the_message(self, logged: BridgeRun) -> None:
        assert logged.logs[0] == {"log": "DEBUG", "message": "d 1"}

    def test_a_child_logger_reaches_the_channel(self, logged: BridgeRun) -> None:
        assert logged.logs[-1] == {"log": "INFO", "message": "from a child"}

    def test_the_lines_sit_between_the_hello_and_the_final_message(self, logged: BridgeRun) -> None:
        assert logged.messages[0] == HELLO
        assert logged.messages[1:-1] == EXPECTED_LOGS
        assert sorted(logged.final) == FINAL_KEYS

    def test_logging_is_not_duplicated_on_stderr(self, logged: BridgeRun) -> None:
        assert logged.stderr == ""


# Each test starts a child Python.
class TestPrintedTextIsUTF8OnEveryHost:
    """REQ-4.6.9: on a host that is not UTF-8 the script's two streams still leave as UTF-8."""

    def test_standard_output_carries_utf8_bytes(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        done = printed_bytes(tmp_path, GREETING_ON_STDOUT, non_utf8_child_env)

        assert (done.stdout, done.stderr, done.returncode) == (GREETING_LINE, b"", 0)

    def test_standard_error_carries_utf8_bytes(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        done = printed_bytes(tmp_path, GREETING_ON_STDERR, non_utf8_child_env)

        assert (done.stdout, done.stderr, done.returncode) == (b"", GREETING_LINE, 0)


@dataclass(frozen=True)
class Channel:
    """The bridge's message channel, pointed at a file this process owns."""

    path: Path

    @property
    def messages(self) -> list[dict[str, Any]]:
        text = self.path.read_text(encoding="utf-8")
        return [json.loads(line) for line in text.splitlines() if line.strip()]

    @property
    def final(self) -> dict[str, Any]:
        return self.messages[-1]


def closed_fd() -> int:
    """A descriptor number nothing holds, so the guard finds no channel there."""
    handle = os.open(os.devnull, os.O_RDONLY)
    os.close(handle)
    return handle


def held_by(fd: int) -> tuple[int, int] | None:
    """The open file a descriptor number stands for, or None when nothing holds it."""
    try:
        status = os.stat(fd)
    except OSError:
        return None
    return status.st_dev, status.st_ino


def script_file(tmp_path: Path, body: str) -> str:
    """One script on disk, the way the bridge is handed it."""
    path = tmp_path / "script.py"
    path.write_text(body, encoding="utf-8")
    return str(path)


def set_bridge_input(prepared: BridgeInput, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the bridge at a prepared envelope, with argv and the module path put back after."""
    monkeypatch.setenv("WAVE_BRIDGE_IN", str(prepared.envelope))
    monkeypatch.setattr(sys, "argv", [str(BRIDGE_PATH)])
    monkeypatch.setattr(sys, "path", list(sys.path))


def run_in_process(prepared: BridgeInput, monkeypatch: pytest.MonkeyPatch) -> int:
    set_bridge_input(prepared, monkeypatch)
    return main()


@pytest.fixture
def channel(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Channel]:
    fd = _python_bridge.CHANNEL_FD
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    path = tmp_path / "in-process-channel.jsonl"
    handle = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    write, fstat = os.write, os.fstat
    # The number itself is never repointed: a parallel test worker receives its work on it.
    monkeypatch.setattr(os, "write", lambda to, data: write(handle if to == fd else to, data))
    monkeypatch.setattr(os, "fstat", lambda of: fstat(handle if of == fd else of))
    try:
        yield Channel(path)
    finally:
        # The bridge takes over the root logger, so it is put back before the file is closed.
        root.handlers, root.level = handlers, level
        os.close(handle)


@pytest.fixture
def table() -> _Table:
    decoded = _decode(READINGS)
    assert isinstance(decoded, _Table)
    return decoded


class TestTheChannelIsFileDescriptorThree:
    """The number the in-process cases stand in for is the number the plugin opens."""

    def test_the_bridge_writes_to_fd_three(self) -> None:
        assert _python_bridge.CHANNEL_FD == 3

    def test_the_in_process_channel_leaves_that_number_alone(
        self, request: pytest.FixtureRequest
    ) -> None:
        """A parallel test worker receives its work on descriptor 3, so no case may repoint it."""
        before = held_by(_python_bridge.CHANNEL_FD)

        channel: Channel = request.getfixturevalue("channel")
        _write({"probe": 1})

        assert held_by(_python_bridge.CHANNEL_FD) == before
        assert channel.messages == [{"probe": 1}]


class TestTheChannelGuard:
    """Without a channel there is no way back to WAVE, so the bridge stops before the script."""

    def test_an_open_channel_is_ready(self, channel: Channel) -> None:
        assert _channel_ready() is True

    def test_a_closed_channel_is_not_ready(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(_python_bridge, "CHANNEL_FD", closed_fd())

        assert _channel_ready() is False

    def test_the_bridge_stops_with_two_and_names_the_missing_channel(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setattr(_python_bridge, "CHANNEL_FD", closed_fd())

        code = main()

        assert code == 2
        assert capsys.readouterr().err == CHANNEL_MISSING + "\n"


class TestTheChannelWriter:
    """Every message is one JSON line; a value JSON cannot carry travels with its own marker."""

    def test_each_message_is_its_own_line(self, channel: Channel) -> None:
        _write({"hello": "wave-bridge", "python": "3.8.0"})
        _write({"log": "INFO", "message": "second"})

        assert channel.messages == [
            {"hello": "wave-bridge", "python": "3.8.0"},
            {"log": "INFO", "message": "second"},
        ]

    def test_a_value_json_cannot_carry_is_written_with_its_own_marker(
        self, channel: Channel
    ) -> None:
        _write({"exports": {"handle": object(), "nothing": None}})

        assert len(channel.messages) == 1
        exports = channel.final["exports"]
        assert exports["nothing"] is None
        assert "handle" in exports
        assert exports["handle"] is not None


class TestTheTypedDecode:
    """PYRUN-5: one typed value from WAVE as the Python object the script reads."""

    def test_a_decimal_envelope_becomes_an_exact_decimal(self) -> None:
        assert _decode({"__wave_type": "decimal", "value": "0.1"}) == Decimal("0.1")

    def test_a_table_envelope_becomes_the_bridge_table(self) -> None:
        assert isinstance(_decode(READINGS), _Table)

    def test_a_plain_map_is_decoded_entry_by_entry(self) -> None:
        decoded = _decode({"ratio": {"__wave_type": "decimal", "value": "1.5"}, "name": "a1"})

        assert decoded == {"ratio": Decimal("1.5"), "name": "a1"}

    def test_a_map_of_an_unknown_kind_is_decoded_as_a_plain_map(self) -> None:
        assert _decode({"__wave_type": "future", "value": "7"}) == {
            "__wave_type": "future",
            "value": "7",
        }

    def test_a_list_is_decoded_item_by_item(self) -> None:
        assert _decode([{"__wave_type": "decimal", "value": "2"}, 1]) == [Decimal("2"), 1]

    def test_a_scalar_is_handed_over_untouched(self) -> None:
        assert _decode("hello") == "hello"
        assert _decode(7) == 7
        assert _decode(None) is None


class TestTheTypedEncode:
    """PYRUN-6: one script global as the typed value WAVE reads back."""

    def test_a_table_encodes_to_the_table_envelope(self, table: _Table) -> None:
        assert _encode(table) == READINGS

    def test_a_decimal_encodes_to_its_own_text(self) -> None:
        assert _encode(Decimal("0.1")) == {"__wave_type": "decimal", "value": "0.1"}

    def test_a_float_encodes_to_every_digit_python_holds(self) -> None:
        assert _encode(2.5) == {"__wave_type": "decimal", "value": "2.5"}

    def test_a_map_encodes_entry_by_entry_under_text_keys(self) -> None:
        assert _encode({1: 2.5}) == {"1": {"__wave_type": "decimal", "value": "2.5"}}

    def test_a_list_encodes_item_by_item(self) -> None:
        assert _encode([Decimal("1"), "a"]) == [{"__wave_type": "decimal", "value": "1"}, "a"]

    def test_a_scalar_is_handed_over_untouched(self) -> None:
        assert _encode("hello") == "hello"
        assert _encode(True) is True
        assert _encode(None) is None


class TestTheBridgeTableObject:
    """PYRUN-5: the table reads like an expression's table and hands out copies, never itself."""

    def test_the_columns_are_named_in_order(self, table: _Table) -> None:
        assert table.columns == READINGS["columns"]

    def test_the_columns_list_is_a_copy(self, table: _Table) -> None:
        table.columns.append("extra")

        assert table.columns == READINGS["columns"]

    def test_the_rows_are_dicts_keyed_by_column(self, table: _Table) -> None:
        assert table.rows[0] == {"sensor": "a1", "temp_c": Decimal("21.5"), "count": 3, "ok": True}

    def test_a_float_cell_is_an_exact_decimal(self, table: _Table) -> None:
        assert table.rows[1]["temp_c"] == Decimal("18.25")

    def test_a_cell_of_any_other_type_is_handed_over_untouched(self, table: _Table) -> None:
        assert table.rows[1]["count"] == 0
        assert table.rows[1]["ok"] is False

    def test_len_counts_the_rows(self, table: _Table) -> None:
        assert len(table) == 2

    def test_a_row_is_read_by_index(self, table: _Table) -> None:
        assert table[1]["sensor"] == "b7"

    def test_iteration_walks_every_row_in_order(self, table: _Table) -> None:
        assert [row["sensor"] for row in table] == ["a1", "b7"]

    def test_it_refuses_a_row_assignment(self, table: _Table) -> None:
        with pytest.raises(TypeError):
            table[0] = {"sensor": "c9"}

    def test_a_row_dict_the_script_edits_leaves_the_table_alone(self, table: _Table) -> None:
        table[0]["sensor"] = "edited"

        assert table[0]["sensor"] == "a1"

    def test_its_envelope_carries_the_rows_it_arrived_with(self, table: _Table) -> None:
        assert table._envelope() == READINGS


class TestTheLoggingRelayInProcess:
    """PYRUN-8: the root logger is taken over so every record lands on the channel."""

    def test_the_channel_handler_becomes_the_only_root_handler(self, channel: Channel) -> None:
        _install_logging()

        assert [type(handler) for handler in logging.getLogger().handlers] == [_ChannelHandler]

    def test_the_root_level_lets_debug_through(self, channel: Channel) -> None:
        _install_logging()

        assert logging.getLogger().level == logging.DEBUG

    def test_a_record_becomes_one_line_at_its_own_level(self, channel: Channel) -> None:
        _install_logging()

        logging.getLogger().debug("d %d", 1)

        assert channel.messages == [{"log": "DEBUG", "message": "d 1"}]

    def test_the_handler_writes_the_record_it_is_handed(self, channel: Channel) -> None:
        record = logging.LogRecord("root", logging.ERROR, __file__, 1, "e %s", ("one",), None)

        _ChannelHandler().emit(record)

        assert channel.messages == [{"log": "ERROR", "message": "e one"}]

    def test_a_record_logged_with_the_exception_carries_its_traceback(
        self, channel: Channel
    ) -> None:
        _install_logging()

        try:
            raise ValueError("boom")
        except ValueError:
            logging.getLogger().exception("failed")

        message = channel.messages[0]["message"]
        assert message.startswith("failed\n")
        assert "ValueError: boom" in message
        assert "Traceback (most recent call last)" in message

    def test_a_record_logged_with_the_stack_carries_it(self, channel: Channel) -> None:
        _install_logging()

        logging.getLogger().info("where", stack_info=True)

        message = channel.messages[0]["message"]
        assert message.startswith("where\n")
        assert "Stack (most recent call last)" in message


class TestTheTracebackReport:
    """PYRUN-7: the script's own traceback reaches stderr, without the bridge's own frame."""

    def test_the_bridge_frame_is_left_out(self, capsys: pytest.CaptureFixture[str]) -> None:
        code = compile("raise ValueError('boom')\n", "script.py", "exec")
        try:
            exec(code, {})
        except ValueError as exc:
            _report(exc)

        printed = capsys.readouterr().err
        assert 'File "script.py", line 1' in printed
        assert "test_python_bridge.py" not in printed
        assert printed.endswith("ValueError: boom\n")

    def test_an_exception_with_no_traceback_is_still_named(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _report(ValueError("boom"))

        assert capsys.readouterr().err == "ValueError: boom\n"


class TestTheExitCodeOfSysExit:
    """PYRUN-7: sys.exit ends the script, and whatever it was given becomes the exit code."""

    def test_a_bare_sys_exit_is_zero(self) -> None:
        assert _exit_code(None) == 0

    def test_a_number_is_the_exit_code(self) -> None:
        assert _exit_code(3) == 3

    def test_a_message_exits_one(self) -> None:
        assert _exit_code("stopping here") == 1

    def test_none_and_a_number_write_nothing(self, capsys: pytest.CaptureFixture[str]) -> None:
        _exit_code(None)
        _exit_code(3)

        assert capsys.readouterr().err == ""

    def test_a_message_is_written_to_stderr_on_its_own_line(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _exit_code("stopping here")

        assert capsys.readouterr().err == "stopping here\n"

    def test_any_other_value_is_written_as_its_text(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert _exit_code(["a", 1]) == 1
        assert capsys.readouterr().err == "['a', 1]\n"

    def test_a_value_whose_text_raises_writes_a_blank_line_and_that_traceback(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        class Unprintable:
            def __str__(self) -> str:
                raise ValueError("no text")

        assert _exit_code(Unprintable()) == 1
        printed = capsys.readouterr().err
        assert printed.startswith("\nTraceback (most recent call last):\n")
        assert printed.endswith("ValueError: no text\n")
        assert f'File "{BRIDGE_PATH}"' not in printed

    def test_the_exit_it_runs_under_is_not_chained_onto_that_traceback(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        class Unprintable:
            def __str__(self) -> str:
                raise ValueError("no text")

        try:
            raise SystemExit(Unprintable())
        except SystemExit as exc:
            assert _exit_code(exc.code) == 1

        printed = capsys.readouterr().err
        assert printed.startswith("\nTraceback (most recent call last):\n")
        assert printed.endswith("ValueError: no text\n")
        assert "During handling of the above exception" not in printed
        assert "SystemExit" not in printed


class TestTheScriptNamespace:
    """PYRUN-5 and PYRUN-9: the globals the script starts with."""

    def test_the_script_is_the_program(self) -> None:
        namespace = _namespace({"script": "/srv/work/script.py", "inputs": {}})

        assert namespace["__name__"] == "__main__"
        assert namespace["__file__"] == "/srv/work/script.py"
        assert namespace["__doc__"] is None
        assert namespace["__package__"] is None

    def test_each_input_is_a_decoded_global(self) -> None:
        envelope = {"script": "/srv/work/script.py", "inputs": SCALAR_INPUTS}

        namespace = _namespace(envelope)

        assert namespace["text"] == "hello"
        assert namespace["ratio"] == Decimal("1.5")


class TestRunningTheScriptInProcess:
    """PYRUN-7: how the script ended, as the message the bridge hands back or the exit it raised."""

    def test_a_normal_end_reports_no_error(self, tmp_path: Path) -> None:
        namespace: dict[str, Any] = {}

        assert _run(script_file(tmp_path, "total = 3\n"), namespace) == (None, 0)
        assert namespace["total"] == 3

    def test_sys_exit_travels_on_with_its_value(self, tmp_path: Path) -> None:
        script = script_file(tmp_path, "import sys\nsys.exit(3)\n")

        with pytest.raises(SystemExit) as raised:
            _run(script, {})

        assert raised.value.code == 3

    def test_a_bare_sys_exit_travels_on_with_no_value(self, tmp_path: Path) -> None:
        script = script_file(tmp_path, "import sys\nsys.exit()\n")

        with pytest.raises(SystemExit) as raised:
            _run(script, {})

        assert raised.value.code is None

    def test_sys_exit_with_text_travels_on_with_nothing_written(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        script = script_file(tmp_path, "import sys\nsys.exit('stopping here')\n")

        with pytest.raises(SystemExit) as raised:
            _run(script, {})

        assert raised.value.code == "stopping here"
        assert capsys.readouterr().err == ""

    def test_an_uncaught_exception_is_named_with_its_type(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        script = script_file(tmp_path, "raise ValueError('boom')\n")

        assert _run(script, {}) == ("ValueError: boom", 1)
        assert "Traceback (most recent call last)" in capsys.readouterr().err

    def test_a_syntax_error_names_its_line_and_nothing_runs(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        namespace: dict[str, Any] = {}

        error, exit_code = _run(script_file(tmp_path, SYNTAX_ERROR_SCRIPT), namespace)

        assert re.fullmatch(r"SyntaxError: .+ \(line 3\)", error or "")
        assert exit_code == 1
        assert namespace == {}
        assert "SyntaxError" in capsys.readouterr().err


class TestTheFinalMessageIsAssembled:
    """PYRUN-6: what the script set, what it never set, and how it ended."""

    def test_a_name_the_script_set_is_encoded(self) -> None:
        message = _final({"ratio": "float"}, {"ratio": Decimal("1.5")}, None, 0)

        assert message["exports"] == {"ratio": {"__wave_type": "decimal", "value": "1.5"}}
        assert message["missing"] == []

    def test_a_name_the_script_never_set_is_listed_as_missing(self) -> None:
        message = _final({"total": "integer"}, {}, None, 0)

        assert message["exports"] == {}
        assert message["missing"] == ["total"]

    def test_the_error_and_the_exit_code_are_carried(self) -> None:
        message = _final({}, {}, "ValueError: boom", 1)

        assert message == {
            "exports": {},
            "missing": [],
            "error": "ValueError: boom",
            "exit_code": 1,
        }


class TestTheBridgeProgramInProcess:
    """The whole program over one envelope: the hello, the script, the final message."""

    def test_the_hello_names_this_interpreter(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run_in_process(prepare_bridge(tmp_path, "pass\n"), monkeypatch)

        assert channel.messages[0] == HELLO

    def test_a_normal_end_hands_back_what_the_script_set(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "total = 3\n", exports={"total": "integer"})

        code = run_in_process(prepared, monkeypatch)

        assert code == 0
        assert channel.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": None,
            "exit_code": 0,
        }

    def test_argv_is_the_script_then_the_arguments(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "pass\n", arguments=["one", "two"])

        run_in_process(prepared, monkeypatch)

        assert sys.argv == [str(prepared.script), "one", "two"]

    def test_the_working_directory_leads_the_module_path(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "pass\n")

        run_in_process(prepared, monkeypatch)

        assert sys.path[0] == str(prepared.working_dir)
        assert str(prepared.script.parent) not in sys.path

    def test_file_mode_puts_the_script_folder_after_the_working_directory(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "pass\n", mode="file")

        run_in_process(prepared, monkeypatch)

        assert sys.path[0] == str(prepared.working_dir)
        assert sys.path[1] == str(prepared.script.parent)

    def test_a_typed_input_reaches_the_script_as_a_global(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(
            tmp_path,
            "sensors = [row['sensor'] for row in readings]\n",
            inputs={"readings": READINGS},
            exports={"sensors": "array"},
        )

        run_in_process(prepared, monkeypatch)

        assert channel.final["exports"] == {"sensors": ["a1", "b7"]}

    def test_sys_exit_is_the_code_the_bridge_ends_on(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "import sys\ntotal = 3\nsys.exit(2)\n")

        with pytest.raises(SystemExit) as raised:
            run_in_process(prepared, monkeypatch)

        assert raised.value.code == 2
        assert channel.final["exit_code"] == 2
        assert channel.final["error"] is None

    def test_a_text_exit_is_written_and_recorded_then_carries_its_code(
        self,
        channel: Channel,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        prepared = prepare_bridge(
            tmp_path,
            "import sys\ntotal = 3\nsys.exit('stopping here')\n",
            exports={"total": "integer"},
        )

        with pytest.raises(SystemExit) as raised:
            run_in_process(prepared, monkeypatch)

        assert raised.value.code == 1
        assert capsys.readouterr().err == "stopping here\n"
        assert channel.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": None,
            "exit_code": 1,
        }

    def test_an_uncaught_exception_is_named_in_the_final_message(
        self,
        channel: Channel,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        prepared = prepare_bridge(
            tmp_path,
            "total = 3\nraise ValueError('boom')\n",
            exports={"total": "integer"},
        )

        code = run_in_process(prepared, monkeypatch)

        assert code == 1
        assert channel.final == {
            "exports": {"total": 3},
            "missing": [],
            "error": "ValueError: boom",
            "exit_code": 1,
        }
        assert "ValueError: boom" in capsys.readouterr().err

    def test_a_syntax_error_ends_the_run_before_the_script(
        self,
        channel: Channel,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        prepared = prepare_bridge(tmp_path, SYNTAX_ERROR_SCRIPT, exports={"total": "integer"})

        code = run_in_process(prepared, monkeypatch)

        assert code == 1
        assert re.fullmatch(r"SyntaxError: .+ \(line 3\)", channel.final["error"])
        assert channel.final["missing"] == ["total"]
        assert "SyntaxError" in capsys.readouterr().err

    def test_a_logging_record_sits_between_the_hello_and_the_final_message(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "import logging\nlogging.info('in process')\n")

        run_in_process(prepared, monkeypatch)

        assert channel.messages[0] == HELLO
        assert channel.messages[1:-1] == [{"log": "INFO", "message": "in process"}]
        assert sorted(channel.final) == FINAL_KEYS


class TestTheBridgeEntryPoint:
    """How the interpreter enters the program, and what an interpreter below the floor gets."""

    def test_the_entry_ends_on_the_code_the_script_exited_with(
        self, channel: Channel, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        prepared = prepare_bridge(tmp_path, "import sys\nsys.exit(3)\n")
        set_bridge_input(prepared, monkeypatch)

        with pytest.raises(SystemExit) as raised:
            runpy.run_path(str(BRIDGE_PATH), run_name="__main__")

        assert raised.value.code == 3
        assert channel.final["exit_code"] == 3

    def test_an_interpreter_below_the_floor_stops_with_two(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setattr(sys, "hexversion", 0x30711F0)

        with pytest.raises(SystemExit) as raised:
            runpy.run_path(str(BRIDGE_PATH), run_name="__main__")

        assert raised.value.code == 2
        assert capsys.readouterr().err == TOO_OLD + "\n"
