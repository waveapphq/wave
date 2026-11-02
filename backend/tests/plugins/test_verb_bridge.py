"""The shared sync verb bridge (REQ-5.1.1, REQ-3.4.1.5, REQ-3.4.1.10).

run_verb lets a plugin's prepare hook settle the params and mask the values it
names, then runs one synchronous core off the event loop and materializes its
envelope into block outputs. log_via builds the two-argument callable that core
logs through. Every family with a sync core rides the same bridge: the
Kubernetes verbs, the Helm verbs and the File I/O operations.
"""

import asyncio
import importlib
import inspect
import re
import threading
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import execute_context
from wavecore.plugins import _k8s_common as common
from wavecore.plugins import _process_group

_BRIDGE_PLUGIN_MODULES = [
    "k8s_connect",
    "k8s_get",
    "k8s_events",
    "k8s_logs",
    "k8s_top",
    "k8s_apply",
    "k8s_delete",
    "k8s_scale",
    "k8s_rollout",
    "k8s_exec",
    "k8s_script",
    "k8s_copy",
    "helm_install",
    "helm_upgrade",
    "helm_rollback",
    "helm_uninstall",
    "helm_test",
    "helm_status",
    "sql_client",
]

_SECRET_PLAINTEXT = "s3cr3t"
_FORM_SECRET_VALUES = ["s3cr3t", "czNjcjN0", "admin", "YWRtaW4="]
_MANIFEST_SECRET_VALUES = ["czNjcjN0", "s3cr3t"]
_READ_ONLY_MESSAGE = (
    "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
)
_TESTDATA_MISSING_MESSAGE = (
    "testdata file not found: testdata://seed.txt\nSearched paths: /data/seed.txt"
)
_POD_PATH = "/etc/config/app.conf"
_PUSH_SOURCE = "testdata://seed.txt"
_LOCAL_PUSH_PATH = "/data/seed.txt"


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


def _bridge() -> Any:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    from wavecore.plugins import _verb_bridge

    return _verb_bridge


class TestTheBridgeHasItsOwnModule:
    """Both functions live in _verb_bridge, and _k8s_common keeps no alias."""

    def test_run_verb_is_defined_in_the_verb_bridge_module(self) -> None:
        assert _bridge().run_verb.__module__ == "wavecore.plugins._verb_bridge"

    def test_log_via_is_defined_in_the_verb_bridge_module(self) -> None:
        assert _bridge().log_via.__module__ == "wavecore.plugins._verb_bridge"

    def test_k8s_common_no_longer_exposes_run_verb(self) -> None:
        assert not hasattr(common, "run_verb")

    def test_k8s_common_no_longer_exposes_log_via(self) -> None:
        assert not hasattr(common, "log_via")

    @pytest.mark.parametrize("name", _BRIDGE_PLUGIN_MODULES)
    def test_every_plugin_that_runs_a_verb_binds_the_bridge(self, name: str) -> None:
        module = importlib.import_module(f"wavecore.plugins.{name}")

        assert module.run_verb is _bridge().run_verb


class TestLogVia:
    """log_via turns a context logger into the callable a sync core writes lines through."""

    def test_it_returns_a_callable(self) -> None:
        assert callable(_bridge().log_via(MagicMock()))

    @pytest.mark.parametrize(
        "level, method",
        [("INFO", "info"), ("WARN", "warn"), ("ERROR", "error"), ("DEBUG", "debug")],
    )
    def test_each_level_writes_through_the_matching_logger_method(
        self, level: str, method: str
    ) -> None:
        logger = MagicMock()
        message = "Read 2 Pod object(s) from /api/v1/namespaces/apps/pods"

        _bridge().log_via(logger)(level, message)

        assert logger.method_calls == [getattr(call, method)(message)]

    def test_a_lowercase_level_reaches_the_same_method(self) -> None:
        logger = MagicMock()

        _bridge().log_via(logger)("info", "Connected to Kubernetes v1.33.0")

        assert logger.method_calls == [call.info("Connected to Kubernetes v1.33.0")]


