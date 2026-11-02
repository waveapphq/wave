"""WAVE-side schemes in a Remote Execution body (REQ-3.4.1.3, REQ-3.4.1.9, REQ-3.4.1.10)."""

import asyncio
import base64
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.core.remote_exec.test_bundle import _run_bundle
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.remote_exec import execute_remote_container
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.core.table import Table

HOST = "prod-host"
HOST_SESSION = "host-sess-1"
PAYLOAD = b"\x00\xffhi"
MISSING_PAYLOAD = "testdata://missing.bin"
NOT_FOUND = f"Payload file not found: {MISSING_PAYLOAD}"


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _refusal(scheme: str) -> str:
    return (
        f"Remote Execution failed on host '{HOST}': {scheme} paths are not available on the "
        "remote host - use an absolute or relative path on the remote host"
    )


@pytest.fixture(autouse=True)
def _registered_plugins() -> Iterator[None]:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.file_io import FileIOPlugin
    from wavecore.plugins.netcat import NetcatPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(FileIOPlugin())
    register_plugin(NetcatPlugin())
    yield
    clear_registry()
    wb_common._workbench_sessions.clear()
    log_streaming_service._session_logs.clear()
    log_streaming_service._session_registries.clear()


def _session(testdata: Path | None = None, artifacts: Path | None = None) -> dict[str, Any]:
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
    }
    if testdata is not None:
        session["testdata_dirs"] = [str(testdata)]
    if artifacts is not None:
        session["artifacts_dir"] = str(artifacts)
    wb_common._workbench_sessions[session_id] = session
    log_streaming_service.register_secret_registry(session_id, session["secret_registry"])
    return session


