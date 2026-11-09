"""The Python block on a remote host (REQ-3.4.1.2).

PYRUN-12: local and remote share one local-process core. The runtime half, the watchdog and
the bridge ride inside the Remote Execution bundle as source text, the typed input values are
encoded before the request leaves WAVE, and a WAVE-side script file is read here and shipped
so File mode works there too (PYRUN-2). What resolves on the remote host fails there, with
the remote host named (PYRUN-11). WAVE writes the block's start line before the request leaves,
and a non-zero exit there names the last stderr line unless Stderr is marked secret (PYRUN-11).
"""

import ast
import asyncio
import builtins
import json
import os
import re
import uuid
from collections.abc import Callable, Iterator
from decimal import Decimal
from functools import cache
from importlib import import_module
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.core.remote_exec.test_bundle import _REGISTRY_PROBE, _run_bundle, _run_bundle_lines
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.remote_exec import execute_remote_container
from wavecore.core.remote_exec.bundle import _vendored_sources, build_bundle
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.core.table import Table
from wavecore.core.variables.declared_types import declared_type_scope
from wavecore.plugins.python import PythonPlugin

HOST = "prod-host"
HOST_SESSION = "python-host-sess"
BUNDLE_REF = "remote-worker"

RUNTIME_MODULE = "wavecore.plugins._local_process_runtime"
LOCAL_PROCESS_MODULE = "wavecore.plugins._local_process"
WATCHDOG_MODULE = "wavecore.plugins._local_process_watchdog"
BRIDGE_MODULE = "wavecore.plugins._python_bridge"
PROCESS_GROUP_MODULE = "wavecore.plugins._process_group"
USER_PATTERNS_MODULE = "wavecore.plugins._user_patterns"
PLURAL_MODULE = "wavecore.plugins._plural"

# By name: each case imports the module it reads.
VENDORED = (
    RUNTIME_MODULE,
    LOCAL_PROCESS_MODULE,
    WATCHDOG_MODULE,
    BRIDGE_MODULE,
    USER_PATTERNS_MODULE,
)

# The runtime half is standard library only: these four are the whole wavecore budget (PYRUN-12).
RUNTIME_WAVECORE_BUDGET = frozenset(
    {LOCAL_PROCESS_MODULE, PROCESS_GROUP_MODULE, USER_PATTERNS_MODULE, PLURAL_MODULE}
)

# The last line of the vendored-source loader; the worker is everything after it.
LOADER_END = "_sys.meta_path.insert(0, _WaveFinder())"

HOST_FAILED = f"Remote Execution failed on host '{HOST}': "
REMOTE_START_LINE = "Running the script under WAVE's own interpreter on the remote host"
REMOTE_SCHEME_REFUSED = (
    "{scheme} paths are not available on the remote host - "
    "use an absolute or relative path on the remote host"
)
INTERPRETER_MISSING = "Interpreter not found on the remote host: nosuchpython"

READINGS_SCRIPT = "label = readings[0]['sensor']\ntotal = threshold * 2\nprint(label)\n"
GREETER_SCRIPT = "import os\nimport sys\nprint(os.path.basename(sys.argv[0]))\n"
CWD_SCRIPT = "import os\nprint(os.getcwd())\n"
NESTED_INPUT_SCRIPT = (
    "print(type(payload['readings']).__name__)\n"
    "print(payload['readings'][0]['sensor'])\n"
    "print(payload['rate'])\n"
)
NESTED_EXPORT_SCRIPT = "bundle = {'rows': readings, 'rate': 2.5}\n"
READ_ENVIRONMENT_SCRIPT = "import os\nprint(os.environ['RATE'])\n"
# The token is assembled at run time, so the script text itself never carries it.
EXIT_WITH_STDERR_SCRIPT = "import sys\nsys.stderr.write('remote-' + 'token\\n')\nsys.exit(2)\n"
EXIT_WITH_TEXT_SCRIPT = "import sys\nsys.exit('remote-' + 'stop')\n"
RAISE_SCRIPT = "raise ValueError('boom')\n"
TEXT_EXPORT_SCRIPT = "print('ran')\nn = 'seven'\n"
NOT_AN_INTEGER = "Script variable 'n' is not a valid integer"
NEVER_SET_LINE = "Variable export '{}' was never set; the bound variable keeps its value"
READINGS_ENV_TEXT = (
    '{"columns":[{"name":"sensor","type":"string"},'
    '{"name":"temp_c","type":"float"}],"rows":[["s-1","21.5"]]}'
)


