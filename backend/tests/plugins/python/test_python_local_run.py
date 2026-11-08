"""The Python block end to end on a real interpreter (REQ-3.4.1.2).

Input variables arrive as globals of their mapped Python type (PYRUN-5), arguments arrive as
sys.argv[1:] (PYRUN-4), variable exports come back as the bound variable's type and are read
even after an exception (PYRUN-6), outcomes carry their reason (PYRUN-7), standard logging
reaches the run console at its own level (PYRUN-8), the Working Directory leads sys.path
(PYRUN-9), the process environment is Shell Script's (PYRUN-5, SHRUN-11), patterns and the
deadline bound the run (PYRUN-11), the Interpreter row names the program that runs the
bridge (PYRUN-3, PYRUN-10), the first console line names that program and the script, and a
non-zero exit names the last stderr line (PYRUN-7, PYRUN-11).
"""

import asyncio
import os
import re
import sys
import tempfile
import time
from collections.abc import Generator
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.api.services import storage_paths
from wavecore.core.execution import plugin_executor
from wavecore.core.execution.plugin_executor import (
    build_map_expression_keys,
    derive_parameter_metadata,
    resolve_parameters,
)
from wavecore.core.table import Table
from wavecore.plugins import _local_process
from wavecore.plugins import python as python_block
from wavecore.plugins._local_process_common import coerce_typed
from wavecore.plugins.python import PythonPlugin, _ChannelFollower, _read_channel

EXPORT_NAMES = ["count", "status"]
EXPORT_BINDINGS = {"count": "c", "status": "s"}
EXPORT_TYPES = {"count": "integer", "status": "string"}
NEVER_SET_DEBUG = "Variable export 'missing' was never set; the bound variable keeps its value"
NOT_ENDED_WARN = "Variable exports were not read: the script did not end after the pattern match"
PASS_LINE = "Output matched the pass pattern"
FAIL_LINE = "Output matched the fail pattern"
START_LINE = "Running the script under WAVE's own interpreter on the WAVE server"
EXACT_FLOAT = "0.1234567890123456789"
LEAK = "leaky-value"
MARKER = "marker"
POLL = 0.005

BOOM = ["raise ValueError('boom')"]
EXIT_WITH_TEXT = ["import sys", "sys.exit('stopping here')"]
EXIT_WITH_SECRET_TEXT = ["import sys", "sys.exit(token)"]
SYNTAX_ERROR = ["x = 1", "y = 2", "if True"]
PRINT_BOTH_STREAMS = ["import sys", "print('out')", "sys.stderr.write('err\\n')"]
PRINT_SECRET_AND_A_MARKER = ["import sys", "print(token)", "sys.stderr.write('marker\\n')"]
LOG_EVERY_LEVEL = [
    "import logging",
    "logging.debug('dbg')",
    "logging.info('inf')",
    "logging.warning('wrn')",
    "logging.error('err')",
    "logging.critical('crit')",
]
LOG_MULTILINE = ["import logging", "logging.info('first\\nsecond\\nthird')"]
LOG_WITH_EXCEPTION = [
    "import logging",
    "try:",
    "    1 / 0",
    "except ZeroDivisionError:",
    "    logging.error('caught', exc_info=True)",
]
LOG_AND_EXPORT = ["import logging", "logging.info('working')", "count = 7", "status = 'ok'"]
WAIT_FOR_RELEASE = [
    "import pathlib",
    "import sys",
    "import time",
    "release = pathlib.Path(sys.argv[1])",
    "deadline = time.time() + 30",
    "while not release.exists() and time.time() < deadline:",
    "    time.sleep(0.01)",
    "print('done')",
]
FIRST_RECORD = b'{"log": "INFO", "message": "first"}\n'
SECOND_HEAD = b'{"log": "INFO", "message": '
SECOND_TAIL = b'"second"}\n'
PATTERN_FAIL = ["import time", "print('ERROR x', flush=True)", "time.sleep(30)"]
PATTERN_PASS = ["import time", "print('READY now', flush=True)", "time.sleep(30)"]
IGNORE_TERM = [
    "import signal",
    "import time",
    "signal.signal(signal.SIGTERM, signal.SIG_IGN)",
    "count = 7",
    "status = 'ok'",
    "print('READY now', flush=True)",
    "time.sleep(30)",
]
READINGS = [
    {"sensor": "a", "temp_c": Decimal("21.5")},
    {"sensor": "b", "temp_c": Decimal("30.5")},
]
BOUND_TYPES = [
    pytest.param(name, id=name)
    for name in ("string", "integer", "float", "boolean", "array", "map", "table")
]
NEVER_RUNS = ["print('never')"]
NESTED_UNCARRIABLE = [
    pytest.param("array", "out = [1, object()]", id="array"),
    pytest.param("map", "out = {'handle': object()}", id="map"),
    pytest.param("table", "out = [{'handle': object()}]", id="table"),
]

_OMITTED = object()


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def anchored(prefix: str) -> str:
    """Anchor a message whose tail the platform writes."""
    return f"^{re.escape(prefix)}: .+$"


def script_of(*lines: str) -> str:
    """One script body from its lines."""
    return "\n".join(lines) + "\n"


def readings_table() -> Table:
    """The two-row table the typed input and export tests hand back and forth."""
    return Table.from_list([dict(row) for row in READINGS])


def context(
    params: dict[str, Any],
    *,
    logger: Any = None,
    output_bindings: dict[str, str] | None = None,
    output_types: Any = _OMITTED,
    output_secret_fields: list[str] | None = None,
    artifacts_dir: Path | None = None,
    testdata_dirs: list[Path] | None = None,
) -> dict[str, Any]:
    """The execute() context the workbench builds for a block."""
    built: dict[str, Any] = {
        "parameters": params,
        "variables": {},
        "logger": logger if logger is not None else MagicMock(),
        "output_bindings": output_bindings or {},
        "output_secret_fields": output_secret_fields or [],
        "artifacts_dir": str(artifacts_dir) if artifacts_dir is not None else None,
        "testdata_dirs": [str(d) for d in testdata_dirs] if testdata_dirs is not None else [],
    }
    if output_types is not _OMITTED:
        built["output_types"] = output_types
    return built


async def run_python(params: dict[str, Any], **ctx: Any) -> dict[str, Any]:
    """Run the Python block once against a real interpreter."""
    return await PythonPlugin().execute(context(params, **ctx))


async def printed(lines: list[str], **params: Any) -> list[str]:
    """The stdout lines of a script run with the given block parameters."""
    result = await run_python({"script": script_of(*lines), **params})
    return result["stdout"].splitlines()


async def run_export(name: str, wave_type: str, lines: list[str], **params: Any) -> dict[str, Any]:
    """Run a script whose one export is bound to a variable of the given type."""
    return await run_python(
        {"script": script_of(*lines), "script_variables": [name], **params},
        output_bindings={name: "bound"},
        output_types={name: wave_type},
    )


async def run_pair(lines: list[str], *, logger: Any = None, **overrides: Any) -> dict[str, Any]:
    """Run a script that fills the two exports of the matrix."""
    return await run_python(
        {"script": script_of(*lines), "script_variables": list(EXPORT_NAMES), **overrides},
        logger=logger,
        output_bindings=EXPORT_BINDINGS,
        output_types=EXPORT_TYPES,
    )