def _node(
    node_id: str,
    element_type: str,
    values: dict[str, Any],
    expressions: list[str],
    bindings: dict[str, str] | None = None,
) -> Any:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": "control" if element_type == "remote-execution" else "plugin",
            "version": "1.0.0",
            "config": {
                "values": values,
                "outputBindings": bindings or {},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": node_id,
            "expressionFields": expressions,
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


async def _bundle_worker(
    worker: Any,
    plugin_id: str,
    params: dict[str, Any],
    variables: dict[str, Any],
    trust: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "id": "r1",
        "plugin_id": plugin_id,
        "params": params,
        "variables": variables,
    }
    if trust is not None:
        request["trust"] = trust
    return await asyncio.to_thread(_run_bundle, request, isolated=True)


async def _run_body(
    values: dict[str, Any],
    expressions: list[str],
    variables: dict[str, Any],
    *,
    element_type: str = "file-io",
    bindings: dict[str, str] | None = None,
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session = session or _session()
    node_map = {
        "rex-1": _node("rex-1", "remote-execution", {"session_id": HOST_SESSION}, []),
        "body-1": _node("body-1", element_type, values, expressions, bindings),
    }
    adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
    worker = MagicMock()
    worker.host = HOST
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
        patch.object(_remote_exec, "run_on_worker", _bundle_worker),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        await execute_remote_container(
            "rex-1", adj, node_map, variables, session, session["session_id"], set(), [], None
        )
    return variables


_SCHEMES = ["testdata://", "artifact://"]
_OPERATIONS = [
    pytest.param({"operation": "read"}, id="read"),
    pytest.param({"operation": "write", "content": "x"}, id="write"),
]


class TestTheRemoteHostRefusesWaveSideSchemes:
    """Literal or read from a variable, the reference fails the body and leaves the host alone."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("scheme", _SCHEMES)
    @pytest.mark.parametrize("operation", _OPERATIONS)
    async def test_a_literal_reference_is_refused(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        scheme: str,
        operation: dict[str, Any],
    ) -> None:
        monkeypatch.chdir(tmp_path)
        values = {**operation, "path": f"{scheme}orders.csv"}

        with pytest.raises(RuntimeError, match=f"^{re.escape(_refusal(scheme))}$"):
            await _run_body(values, [], {})

        assert list(tmp_path.iterdir()) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("scheme", _SCHEMES)
    @pytest.mark.parametrize("operation", _OPERATIONS)
    async def test_a_reference_read_from_a_variable_is_refused(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        scheme: str,
        operation: dict[str, Any],
    ) -> None:
        monkeypatch.chdir(tmp_path)
        values = {**operation, "path": "orders_path"}

        with pytest.raises(RuntimeError, match=f"^{re.escape(_refusal(scheme))}$"):
            await _run_body(values, ["path"], {"orders_path": f"{scheme}reports/orders.csv"})

        assert list(tmp_path.iterdir()) == []

    @pytest.mark.asyncio
    async def test_a_relative_path_is_written_where_the_worker_starts(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        values = {"operation": "write", "path": "reports/../orders.csv", "content": "a,b\n"}
        (tmp_path / "reports").mkdir()

        await _run_body(values, [], {})

        assert (tmp_path / "orders.csv").read_text(encoding="utf-8") == "a,b\n"

    @pytest.mark.asyncio
    async def test_a_parent_segment_through_a_missing_folder_is_normalized_as_on_wave(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        values = {"operation": "write", "path": "made/../orders.csv", "content": "a,b\n"}

        await _run_body(values, [], {})

        assert (tmp_path / "orders.csv").read_text(encoding="utf-8") == "a,b\n"
        assert sorted(entry.name for entry in tmp_path.iterdir()) == ["orders.csv"]


def _talk_file(file: str, **overrides: Any) -> dict[str, Any]:
    """A Single TCP Talk that sends the payload file `file` (NETCAT-10)."""
    base = {"host": "127.0.0.1", "ports": "single", "port": 7, "protocol": "tcp"}
    return {**base, "mode": "talk", "send": "file", "file": file, "timeout": 1, **overrides}


def _folder_with_payload(root: Path, name: str) -> Path:
    folder = root / name
    folder.mkdir()
    (folder / "payload.bin").write_bytes(PAYLOAD)
    return folder


def _console(session_id: str) -> list[tuple[str, str]]:
    """The session's run console lines so far as (level, message)."""
    return [
        (str(entry["level"]), str(entry["message"]))
        for entry in log_streaming_service.get_logs(session_id)
    ]


class TestTheNetcatRequestShipsAWaveSidePayload:
    """A testdata:// or artifact:// payload is read on WAVE and shipped base64 (NETCAT-10)."""

    @pytest.mark.parametrize(
        ("scheme", "folder_key"), [("testdata://", "testdata"), ("artifact://", "artifacts")]
    )
    def test_a_scheme_payload_is_read_on_wave_and_shipped_base64(
        self, tmp_path: Path, scheme: str, folder_key: str
    ) -> None:
        session = _session(**{folder_key: _folder_with_payload(tmp_path, folder_key)})
        params = _talk_file(f"{scheme}payload.bin")
        before = dict(params)

        result = _remote_exec._netcat_request(params, session["session_id"])

        assert base64.b64decode(result["payload_base64"]) == PAYLOAD
        assert result["file"] == f"{scheme}payload.bin"
        assert "payload_error" not in result
        assert params == before

    def test_a_plain_path_is_left_for_the_remote_host(self, tmp_path: Path) -> None:
        session = _session(testdata=_folder_with_payload(tmp_path, "testdata"))
        params = _talk_file("/nowhere/payload.bin")

        result = _remote_exec._netcat_request(params, session["session_id"])

        assert result == params

    def test_a_padded_scheme_path_is_read_trimmed_and_kept_as_written(self, tmp_path: Path) -> None:
        session = _session(testdata=_folder_with_payload(tmp_path, "testdata"))
        params = _talk_file("  testdata://payload.bin ")

        result = _remote_exec._netcat_request(params, session["session_id"])

        assert base64.b64decode(result["payload_base64"]) == PAYLOAD
        assert result["file"] == "  testdata://payload.bin "
        assert "payload_error" not in result

    @pytest.mark.parametrize(
        "settings",
        [
            pytest.param({"mode": "check"}, id="check"),
            pytest.param({"send": "text", "text": "hello"}, id="talk-text"),
            pytest.param({"send": "nothing"}, id="talk-nothing"),
        ],
    )
    def test_a_scheme_file_the_settings_hide_passes_through_unchanged(
        self, tmp_path: Path, settings: dict[str, Any]
    ) -> None:
        session = _session(testdata=_folder_with_payload(tmp_path, "testdata"))
        params = _talk_file("testdata://payload.bin", **settings)

        result = _remote_exec._netcat_request(params, session["session_id"])

        assert result == params


class TestTheNetcatRequestShipsAPayloadFailure:
    """A WAVE-side payload that cannot be read travels as the failure message (NETCAT-19)."""

    @pytest.mark.parametrize(
        ("file", "configured"),
        [
            pytest.param(MISSING_PAYLOAD, True, id="testdata-missing"),
            pytest.param("artifact://missing.bin", True, id="artifact-missing"),
            pytest.param("testdata://payload.bin", False, id="no-testdata-folder"),
        ],
    )
    def test_a_missing_target_ships_the_not_found_message(
        self, tmp_path: Path, file: str, configured: bool
    ) -> None:
        folders = {"testdata": tmp_path / "testdata", "artifacts": tmp_path / "artifacts"}
        for folder in folders.values():
            folder.mkdir()
        session = _session(**folders) if configured else _session()

        result = _remote_exec._netcat_request(_talk_file(file), session["session_id"])

        assert result["payload_error"] == f"Payload file not found: {file}"
        assert "payload_base64" not in result

    def test_an_unreadable_file_ships_the_error_text(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = _session(testdata=_folder_with_payload(tmp_path, "testdata"))

        def unreadable(self: Path) -> bytes:
            raise PermissionError(13, "Permission denied")

        monkeypatch.setattr(Path, "read_bytes", unreadable)

        result = _remote_exec._netcat_request(
            _talk_file("testdata://payload.bin"), session["session_id"]
        )

        assert result["payload_error"] == "Could not read the payload file: Permission denied"
        assert "payload_base64" not in result


class TestAWaveSidePayloadFailureFollowsOnError:
    """Through the real bundle, the shipped failure fails or records the block (NETCAT-19)."""

    async def test_fail_the_block_names_the_remote_host_and_the_file(self, tmp_path: Path) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        message = f"Remote Execution failed on host '{HOST}': {NOT_FOUND}"

        with pytest.raises(RuntimeError, match=exact(message)):
            await _run_body(
                _talk_file(MISSING_PAYLOAD),
                [],
                {},
                element_type="netcat",
                session=_session(testdata),
            )

    async def test_record_and_continue_records_start_failed_with_empty_results(
        self, tmp_path: Path
    ) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        session = _session(testdata)
        bindings = {
            "success": "ok",
            "error": "err",
            "reason": "why",
            "results": "rows",
            "reply": "answer",
        }

        variables = await _run_body(
            _talk_file(MISSING_PAYLOAD, on_error="record"),
            [],
            {},
            element_type="netcat",
            bindings=bindings,
            session=session,
        )

        assert variables["ok"] is False
        assert variables["err"] == NOT_FOUND
        assert variables["why"] == "StartFailed"
        assert isinstance(variables["rows"], Table)
        assert variables["rows"].row_count() == 0
        assert variables["answer"] == ""
        start = ("INFO", "Talking to 127.0.0.1 port 7 over TCP")
        warning = ("WARN", f"Netcat failed (StartFailed): {NOT_FOUND}")
        console = _console(session["session_id"])
        assert [line for line in console if line in (start, warning)] == [start, warning]