_VERB_ENVELOPE = {
    "__wave_type": "result",
    "outputs": {"result": {"kind": "Pod"}, "names": ["web-1"], "count": 1},
    "secrets": [],
}
_MATERIALIZE = "wavecore.plugins._verb_bridge.materialize"
_TO_THREAD = "wavecore.plugins._verb_bridge.asyncio.to_thread"
_GATE_WAIT = 5.0
_LATE_LINE = "Read 412 Pod object(s) from /api/v1/namespaces/prod/pods"


class _RecordingVerb:
    """Stands in for one sync verb and records what the bridge handed it."""

    def __init__(
        self,
        envelope: Any = None,
        error: Exception | None = None,
        lines: list[tuple[str, str]] | None = None,
    ) -> None:
        self.envelope = envelope
        self.error = error
        self.lines = lines or []
        self.params: Any = None
        self.log: Any = None
        self.thread: int | None = None

    def __call__(self, params: dict[str, Any], log: Any) -> Any:
        self.params = params
        self.log = log
        self.thread = threading.get_ident()
        for level, message in self.lines:
            log(level, message)
        if self.error is not None:
            raise self.error
        return self.envelope


class _ThreadAwareLogger:
    """Records, per line, the thread it was written on and whether a loop was running there."""

    def __init__(self) -> None:
        self.lines: list[tuple[str, str, int, bool]] = []

    def _record(self, level: str, message: str) -> None:
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        self.lines.append((level, message, threading.get_ident(), on_loop))

    def info(self, message: str) -> None:
        self._record("info", message)

    def warn(self, message: str) -> None:
        self._record("warn", message)