async def run_as_resolved(
    values: dict[str, Any], expressions: set[str], variables: dict[str, Any]
) -> dict[str, Any]:
    """Resolve the settings the way a run does, the null gate included, then run the block."""
    metadata = PythonPlugin().metadata
    parameter_types, trim_fields, *_ = derive_parameter_metadata(metadata["parameters"])
    resolved = resolve_parameters(
        values,
        expressions,
        variables,
        parameter_types,
        map_expression_keys=build_map_expression_keys(expressions),
        trim_fields=trim_fields,
        null_policies=plugin_executor.null_policy_fields(metadata["parameters"]),
    )
    return await run_python(resolved)


def stop_params(lines: list[str], **overrides: Any) -> dict[str, Any]:
    """A script stopped by a pattern, with a deadline far past the match."""
    return {"script": script_of(*lines), "stop_on_pattern": True, "timeout": 60, **overrides}


def messages(logger: MagicMock, level: str) -> list[str]:
    """The messages written at one log level."""
    return [str(call.args[0]) for call in getattr(logger, level).call_args_list if call.args]


def every_message(logger: MagicMock) -> list[str]:
    """Every argument of every logger call, at any level."""
    return [str(arg) for _, args, kwargs in logger.mock_calls for arg in (*args, *kwargs.values())]


async def wait_for_message(
    logger: MagicMock, level: str, message: str, bound: float = 10.0
) -> None:
    """Wait until one message has reached the run console at a level."""
    deadline = time.monotonic() + bound
    while time.monotonic() < deadline:
        if message in messages(logger, level):
            return
        await asyncio.sleep(POLL)
    raise AssertionError(f"'{message}' never reached the console at {level}")


def alive(pid: int) -> bool:
    """A pid that still names a process which has not ended."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return False
    return stat.rsplit(") ", 1)[-1].split(" ", 1)[0] != "Z"


async def pid_from(pid_file: Path, bound: float = 5.0) -> int:
    """The pid the script recorded, once the file holds it."""
    deadline = time.monotonic() + bound
    while time.monotonic() < deadline:
        text = pid_file.read_text(encoding="utf-8").strip() if pid_file.exists() else ""
        if text:
            return int(text)
        await asyncio.sleep(POLL)
    raise AssertionError(f"{pid_file} was never written")


async def wait_until_gone(pid: int, bound: float = 5.0) -> None:
    """Wait for a pid to leave the process table."""
    deadline = time.monotonic() + bound
    while time.monotonic() < deadline:
        if not alive(pid):
            return
        await asyncio.sleep(POLL)
    raise AssertionError(f"pid {pid} is still running")


def executable_program(path: Path, body: str) -> Path:
    """A small executable stand-in program on disk."""
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)
    return path


@pytest.fixture(autouse=True)
def _no_coverage_in_children(monkeypatch: pytest.MonkeyPatch) -> None:
    """Coverage must not follow the block into the interpreter it starts."""
    for name in [key for key in os.environ if key.startswith("COV_CORE_")]:
        monkeypatch.delenv(name)


@pytest.fixture
def testdata(tmp_path: Path) -> Path:
    root = tmp_path / "testdata"
    root.mkdir()
    return root


@pytest.fixture
def launches(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every process launch the block asks for; none is carried out."""
    seen: list[Any] = []

    async def refuse(spec: Any) -> Any:
        seen.append(spec)
        raise AssertionError("the script was started")

    monkeypatch.setattr(python_block, "run_local_process", refuse)
    return seen


@pytest.fixture
def storage_base_is_a_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[Path, None, None]:
    """A storage base that is a regular file, so no private directory can be made."""
    blocker = tmp_path / "storage-file"
    blocker.write_text("", encoding="utf-8")
    monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", str(blocker))
    storage_paths.reset_path_cache()
    yield blocker
    storage_paths.reset_path_cache()


class TestLaunchPath:
    """Both Script Types launch the same way, and the script's own name is a file (PYRUN-2)."""

    @pytest.mark.parametrize("script_type", ["source", "file"])
    async def test_both_script_types_run_the_same_script(
        self, script_type: str, testdata: Path
    ) -> None:
        body = script_of("import sys", "print(len(sys.argv) - 1, sys.argv[1])")
        params: dict[str, Any] = {"arguments": [{"value": "a"}]}
        if script_type == "source":
            params["script"] = body
        else:
            (testdata / "run.py").write_text(body, encoding="utf-8")
            params["script_type"] = "file"
            params["script_file"] = "testdata://run.py"

        result = await run_python(params, testdata_dirs=[testdata])

        assert result["stdout"] == "1 a\n"

    async def test_a_source_script_runs_from_a_private_python_file(self) -> None:
        lines = await printed(["import sys", "print(sys.argv[0])"])

        started = Path(lines[0])
        assert started.is_absolute()
        assert started.suffix == ".py"

    async def test_a_file_script_keeps_its_own_path(self, testdata: Path) -> None:
        (testdata / "run.py").write_text("import sys\nprint(sys.argv[0])\n", encoding="utf-8")

        result = await run_python(
            {"script_type": "file", "script_file": "testdata://run.py"},
            testdata_dirs=[testdata],
        )

        assert Path(result["stdout"].strip()).samefile(testdata / "run.py")


class TestStartLine:
    """One INFO line names the interpreter and the script as the block starts (PYRUN-11)."""

    async def test_an_empty_row_names_waves_own_interpreter(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of("x = 'body-text'")}, logger=logger)

        assert messages(logger, "info") == [START_LINE]

    async def test_a_named_interpreter_is_shown_as_written(self) -> None:
        logger = MagicMock()

        await run_python(
            {"script": script_of("pass"), "interpreter": f"{sys.executable} -X utf8"},
            logger=logger,
        )

        assert messages(logger, "info") == [
            f"Running the script under {sys.executable} -X utf8 on the WAVE server"
        ]

    async def test_a_script_file_is_named_by_its_path_as_written(self, testdata: Path) -> None:
        (testdata / "run.py").write_text("pass\n", encoding="utf-8")
        logger = MagicMock()

        await run_python(
            {"script_type": "file", "script_file": "testdata://run.py"},
            logger=logger,
            testdata_dirs=[testdata],
        )

        assert messages(logger, "info") == [
            "Running testdata://run.py under WAVE's own interpreter on the WAVE server"
        ]

    async def test_the_line_is_written_before_a_start_failure(self) -> None:
        logger = MagicMock()

        await run_python(
            {"script": script_of("pass"), "interpreter": "nosuchpython", "on_error": "record"},
            logger=logger,
        )

        assert messages(logger, "info") == [
            "Running the script under nosuchpython on the WAVE server"
        ]


SCALAR_INPUTS = [
    pytest.param("greeting", "hi", "str hi", id="string"),
    pytest.param("count", 7, "int 7", id="integer"),
    pytest.param("flag", True, "bool True", id="boolean"),
    pytest.param("items", [1, 2, 3], "list [1, 2, 3]", id="array"),
    pytest.param("mapping", {"k": "v"}, "dict {'k': 'v'}", id="map"),
]