def exact(message: str) -> str:
    """Anchor an exact message for a regex match."""
    return f"^{re.escape(message)}$"


@cache
def _worker_source() -> str:
    """The worker half of the emitted bundle, past the vendored-source loader."""
    text = build_bundle(BUNDLE_REF).decode("utf-8")
    _loader, marker, worker = text.partition(LOADER_END)
    assert marker, "the emitted bundle no longer ends its loader with the finder install"
    return worker


def _registry_entries(worker: str) -> dict[str, ast.expr]:
    """The worker's own _PLUGINS registry, key by key, as written in the emitted source."""
    for node in ast.walk(ast.parse(worker)):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == "_PLUGINS" for t in node.targets):
            continue
        entries = node.value
        assert isinstance(entries, ast.Dict)
        return {
            key.value: value
            for key, value in zip(entries.keys, entries.values, strict=True)
            if isinstance(key, ast.Constant)
        }
    raise AssertionError("the emitted worker declares no _PLUGINS registry")


def _imported_targets(source: str) -> set[str]:
    """Every dotted name the source imports, a `from` import joined to the name it takes."""
    targets: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            targets |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            targets |= {f"{module}.{alias.name}" for alias in node.names}
    return targets


def _relative_imports(source: str) -> list[str]:
    """Every relative import in the source; a vendored module may hold none."""
    return [
        node.module or ""
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom) and node.level > 0
    ]


def _within_budget(target: str) -> bool:
    """True when an imported name belongs to a module the runtime half may reach for."""
    return any(
        target == allowed or target.startswith(f"{allowed}.") for allowed in RUNTIME_WAVECORE_BUDGET
    )


def _bound_names(worker: str, module: str) -> set[str]:
    """The local names the worker binds for one vendored module."""
    package, _, leaf = module.rpartition(".")
    names: set[str] = set()
    for node in ast.walk(ast.parse(worker)):
        if isinstance(node, ast.ImportFrom) and node.module == package:
            names |= {alias.asname or alias.name for alias in node.names if alias.name == leaf}
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == module and alias.asname is not None:
                    names.add(alias.asname)
    return names


def _watchdog_assignments(worker: str) -> list[tuple[str, ast.expr]]:
    """Every assignment the worker makes to a `<module>.WATCHDOG_PATH` as it starts."""
    found: list[tuple[str, ast.expr]] = []
    for node in ast.parse(worker).body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Attribute) and target.attr == "WATCHDOG_PATH":
                assert isinstance(target.value, ast.Name)
                found.append((target.value.id, node.value))
    return found


def _vendored_lookups(worker: str) -> set[str]:
    """Every vendored-source key the worker reads out of the loader's source map."""
    keys: set[str] = set()
    for node in ast.walk(ast.parse(worker)):
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == "_WAVE_SOURCES"
            and isinstance(node.slice, ast.Constant)
        ):
            keys.add(node.slice.value)
    return keys


@pytest.fixture(autouse=True)
def _no_coverage_in_children(monkeypatch: pytest.MonkeyPatch) -> None:
    """Coverage started in a spawned child interferes with the process tree a run owns."""
    for name in [key for key in os.environ if key.startswith("COV_CORE_")]:
        monkeypatch.delenv(name)