class _Gate:
    """A verb held open until released, so its awaiting task can be canceled mid-run."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()
        self.escaped: list[Exception] = []

    def verb(self, params: dict[str, Any], log: Any) -> Any:
        self.started.set()
        self.release.wait(_GATE_WAIT)
        try:
            log("INFO", _LATE_LINE)
        except Exception as error:
            self.escaped.append(error)
        self.finished.set()
        return _VERB_ENVELOPE


async def _drain(turns: int = 3) -> None:
    """Give the loop enough turns to run whatever a verb thread scheduled on it."""
    for _ in range(turns):
        await asyncio.sleep(0)


class TestRunVerb:
    """The bridge: params through unchanged, the verb off the loop, the envelope materialized."""

    async def test_the_verb_receives_the_params_dict_unchanged(self) -> None:
        params = {"session": "{}", "kind": "Pod", "on_error": "fail"}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, params, execute_context(params))

        assert verb.params is params
        assert verb.params == {"session": "{}", "kind": "Pod", "on_error": "fail"}

    @pytest.mark.parametrize("level, method", [("INFO", "info"), ("WARN", "warn")])
    async def test_each_level_writes_through_the_matching_logger_method(
        self, level: str, method: str
    ) -> None:
        message = "Read 2 Pod object(s) from /api/v1/namespaces/apps/pods"
        logger = MagicMock()
        verb = _RecordingVerb(_VERB_ENVELOPE, lines=[(level, message)])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
        await _drain()

        assert logger.method_calls == [getattr(call, method)(message)]

    async def test_a_line_logged_inside_the_verb_is_written_on_the_event_loop_thread(
        self,
    ) -> None:
        message = "Connected to Kubernetes v1.33.0 at https://kwok:6443"
        logger = _ThreadAwareLogger()
        verb = _RecordingVerb(_VERB_ENVELOPE, lines=[("INFO", message)])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))

        assert verb.thread != threading.get_ident()
        assert logger.lines == [("info", message, threading.get_ident(), True)]

    async def test_lines_logged_inside_the_verb_keep_their_order_and_levels(self) -> None:
        lines = [
            ("INFO", "Connected to Kubernetes v1.33.0 at https://kwok:6443"),
            ("WARN", "Read failed (NotFound): K8s namespace 'missing' not found"),
            ("INFO", "Read 0 Namespace object(s) from /api/v1/namespaces/missing"),
        ]
        logger = _ThreadAwareLogger()
        verb = _RecordingVerb(_VERB_ENVELOPE, lines=lines)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))

        assert [(level, message) for level, message, _, _ in logger.lines] == [
            (level.lower(), message) for level, message in lines
        ]

    async def test_materialize_takes_the_envelope_and_the_register_secret_once(self) -> None:
        register_secret = MagicMock()
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}) as materialize:
            await _bridge().run_verb(verb, {}, execute_context({}, register_secret=register_secret))

        assert materialize.call_args_list == [call(_VERB_ENVELOPE, register_secret)]

    async def test_the_materialized_outputs_are_what_the_bridge_returns(self) -> None:
        outputs = {"result": {"kind": "Pod"}, "names": ["web-1"], "count": 1, "success": True}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value=outputs):
            answer = await _bridge().run_verb(verb, {}, execute_context({}))

        assert answer is outputs

    async def test_a_context_with_no_register_secret_key_materializes_with_none(self) -> None:
        context = execute_context({})
        verb = _RecordingVerb(_VERB_ENVELOPE)

        assert "register_secret" not in context
        with patch(_MATERIALIZE, return_value={}) as materialize:
            await _bridge().run_verb(verb, {}, context)

        assert materialize.call_args_list == [call(_VERB_ENVELOPE, None)]

    async def test_the_verb_is_handed_to_asyncio_to_thread(self) -> None:
        real_to_thread = asyncio.to_thread
        handed: list[tuple[Any, ...]] = []

        async def _spy(function: Any, *args: Any) -> Any:
            handed.append((function, *args))
            return await real_to_thread(function, *args)

        params = {"kind": "Pod"}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}), patch(_TO_THREAD, _spy):
            await _bridge().run_verb(verb, params, execute_context(params))

        assert len(handed) == 1
        assert handed[0][0] is verb
        assert handed[0][1] is params
        assert callable(handed[0][2])

    async def test_the_verb_body_runs_off_the_event_loop(self) -> None:
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}))

        assert verb.thread is not None
        assert verb.thread != threading.get_ident()

    async def test_an_exception_from_the_verb_propagates_unchanged(self) -> None:
        message = "K8s Pod 'web-1' not found in namespace 'apps'"
        verb = _RecordingVerb(error=ValueError(message))

        with patch(_MATERIALIZE, return_value={}) as materialize:
            with pytest.raises(ValueError, match=_exact(message)):
                await _bridge().run_verb(verb, {}, execute_context({}))

        assert materialize.call_args_list == []


class TestRunVerbAfterItsAwaiterIsGone:
    """A verb that finishes after its await was canceled writes nothing and raises nothing."""

    async def test_a_canceled_await_leaves_the_verbs_last_line_unwritten(self) -> None:
        logger = _ThreadAwareLogger()
        gate = _Gate()

        task = asyncio.create_task(
            _bridge().run_verb(gate.verb, {}, execute_context({}, logger=logger))
        )
        await asyncio.to_thread(gate.started.wait, _GATE_WAIT)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        gate.release.set()
        await asyncio.to_thread(gate.finished.wait, _GATE_WAIT)
        await _drain()

        assert gate.finished.is_set()
        assert logger.lines == []

    async def test_a_canceled_await_writes_no_line_through_the_context_logger(self) -> None:
        logger = MagicMock()
        gate = _Gate()

        task = asyncio.create_task(
            _bridge().run_verb(gate.verb, {}, execute_context({}, logger=logger))
        )
        await asyncio.to_thread(gate.started.wait, _GATE_WAIT)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        gate.release.set()
        await asyncio.to_thread(gate.finished.wait, _GATE_WAIT)
        await _drain()

        assert logger.method_calls == []

    def test_a_line_logged_after_the_loop_closed_never_raises_in_the_verb(self) -> None:
        logger = MagicMock()
        gate = _Gate()

        async def drive() -> None:
            task = asyncio.create_task(
                _bridge().run_verb(gate.verb, {}, execute_context({}, logger=logger))
            )
            await asyncio.to_thread(gate.started.wait, _GATE_WAIT)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(drive())
        finally:
            loop.close()
        gate.release.set()

        assert gate.finished.wait(_GATE_WAIT)
        assert gate.escaped == []
        assert logger.method_calls == []


def _registry() -> tuple[list[Any], Any]:
    """The two-argument register_secret the engine passes, and the list it appends to."""
    values: list[Any] = []

    def register_secret(value: Any, revealed: bool = False) -> None:
        values.append(value)

    return values, register_secret


class _SnapshotVerb:
    """Records what had already been registered at the moment the verb body was entered."""

    def __init__(self, registered: list[Any], error: Exception | None = None) -> None:
        self.registered = registered
        self.error = error
        self.seen: list[Any] = []
        self.params: Any = None

    def __call__(self, params: dict[str, Any], log: Any) -> Any:
        self.params = params
        self.seen = list(self.registered)
        if self.error is not None:
            raise self.error
        return _VERB_ENVELOPE


class _RecordingPrepare:
    """Stands in for one plugin's prepare hook and records what the bridge handed it."""

    def __init__(
        self,
        result: dict[str, Any] | None = None,
        values: list[str] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result
        self.values = values or []
        self.error = error
        self.params: Any = None
        self.context: Any = None

    def __call__(self, params: dict[str, Any], context: dict[str, Any]) -> Any:
        self.params = params
        self.context = context
        if self.error is not None:
            raise self.error
        return (params if self.result is None else self.result), list(self.values)


class TestRunVerbPrepare:
    """The bridge's prepare hook: the params the verb runs on, and the values masked first."""

    async def test_prepare_is_keyword_only_and_defaults_to_none(self) -> None:
        parameter = inspect.signature(_bridge().run_verb).parameters["prepare"]

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is None

    async def test_an_explicit_none_prepare_hands_the_verb_the_caller_params(self) -> None:
        params = {"session": "{}", "kind": "Pod", "on_error": "fail"}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, params, execute_context(params), prepare=None)

        assert verb.params is params
        assert verb.params == {"session": "{}", "kind": "Pod", "on_error": "fail"}

    async def test_the_hook_reads_the_params_and_the_context_it_was_given(self) -> None:
        params = {"session": "{}", "kind": "Secret"}
        context = execute_context(params)
        prepare = _RecordingPrepare()
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, params, context, prepare=prepare)

        assert prepare.params is params
        assert prepare.context is context

    async def test_the_verb_runs_on_the_params_the_hook_returned(self) -> None:
        params = {"source_path": _PUSH_SOURCE, "target_path": _POD_PATH}
        prepare = _RecordingPrepare(
            result={"source_path": _LOCAL_PUSH_PATH, "target_path": "/srv/x"}
        )
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, params, execute_context(params), prepare=prepare)

        assert verb.params is prepare.result
        assert verb.params == {"source_path": _LOCAL_PUSH_PATH, "target_path": "/srv/x"}

    async def test_a_hook_that_rewrites_two_keys_leaves_the_callers_dict_alone(self) -> None:
        params = {"source_path": _PUSH_SOURCE, "target_path": _POD_PATH, "pod": "web-1"}
        prepare = _RecordingPrepare(
            result={"source_path": _LOCAL_PUSH_PATH, "target_path": "/srv/x", "pod": "web-1"}
        )
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, params, execute_context(params), prepare=prepare)

        assert params == {"source_path": _PUSH_SOURCE, "target_path": _POD_PATH, "pod": "web-1"}

    async def test_every_prepared_value_is_registered_before_the_verb_body_starts(self) -> None:
        registered, register_secret = _registry()
        verb = _SnapshotVerb(registered)
        prepare = _RecordingPrepare(values=_FORM_SECRET_VALUES)
        context = execute_context({}, register_secret=register_secret)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert verb.seen == _FORM_SECRET_VALUES
        assert registered == _FORM_SECRET_VALUES

    async def test_a_prepared_value_is_registered_even_when_the_verb_then_raises(self) -> None:
        message = "K8s Secret 'db' not found in namespace 'apps'"
        registered, register_secret = _registry()
        verb = _SnapshotVerb(registered, error=ValueError(message))
        prepare = _RecordingPrepare(values=_MANIFEST_SECRET_VALUES)
        context = execute_context({}, register_secret=register_secret)

        with patch(_MATERIALIZE, return_value={}):
            with pytest.raises(ValueError, match=_exact(message)):
                await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert verb.seen == _MANIFEST_SECRET_VALUES

    async def test_a_context_with_no_register_secret_still_runs_the_prepared_verb(self) -> None:
        context = execute_context({})
        prepare = _RecordingPrepare(values=_MANIFEST_SECRET_VALUES)
        verb = _RecordingVerb(_VERB_ENVELOPE)

        assert "register_secret" not in context
        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert prepare.context is context
        assert verb.thread is not None

    async def test_a_register_secret_that_is_not_callable_is_ignored(self) -> None:
        context = execute_context({}, register_secret="not-a-callable")
        prepare = _RecordingPrepare(values=_MANIFEST_SECRET_VALUES)
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert verb.thread is not None

    async def test_a_hook_that_prepares_no_values_registers_nothing(self) -> None:
        registered, register_secret = _registry()
        prepare = _RecordingPrepare()
        verb = _RecordingVerb(_VERB_ENVELOPE)
        context = execute_context({}, register_secret=register_secret)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert registered == []

    async def test_a_value_error_from_the_hook_reaches_the_caller_and_the_verb_never_runs(
        self,
    ) -> None:
        prepare = _RecordingPrepare(error=ValueError(_READ_ONLY_MESSAGE))
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}) as materialize:
            with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)) as caught:
                await _bridge().run_verb(verb, {}, execute_context({}), prepare=prepare)

        assert type(caught.value) is ValueError
        assert verb.params is None
        assert materialize.call_args_list == []

    async def test_a_file_not_found_error_from_the_hook_reaches_the_caller_unchanged(self) -> None:
        prepare = _RecordingPrepare(error=FileNotFoundError(_TESTDATA_MISSING_MESSAGE))
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}) as materialize:
            with pytest.raises(
                FileNotFoundError, match=_exact(_TESTDATA_MISSING_MESSAGE)
            ) as caught:
                await _bridge().run_verb(verb, {}, execute_context({}), prepare=prepare)

        assert type(caught.value) is FileNotFoundError
        assert verb.params is None
        assert materialize.call_args_list == []

    async def test_a_prepared_verb_that_outlives_its_await_still_writes_no_line(self) -> None:
        logger = MagicMock()
        gate = _Gate()
        registered, register_secret = _registry()
        prepare = _RecordingPrepare(values=[_SECRET_PLAINTEXT])
        context = execute_context({}, register_secret=register_secret, logger=logger)

        task = asyncio.create_task(_bridge().run_verb(gate.verb, {}, context, prepare=prepare))
        await asyncio.to_thread(gate.started.wait, _GATE_WAIT)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        gate.release.set()
        await asyncio.to_thread(gate.finished.wait, _GATE_WAIT)
        await _drain()

        assert registered == [_SECRET_PLAINTEXT]
        assert logger.method_calls == []