class TestTypedInputs:
    """Each Input Variable is a global of the Python type its WAVE type maps to (PYRUN-5)."""

    @pytest.mark.parametrize(("name", "value", "expected"), SCALAR_INPUTS)
    async def test_a_value_arrives_as_its_python_type(
        self, name: str, value: Any, expected: str
    ) -> None:
        lines = await printed([f"print(type({name}).__name__, {name})"], input_vars={name: value})

        assert lines == [expected]

    async def test_a_null_arrives_as_none(self) -> None:
        lines = await printed(["print(nothing is None)"], input_vars={"nothing": None})

        assert lines == ["True"]

    async def test_a_float_arrives_as_an_exact_decimal(self) -> None:
        lines = await printed(
            ["import decimal", "print(isinstance(price, decimal.Decimal))", "print(price)"],
            input_vars={"price": Decimal(EXACT_FLOAT)},
        )

        assert lines == ["True", EXACT_FLOAT]

    async def test_a_table_arrives_as_the_bridge_table(self) -> None:
        lines = await printed(
            [
                "print(list(readings.columns))",
                "print(len(readings))",
                "print(len(readings.rows))",
                "print([row['sensor'] for row in readings])",
                "print(readings[1]['temp_c'])",
            ],
            input_vars={"readings": readings_table()},
        )

        assert lines == ["['sensor', 'temp_c']", "2", "2", "['a', 'b']", "30.5"]

    async def test_an_input_variable_is_a_global_and_not_an_environment_entry(self) -> None:
        lines = await printed(
            ["import os", "print(greeting)", "print('greeting' in os.environ)"],
            input_vars={"greeting": "hi"},
        )

        assert lines == ["hi", "False"]

    async def test_no_environment_entry_carries_an_input_value(self) -> None:
        lines = await printed(
            ["import os", f"print(any(value == {LEAK!r} for value in os.environ.values()))"],
            input_vars={"token": LEAK},
        )

        assert lines == ["False"]

    async def test_a_table_nested_in_a_map_arrives_as_the_bridge_table(self) -> None:
        lines = await printed(
            [
                "inner = payload['readings']",
                "print(type(inner).__name__)",
                "print(inner[1]['temp_c'])",
                "print(type(payload['limit']).__name__, payload['limit'])",
            ],
            input_vars={"payload": {"readings": readings_table(), "limit": Decimal(EXACT_FLOAT)}},
        )

        assert lines == ["_Table", "30.5", f"Decimal {EXACT_FLOAT}"]

    async def test_a_table_nested_in_an_array_arrives_as_the_bridge_table(self) -> None:
        lines = await printed(
            ["print([type(item).__name__ for item in payload])"],
            input_vars={"payload": [readings_table(), Decimal(EXACT_FLOAT)]},
        )

        assert lines == ["['_Table', 'Decimal']"]


EXPORT_MATRIX = [
    pytest.param("string", "out = 'hello'", "hello", id="string"),
    pytest.param("integer", "out = 41", 41, id="integer"),
    pytest.param("boolean", "out = True", True, id="boolean"),
    pytest.param("array", "out = [1, 2, 3]", [1, 2, 3], id="array"),
    pytest.param("map", "out = {'k': 1}", {"k": 1}, id="map"),
]


class TestTypedExports:
    """An export comes back as the bound variable's type or fails the block (PYRUN-6)."""

    @pytest.mark.parametrize(("wave_type", "line", "expected"), EXPORT_MATRIX)
    async def test_an_export_comes_back_as_its_bound_type(
        self, wave_type: str, line: str, expected: Any
    ) -> None:
        result = await run_export("out", wave_type, [line])

        assert result["out"] == expected
        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_an_integer_export_is_an_int_and_not_a_bool(self) -> None:
        result = await run_export("out", "integer", ["out = 41"])

        assert isinstance(result["out"], int)
        assert not isinstance(result["out"], bool)

    async def test_a_decimal_export_comes_back_exact(self) -> None:
        result = await run_export(
            "out", "float", ["import decimal", f"out = decimal.Decimal({EXACT_FLOAT!r})"]
        )

        assert isinstance(result["out"], Decimal)
        assert result["out"] == Decimal(EXACT_FLOAT)

    @pytest.mark.parametrize(
        ("line", "expected"),
        [pytest.param("out = 2", "2", id="int"), pytest.param("out = 1.5", "1.5", id="float")],
    )
    async def test_an_int_and_a_float_both_fill_a_float_export(
        self, line: str, expected: str
    ) -> None:
        result = await run_export("out", "float", [line])

        assert isinstance(result["out"], Decimal)
        assert result["out"] == Decimal(expected)

    async def test_a_boolean_is_not_a_valid_integer_export(self) -> None:
        with pytest.raises(ValueError, match=exact("Script variable 'n' is not a valid integer")):
            await run_export("n", "integer", ["n = True"])

    async def test_a_list_of_dicts_comes_back_as_a_table(self) -> None:
        result = await run_export(
            "rows", "table", ["rows = [{'id': 1, 'ok': True}, {'id': 2, 'ok': False}]"]
        )

        table = result["rows"]
        assert isinstance(table, Table)
        assert table.col_names() == ["id", "ok"]
        assert table.col_types() == ["integer", "boolean"]
        assert table.to_list() == [{"id": 1, "ok": True}, {"id": 2, "ok": False}]

    async def test_a_table_export_takes_its_column_order_from_the_first_row(self) -> None:
        result = await run_export("rows", "table", ["rows = [{'b': 1, 'a': 2}, {'a': 4, 'b': 3}]"])

        assert result["rows"].col_names() == ["b", "a"]
        assert result["rows"].to_list() == [{"b": 1, "a": 2}, {"b": 3, "a": 4}]

    async def test_a_table_input_rides_back_out_as_a_table(self) -> None:
        result = await run_export(
            "out", "table", ["out = readings"], input_vars={"readings": readings_table()}
        )

        assert result["out"].col_names() == ["sensor", "temp_c"]
        assert result["out"].to_list() == READINGS

    async def test_an_export_the_script_never_sets_leaves_the_variable_alone(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {"script": script_of("print('hi')"), "script_variables": ["missing"]},
            logger=logger,
            output_bindings={"missing": "m"},
            output_types={"missing": "string"},
        )

        assert result["success"] is True
        assert result["reason"] == ""
        assert "missing" not in result
        assert messages(logger, "debug").count(NEVER_SET_DEBUG) == 1

    async def test_an_unbound_export_returns_no_output(self) -> None:
        result = await run_python({"script": script_of("out = 1"), "script_variables": ["out"]})

        assert "out" not in result

    async def test_a_wrong_typed_export_fails_under_fail(self) -> None:
        with pytest.raises(ValueError, match=exact("Script variable 'n' is not a valid integer")):
            await run_export("n", "integer", [f"n = {LEAK!r}"])

    async def test_a_wrong_typed_export_never_echoes_the_value(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {
                "script": script_of(f"n = {LEAK!r}"),
                "script_variables": ["n"],
                "on_error": "record",
            },
            logger=logger,
            output_bindings={"n": "bound"},
            output_types={"n": "integer"},
        )

        assert result["error"] == "Script variable 'n' is not a valid integer"
        assert result["reason"] == "OutputVariable"
        assert result["success"] is False
        assert result["__block_warning"] is True
        assert LEAK not in result["error"]
        assert [line for line in every_message(logger) if LEAK in line] == []

    async def test_a_recorded_wrong_typed_export_binds_what_fit(self) -> None:
        result = await run_pair(["count = 'abc'", "status = 'ok'"], on_error="record")

        assert result["status"] == "ok"
        assert "count" not in result
        assert result["error"] == "Script variable 'count' is not a valid integer"
        assert result["reason"] == "OutputVariable"

    async def test_a_nested_float_comes_back_as_an_exact_decimal(self) -> None:
        result = await run_export("out", "map", ["out = {'rate': 2.5, 'seen': [0.5]}"])

        assert result["out"] == {"rate": Decimal("2.5"), "seen": [Decimal("0.5")]}
        assert result["success"] is True

    async def test_a_nested_table_comes_back_as_a_table(self) -> None:
        result = await run_export(
            "out",
            "map",
            ["out = {'rows': readings}"],
            input_vars={"readings": readings_table()},
        )

        nested = result["out"]["rows"]
        assert isinstance(nested, Table)
        assert nested.to_list() == READINGS