@pytest.fixture(autouse=True)
def _registered_plugins() -> Iterator[None]:
    """Register the plugins the container looks up for the remotability check."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(PythonPlugin())
    log_streaming_service._session_logs.clear()
    yield
    clear_registry()
    wb_common._workbench_sessions.clear()
    log_streaming_service._session_logs.clear()
    log_streaming_service._session_registries.clear()


@pytest.fixture
def read_on_wave(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    """Every file opened for reading on WAVE itself; a write is not recorded."""
    seen: list[Path] = []
    real_path_open, real_open = Path.open, builtins.open

    def spy_path_open(self: Path, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if "r" in mode:
            seen.append(Path(self))
        return real_path_open(self, mode, *args, **kwargs)

    def spy_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if "r" in mode and isinstance(file, str | Path):
            seen.append(Path(file))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", spy_path_open)
    monkeypatch.setattr(builtins, "open", spy_open)
    return seen


def _session(testdata: Path | None = None) -> dict[str, Any]:
    """A workbench session holding one open SSH session to the remote host."""
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, HOST, None, None, connect_timeout=30)
    session_id = str(uuid.uuid4())
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
        "variables": {},
        "secret_variable_names": [],
        "secret_registry": SecretRegistry(),
        "ssh_session_registry": registry,
        "testdata_dirs": [str(testdata)] if testdata is not None else [],
    }
    wb_common._workbench_sessions[session_id] = session
    log_streaming_service.register_secret_registry(session_id, session["secret_registry"])
    return session


def _node(
    node_id: str,
    element_type: str,
    values: dict[str, Any],
    *,
    expressions: list[str] | None = None,
    bindings: dict[str, str] | None = None,
    secret_outputs: list[str] | None = None,
) -> dict[str, Any]:
    """One canvas node: the Remote Execution container, or a block inside its body."""
    container = element_type == "remote-execution"
    config: dict[str, Any] = {
        "values": values,
        "outputBindings": bindings or {},
        "profileBindings": [],
    }
    if secret_outputs is not None:
        config["outputSecretFields"] = secret_outputs
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": "control" if container else "plugin",
            "version": "1.0.0",
            "config": config,
            "disabled": False,
            "displayName": node_id,
            "expressionFields": list(expressions or []),
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _passed(outputs: dict[str, Any] | None = None) -> dict[str, Any]:
    """A worker answer that carries the result envelope every core returns."""
    return {
        "return_value": {"__wave_type": "result", "outputs": outputs or {}, "secrets": []},
        "logs": [],
        "status": "passed",
        "error": None,
    }


async def _bundle_worker(
    handle: Any,
    plugin_id: str,
    params: dict[str, Any],
    variables: dict[str, Any],
    trust: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The real built bundle answering the request, as a remote host's worker does."""
    request: dict[str, Any] = {
        "id": "r1",
        "plugin_id": plugin_id,
        "params": params,
        "variables": variables,
    }
    if trust is not None:
        request["trust"] = trust
    return await asyncio.to_thread(_run_bundle, request, isolated=True)