class TestRunVerbWithoutALogger:
    """A context with no logger still runs the verb; its lines go nowhere."""

    async def test_a_context_with_no_logger_key_still_runs_the_verb(self) -> None:
        context: dict[str, Any] = {"parameters": {}, "variables": {}}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context)

        assert verb.thread is not None
        assert verb.thread != threading.get_ident()

    async def test_a_context_with_no_logger_key_returns_the_materialized_outputs(self) -> None:
        outputs = {"result": {"kind": "Pod"}, "count": 1}
        context: dict[str, Any] = {"parameters": {}, "variables": {}}
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value=outputs):
            answer = await _bridge().run_verb(verb, {}, context)

        assert answer is outputs

    async def test_a_line_logged_with_no_logger_never_raises_in_the_verb(self) -> None:
        context: dict[str, Any] = {"parameters": {}, "variables": {}}
        verb = _RecordingVerb(_VERB_ENVELOPE, lines=[("INFO", "Connected to Kubernetes v1.33.0")])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context)
        await _drain()

        assert verb.thread is not None

    async def test_a_context_whose_logger_is_none_still_runs_the_verb(self) -> None:
        context: dict[str, Any] = {"parameters": {}, "variables": {}, "logger": None}
        verb = _RecordingVerb(_VERB_ENVELOPE, lines=[("WARN", "Read failed (NotFound)")])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context)
        await _drain()

        assert verb.thread is not None

    async def test_a_prepared_verb_runs_without_a_logger_too(self) -> None:
        context: dict[str, Any] = {"parameters": {}, "variables": {}}
        prepare = _RecordingPrepare(values=[_SECRET_PLAINTEXT])
        verb = _RecordingVerb(_VERB_ENVELOPE)

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, context, prepare=prepare)

        assert prepare.context is context
        assert verb.thread is not None