class TestNoneExports:
    """A None export makes the bound variable null, whatever its type (PYRUN-6, REQ-3.1.3.23)."""

    @pytest.mark.parametrize("wave_type", BOUND_TYPES)
    async def test_a_none_export_makes_the_bound_variable_null(self, wave_type: str) -> None:
        result = await run_export("out", wave_type, ["out = None"])

        assert "out" in result
        assert result["out"] is None
        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_none_export_is_not_reported_as_never_set(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {"script": script_of("out = None"), "script_variables": ["out"]},
            logger=logger,
            output_bindings={"out": "bound"},
            output_types={"out": "integer"},
        )

        assert result["out"] is None
        assert messages(logger, "debug") == []

    @pytest.mark.parametrize("wave_type", BOUND_TYPES)
    async def test_a_value_json_cannot_carry_still_fails_the_export(self, wave_type: str) -> None:
        with pytest.raises(
            ValueError, match=exact(f"Script variable 'out' is not a valid {wave_type}")
        ):
            await run_export("out", wave_type, ["out = object()"])

    async def test_a_recorded_run_binds_the_none_and_fails_the_value_json_cannot_carry(
        self,
    ) -> None:
        result = await run_pair(["count = object()", "status = None"], on_error="record")

        assert "status" in result
        assert result["status"] is None
        assert "count" not in result
        assert result["error"] == "Script variable 'count' is not a valid integer"
        assert result["reason"] == "OutputVariable"
        assert result["success"] is False

    @pytest.mark.parametrize(("wave_type", "line"), NESTED_UNCARRIABLE)
    async def test_a_value_json_cannot_carry_inside_the_export_still_fails_it(
        self, wave_type: str, line: str
    ) -> None:
        with pytest.raises(
            ValueError, match=exact(f"Script variable 'out' is not a valid {wave_type}")
        ):
            await run_export("out", wave_type, [line])


FITTING_VALUES = [
    pytest.param("text", "string", id="string"),
    pytest.param(7, "integer", id="integer"),
    pytest.param(True, "boolean", id="boolean"),
    pytest.param([1, 2], "array", id="array"),
    pytest.param({"k": 1}, "map", id="map"),
]

REFUSED_VALUES = [
    pytest.param(7, "string", id="int-as-string"),
    pytest.param("7", "integer", id="text-as-integer"),
    pytest.param(True, "integer", id="bool-as-integer"),
    pytest.param(1, "boolean", id="int-as-boolean"),
    pytest.param({"k": 1}, "array", id="map-as-array"),
    pytest.param([1, 2], "map", id="array-as-map"),
    pytest.param(7, "table", id="int-as-table"),
    pytest.param([1, 2], "table", id="scalars-as-table"),
]