async def _run_python_body(
    values: dict[str, Any],
    *,
    worker: Callable[..., Any],
    expressions: list[str] | None = None,
    bindings: dict[str, str] | None = None,
    variables: dict[str, Any] | None = None,
    testdata: Path | None = None,
    secret_outputs: list[str] | None = None,
    declared: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Run one Python block in a Remote Execution body on the given variables; hand them back."""
    session = _session(testdata)
    node_map = {
        "rex-1": _node("rex-1", "remote-execution", {"session_id": HOST_SESSION}),
        "body-1": _node(
            "body-1",
            "python",
            values,
            expressions=expressions,
            bindings=bindings,
            secret_outputs=secret_outputs,
        ),
    }
    adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
    run_variables: dict[str, Any] = {} if variables is None else variables
    handle = MagicMock()
    handle.host = HOST
    with (
        declared_type_scope(declared or {}),
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=handle)),
        patch.object(_remote_exec, "run_on_worker", worker),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        await execute_remote_container(
            "rex-1",
            adj,
            node_map,
            run_variables,
            session,
            session["session_id"],
            set(),
            [],
            None,
        )
    return run_variables


def _sent_params(worker: AsyncMock) -> dict[str, Any]:
    """The resolved parameters the request carried to the worker."""
    params: dict[str, Any] = worker.await_args.args[2]
    return params


def _console(level: str | None = None) -> list[str]:
    """Every run console message so far, optionally at one level."""
    return [
        str(entry["message"])
        for entries in log_streaming_service._session_logs.values()
        for entry in entries
        if level is None or entry["level"] == level
    ]


def _was_read_on_wave(seen: list[Path], target: Path) -> bool:
    """True when the spy saw the file opened for reading here, whatever spelling reached it."""
    resolved = target.resolve()
    return any(path.resolve() == resolved for path in seen)


def _readings() -> Table:
    return Table(columns=[("sensor", "string"), ("temp_c", "float")])


def _one_reading() -> Table:
    table = _readings()
    table.add_row(["s-1", Decimal("21.5")])
    return table


class TestTheBundleCarriesThePythonBlock:
    """The block dispatches on the remote worker the way File I/O does."""

    def test_the_worker_registry_lists_python(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "registry-probe", "params": {}, "variables": {}}],
            source_patch=_REGISTRY_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert "python" in responses[0]["return_value"]

    def test_the_python_entry_stands_beside_the_file_io_entry(self) -> None:
        entries = _registry_entries(_worker_source())

        assert "file-io" in entries
        assert "python" in entries
        assert isinstance(entries["python"], ast.Lambda | ast.Name | ast.Attribute)


class TestTheVendoredRuntimeTravels:
    """The runtime, the watchdog, the bridge and the pattern compile ride as text (PYRUN-12)."""

    @pytest.mark.parametrize("module", sorted(VENDORED))
    def test_the_module_rides_as_its_own_source_text(self, module: str) -> None:
        own_file = Path(str(import_module(module).__file__))

        sources = _vendored_sources()

        assert module in sources
        assert sources[module] == own_file.read_text(encoding="utf-8")

    def test_the_runtime_imports_no_wavecore_module_beyond_the_four_allowed(self) -> None:
        source = _vendored_sources()[RUNTIME_MODULE]

        reached = {
            target
            for target in _imported_targets(source)
            if target.split(".")[0] == "wavecore" and not _within_budget(target)
        }

        assert reached == set()

    def test_the_runtime_imports_nothing_relatively(self) -> None:
        assert _relative_imports(_vendored_sources()[RUNTIME_MODULE]) == []


class TestTheWorkerOwnsTheWatchdogSource:
    """The spawned watchdog resolves to the text the worker wrote, never a package file."""

    def test_the_worker_assigns_the_watchdog_path_at_start(self) -> None:
        worker = _worker_source()

        [(module_name, assigned)] = _watchdog_assignments(worker)

        assert module_name in _bound_names(worker, LOCAL_PROCESS_MODULE)
        assert not isinstance(assigned, ast.Constant)

    def test_the_worker_writes_the_watchdog_from_the_vendored_source(self) -> None:
        assert WATCHDOG_MODULE in _vendored_lookups(_worker_source())


class TestTypedInputVariablesCrossTheWire:
    """Input Variables reach a remote script as the objects a local script gets (PYRUN-5)."""

    async def test_a_table_crosses_in_the_typed_envelope(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {"script_type": "source", "script": "pass", "input_vars": {"readings": "readings"}},
            worker=worker,
            expressions=["input_vars.readings"],
            variables={"readings": _one_reading()},
        )

        envelope = _sent_params(worker)["input_vars"]["readings"]
        assert envelope["__wave_type"] == "table"
        restored = Table.from_dict({k: v for k, v in envelope.items() if k != "__wave_type"})
        assert restored.col_names() == ["sensor", "temp_c"]
        assert restored.to_list() == [{"sensor": "s-1", "temp_c": Decimal("21.5")}]

    async def test_a_float_crosses_as_exact_decimal_text(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {"script_type": "source", "script": "pass", "input_vars": {"threshold": "threshold"}},
            worker=worker,
            expressions=["input_vars.threshold"],
            variables={"threshold": Decimal("0.000000123456789")},
        )

        assert _sent_params(worker)["input_vars"]["threshold"] == {
            "__wave_type": "decimal",
            "value": "0.000000123456789",
        }

    async def test_nothing_is_dropped_and_the_request_still_frames_as_json(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {
                "script_type": "source",
                "script": "pass",
                "input_vars": {"readings": "readings", "threshold": "threshold"},
            },
            worker=worker,
            expressions=["input_vars.readings", "input_vars.threshold"],
            variables={"readings": _one_reading(), "threshold": Decimal("30.5")},
        )

        params = _sent_params(worker)
        assert sorted(params["input_vars"]) == ["readings", "threshold"]
        assert json.loads(json.dumps(params))["input_vars"] == params["input_vars"]


class TestWhereTheScriptFileIsRead:
    """A WAVE-side reference is read here; a plain path is read where the block runs."""

    async def test_a_testdata_script_is_read_on_wave_and_sent_as_source(
        self, tmp_path: Path, read_on_wave: list[Path]
    ) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        script = testdata / "greet.py"
        script.write_text(GREETER_SCRIPT, encoding="utf-8")
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {"script_type": "file", "script_file": "testdata://greet.py"},
            worker=worker,
            testdata=testdata,
        )

        params = _sent_params(worker)
        assert params["script_type"] == "source"
        assert params["script"] == GREETER_SCRIPT
        assert "script_file" not in params
        assert _was_read_on_wave(read_on_wave, script)

    async def test_the_remote_temp_file_keeps_the_original_file_name(self, tmp_path: Path) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "greet.py").write_text(GREETER_SCRIPT, encoding="utf-8")

        variables = await _run_python_body(
            {"script_type": "file", "script_file": "testdata://greet.py"},
            worker=_bundle_worker,
            bindings={"stdout": "out"},
            testdata=testdata,
        )

        assert variables["out"] == "greet.py\n"

    async def test_a_plain_path_stays_a_file_and_is_never_read_on_wave(
        self, tmp_path: Path, read_on_wave: list[Path]
    ) -> None:
        on_wave = tmp_path / "on_wave.py"
        on_wave.write_text("print('read on WAVE')\n", encoding="utf-8")
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {"script_type": "file", "script_file": str(on_wave)},
            worker=worker,
        )

        params = _sent_params(worker)
        assert params["script_type"] == "file"
        assert params["script_file"] == str(on_wave)
        assert not params.get("script")
        assert not _was_read_on_wave(read_on_wave, on_wave)


class TestTheRemoteDefaultWorkingDirectory:
    """A blank or absent Working Directory starts in the remote host's own temp folder."""

    @pytest.mark.parametrize("value", [None, "", "   "], ids=["absent", "empty", "whitespace"])
    async def test_the_script_starts_in_the_remote_hosts_temp_folder(
        self, value: str | None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        remote_temp = tmp_path / "remote-temp"
        remote_temp.mkdir()
        monkeypatch.setenv("TMPDIR", str(remote_temp))
        values: dict[str, Any] = {"script_type": "source", "script": CWD_SCRIPT}
        if value is not None:
            values["working_dir"] = value

        variables = await _run_python_body(
            values, worker=_bundle_worker, bindings={"stdout": "out"}
        )

        assert variables["out"] == f"{remote_temp.resolve()}\n"

    async def test_wave_sends_no_folder_of_its_own_for_an_absent_setting(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body({"script_type": "source", "script": "pass"}, worker=worker)

        assert "working_dir" not in _sent_params(worker)


class TestTheRemoteHostRefusesWaveSidePaths:
    """A folder only WAVE can resolve fails the block on the remote host (PYRUN-11)."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    async def test_a_wave_side_working_directory_fails_with_start_failed(self, scheme: str) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": "print('never')",
                "working_dir": f"{scheme}data",
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={"error": "err", "reason": "why", "success": "ok", "stdout": "out"},
        )

        refused = REMOTE_SCHEME_REFUSED.format(scheme=scheme)
        assert re.match(exact(refused), variables["err"]) is not None
        assert variables["why"] == "StartFailed"
        assert variables["ok"] is False
        assert variables["out"] == ""


class TestTheRemoteInterpreter:
    """The Interpreter row resolves on the remote host, and the miss names it (PYRUN-3)."""

    async def test_a_missing_interpreter_names_the_remote_host(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": "print('never')",
                "interpreter": "nosuchpython",
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={"error": "err", "reason": "why", "success": "ok"},
        )

        assert re.match(exact(INTERPRETER_MISSING), variables["err"]) is not None
        assert variables["why"] == "StartFailed"
        assert variables["ok"] is False


class TestTheRemoteEntryRunsTheCore:
    """The same core runs on the worker and hands typed exports back (PYRUN-6, PYRUN-12)."""

    async def test_the_script_runs_and_its_exports_come_back_typed(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": READINGS_SCRIPT,
                "input_vars": {"readings": "readings", "threshold": "threshold"},
                "script_variables": ["label", "total"],
            },
            worker=_bundle_worker,
            expressions=["input_vars.readings", "input_vars.threshold"],
            bindings={
                "stdout": "out",
                "exit_code": "code",
                "success": "ok",
                "label": "label_var",
                "total": "total_var",
            },
            variables={"readings": _one_reading(), "threshold": Decimal("30.5")},
            declared={"label_var": "string", "total_var": "float"},
        )

        assert variables["out"] == "s-1\n"
        assert variables["code"] == 0
        assert variables["ok"] is True
        assert variables["label_var"] == "s-1"
        assert isinstance(variables["total_var"], Decimal)
        assert variables["total_var"] == Decimal("61.0")

    async def test_a_nested_table_and_float_reach_the_script_as_what_they_are(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": NESTED_INPUT_SCRIPT,
                "input_vars": {"payload": "payload"},
            },
            worker=_bundle_worker,
            expressions=["input_vars.payload"],
            bindings={"stdout": "out"},
            variables={"payload": {"readings": _one_reading(), "rate": Decimal("2.5")}},
        )

        assert variables["out"] == "_Table\ns-1\n2.5\n"

    async def test_a_nested_export_comes_back_as_the_types_it_stands_for(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": NESTED_EXPORT_SCRIPT,
                "input_vars": {"readings": "readings"},
                "script_variables": ["bundle"],
            },
            worker=_bundle_worker,
            expressions=["input_vars.readings"],
            bindings={"bundle": "bundle_var"},
            variables={"readings": _one_reading()},
            declared={"bundle_var": "map"},
        )

        bundle = variables["bundle_var"]
        assert bundle["rate"] == Decimal("2.5")
        assert isinstance(bundle["rows"], Table)
        assert bundle["rows"].to_list() == [{"sensor": "s-1", "temp_c": Decimal("21.5")}]


# Each case: the export names in list order with their bound types, and the script.
BOUND_ON_BOTH = [
    pytest.param({"n": "integer"}, "n = 'seven'\n", id="text-bound-to-an-integer"),
    pytest.param({"n": "integer"}, "n = True\n", id="boolean-bound-to-an-integer"),
    pytest.param({"n": "float"}, "n = 2\n", id="integer-bound-to-a-float"),
    pytest.param({"n": "integer"}, "n = None\n", id="none-bound-to-an-integer"),
    pytest.param({"n": "table"}, "n = [{'id': 1, 'ok': True}]\n", id="dicts-bound-to-a-table"),
    pytest.param(
        {"a": "integer", "b": "array"}, "a = 'x'\nb = [object()]\n", id="refused-then-uncarriable"
    ),
    pytest.param(
        {"b": "array", "a": "integer"}, "a = 'x'\nb = [object()]\n", id="uncarriable-then-refused"
    ),
]


def _comparable(value: Any) -> Any:
    """A table as its stored form, so a table bound on WAVE and one bound remotely compare."""
    return value.to_dict() if isinstance(value, Table) else value


async def _recorded_on_wave(script: str, types: dict[str, str]) -> dict[str, Any]:
    """The block run on WAVE under Record and continue, each export bound to '<name>_var'."""
    params = {"script": script, "script_variables": list(types), "on_error": "record"}
    return await PythonPlugin().execute(
        {
            "parameters": params,
            "variables": {},
            "logger": MagicMock(),
            "output_bindings": {name: f"{name}_var" for name in types},
            "output_types": types,
            "output_secret_fields": [],
            "testdata_dirs": [],
        }
    )


async def _recorded_on_the_host(script: str, types: dict[str, str]) -> dict[str, Any]:
    """The same block run on the remote host, its outcome bound to err, why and ok."""
    return await _run_python_body(
        {
            "script_type": "source",
            "script": script,
            "script_variables": list(types),
            "on_error": "record",
        },
        worker=_bundle_worker,
        bindings={
            **{name: f"{name}_var" for name in types},
            "error": "err",
            "reason": "why",
            "success": "ok",
        },
        declared={f"{name}_var": wave_type for name, wave_type in types.items()},
    )


class TestRemoteExportsFitTheBoundType:
    """A remote export binds only when it fits its variable's type, the rule on WAVE (PYRUN-6)."""

    async def test_a_text_export_bound_to_an_integer_fails_the_block_and_binds_nothing(
        self,
    ) -> None:
        held: dict[str, Any] = {"n_var": 5}

        with pytest.raises(RuntimeError, match=exact(HOST_FAILED + NOT_AN_INTEGER)):
            await _run_python_body(
                {"script_type": "source", "script": TEXT_EXPORT_SCRIPT, "script_variables": ["n"]},
                worker=_bundle_worker,
                bindings={"stdout": "out", "n": "n_var"},
                variables=held,
                declared={"n_var": "integer"},
            )

        assert held == {"n_var": 5}

    async def test_a_recorded_refusal_reads_success_false_and_binds_what_fit(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": TEXT_EXPORT_SCRIPT + "status = 'ok'\n",
                "script_variables": ["n", "status"],
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={
                "stdout": "out",
                "n": "n_var",
                "status": "status_var",
                "error": "err",
                "reason": "why",
                "success": "ok",
            },
            variables={"n_var": 5},
            declared={"n_var": "integer", "status_var": "string"},
        )

        assert variables["n_var"] == 5
        assert variables["status_var"] == "ok"
        assert variables["out"] == "ran\n"
        assert variables["ok"] is False
        assert variables["err"] == NOT_AN_INTEGER
        assert variables["why"] == "OutputVariable"
        assert _console("WARN").count(f"Script failed (OutputVariable): {NOT_AN_INTEGER}") == 1

    async def test_an_export_that_fits_binds(self) -> None:
        variables = await _run_python_body(
            {"script_type": "source", "script": "n = 7\n", "script_variables": ["n"]},
            worker=_bundle_worker,
            bindings={"n": "n_var", "success": "ok"},
            variables={"n_var": 5},
            declared={"n_var": "integer"},
        )

        assert variables["n_var"] == 7
        assert variables["ok"] is True

    async def test_a_none_export_binds_null(self) -> None:
        variables = await _run_python_body(
            {"script_type": "source", "script": "n = None\n", "script_variables": ["n"]},
            worker=_bundle_worker,
            bindings={"n": "n_var", "success": "ok"},
            variables={"n_var": 5},
            declared={"n_var": "integer"},
        )

        assert variables["n_var"] is None
        assert variables["ok"] is True

    async def test_an_earlier_failure_keeps_its_reason_and_the_refused_export_stays_unbound(
        self,
    ) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": "n = 'seven'\n" + RAISE_SCRIPT,
                "script_variables": ["n"],
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={"n": "n_var", "error": "err", "reason": "why", "success": "ok"},
            variables={"n_var": 5},
            declared={"n_var": "integer"},
        )

        assert variables["n_var"] == 5
        assert variables["ok"] is False
        assert variables["err"] == "ValueError: boom"
        assert variables["why"] == "Exception"

    @pytest.mark.parametrize(("types", "script"), BOUND_ON_BOTH)
    async def test_the_remote_host_binds_and_fails_as_wave_does(
        self, types: dict[str, str], script: str
    ) -> None:
        on_wave = await _recorded_on_wave(script, types)
        on_host = await _recorded_on_the_host(script, types)

        assert {
            name: _comparable(on_host[f"{name}_var"]) for name in types if f"{name}_var" in on_host
        } == {name: _comparable(on_wave[name]) for name in types if name in on_wave}
        assert (on_host["err"], on_host["why"], on_host["ok"]) == (
            on_wave["error"],
            on_wave["reason"],
            on_wave["success"],
        )

    def test_the_worker_carries_back_only_bound_exports(self) -> None:
        answer = _run_bundle(
            {
                "id": "r1",
                "plugin_id": "python",
                "params": {
                    "script_type": "source",
                    "script": "kept = 1\ndropped = 2\n",
                    "script_variables": ["kept", "dropped", "unset", "unset_unbound"],
                    "bound_exports": ["kept", "unset"],
                },
                "variables": {},
            },
            isolated=True,
        )

        outputs = answer["return_value"]["outputs"]
        assert outputs["kept"] == 1
        assert "dropped" not in outputs
        debug = [entry["message"] for entry in answer["logs"] if entry["level"] == "DEBUG"]
        assert debug == [NEVER_SET_LINE.format("unset")]


class TestTheEnvironmentCrossesAsText:
    """An Environment value is rendered here the way the local path renders it (SHRUN-5)."""

    async def test_a_decimal_and_a_table_are_rendered_before_the_request_is_built(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {
                "script_type": "source",
                "script": "pass",
                "environment": {"RATE": "rate", "READINGS": "readings"},
            },
            worker=worker,
            expressions=["environment.RATE", "environment.READINGS"],
            variables={"rate": Decimal("0.000000123456789"), "readings": _one_reading()},
        )

        params = _sent_params(worker)
        assert params["environment"] == {
            "RATE": "0.000000123456789",
            "READINGS": READINGS_ENV_TEXT,
        }
        assert json.loads(json.dumps(params))["environment"] == params["environment"]

    async def test_the_remote_script_reads_the_exact_decimal_text(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": READ_ENVIRONMENT_SCRIPT,
                "environment": {"RATE": "rate"},
            },
            worker=_bundle_worker,
            expressions=["environment.RATE"],
            bindings={"stdout": "out"},
            variables={"rate": Decimal("0.000000123456789")},
        )

        assert variables["out"] == "0.000000123456789\n"


class TestTheArgumentsCrossAsText:
    """An Arguments row is rendered here the way the local path renders it (PYRUN-4)."""

    async def test_a_decimal_and_a_table_are_rendered_before_the_request_is_built(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {
                "script_type": "source",
                "script": "pass",
                "arguments": [{"value": "rate"}, {"value": "readings"}],
            },
            worker=worker,
            expressions=["arguments.0.value", "arguments.1.value"],
            variables={"rate": Decimal("0.000000123456789"), "readings": _one_reading()},
        )

        params = _sent_params(worker)
        assert params["arguments"] == [
            {"value": "0.000000123456789"},
            {"value": READINGS_ENV_TEXT},
        ]
        assert json.loads(json.dumps(params))["arguments"] == params["arguments"]


class TestTheRemoteStartLine:
    """WAVE names the interpreter, the script and the remote host before the request leaves."""

    async def test_the_line_is_on_the_console_when_the_request_is_sent(self) -> None:
        seen_at_dispatch: list[str] = []

        async def worker(*_args: Any) -> dict[str, Any]:
            seen_at_dispatch.extend(_console("INFO"))
            return _passed()

        await _run_python_body({"script_type": "source", "script": "pass"}, worker=worker)

        assert seen_at_dispatch == [REMOTE_START_LINE]

    async def test_a_named_interpreter_and_a_testdata_file_are_named_as_written(
        self, tmp_path: Path
    ) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "greet.py").write_text(GREETER_SCRIPT, encoding="utf-8")

        await _run_python_body(
            {
                "script_type": "file",
                "script_file": "testdata://greet.py",
                "interpreter": "python3",
            },
            worker=AsyncMock(return_value=_passed()),
            testdata=testdata,
        )

        assert _console("INFO") == ["Running testdata://greet.py under python3 on the remote host"]