class _HoldsACancel:
    """A verb that holds an out-of-band cancel on the bridge's running groups, then blocks."""

    def __init__(self, *, release_first: bool = False, error: Exception | None = None) -> None:
        self.release_first = release_first
        self.error = error
        self.started = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()
        self.held = False
        # Per call: the thread it ran on, and whether the verb had already finished.
        self.calls: list[tuple[int, bool]] = []

    def cancel(self) -> None:
        self.calls.append((threading.get_ident(), self.finished.is_set()))
        self.release.set()
        if self.error is not None:
            raise self.error

    def verb(self, params: dict[str, Any], log: Any) -> Any:
        try:
            try:
                held = _process_group.RUNNING.get()
                held.hold_cancel(self.cancel)
                if self.release_first:
                    held.release_cancel(self.cancel)
                self.held = True
            finally:
                self.started.set()
            self.release.wait(_GATE_WAIT)
        finally:
            self.finished.set()
        return _VERB_ENVELOPE


class _HoldsACancelLate:
    """A verb that blocks first and holds its cancel only once released."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()
        self.calls: list[int] = []
        self.called_by_the_time_hold_returned: list[int] = []
        self.thread: int | None = None

    def cancel(self) -> None:
        self.calls.append(threading.get_ident())

    def verb(self, params: dict[str, Any], log: Any) -> Any:
        self.thread = threading.get_ident()
        try:
            try:
                held = _process_group.RUNNING.get()
            finally:
                self.started.set()
            self.release.wait(_GATE_WAIT)
            held.hold_cancel(self.cancel)
            self.called_by_the_time_hold_returned = list(self.calls)
        finally:
            self.finished.set()
        return _VERB_ENVELOPE


async def _cancel_while_started(task: asyncio.Task[Any], started: threading.Event) -> None:
    """Wait (bounded) for the verb to start, cancel its awaiting task, see the cancellation."""
    assert await asyncio.to_thread(started.wait, _GATE_WAIT)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


class TestRunVerbHoldsTheRunningGroups:
    """REQ-3.2.2.4: the bridge hands the verb thread the groups and cancels a stop ends."""

    async def test_the_verb_thread_sees_the_bridge_running_groups(self) -> None:
        seen: list[Any] = []

        def verb(params: dict[str, Any], log: Any) -> Any:
            seen.append(_process_group.RUNNING.get(None))
            return _VERB_ENVELOPE

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}))

        assert len(seen) == 1
        assert isinstance(seen[0], _process_group.HeldGroups)

    async def test_the_running_groups_are_unset_again_once_the_verb_returns(self) -> None:
        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(_RecordingVerb(_VERB_ENVELOPE), {}, execute_context({}))

        assert _process_group.RUNNING.get(None) is None

    def test_helm_keeps_no_running_groups_of_its_own(self) -> None:
        from wavecore.connectivity.helm import _cli as helm_cli

        assert not hasattr(helm_cli, "RUNNING")


class TestRunVerbCancelsOutOfBand:
    """A canceled await calls the verb's held cancel at once, while the verb thread still blocks."""

    async def test_a_held_cancel_runs_once_on_the_loop_thread_while_the_verb_blocks(
        self,
    ) -> None:
        holder = _HoldsACancel()
        task = asyncio.create_task(_bridge().run_verb(holder.verb, {}, execute_context({})))

        await _cancel_while_started(task, holder.started)

        assert holder.calls == [(threading.get_ident(), False)]
        assert await asyncio.to_thread(holder.finished.wait, _GATE_WAIT)
        assert len(holder.calls) == 1

    async def test_a_cancel_held_after_the_stop_runs_as_it_is_held(self) -> None:
        holder = _HoldsACancelLate()
        task = asyncio.create_task(_bridge().run_verb(holder.verb, {}, execute_context({})))

        await _cancel_while_started(task, holder.started)
        holder.release.set()

        assert await asyncio.to_thread(holder.finished.wait, _GATE_WAIT)
        assert holder.called_by_the_time_hold_returned == [holder.thread]
        assert holder.calls == [holder.thread]
        assert holder.thread != threading.get_ident()

    async def test_a_released_cancel_never_runs(self) -> None:
        holder = _HoldsACancel(release_first=True)
        task = asyncio.create_task(_bridge().run_verb(holder.verb, {}, execute_context({})))

        await _cancel_while_started(task, holder.started)
        holder.release.set()

        assert await asyncio.to_thread(holder.finished.wait, _GATE_WAIT)
        assert holder.held is True
        assert holder.calls == []

    async def test_a_raising_cancel_still_lets_the_cancellation_through(self) -> None:
        holder = _HoldsACancel(error=OSError("cancel refused"))
        task = asyncio.create_task(_bridge().run_verb(holder.verb, {}, execute_context({})))

        await _cancel_while_started(task, holder.started)

        assert holder.calls == [(threading.get_ident(), False)]
        assert await asyncio.to_thread(holder.finished.wait, _GATE_WAIT)

    async def test_a_verb_that_ends_normally_never_calls_its_held_cancel(self) -> None:
        holder = _HoldsACancel()
        holder.release.set()

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(holder.verb, {}, execute_context({}))

        assert holder.calls == []