class TestExportCoercion:
    """The PYRUN-6 acceptance rules, exercised on the coercer itself."""

    @pytest.mark.parametrize(("value", "declared"), FITTING_VALUES)
    def test_a_value_of_the_declared_type_passes_through(self, value: Any, declared: str) -> None:
        assert coerce_typed("v", value, declared) == value

    @pytest.mark.parametrize("declared", BOUND_TYPES)
    def test_none_fits_every_declared_type_and_stays_null(self, declared: str) -> None:
        assert coerce_typed("v", None, declared) is None

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(2, id="int"),
            pytest.param(1.5, id="float"),
            pytest.param(Decimal("1.5"), id="decimal"),
        ],
    )
    def test_an_int_a_float_and_a_decimal_all_fit_float(self, value: Any) -> None:
        coerced = coerce_typed("v", value, "float")

        assert isinstance(coerced, Decimal)
        assert coerced == Decimal(str(value))

    def test_a_bool_does_not_fit_integer(self) -> None:
        with pytest.raises(ValueError, match=exact("Script variable 'n' is not a valid integer")):
            coerce_typed("n", True, "integer")

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(True, id="bool"),
            pytest.param("1.5", id="str"),
        ],
    )
    def test_a_bool_and_a_string_do_not_fit_float(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Script variable 'r' is not a valid float")):
            coerce_typed("r", value, "float")

    def test_a_list_of_dicts_becomes_a_table(self) -> None:
        table = coerce_typed("rows", [{"b": 1, "a": "x"}], "table")

        assert isinstance(table, Table)
        assert table.col_names() == ["b", "a"]
        assert table.col_types() == ["integer", "string"]

    def test_a_table_passes_through(self) -> None:
        table = readings_table()

        assert coerce_typed("t", table, "table") is table

    @pytest.mark.parametrize(("value", "declared"), REFUSED_VALUES)
    def test_a_value_that_does_not_fit_fails_the_export(self, value: Any, declared: str) -> None:
        with pytest.raises(
            ValueError, match=exact(f"Script variable 'v' is not a valid {declared}")
        ):
            coerce_typed("v", value, declared)


class TestArgumentsAndStreams:
    """Arguments reach argv in row order, stdin is empty and the two streams stay apart."""

    async def test_arguments_arrive_as_argv_in_row_order(self) -> None:
        lines = await printed(
            ["import sys", "print(sys.argv[1:])"],
            arguments=[{"value": "one"}, {"value": "two"}, {"value": "three"}],
        )

        assert lines == ["['one', 'two', 'three']"]

    async def test_an_empty_row_arrives_as_an_empty_argument(self) -> None:
        lines = await printed(
            ["import sys", "print(sys.argv[1:])"],
            arguments=[{"value": ""}, {}, {"value": "a b"}],
        )

        assert lines == ["['', '', 'a b']"]

    async def test_standard_input_is_empty(self) -> None:
        lines = await printed(["import sys", "print(repr(sys.stdin.read()))"])

        assert lines == ["''"]

    async def test_print_goes_to_stdout_and_stderr_text_to_stderr(self) -> None:
        result = await run_python({"script": script_of(*PRINT_BOTH_STREAMS)})

        assert result["stdout"] == "out\n"
        assert result["stderr"] == "err\n"
        assert result["exit_code"] == 0
        assert result["success"] is True


NULL_ARGUMENT_ROWS = [
    pytest.param([None], "Row 1 in 'arguments' is null", id="first-row"),
    pytest.param(["a", None, "b"], "Row 2 in 'arguments' is null", id="middle-row"),
]

PRINTS_ARGV_AND_TEAM = ["import os", "import sys", "print(sys.argv[1:], repr(os.environ['TEAM']))"]

NULL_INSIDE = [
    pytest.param([1, None, 2], "[1,null,2]", id="list"),
    pytest.param({"a": None, "b": 1}, '{"a":null,"b":1}', id="map"),
]

BLANK_ENTRY_EXPRESSIONS = [
    pytest.param(
        "environment", "environment.TEAM", "'TEAM' in 'environment' is null", id="environment"
    ),
    pytest.param("arguments", "arguments.1.value", "Row 2 in 'arguments' is null", id="argument"),
]

STORED_NULL_ENTRIES = [
    pytest.param({"environment": {"TEAM": None}}, "'TEAM' in 'environment' is null", id="entry"),
    pytest.param(
        {"arguments": [{"value": "a"}, {"value": None}]},
        "Row 2 in 'arguments' is null",
        id="argument-row",
    ),
]


class TestNullNeverReachesTheScriptAsText:
    """A null argument row or Environment entry fails before the script starts (PYRUN-4)."""

    @pytest.mark.parametrize(("rows", "message"), NULL_ARGUMENT_ROWS)
    async def test_a_null_argument_row_fails_naming_the_row(
        self, rows: list[Any], message: str, launches: list[Any]
    ) -> None:
        arguments = [{"value": value} for value in rows]

        with pytest.raises(ValueError, match=exact(message)):
            await run_python({"script": script_of(*NEVER_RUNS), "arguments": arguments})

        assert launches == []

    async def test_a_null_environment_entry_fails_naming_the_entry(
        self, launches: list[Any]
    ) -> None:
        environment = {"TEAM": "wave", "NOTHING": None}

        with pytest.raises(ValueError, match=exact("'NOTHING' in 'environment' is null")):
            await run_python({"script": script_of(*NEVER_RUNS), "environment": environment})

        assert launches == []

    @pytest.mark.parametrize(
        ("params", "message"),
        [
            pytest.param(
                {"arguments": [{"value": "a"}, {"value": None}]},
                "Row 2 in 'arguments' is null",
                id="argument-row",
            ),
            pytest.param(
                {"environment": {"NOTHING": None}},
                "'NOTHING' in 'environment' is null",
                id="environment-entry",
            ),
        ],
    )
    async def test_it_records_a_start_failure_under_record(
        self, params: dict[str, Any], message: str, launches: list[Any]
    ) -> None:
        result = await run_python(
            {"script": script_of(*NEVER_RUNS), "on_error": "record", **params}
        )

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == message
        assert result["success"] is False
        assert launches == []

    async def test_an_empty_environment_entry_arrives_as_empty_text(self) -> None:
        lines = await printed(
            ["import os", "print(repr(os.environ['EMPTY']))"], environment={"EMPTY": ""}
        )

        assert lines == ["''"]

    @pytest.mark.parametrize(("value", "text"), NULL_INSIDE)
    async def test_a_null_inside_a_list_or_map_travels_as_json_null(
        self, value: Any, text: str
    ) -> None:
        lines = await printed(
            ["import os", "import sys", "print(os.environ['ITEMS'])", "print(sys.argv[1])"],
            environment={"ITEMS": value},
            arguments=[{"value": value}],
        )

        assert lines == [text, text]


class TestNullFromAnExpression:
    """A null entry, from an expression or stored, reaches the block, which applies its
    setting's rule (REQ-3.1.3.21)."""

    async def test_an_input_variable_entry_that_is_null_reaches_the_script_as_none(self) -> None:
        result = await run_as_resolved(
            {
                "script": script_of("print(nothing is None, type(nothing).__name__)"),
                "input_vars": {"nothing": "missing"},
            },
            {"input_vars.nothing"},
            {"missing": None},
        )

        assert result["stdout"] == "True NoneType\n"
        assert result["success"] is True

    async def test_an_argument_row_that_is_null_fails_before_the_script_starts(
        self, launches: list[Any]
    ) -> None:
        with pytest.raises(ValueError, match=exact("Row 2 in 'arguments' is null")):
            await run_as_resolved(
                {
                    "script": script_of(*NEVER_RUNS),
                    "arguments": [{"value": "a"}, {"value": "missing"}],
                },
                {"arguments.1.value"},
                {"missing": None},
            )

        assert launches == []

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    @pytest.mark.parametrize(("setting", "expression", "refusal"), BLANK_ENTRY_EXPRESSIONS)
    async def test_a_row_or_entry_whose_expression_is_left_blank_fails_before_the_start(
        self, setting: str, expression: str, refusal: str, text: str, launches: list[Any]
    ) -> None:
        entries = {"environment": {"TEAM": text}, "arguments": [{"value": "a"}, {"value": text}]}

        with pytest.raises(ValueError, match=exact(refusal)):
            await run_as_resolved(
                {"script": script_of(*NEVER_RUNS), setting: entries[setting]}, {expression}, {}
            )

        assert launches == []

    @pytest.mark.parametrize(("values", "refusal"), STORED_NULL_ENTRIES)
    async def test_a_row_or_entry_stored_as_null_fails_before_the_script_starts(
        self, values: dict[str, Any], refusal: str, launches: list[Any]
    ) -> None:
        with pytest.raises(ValueError, match=exact(refusal)):
            await run_as_resolved({"script": script_of(*NEVER_RUNS), **values}, set(), {})

        assert launches == []

    async def test_an_argument_row_and_an_entry_left_as_empty_text_arrive_as_empty_text(
        self,
    ) -> None:
        result = await run_as_resolved(
            {
                "script": script_of(*PRINTS_ARGV_AND_TEAM),
                "environment": {"TEAM": ""},
                "arguments": [{"value": "a"}, {"value": ""}],
            },
            set(),
            {},
        )

        assert result["stdout"] == "['a', ''] ''\n"

    async def test_an_input_variable_left_empty_still_reaches_the_script_as_none(self) -> None:
        result = await run_as_resolved(
            {
                "script": script_of("print(nothing is None)"),
                "input_vars": {"nothing": ""},
            },
            {"input_vars.nothing"},
            {},
        )

        assert result["stdout"] == "True\n"

    async def test_an_environment_entry_that_is_null_fails_before_the_script_starts(
        self, launches: list[Any]
    ) -> None:
        with pytest.raises(ValueError, match=exact("'TEAM' in 'environment' is null")):
            await run_as_resolved(
                {"script": script_of(*NEVER_RUNS), "environment": {"TEAM": "missing"}},
                {"environment.TEAM"},
                {"missing": None},
            )

        assert launches == []


class TestFailureOutcomes:
    """An exception, an exit code and a syntax error each carry their own reason (PYRUN-7)."""

    async def test_an_uncaught_exception_fails_the_block(self) -> None:
        with pytest.raises(ValueError, match=exact("ValueError: boom")):
            await run_python({"script": script_of(*BOOM)})

    async def test_a_recorded_exception_carries_its_reason_and_exit_code(self) -> None:
        result = await run_python({"script": script_of(*BOOM), "on_error": "record"})

        assert result["success"] is False
        assert result["error"] == "ValueError: boom"
        assert result["reason"] == "Exception"
        assert result["exit_code"] == 1
        assert result["__block_warning"] is True

    async def test_the_traceback_is_written_to_stderr(self) -> None:
        result = await run_python({"script": script_of(*BOOM), "on_error": "record"})

        assert "Traceback (most recent call last)" in result["stderr"]
        assert "ValueError: boom" in result["stderr"]

    async def test_the_traceback_reaches_the_run_console_at_error(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of(*BOOM), "on_error": "record"}, logger=logger)

        written = "\n".join(messages(logger, "error"))
        assert "Traceback (most recent call last)" in written
        assert "ValueError: boom" in written

    async def test_a_recorded_exception_logs_the_warn_line(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of(*BOOM), "on_error": "record"}, logger=logger)

        assert messages(logger, "warn") == ["Script failed (Exception): ValueError: boom"]

    async def test_exports_are_read_after_an_uncaught_exception(self) -> None:
        result = await run_pair(
            ["count = 7", "status = 'ok'", "raise ValueError('boom')"], on_error="record"
        )

        assert result["count"] == 7
        assert result["status"] == "ok"
        assert result["reason"] == "Exception"
        assert result["exit_code"] == 1

    async def test_a_non_zero_exit_fails_with_its_code(self) -> None:
        with pytest.raises(ValueError, match=exact("Script exited with code 2")):
            await run_python({"script": script_of("import sys", "sys.exit(2)")})

    async def test_a_recorded_non_zero_exit_keeps_the_code(self) -> None:
        result = await run_python(
            {"script": script_of("import sys", "sys.exit(2)"), "on_error": "record"}
        )

        assert result["exit_code"] == 2
        assert result["reason"] == "NonZeroExit"
        assert result["error"] == "Script exited with code 2"

    async def test_a_non_zero_exit_names_the_last_stderr_line(self) -> None:
        script = script_of("import sys", "sys.stderr.write('bad input\\n')", "sys.exit(2)")

        with pytest.raises(ValueError, match=exact("Script exited with code 2: bad input")):
            await run_python({"script": script})

    async def test_a_secret_stderr_keeps_the_bare_exit_message(self) -> None:
        script = script_of("import sys", "sys.stderr.write('token\\n')", "sys.exit(2)")

        result = await run_python(
            {"script": script, "on_error": "record"}, output_secret_fields=["stderr"]
        )

        assert result["error"] == "Script exited with code 2"

    async def test_sys_exit_with_text_fails_naming_the_text(self) -> None:
        with pytest.raises(ValueError, match=exact("Script exited with code 1: stopping here")):
            await run_python({"script": script_of(*EXIT_WITH_TEXT)})

    async def test_a_recorded_sys_exit_with_text_keeps_the_text_on_stderr(self) -> None:
        result = await run_python({"script": script_of(*EXIT_WITH_TEXT), "on_error": "record"})

        assert result["exit_code"] == 1
        assert result["reason"] == "NonZeroExit"
        assert result["error"] == "Script exited with code 1: stopping here"
        assert result["stderr"] == "stopping here\n"

    async def test_a_secret_stderr_keeps_the_exit_text_out_of_the_message(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {
                "script": script_of(*EXIT_WITH_SECRET_TEXT),
                "input_vars": {"token": LEAK},
                "on_error": "record",
                "stream_output": True,
            },
            logger=logger,
            output_secret_fields=["stderr"],
        )

        assert result["error"] == "Script exited with code 1"
        assert result["stderr"] == f"{LEAK}\n"
        assert [line for line in every_message(logger) if LEAK in line] == []

    async def test_an_exception_keeps_its_own_message_over_the_stderr_line(self) -> None:
        result = await run_python({"script": script_of(*BOOM), "on_error": "record"})

        assert result["error"] == "ValueError: boom"

    @pytest.mark.parametrize("call", ["sys.exit()", "sys.exit(0)", "sys.exit(None)"])
    async def test_a_zero_exit_passes(self, call: str) -> None:
        result = await run_python({"script": script_of("import sys", "print('done')", call)})

        assert result["success"] is True
        assert result["exit_code"] == 0
        assert result["stdout"] == "done\n"

    async def test_exports_are_read_after_sys_exit(self) -> None:
        result = await run_pair(["import sys", "count = 7", "status = 'ok'", "sys.exit(0)"])

        assert result["count"] == 7
        assert result["status"] == "ok"
        assert result["success"] is True

    async def test_a_syntax_error_names_its_line(self) -> None:
        with pytest.raises(ValueError, match=r"^SyntaxError: .+ \(line 3\)$"):
            await run_python({"script": script_of(*SYNTAX_ERROR)})

    async def test_a_recorded_syntax_error_reads_as_an_exception(self) -> None:
        result = await run_python({"script": script_of(*SYNTAX_ERROR), "on_error": "record"})

        assert result["reason"] == "Exception"
        assert re.fullmatch(r"SyntaxError: .+ \(line 3\)", result["error"])
        assert result["exit_code"] == 1
        assert result["stdout"] == ""