class TestTheRemoteExitMessage:
    """A non-zero exit on the remote host names the last stderr line as it does on WAVE."""

    async def test_the_last_stderr_line_follows_the_code(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": EXIT_WITH_STDERR_SCRIPT,
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={"error": "err", "reason": "why"},
        )

        assert variables["err"] == "Script exited with code 2: remote-token"
        assert variables["why"] == "NonZeroExit"

    async def test_the_sys_exit_text_follows_the_code(self) -> None:
        variables = await _run_python_body(
            {
                "script_type": "source",
                "script": EXIT_WITH_TEXT_SCRIPT,
                "on_error": "record",
            },
            worker=_bundle_worker,
            bindings={"error": "err", "reason": "why", "stderr": "text"},
        )

        assert variables["err"] == "Script exited with code 1: remote-stop"
        assert variables["why"] == "NonZeroExit"
        assert variables["text"] == "remote-stop\n"

    async def test_a_secret_stderr_keeps_the_sys_exit_text_out_of_the_message(self) -> None:
        with pytest.raises(RuntimeError, match=exact(f"{HOST_FAILED}Script exited with code 1")):
            await _run_python_body(
                {
                    "script_type": "source",
                    "script": EXIT_WITH_TEXT_SCRIPT,
                    "stream_output": True,
                },
                worker=_bundle_worker,
                secret_outputs=["stderr"],
            )

        assert [line for line in _console() if "remote-stop" in line] == []

    async def test_the_request_names_the_streams_marked_secret(self) -> None:
        worker = AsyncMock(return_value=_passed())

        await _run_python_body(
            {"script_type": "source", "script": "pass"},
            worker=worker,
            secret_outputs=["stderr", "exit_code"],
        )

        assert _sent_params(worker)["output_secret_fields"] == ["exit_code", "stderr"]

    async def test_a_secret_stderr_keeps_the_bare_message_and_no_live_line(self) -> None:
        with pytest.raises(RuntimeError, match=exact(f"{HOST_FAILED}Script exited with code 2")):
            await _run_python_body(
                {
                    "script_type": "source",
                    "script": EXIT_WITH_STDERR_SCRIPT,
                    "stream_output": True,
                },
                worker=_bundle_worker,
                secret_outputs=["stderr"],
            )

        assert [line for line in _console() if "remote-token" in line] == []

    async def test_a_secret_stderr_keeps_the_traceback_off_the_console(self) -> None:
        with pytest.raises(RuntimeError, match=exact(f"{HOST_FAILED}ValueError: boom")):
            await _run_python_body(
                {"script_type": "source", "script": RAISE_SCRIPT},
                worker=_bundle_worker,
                secret_outputs=["stderr"],
            )

        assert [line for line in _console() if "Traceback" in line] == []