_TRUST_LINE = "Trusting WAVE's built-in certificate list (June 2026)"
_PROXY_LINE = "Using the proxy http://proxy.internal:3128"


def _run_log() -> Any:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    from wavecore.connectivity import run_log

    return run_log


class _LogsOnce:
    """A verb that writes lines through the run's once-per-run sink, between its own log lines."""

    def __init__(self, steps: list[tuple[str, str, str]]) -> None:
        # Each step: ("once" | "log", level, message).
        self.steps = steps
        self.seen: Any = None

    def __call__(self, params: dict[str, Any], log: Any) -> Any:
        self.seen = _run_log().RUN_LOG.get()
        for how, level, message in self.steps:
            if how == "once":
                _run_log().log_once(level, message)
            else:
                log(level, message)
        return _VERB_ENVELOPE


class TestRunVerbHoldsTheRunLog:
    """REQ-4.5.16: the bridge sets the run's log sink beside its running groups."""

    async def test_the_verb_thread_sees_a_run_log(self) -> None:
        verb = _LogsOnce([])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}))

        assert isinstance(verb.seen, _run_log().RunLog)

    async def test_the_run_log_is_set_beside_the_running_groups(self) -> None:
        seen: list[tuple[Any, Any]] = []

        def verb(params: dict[str, Any], log: Any) -> Any:
            seen.append((_process_group.RUNNING.get(None), _run_log().RUN_LOG.get()))
            return _VERB_ENVELOPE

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}))

        assert len(seen) == 1
        assert isinstance(seen[0][0], _process_group.HeldGroups)
        assert isinstance(seen[0][1], _run_log().RunLog)

    async def test_the_run_log_is_unset_again_once_the_verb_returns(self) -> None:
        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(_LogsOnce([]), {}, execute_context({}))

        assert _run_log().RUN_LOG.get() is None

    async def test_the_run_log_is_unset_again_when_the_verb_raises(self) -> None:
        message = "K8s Pod 'web-1' not found in namespace 'apps'"
        verb = _RecordingVerb(error=ValueError(message))

        with pytest.raises(ValueError, match=_exact(message)):
            await _bridge().run_verb(verb, {}, execute_context({}))

        assert _run_log().RUN_LOG.get() is None

    async def test_each_run_holds_a_run_log_of_its_own(self) -> None:
        first = _LogsOnce([])
        second = _LogsOnce([])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(first, {}, execute_context({}))
            await _bridge().run_verb(second, {}, execute_context({}))

        assert first.seen is not None and second.seen is not None
        assert first.seen is not second.seen