class TestRunConsoleLogging:
    """Logging records always reach the console; stream lines obey Log Output (PYRUN-8)."""

    async def test_every_level_reaches_the_console_with_log_output_off(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of(*LOG_EVERY_LEVEL)}, logger=logger)

        assert messages(logger, "debug") == ["dbg"]
        assert messages(logger, "info") == [START_LINE, "inf"]
        assert messages(logger, "warn") == ["wrn"]
        assert messages(logger, "error") == ["err", "crit"]

    async def test_a_named_logger_rides_the_root_handler(self) -> None:
        logger = MagicMock()

        await run_python(
            {"script": script_of("import logging", "logging.getLogger('app').info('from app')")},
            logger=logger,
        )

        assert messages(logger, "info") == [START_LINE, "from app"]

    async def test_stream_lines_stay_quiet_while_log_output_is_off(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of(*PRINT_BOTH_STREAMS)}, logger=logger)

        assert every_message(logger) == [START_LINE]

    async def test_stdout_logs_at_info_and_stderr_at_warn_while_log_output_is_on(self) -> None:
        logger = MagicMock()

        await run_python(
            {"script": script_of(*PRINT_BOTH_STREAMS), "stream_output": True}, logger=logger
        )

        assert messages(logger, "info") == [START_LINE, "out"]
        assert messages(logger, "warn") == ["err"]

    async def test_a_multiline_message_reaches_the_console_whole(self) -> None:
        logger = MagicMock()

        await run_python({"script": script_of(*LOG_MULTILINE)}, logger=logger)

        assert messages(logger, "info") == [START_LINE, "first\nsecond\nthird"]

    async def test_a_record_logged_with_exception_info_still_carries_its_message(self) -> None:
        logger = MagicMock()

        result = await run_python({"script": script_of(*LOG_WITH_EXCEPTION)}, logger=logger)

        assert result["success"] is True
        logged = [text for text in messages(logger, "error") if text.startswith("caught")]
        assert logged, messages(logger, "error")
        assert "ZeroDivisionError: division by zero" in logged[0]
        assert "Traceback (most recent call last)" in logged[0]

    async def test_a_script_that_logs_still_hands_back_its_exports(self) -> None:
        logger = MagicMock()

        result = await run_pair(LOG_AND_EXPORT, logger=logger)

        assert result["count"] == 7
        assert result["status"] == "ok"
        assert messages(logger, "info") == [START_LINE, "working"]


class TestLiveRunConsoleLogging:
    """A record reaches the console as it is emitted, not when the block ends (PYRUN-8)."""

    async def test_every_level_arrives_while_the_script_is_still_running(
        self, tmp_path: Path
    ) -> None:
        release = tmp_path / "release"
        logger = MagicMock()
        block = asyncio.ensure_future(
            run_python(
                {
                    "script": script_of(*LOG_EVERY_LEVEL, *WAIT_FOR_RELEASE),
                    "arguments": [{"value": str(release)}],
                    "timeout": 60,
                },
                logger=logger,
            )
        )
        try:
            await wait_for_message(logger, "error", "crit")
            assert not block.done()
            assert messages(logger, "debug") == ["dbg"]
            assert messages(logger, "info") == [START_LINE, "inf"]
            assert messages(logger, "warn") == ["wrn"]
            assert messages(logger, "error") == ["err", "crit"]
        finally:
            release.write_text("go", encoding="utf-8")
            result = await block

        assert result["stdout"] == "done\n"
        assert messages(logger, "debug") == ["dbg"]
        assert messages(logger, "info") == [START_LINE, "inf"]
        assert messages(logger, "warn") == ["wrn"]
        assert messages(logger, "error") == ["err", "crit"]


class TestChannelFollower:
    """It takes whole lines only, each once, and never fails the block itself (PYRUN-8)."""

    async def test_a_partial_line_waits_for_its_newline(self, tmp_path: Path) -> None:
        channel = tmp_path / "channel"
        channel.write_bytes(FIRST_RECORD + SECOND_HEAD)
        logger = MagicMock()

        follower = _ChannelFollower(str(channel), logger)
        try:
            await wait_for_message(logger, "info", "first")
            assert messages(logger, "info") == ["first"]
            with channel.open("ab") as handle:
                handle.write(SECOND_TAIL)
            await wait_for_message(logger, "info", "second")
        finally:
            taken = await follower.close()

        assert messages(logger, "info") == ["first", "second"]
        assert taken == 2

    async def test_what_it_took_is_what_the_end_of_run_read_skips(self, tmp_path: Path) -> None:
        channel = tmp_path / "channel"
        channel.write_bytes(b'\n{"hello": "wave-bridge"}\n' + FIRST_RECORD)
        logger = MagicMock()

        follower = _ChannelFollower(str(channel), logger)
        try:
            await wait_for_message(logger, "info", "first")
        finally:
            taken = await follower.close()

        assert every_message(logger) == ["first"]
        assert taken == len(_read_channel(str(channel)))

    async def test_a_channel_it_cannot_read_leaves_the_block_alone(self, tmp_path: Path) -> None:
        logger = MagicMock()

        follower = _ChannelFollower(str(tmp_path / "gone"), logger)
        await asyncio.sleep(POLL)
        taken = await follower.close()

        assert taken == 0
        assert every_message(logger) == []