class TestRunVerbLogsOncePerRun:
    """A line written through log_once reaches the block logger once per run, on the loop thread."""

    async def test_a_line_logged_twice_in_one_run_reaches_the_block_logger_once(self) -> None:
        logger = MagicMock()
        verb = _LogsOnce([("once", "INFO", _TRUST_LINE), ("once", "INFO", _TRUST_LINE)])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
        await _drain()

        assert logger.method_calls == [call.info(_TRUST_LINE)]

    async def test_the_line_keeps_its_level(self) -> None:
        logger = MagicMock()
        verb = _LogsOnce([("once", "WARN", _PROXY_LINE)])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
        await _drain()

        assert logger.method_calls == [call.warn(_PROXY_LINE)]

    async def test_different_lines_are_each_logged_once(self) -> None:
        logger = MagicMock()
        verb = _LogsOnce(
            [
                ("once", "INFO", _TRUST_LINE),
                ("once", "INFO", _PROXY_LINE),
                ("once", "INFO", _TRUST_LINE),
            ]
        )

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
        await _drain()

        assert logger.method_calls == [call.info(_TRUST_LINE), call.info(_PROXY_LINE)]

    async def test_a_once_line_keeps_its_place_among_the_verbs_own_lines(self) -> None:
        connected = "Connected to Kubernetes v1.33.0 at https://kwok:6443"
        read = "Read 2 Pod object(s) from /api/v1/namespaces/apps/pods"
        logger = _ThreadAwareLogger()
        verb = _LogsOnce(
            [
                ("once", "INFO", _TRUST_LINE),
                ("log", "INFO", connected),
                ("once", "INFO", _TRUST_LINE),
                ("log", "INFO", read),
            ]
        )

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))

        assert [message for _, message, _, _ in logger.lines] == [_TRUST_LINE, connected, read]

    async def test_the_line_is_written_on_the_event_loop_thread(self) -> None:
        logger = _ThreadAwareLogger()
        verb = _LogsOnce([("once", "INFO", _TRUST_LINE)])

        with patch(_MATERIALIZE, return_value={}):
            await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))

        assert logger.lines == [("info", _TRUST_LINE, threading.get_ident(), True)]

    async def test_two_runs_each_log_the_line(self) -> None:
        logger = MagicMock()

        with patch(_MATERIALIZE, return_value={}):
            for _ in range(2):
                verb = _LogsOnce([("once", "INFO", _TRUST_LINE), ("once", "INFO", _TRUST_LINE)])
                await _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
        await _drain()

        assert logger.method_calls == [call.info(_TRUST_LINE), call.info(_TRUST_LINE)]

    async def test_runs_side_by_side_keep_their_own_lines(self) -> None:
        loggers = [MagicMock(), MagicMock()]
        verbs = [
            _LogsOnce([("once", "INFO", _TRUST_LINE), ("once", "INFO", _TRUST_LINE)])
            for _ in loggers
        ]

        with patch(_MATERIALIZE, return_value={}):
            await asyncio.gather(
                *(
                    _bridge().run_verb(verb, {}, execute_context({}, logger=logger))
                    for verb, logger in zip(verbs, loggers, strict=True)
                )
            )
        await _drain()

        assert [logger.method_calls for logger in loggers] == [
            [call.info(_TRUST_LINE)],
            [call.info(_TRUST_LINE)],
        ]

    async def test_a_once_line_with_no_logger_never_raises_in_the_verb(self) -> None:
        context: dict[str, Any] = {"parameters": {}, "variables": {}}
        verb = _LogsOnce([("once", "INFO", _TRUST_LINE)])

        with patch(_MATERIALIZE, return_value={}):
            answer = await _bridge().run_verb(verb, {}, context)
        await _drain()

        assert answer == {}

    async def test_a_once_line_after_the_await_is_gone_is_never_written(self) -> None:
        logger = MagicMock()
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        escaped: list[Exception] = []

        def verb(params: dict[str, Any], log: Any) -> Any:
            started.set()
            release.wait(_GATE_WAIT)
            try:
                _run_log().log_once("INFO", _TRUST_LINE)
            except Exception as error:
                escaped.append(error)
            finished.set()
            return _VERB_ENVELOPE

        task = asyncio.create_task(_bridge().run_verb(verb, {}, execute_context({}, logger=logger)))
        await _cancel_while_started(task, started)
        release.set()
        assert await asyncio.to_thread(finished.wait, _GATE_WAIT)
        await _drain()

        assert escaped == []
        assert logger.method_calls == []