class TestStopOnPattern:
    """A pattern stops the script and decides the outcome (PYRUN-11, SHRUN-13)."""

    async def test_a_fail_match_fails_the_block(self) -> None:
        with pytest.raises(ValueError, match=r"^Output matched the fail pattern: .{1,200}$"):
            await run_python(stop_params(PATTERN_FAIL, fail_pattern="ERROR"))

    async def test_a_recorded_fail_match_names_the_line(self) -> None:
        result = await run_python(
            stop_params(PATTERN_FAIL, fail_pattern="ERROR", on_error="record")
        )

        assert result["error"] == f"{FAIL_LINE}: ERROR x"
        assert result["reason"] == "FailPattern"
        assert result["exit_code"] == 137
        assert result["success"] is False

    async def test_a_pass_match_passes_the_block_and_says_so(self) -> None:
        logger = MagicMock()

        result = await run_python(stop_params(PATTERN_PASS, pass_pattern="READY"), logger=logger)

        assert result["success"] is True
        assert result["exit_code"] == 137
        assert messages(logger, "info") == [START_LINE, f"{PASS_LINE}: READY now"]

    async def test_a_script_that_does_not_end_after_a_match_warns_that_no_export_was_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 0.2)
        logger = MagicMock()

        result = await run_python(
            {**stop_params(IGNORE_TERM, pass_pattern="READY"), "script_variables": EXPORT_NAMES},
            logger=logger,
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["__block_warning"] is True
        assert "count" not in result
        assert "status" not in result
        assert NOT_ENDED_WARN in messages(logger, "warn")


class TestTimeout:
    """The deadline bounds the run and the whole tree goes with it (PYRUN-11, SHRUN-14)."""

    async def test_a_timeout_fails_the_block_and_ends_the_process_tree(
        self, tmp_path: Path
    ) -> None:
        pid_file = tmp_path / "child.pid"
        lines = [
            "import pathlib",
            "import subprocess",
            "import sys",
            "import time",
            "child = subprocess.Popen(['sleep', '999'])",
            "pathlib.Path(sys.argv[1]).write_text(str(child.pid))",
            "time.sleep(30)",
        ]

        with pytest.raises(ValueError, match=exact("Script timed out after 1 second")):
            await run_python(
                {
                    "script": script_of(*lines),
                    "arguments": [{"value": str(pid_file)}],
                    "timeout": 1,
                }
            )

        await wait_until_gone(await pid_from(pid_file))


class TestStreamTruncation:
    """A stream that dropped output says so once, naming the bytes (SHRUN-8)."""

    @pytest.mark.parametrize(("stream", "noun"), [("stdout", "Stdout"), ("stderr", "Stderr")])
    async def test_a_truncated_stream_reports_the_dropped_bytes(
        self, stream: str, noun: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_local_process, "TAIL_CAP", 1024)
        logger = MagicMock()

        await run_python(
            {"script": script_of("import sys", f"sys.{stream}.write('A' * 2048)")}, logger=logger
        )

        assert messages(logger, "warn") == [f"{noun} truncated: 1024 bytes dropped"]


class TestModulePath:
    """The Working Directory leads sys.path, File mode adds the script's folder (PYRUN-9)."""

    async def test_the_working_directory_leads_sys_path(self, testdata: Path) -> None:
        (testdata / "helpers.py").write_text("NAME = 'from-testdata'\n", encoding="utf-8")

        lines = await printed(
            ["import sys", "import helpers", "print(sys.path[0])", "print(helpers.NAME)"],
            working_dir=str(testdata),
        )

        assert Path(lines[0]).samefile(testdata)
        assert lines[1] == "from-testdata"

    async def test_file_mode_adds_the_scripts_own_folder(
        self, tmp_path: Path, testdata: Path
    ) -> None:
        lib = tmp_path / "lib"
        lib.mkdir()
        (lib / "sidecar.py").write_text("TAG = 'beside-the-script'\n", encoding="utf-8")
        (lib / "run.py").write_text("import sidecar\nprint(sidecar.TAG)\n", encoding="utf-8")

        result = await run_python(
            {
                "script_type": "file",
                "script_file": str(lib / "run.py"),
                "working_dir": str(testdata),
            }
        )

        assert result["stdout"] == "beside-the-script\n"

    async def test_source_mode_keeps_the_private_folder_off_the_path(self, testdata: Path) -> None:
        lines = await printed(
            [
                "import os",
                "import sys",
                "private = os.path.dirname(os.path.abspath(sys.argv[0]))",
                "print(private in sys.path)",
            ],
            working_dir=str(testdata),
        )

        assert lines == ["False"]


class TestDefaultWorkingDirectory:
    """An absent or blank Working Directory starts in the system temp folder (REQ-3.4.3.11)."""

    @pytest.mark.parametrize(
        "value", [_OMITTED, None, "", "   "], ids=["absent", "none", "empty", "whitespace"]
    )
    async def test_the_script_starts_in_the_temp_folder(
        self, value: object, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        system_temp = tmp_path / "system-temp"
        system_temp.mkdir()
        monkeypatch.setattr(tempfile, "tempdir", str(system_temp))
        params = {} if value is _OMITTED else {"working_dir": value}

        lines = await printed(["import os", "print(os.getcwd())"], **params)

        assert lines == [str(system_temp.resolve())]


class TestProcessEnvironment:
    """The environment is Shell Script's, with the two folder variables (PYRUN-5, SHRUN-11)."""

    async def test_the_two_folder_variables_are_present(
        self, tmp_path: Path, testdata: Path
    ) -> None:
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()

        result = await run_python(
            {
                "script": script_of(
                    "import os",
                    "print(os.environ['WAVE_TESTDATA_DIR'])",
                    "print(os.environ['WAVE_ARTIFACTS_DIR'])",
                )
            },
            artifacts_dir=artifacts,
            testdata_dirs=[testdata],
        )

        assert result["stdout"] == f"{testdata}\n{artifacts}\n"

    async def test_the_blocks_own_environment_map_is_added(self) -> None:
        lines = await printed(
            ["import os", "print(os.environ['TEAM'])"], environment={"TEAM": "wave"}
        )

        assert lines == ["wave"]

    async def test_the_servers_own_environment_reaches_the_script(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "DEBUG")

        lines = await printed(["import os", "print(os.environ['WAVE_LOG_LEVEL'])"])

        assert lines == ["DEBUG"]


class TestSecretValues:
    """A stream marked secret is left out of the live console (PYRUN-8, REQ-3.1.3.16)."""

    async def test_no_console_line_carries_an_input_value_while_log_output_is_off(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {"script": script_of("print(token)"), "input_vars": {"token": LEAK}}, logger=logger
        )

        assert result["stdout"] == f"{LEAK}\n"
        assert [line for line in every_message(logger) if LEAK in line] == []

    async def test_a_live_console_takes_the_open_stream_and_drops_the_secret_one(self) -> None:
        logger = MagicMock()

        result = await run_python(
            {
                "script": script_of(*PRINT_SECRET_AND_A_MARKER),
                "input_vars": {"token": LEAK},
                "stream_output": True,
            },
            logger=logger,
            output_secret_fields=["stdout"],
        )

        assert messages(logger, "warn") == [MARKER]
        assert messages(logger, "info") == [START_LINE]
        assert result["stdout"] == f"{LEAK}\n"
        assert [line for line in every_message(logger) if LEAK in line] == []

    async def test_a_fail_match_on_a_secret_stream_omits_the_line(self) -> None:
        result = await run_python(
            stop_params(
                ["import time", "print(token, flush=True)", "time.sleep(30)"],
                fail_pattern=LEAK,
                on_error="record",
                input_vars={"token": LEAK},
            ),
            output_secret_fields=["stdout"],
        )

        assert result["error"] == FAIL_LINE
        assert result["reason"] == "FailPattern"


class TestInterpreterResolution:
    """The Interpreter row is a command line WAVE appends the script and arguments to (PYRUN-3)."""

    @pytest.mark.parametrize(
        "interpreter", [pytest.param("", id="empty"), pytest.param("   ", id="whitespace")]
    )
    async def test_an_empty_row_runs_waves_own_interpreter(self, interpreter: str) -> None:
        lines = await printed(["import sys", "print(sys.executable)"], interpreter=interpreter)

        assert Path(lines[0]).samefile(sys.executable)

    async def test_a_row_with_flags_appends_the_script_then_the_arguments(self) -> None:
        lines = await printed(
            ["import sys", "print(sorted(sys._xoptions))", "print(sys.argv[1:])"],
            interpreter=f"{sys.executable} -X utf8",
            arguments=[{"value": "one"}, {"value": "two"}],
        )

        assert lines == ["['utf8']", "['one', 'two']"]

    async def test_a_relative_program_starts_from_the_working_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        work = tmp_path / "work"
        (work / "bin").mkdir(parents=True)
        executable_program(
            work / "bin" / "lab-python", f'#!/bin/sh\nexec "{sys.executable}" "$@"\n'
        )
        monkeypatch.chdir(tmp_path)

        lines = await printed(
            ["print('via the lab interpreter')"],
            interpreter="./bin/lab-python",
            working_dir=str(work),
        )

        assert lines == ["via the lab interpreter"]

    async def test_an_expression_row_is_resolved_before_the_launch(self) -> None:
        parameter_types, *_ = derive_parameter_metadata(PythonPlugin().metadata["parameters"])
        resolved = resolve_parameters(
            {"interpreter": "py"}, {"interpreter"}, {"py": sys.executable}, parameter_types
        )

        lines = await printed(["import sys", "print(sys.executable)"], **resolved)

        assert Path(lines[0]).samefile(sys.executable)


class TestInterpreterStartFailures:
    """A program that is missing, or is not Python, fails the block before the script runs."""

    async def test_a_missing_program_is_named(self) -> None:
        with pytest.raises(
            ValueError, match=exact("Interpreter not found on the WAVE server: nosuchpython")
        ):
            await run_python({"script": script_of("print('never')"), "interpreter": "nosuchpython"})

    async def test_the_message_names_the_program_and_not_the_whole_row(self) -> None:
        with pytest.raises(
            ValueError, match=exact("Interpreter not found on the WAVE server: nosuchpython")
        ):
            await run_python(
                {"script": script_of("print('never')"), "interpreter": "nosuchpython -X utf8"}
            )

    async def test_a_program_that_is_not_python_is_refused(self) -> None:
        with pytest.raises(ValueError, match=anchored("Interpreter is not Python 3.8 or newer")):
            await run_python({"script": script_of("print('never')"), "interpreter": "/bin/true"})

    async def test_a_program_that_fails_without_the_bridge_is_refused(self, tmp_path: Path) -> None:
        stub = executable_program(tmp_path / "stub-python", "#!/bin/sh\nexit 3\n")

        with pytest.raises(ValueError, match=anchored("Interpreter is not Python 3.8 or newer")):
            await run_python({"script": script_of("print('never')"), "interpreter": str(stub)})

    async def test_a_refused_interpreter_records_start_failed(self) -> None:
        result = await run_python(
            {
                "script": script_of("print('never')"),
                "interpreter": "/bin/true",
                "on_error": "record",
            }
        )

        assert result["reason"] == "StartFailed"
        assert result["success"] is False
        assert result["stdout"] == ""


START_FAILURES = [
    pytest.param(
        {"script_type": "file", "script_file": "testdata://missing.py"},
        "Script file not found: testdata://missing.py",
        id="script-file-missing",
    ),
    pytest.param(
        {"script": "print(1)\n", "working_dir": "/nope"},
        "Working directory not found: /nope",
        id="working-dir-missing",
    ),
    pytest.param(
        {"script_type": "file", "script_file": "testdata://"},
        "Path is the root folder: testdata://",
        id="scheme-root",
    ),
]


class TestStartFailures:
    """A run that never starts fails with reason StartFailed and nothing captured."""

    @pytest.mark.parametrize(("params", "message"), START_FAILURES)
    async def test_it_raises_under_fail(
        self, params: dict[str, Any], message: str, testdata: Path
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await run_python(dict(params), testdata_dirs=[testdata])

    @pytest.mark.parametrize(("params", "message"), START_FAILURES)
    async def test_it_records_minus_one_under_record(
        self, params: dict[str, Any], message: str, testdata: Path
    ) -> None:
        result = await run_python({**params, "on_error": "record"}, testdata_dirs=[testdata])

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == message
        assert result["success"] is False

    async def test_an_operating_system_refusal_is_reported(
        self, storage_base_is_a_file: Path
    ) -> None:
        with pytest.raises(ValueError, match=anchored("Could not start the script")):
            await run_python({"script": script_of("print(1)")})
