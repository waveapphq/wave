"""Tests for Remote Execution container body execution (REQ-3.4.1.3).

A Remote Execution container runs its body sub-flow over a mandatory Session ID =
an already-open SSH session. On execute it resolves that session's live
connection, opens a persistent remote worker (interpreter validated at runtime),
routes each body block by its remotability (remotable -> the host worker, else
locally on WAVE), binds the container's single output (Remote Session ID), then
tears the worker down.

execute_remote_container mirrors the For Loop body executor
(_execute_for_loop_body): it receives the container node id, the graph adjacency,
the node map, the run variables, the session, and the exec queue, and drives the
body chain reached over the cyan `body` handle before queuing the `then` egress.

The container is exercised directly here with hand-built session / adj / node_map
fixtures (as the For Loop helper tests do), against a fake SSH connection and
patched runner functions - no real sshd / python3. The runner functions
(open_worker / run_on_worker / close_worker) are patched on the remote_exec
module, so the container must import them by name.

Exact error-message contracts asserted here:
- Missing Session ID: "Missing required parameter: session_id"
- Unknown / closed session: "SSH session '{id}' not found or already closed"
- No compatible interpreter: "Remote Execution: no compatible Python interpreter on the host"
- Worker / remote body failure: "Remote Execution failed on host '{host}': {detail}"

A non-remotable body block is NOT rejected: it runs locally on WAVE.
"""

import asyncio
import base64
import json
import os
import re
import uuid
from contextlib import ExitStack
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.core.remote_exec.test_bundle import _run_bundle
from tests.plugins.k8s._k8s_fixtures import exact
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import plugins as _wb_plugins
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench import signals as _wb_signals
from wavecore.api.services.workbench.remote_exec import execute_remote_container
from wavecore.core.remote_exec import worker_registry as _worker_registry
from wavecore.core.remote_exec.worker_registry import RemoteWorkerRegistry
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.core.table import Table
from wavecore.core.variables.declared_types import declared_type_scope


def _make_remote_node(
    node_id: str,
    session_id: str | None = None,
    remote_session_var: str = "rsid",
) -> dict[str, Any]:
    """Build a Remote Execution container node."""
    values: dict[str, Any] = {}
    if session_id is not None:
        values["session_id"] = session_id
    config: dict[str, Any] = {
        "values": values,
        "outputBindings": {"remote_session_id": remote_session_var},
        "profileBindings": [],
    }
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Remote Execution",
            "elementType": "remote-execution",
            "nodeType": "control",
            "version": "1.0.0",
            "config": config,
            "disabled": False,
            "displayName": "Remote Execution",
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_plugin_node(
    node_id: str,
    element_type: str,
    config_values: dict[str, Any],
    label: str = "Body",
    output_secret_fields: list[str] | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a plugin body node (e.g. HTTP Client, Shell Script)."""
    config: dict[str, Any] = {"values": config_values, "profileBindings": []}
    if output_secret_fields is not None:
        config["outputSecretFields"] = output_secret_fields
    if output_bindings is not None:
        config["outputBindings"] = output_bindings
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": config,
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_session(ssh_registry: SSHSessionRegistry) -> dict[str, Any]:
    """A minimal workbench session carrying the run's SSH session registry."""
    return {
        "session_id": "rex-run-1",
        "status": "running",
        "block_states": {},
        "skipped_node_ids": [],
        "ssh_session_registry": ssh_registry,
    }


def _ssh_registry_with(session_id: str, host: str = "prod-host") -> tuple[SSHSessionRegistry, Any]:
    """An SSH registry holding one open session over a fake connection."""
    registry = SSHSessionRegistry()
    conn = MagicMock()
    registry.register(session_id, conn, None, host, None, None, connect_timeout=30)
    return registry, conn


HTTP_BODY_CONFIG = {"method": "GET", "url": "http://target.local/health"}
K8S_GET_CONFIG = {
    "session": "k8s-session-value",
    "kind": "ConfigMap",
    "name": "cm-1",
    "namespace": "default",
}
K8S_CONNECT_CONFIG = {"api_url": "https://k8s.local"}
K8S_CONNECT_BAD_TIMEOUT = {"api_url": "https://k8s.local", "timeout": 0}

K8S_SESSION_VALUE = "k8s-session-value"
APPLY_SECRET_PLAINTEXT = "planted-apply-secret-value"
APPLY_SECRET_BASE64 = base64.b64encode(APPLY_SECRET_PLAINTEXT.encode("utf-8")).decode("ascii")
APPLY_SECRET_MANIFEST = json.dumps(
    {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "app-secret", "namespace": "default"},
        "stringData": {"token": APPLY_SECRET_PLAINTEXT},
    }
)

# One valid config per Kubernetes-family element type a Remote Execution body may carry,
# the six Helm blocks included: they drive the execution host's own helm.
K8S_BODY_CONFIGS: dict[str, dict[str, Any]] = {
    "k8s-connect": dict(K8S_CONNECT_CONFIG),
    "k8s-get": dict(K8S_GET_CONFIG),
    "k8s-events": {"session": K8S_SESSION_VALUE},
    "k8s-logs": {"session": K8S_SESSION_VALUE, "pod": "pod-a", "container": "app"},
    "k8s-top": {"session": K8S_SESSION_VALUE},
    "k8s-apply": {"session": K8S_SESSION_VALUE, "manifest": APPLY_SECRET_MANIFEST},
    "k8s-delete": {"session": K8S_SESSION_VALUE, "kind": "Pod", "name": "pod-a"},
    "k8s-scale": {
        "session": K8S_SESSION_VALUE,
        "kind": "Deployment",
        "name": "dep-a",
        "replicas": 2,
    },
    "k8s-rollout": {"session": K8S_SESSION_VALUE, "kind": "Deployment", "name": "dep-a"},
    "k8s-exec": {
        "session": K8S_SESSION_VALUE,
        "pod": "pod-a",
        "container": "app",
        "command": "echo hi",
    },
    "k8s-script": {
        "session": K8S_SESSION_VALUE,
        "pod": "pod-a",
        "container": "app",
        "script": "echo hi",
    },
    "k8s-copy": {
        "session": K8S_SESSION_VALUE,
        "pod": "pod-a",
        "container": "app",
        "source_path": "/var/data/report.csv",
        "target_path": "/srv/work/report.csv",
    },
    "helm-install": {
        "session": K8S_SESSION_VALUE,
        "release": "web",
        "chart": "wave-demo",
    },
    "helm-upgrade": {
        "session": K8S_SESSION_VALUE,
        "release": "web",
        "chart": "wave-demo",
    },
    "helm-rollback": {"session": K8S_SESSION_VALUE, "release": "web"},
    "helm-uninstall": {"session": K8S_SESSION_VALUE, "release": "web"},
    "helm-test": {"session": K8S_SESSION_VALUE, "release": "web"},
    "helm-status": {"session": K8S_SESSION_VALUE, "release": "web"},
}


def _prime_masking_session(ssh_registry: SSHSessionRegistry) -> tuple[dict[str, Any], str]:
    """A workbench session wired for log masking over an already-open SSH session."""
    session_id = str(uuid.uuid4())
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
        "variables": {},
        "secret_variable_names": [],
        "secret_registry": SecretRegistry(),
        "ssh_session_registry": ssh_registry,
    }
    wb_common._workbench_sessions[session_id] = session
    log_streaming_service.register_secret_registry(session_id, session["secret_registry"])
    return session, session_id


@pytest.fixture(autouse=True)
def _registered_plugins() -> Any:
    """Register the plugins the container looks up for remotability checks."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.helm_install import HelmInstallPlugin
    from wavecore.plugins.helm_rollback import HelmRollbackPlugin
    from wavecore.plugins.helm_status import HelmStatusPlugin
    from wavecore.plugins.helm_test import HelmTestPlugin
    from wavecore.plugins.helm_uninstall import HelmUninstallPlugin
    from wavecore.plugins.helm_upgrade import HelmUpgradePlugin
    from wavecore.plugins.http_client import HTTPClientPlugin
    from wavecore.plugins.k8s_apply import K8sApplyPlugin
    from wavecore.plugins.k8s_connect import K8sConnectPlugin
    from wavecore.plugins.k8s_copy import K8sCopyPlugin
    from wavecore.plugins.k8s_delete import K8sDeletePlugin
    from wavecore.plugins.k8s_events import K8sEventsPlugin
    from wavecore.plugins.k8s_exec import K8sExecPlugin
    from wavecore.plugins.k8s_get import K8sGetPlugin
    from wavecore.plugins.k8s_logs import K8sLogsPlugin
    from wavecore.plugins.k8s_rollout import K8sRolloutPlugin
    from wavecore.plugins.k8s_scale import K8sScalePlugin
    from wavecore.plugins.k8s_script import K8sScriptPlugin
    from wavecore.plugins.k8s_top import K8sTopPlugin
    from wavecore.plugins.log import LogPlugin
    from wavecore.plugins.shell_exec import ShellExecPlugin
    from wavecore.plugins.shell_script import ShellScriptPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(HTTPClientPlugin())
    register_plugin(ShellScriptPlugin())
    register_plugin(ShellExecPlugin())
    register_plugin(LogPlugin())
    register_plugin(K8sConnectPlugin())
    register_plugin(K8sEventsPlugin())
    register_plugin(K8sGetPlugin())
    register_plugin(K8sLogsPlugin())
    register_plugin(K8sTopPlugin())
    register_plugin(K8sApplyPlugin())
    register_plugin(K8sDeletePlugin())
    register_plugin(K8sScalePlugin())
    register_plugin(K8sRolloutPlugin())
    register_plugin(K8sExecPlugin())
    register_plugin(K8sScriptPlugin())
    register_plugin(K8sCopyPlugin())
    register_plugin(HelmInstallPlugin())
    register_plugin(HelmUpgradePlugin())
    register_plugin(HelmRollbackPlugin())
    register_plugin(HelmUninstallPlugin())
    register_plugin(HelmTestPlugin())
    register_plugin(HelmStatusPlugin())
    yield
    clear_registry()


def _passing_run_result() -> dict[str, Any]:
    return {
        "return_value": {"status_code": 200, "body": "ok"},
        "logs": [{"level": "INFO", "message": "HTTP 200"}],
        "status": "passed",
        "error": None,
    }


async def _run_container(
    node_id: str,
    node_map: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    session: dict[str, Any],
    *,
    variables: dict[str, Any] | None = None,
    exec_queue: list[str] | None = None,
) -> Any:
    return await execute_remote_container(
        node_id,
        adj,
        node_map,
        variables if variables is not None else {},
        session,
        session["session_id"],
        set(),
        exec_queue if exec_queue is not None else [],
        None,
    )


@dataclass
class _BodyRun:
    session: dict[str, Any]
    session_id: str
    variables: dict[str, Any]
    error: Exception | None


async def _run_body_block(
    node: dict[str, Any],
    result: dict[str, Any],
    *,
    secret_registry: SecretRegistry | None = None,
) -> _BodyRun:
    """Run a Remote Execution whose body holds ``node`` alone; the worker answers ``result``."""
    registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
    session, session_id = _prime_masking_session(registry)
    if secret_registry is not None:
        session["secret_registry"] = secret_registry
        log_streaming_service.register_secret_registry(session_id, secret_registry)
    node_map = {"rex-1": _make_remote_node("rex-1", session_id="host-sess-1"), node["id"]: node}
    adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [(node["id"], "body")]}
    variables: dict[str, Any] = {}
    worker = MagicMock()
    worker.host = "prod-host"
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
        patch.object(_remote_exec, "run_on_worker", AsyncMock(return_value=result)),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        try:
            await _run_container("rex-1", node_map, adj, session, variables=variables)
        except RuntimeError as exc:
            return _BodyRun(session, session_id, variables, exc)
    return _BodyRun(session, session_id, variables, None)


class TestExecutionHostResolution:
    """The mandatory Execution Host = an already-open SSH session."""

    @pytest.mark.asyncio
    async def test_missing_execution_host_raises_exact_message(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {"rex-1": _make_remote_node("rex-1")}

        with pytest.raises(ValueError, match="^Missing required parameter: session_id$"):
            await _run_container("rex-1", node_map, {"rex-1": []}, session)

    @pytest.mark.asyncio
    async def test_empty_execution_host_raises_exact_message(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {"rex-1": _make_remote_node("rex-1", session_id="")}

        with pytest.raises(ValueError, match="^Missing required parameter: session_id$"):
            await _run_container("rex-1", node_map, {"rex-1": []}, session)

    @pytest.mark.asyncio
    async def test_unknown_session_raises_exact_message(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {"rex-1": _make_remote_node("rex-1", session_id="ghost")}

        with pytest.raises(
            ValueError,
            match="^SSH session 'ghost' not found or already closed$",
        ):
            await _run_container("rex-1", node_map, {"rex-1": []}, session)


class TestBodyLocusRouting:
    """The body allows any block: remotable -> the host worker, else local on WAVE."""

    @pytest.mark.asyncio
    async def test_non_remotable_body_block_runs_locally(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "shell-script", {"script": "echo hi"}),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        local_exec = AsyncMock(return_value={})
        run_on_worker = AsyncMock()
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        # Shell Script is not remotable: it runs locally on WAVE, never on the worker.
        local_exec.assert_awaited_once()
        assert local_exec.await_args.kwargs["block_id"] == "body-1"
        run_on_worker.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_shell_exec_body_block_runs_locally(self) -> None:
        """Shell Exec starts its process on the WAVE server, so a body never
        hands it to the host (SHRUN-17)."""
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "shell-exec", {"command": "echo hi"}),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        local_exec = AsyncMock(return_value={})
        run_on_worker = AsyncMock()
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        local_exec.assert_awaited_once()
        assert local_exec.await_args.kwargs["block_id"] == "body-1"
        run_on_worker.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_remotable_and_local_blocks_route_separately(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
            "log-1": _make_plugin_node("log-1", "log", {"message": "'hi'"}, label="Log"),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {
            "rex-1": [("http-1", "body")],
            "http-1": [("log-1", None)],
        }

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        local_exec = AsyncMock(return_value={})
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        # http-client (remotable) rides the worker; log (not remotable) runs locally.
        assert run_on_worker.await_args.args[1] == "http-client"
        assert local_exec.await_args.kwargs["block_id"] == "log-1"

    @pytest.mark.asyncio
    async def test_a_kubernetes_body_block_rides_the_worker(self) -> None:
        """A Kubernetes read block is remotable: it must reach the cluster from
        the host, not from WAVE, or the whole point of the container is lost."""
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "k8s-get", dict(K8S_GET_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        local_exec = AsyncMock(return_value={})
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        assert run_on_worker.await_args.args[1] == "k8s-get"
        local_exec.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_local_body_block_failure_propagates(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "shell-script", {"script": "boom"}),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        local_exec = AsyncMock(side_effect=RuntimeError("script failed"))
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(RuntimeError, match="^script failed$"):
                await _run_container("rex-1", node_map, adj, session)


class TestInterpreterValidation:
    """The host must have a compatible Python interpreter (runtime check)."""

    @pytest.mark.asyncio
    async def test_incompatible_interpreter_surfaces_exact_message(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        open_worker = AsyncMock(
            side_effect=RuntimeError(
                "Remote Execution: no compatible Python interpreter on the host"
            )
        )
        with patch.object(_remote_exec, "open_worker", open_worker):
            with pytest.raises(
                RuntimeError,
                match="^Remote Execution: no compatible Python interpreter on the host$",
            ):
                await _run_container("rex-1", node_map, adj, session)

    @pytest.mark.asyncio
    async def test_below_floor_interpreter_surfaces_exact_message(self) -> None:
        """The version refusal is raised before any body block runs, so it
        reaches the user as itself - no host prefix wrapped around it."""
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
        message = (
            "Remote interpreter 'python3' is Python 3.9; "
            "Remote Execution needs Python 3.10 or newer"
        )

        with patch.object(
            _remote_exec, "open_worker", AsyncMock(side_effect=RuntimeError(message))
        ):
            with pytest.raises(RuntimeError, match=f"^{re.escape(message)}$"):
                await _run_container("rex-1", node_map, adj, session)


class TestRemoteValidationParity:
    """A remote block's parameters are checked on WAVE before they cross.
    A block that could never succeed fails with its own plugin's wording, and
    nothing is pushed to the host."""

    _TIMEOUT_MESSAGE = "Parameter 'timeout' must be positive"

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    @pytest.mark.asyncio
    async def test_the_plugin_message_surfaces_with_the_host_prefix(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_BAD_TIMEOUT)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        expected = f"Remote Execution failed on host 'prod-host': {self._TIMEOUT_MESSAGE}"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(RuntimeError, match=f"^{re.escape(expected)}$"):
                await _run_container("rex-1", node_map, adj, session)

    @pytest.mark.asyncio
    async def test_a_rejected_block_never_reaches_the_worker(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_BAD_TIMEOUT)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        close_worker = AsyncMock()
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", close_worker),
        ):
            with pytest.raises(RuntimeError):
                await _run_container("rex-1", node_map, adj, session)

        run_on_worker.assert_not_awaited()
        close_worker.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_rejected_block_writes_no_inputs_line(self) -> None:
        """A block that never left WAVE should not have echoed its inputs."""
        node = _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_BAD_TIMEOUT))

        run = await _run_body_block(node, _passing_run_result())

        expected = f"Remote Execution failed on host 'prod-host': {self._TIMEOUT_MESSAGE}"
        assert str(run.error) == expected
        messages = [entry["message"] for entry in log_streaming_service.get_logs(run.session_id)]
        assert not any(message.startswith("Inputs: ") for message in messages)

    @pytest.mark.asyncio
    async def test_a_rejected_block_is_painted_failed(self) -> None:
        node = _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_BAD_TIMEOUT))

        run = await _run_body_block(node, _passing_run_result())

        assert run.error is not None
        assert run.session["block_states"]["body-1"] == "failed"

    @pytest.mark.asyncio
    async def test_a_valid_http_body_still_reaches_the_worker(self) -> None:
        """The check is generic, so the shipped HTTP path must be unaffected."""
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        assert run_on_worker.await_args.args[1] == "http-client"

    @pytest.mark.asyncio
    async def test_a_valid_kubernetes_body_still_reaches_the_worker(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "k8s-get", dict(K8S_GET_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        assert run_on_worker.await_args.args[1] == "k8s-get"


HOST_FAILED = "Remote Execution failed on host 'prod-host': "


@dataclass
class _NullBodyRun:
    session: dict[str, Any]
    run_on_worker: AsyncMock


async def _run_lone_body_block(
    run: _NullBodyRun,
    element_type: str,
    values: dict[str, Any],
    *,
    expressions: list[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> None:
    """Run a Remote Execution whose body holds one block of ``element_type`` alone."""
    node = _make_plugin_node("body-1", element_type, values)
    node["data"]["expressionFields"] = list(expressions or [])
    node_map = {"rex-1": _make_remote_node("rex-1", session_id="host-sess-1"), "body-1": node}
    adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
    worker = MagicMock()
    worker.host = "prod-host"
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
        patch.object(_remote_exec, "run_on_worker", run.run_on_worker),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        await _run_container("rex-1", node_map, adj, run.session, variables=dict(variables or {}))


EMPTY_ARGUMENT_AND_ENTRY = (
    'test "$#" = 2 && test "$1" = a && test -z "$2" '
    '&& test "${TOKEN+set}" = set && test -z "$TOKEN"'
)


class TestNullScriptTextStaysOnWave:
    """REQ-3.1.3.22: a null that would reach a script as text fails on WAVE and nothing is
    sent to the host; a setting given null fails and names it on the remote path as well."""

    @pytest.fixture
    def body(self) -> Any:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.python import PythonPlugin

        register_plugin(PythonPlugin())
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session, _session_id = _prime_masking_session(registry)
        yield _NullBodyRun(session, AsyncMock(return_value=_passing_run_result()))
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    @staticmethod
    def _sent(body: _NullBodyRun) -> dict[str, Any]:
        body.run_on_worker.assert_awaited_once()
        request: dict[str, Any] = body.run_on_worker.await_args.args[2]
        return request

    @pytest.mark.parametrize(
        ("values", "refusal"),
        [
            pytest.param(
                {"script": "print(1)", "environment": {"RATE": "1", "TOKEN": None}},
                "'TOKEN' in 'environment' is null",
                id="environment-entry",
            ),
            pytest.param(
                {"script": "print(1)", "arguments": [{"value": "a"}, {"value": None}]},
                "Row 2 in 'arguments' is null",
                id="argument-row",
            ),
        ],
    )
    async def test_a_python_entry_stored_as_null_fails_and_nothing_is_sent(
        self, body: _NullBodyRun, values: dict[str, Any], refusal: str
    ) -> None:
        with pytest.raises(RuntimeError, match=exact(HOST_FAILED + refusal)):
            await _run_lone_body_block(body, "python", values)

        body.run_on_worker.assert_not_awaited()

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    @pytest.mark.parametrize(
        ("setting", "expression", "refusal"),
        [
            pytest.param(
                "environment",
                "environment.TOKEN",
                "'TOKEN' in 'environment' is null",
                id="environment-entry",
            ),
            pytest.param(
                "arguments", "arguments.1.value", "Row 2 in 'arguments' is null", id="argument-row"
            ),
        ],
    )
    async def test_a_python_entry_whose_expression_is_left_blank_fails_and_nothing_is_sent(
        self, body: _NullBodyRun, setting: str, expression: str, refusal: str, text: str
    ) -> None:
        entries = {"environment": {"TOKEN": text}, "arguments": [{"value": "a"}, {"value": text}]}

        with pytest.raises(RuntimeError, match=exact(HOST_FAILED + refusal)):
            await _run_lone_body_block(
                body,
                "python",
                {"script": "print(1)", setting: entries[setting]},
                expressions=[expression],
            )

        body.run_on_worker.assert_not_awaited()

    async def test_an_environment_expression_that_gives_null_fails_and_nothing_is_sent(
        self, body: _NullBodyRun
    ) -> None:
        message = HOST_FAILED + "'TOKEN' in 'environment' is null"

        with pytest.raises(RuntimeError, match=exact(message)):
            await _run_lone_body_block(
                body,
                "python",
                {"script": "print(1)", "environment": {"TOKEN": "token"}},
                expressions=["environment.TOKEN"],
                variables={"token": None},
            )

        body.run_on_worker.assert_not_awaited()

    async def test_an_argument_expression_that_gives_null_fails_and_nothing_is_sent(
        self, body: _NullBodyRun
    ) -> None:
        message = HOST_FAILED + "Row 2 in 'arguments' is null"

        with pytest.raises(RuntimeError, match=exact(message)):
            await _run_lone_body_block(
                body,
                "python",
                {"script": "print(1)", "arguments": [{"value": "a"}, {"value": "token"}]},
                expressions=["arguments.1.value"],
                variables={"token": None},
            )

        body.run_on_worker.assert_not_awaited()

    @pytest.mark.parametrize(
        ("element_type", "values", "setting_name"),
        [
            pytest.param(
                "python",
                {"script": "print(1)", "environment": "env_map"},
                "environment",
                id="python-environment",
            ),
            pytest.param(
                "http-client",
                {"method": "GET", "url": "env_map"},
                "url",
                id="http-url",
            ),
        ],
    )
    async def test_a_setting_given_null_fails_with_its_name_and_nothing_is_sent(
        self, body: _NullBodyRun, element_type: str, values: dict[str, Any], setting_name: str
    ) -> None:
        message = HOST_FAILED + f"'{setting_name}' is null"

        with pytest.raises(RuntimeError, match=exact(message)):
            await _run_lone_body_block(
                body,
                element_type,
                values,
                expressions=[setting_name],
                variables={"env_map": None},
            )

        body.run_on_worker.assert_not_awaited()

    async def test_a_null_python_input_variable_still_reaches_the_host(
        self, body: _NullBodyRun
    ) -> None:
        await _run_lone_body_block(
            body,
            "python",
            {"script": "print(count)", "input_vars": {"count": "count_var"}},
            expressions=["input_vars.count"],
            variables={"count_var": None},
        )

        assert self._sent(body)["input_vars"] == {"count": None}

    async def test_an_empty_row_and_a_null_item_cross_as_text(self, body: _NullBodyRun) -> None:
        await _run_lone_body_block(
            body,
            "python",
            {
                "script": "print(1)",
                "environment": {"ITEMS": [1, None, 2], "EMPTY": ""},
                "arguments": [{"value": ""}, {"value": [1, None, 2]}],
            },
        )

        request = self._sent(body)
        assert request["environment"] == {"ITEMS": "[1,null,2]", "EMPTY": ""}
        assert [row["value"] for row in request["arguments"]] == ["", "[1,null,2]"]

    @pytest.mark.parametrize(
        ("element_type", "values", "expressions", "message"),
        [
            pytest.param(
                "shell-exec",
                {"command": 'echo "$TOKEN"', "env_vars": {"TOKEN": "token"}},
                ["env_vars.TOKEN"],
                "'TOKEN' in 'env_vars' is null",
                id="shell-exec-input-variable",
            ),
            pytest.param(
                "shell-script",
                {"script": "echo hi", "arguments": [{"value": "a"}, {"value": "token"}]},
                ["arguments.1.value"],
                "Row 2 in 'arguments' is null",
                id="shell-script-argument-row",
            ),
            pytest.param(
                "shell-script",
                {"script": "echo hi", "input_vars": {"TOKEN": None}},
                [],
                "'TOKEN' in 'input_vars' is null",
                id="shell-script-input-variable-stored-null",
            ),
            pytest.param(
                "shell-script",
                {"script": "echo hi", "arguments": [{"value": "a"}, {"value": None}]},
                [],
                "Row 2 in 'arguments' is null",
                id="shell-script-argument-row-stored-null",
            ),
            pytest.param(
                "shell-script",
                {"script": "echo hi", "input_vars": {"TOKEN": ""}},
                ["input_vars.TOKEN"],
                "'TOKEN' in 'input_vars' is null",
                id="shell-script-input-variable-expression-left-empty",
            ),
            pytest.param(
                "shell-script",
                {"script": "echo hi", "arguments": [{"value": "a"}, {"value": "  "}]},
                ["arguments.1.value"],
                "Row 2 in 'arguments' is null",
                id="shell-script-argument-row-expression-left-blank",
            ),
        ],
    )
    async def test_a_shell_block_in_the_body_fails_on_wave_and_nothing_is_sent(
        self,
        body: _NullBodyRun,
        element_type: str,
        values: dict[str, Any],
        expressions: list[str],
        message: str,
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await _run_lone_body_block(
                body, element_type, values, expressions=expressions, variables={"token": None}
            )

        body.run_on_worker.assert_not_awaited()
        assert body.session["block_states"]["body-1"] == "failed"

    async def test_a_shell_script_in_the_body_reads_empty_entries_as_empty_text(
        self, body: _NullBodyRun
    ) -> None:
        values = {
            "script": EMPTY_ARGUMENT_AND_ENTRY,
            "input_vars": {"TOKEN": ""},
            "arguments": [{"value": "a"}, {"value": ""}],
        }

        await _run_lone_body_block(body, "shell-script", values)

        body.run_on_worker.assert_not_awaited()
        assert body.session["block_states"]["body-1"] == "passed"


class TestNullExecutionHost:
    """The container's Session ID given null fails and names it (REQ-3.1.3.21)."""

    async def test_a_session_id_expression_that_gives_null_is_refused_by_its_name(self) -> None:
        from wavecore.core.expressions import errors as expression_errors

        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node = _make_remote_node("rex-1", session_id="host_ref")
        node["data"]["expressionFields"] = ["session_id"]
        open_worker = AsyncMock()

        with (
            patch.object(_remote_exec, "open_worker", open_worker),
            pytest.raises(expression_errors.NullValueError, match=exact("'session_id' is null")),
        ):
            await _run_container(
                "rex-1", {"rex-1": node}, {"rex-1": []}, session, variables={"host_ref": None}
            )

        open_worker.assert_not_awaited()


async def _bundle_answers(
    _worker: Any,
    plugin_id: str,
    params: dict[str, Any],
    variables: dict[str, Any],
    trust: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The real built bundle answering the request, as the remote host's worker does."""
    request: dict[str, Any] = {
        "id": "r1",
        "plugin_id": plugin_id,
        "params": params,
        "variables": variables,
    }
    if trust is not None:
        request["trust"] = trust
    return await asyncio.to_thread(_run_bundle, request, isolated=True)


async def _run_python_on_the_host(
    session: dict[str, Any],
    script: str,
    bindings: dict[str, str],
    declared: dict[str, str],
    variables: dict[str, Any],
    **settings: Any,
) -> None:
    """Run one Python block in a Remote Execution body on the real bundle."""
    exports = [name for name in bindings if name not in ("error", "reason", "success")]
    values = {"script_type": "source", "script": script, "script_variables": exports, **settings}
    node = _make_plugin_node("body-1", "python", values, output_bindings=bindings)
    node_map = {"rex-1": _make_remote_node("rex-1", session_id="host-sess-1"), "body-1": node}
    adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
    worker = MagicMock()
    worker.host = "prod-host"
    with (
        declared_type_scope(declared),
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
        patch.object(_remote_exec, "run_on_worker", _bundle_answers),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        await _run_container("rex-1", node_map, adj, session, variables=variables)


REMOTE_UNCARRIABLE = [
    pytest.param("string", "out = object()\n", id="whole-value"),
    pytest.param("array", "out = [1, object()]\n", id="inside-a-list"),
    pytest.param("map", "out = {'handle': object()}\n", id="inside-a-map"),
]


class TestRemotePythonExportsJsonCannotCarry:
    """PYRUN-6 on the remote host: a value JSON cannot carry fails its export as it does on
    WAVE, and never binds into a variable."""

    @pytest.fixture
    def session(self, monkeypatch: pytest.MonkeyPatch) -> Any:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.python import PythonPlugin

        for name in [key for key in os.environ if key.startswith("COV_CORE_")]:
            monkeypatch.delenv(name)
        register_plugin(PythonPlugin())
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session, _session_id = _prime_masking_session(registry)
        yield session
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    @pytest.mark.parametrize(("wave_type", "script"), REMOTE_UNCARRIABLE)
    async def test_the_export_fails_as_it_does_on_wave(
        self, session: dict[str, Any], wave_type: str, script: str
    ) -> None:
        variables: dict[str, Any] = {}
        message = HOST_FAILED + f"Script variable 'out' is not a valid {wave_type}"

        with pytest.raises(RuntimeError, match=exact(message)):
            await _run_python_on_the_host(
                session, script, {"out": "out_var"}, {"out_var": wave_type}, variables
            )

        assert "out_var" not in variables

    async def test_a_recorded_run_binds_the_none_and_never_the_value_json_cannot_carry(
        self, session: dict[str, Any]
    ) -> None:
        variables: dict[str, Any] = {"count_var": 5, "status_var": "before"}

        await _run_python_on_the_host(
            session,
            "count = object()\nstatus = None\n",
            {
                "count": "count_var",
                "status": "status_var",
                "error": "err",
                "reason": "why",
                "success": "ok",
            },
            {"count_var": "integer", "status_var": "string"},
            variables,
            on_error="record",
        )

        assert variables["count_var"] == 5
        assert variables["status_var"] is None
        assert variables["err"] == "Script variable 'count' is not a valid integer"
        assert variables["why"] == "OutputVariable"
        assert variables["ok"] is False


class TestRemoteBodyExecution:
    """Happy path: body runs remotely, Remote Session ID bound, worker torn down."""

    @pytest.mark.asyncio
    async def test_body_block_is_routed_to_the_remote_worker(self) -> None:
        registry, conn = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        open_worker = AsyncMock(return_value=worker)
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        close_worker = AsyncMock()

        with (
            patch.object(_remote_exec, "open_worker", open_worker),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", close_worker),
        ):
            await _run_container("rex-1", node_map, adj, session)

        open_worker.assert_awaited_once()
        assert conn in open_worker.await_args.args
        run_on_worker.assert_awaited()
        assert run_on_worker.await_args.args[1] == "http-client"

    @pytest.mark.asyncio
    async def test_remote_session_id_output_is_bound(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        variables: dict[str, Any] = {}
        node_map = {
            "rex-1": _make_remote_node(
                "rex-1", session_id="host-sess-1", remote_session_var="my_rsid"
            ),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session, variables=variables)

        assert isinstance(variables.get("my_rsid"), str)
        assert variables["my_rsid"] != ""

    @pytest.mark.asyncio
    async def test_worker_is_torn_down_after_the_body(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        close_worker = AsyncMock()
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", close_worker),
        ):
            await _run_container("rex-1", node_map, adj, session)

        close_worker.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_then_target_is_queued_after_a_successful_body(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        exec_queue: list[str] = []
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
            "then-1": _make_plugin_node("then-1", "log", {"message": "'done'"}, label="After"),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {
            "rex-1": [("body-1", "body"), ("then-1", "then")],
        }

        worker = MagicMock()
        worker.host = "prod-host"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session, exec_queue=exec_queue)

        assert "then-1" in exec_queue


class TestRemoteFailure:
    """A worker / body failure wraps into the exact host-scoped error message."""

    @pytest.mark.asyncio
    async def test_body_failure_wraps_with_host_and_detail(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(side_effect=RuntimeError("boom"))
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(
                RuntimeError, match="^Remote Execution failed on host 'prod-host': boom$"
            ):
                await _run_container("rex-1", node_map, adj, session)

    @pytest.mark.asyncio
    async def test_worker_is_torn_down_even_when_the_body_fails(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        close_worker = AsyncMock()
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(side_effect=RuntimeError("boom"))
            ),
            patch.object(_remote_exec, "close_worker", close_worker),
        ):
            with pytest.raises(RuntimeError, match="^Remote Execution failed on host"):
                await _run_container("rex-1", node_map, adj, session)

        close_worker.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_failing_remote_block_is_painted_failed_not_left_running(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(side_effect=RuntimeError("boom"))
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(RuntimeError):
                await _run_container("rex-1", node_map, adj, session)

        # The body block must transition running -> failed, never stay running.
        assert session["block_states"]["body-1"] == "failed"

    @pytest.mark.asyncio
    async def test_remote_plugin_returned_failure_wraps_and_paints_failed(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        worker = MagicMock()
        worker.host = "prod-host"
        failed_result = {
            "return_value": None,
            "logs": [],
            "status": "failed",
            "error": "boom on host",
        }
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", AsyncMock(return_value=failed_result)),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(
                RuntimeError, match="^Remote Execution failed on host 'prod-host': boom on host$"
            ):
                await _run_container("rex-1", node_map, adj, session)

        assert session["block_states"]["body-1"] == "failed"

    @staticmethod
    def _tunnel_session() -> dict[str, Any]:
        """A run whose Execution Host session was opened on a tunnel's Local Port."""
        registry = SSHSessionRegistry()
        registry.register(
            "host-sess-1",
            MagicMock(),
            None,
            "127.0.0.1",
            None,
            None,
            connect_timeout=30,
            host_identity="node-2.internal",
        )
        return _make_session(registry)

    @pytest.mark.asyncio
    async def test_a_session_on_a_tunnel_names_the_far_host(self) -> None:
        session = self._tunnel_session()
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(side_effect=RuntimeError("boom"))
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            with pytest.raises(
                RuntimeError, match="^Remote Execution failed on host 'node-2.internal': boom$"
            ):
                await _run_container("rex-1", node_map, adj, session)

    @pytest.mark.asyncio
    async def test_the_worker_registry_records_the_far_host(self) -> None:
        session = self._tunnel_session()
        run_registry = RemoteWorkerRegistry()
        session["remote_worker_registry"] = run_registry
        registered: list[dict[str, Any]] = []
        real_register = run_registry.register

        def _record(remote_session_id: str, *args: Any, **kwargs: Any) -> None:
            real_register(remote_session_id, *args, **kwargs)
            registered.append(dict(run_registry.get(remote_session_id) or {}))

        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

        with (
            patch.object(run_registry, "register", side_effect=_record),
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        assert [record["host"] for record in registered] == ["node-2.internal"]

    @pytest.mark.asyncio
    async def test_non_serializable_variables_are_dropped_before_the_worker(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
        variables = {"ok": "value", "bad": object()}

        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session, variables=variables)

        # Only the JSON-serializable variable crosses to the worker.
        assert run_on_worker.await_args.args[3] == {"ok": "value"}


class TestRemoteRecordMode:
    """A Kubernetes block set to record its failures paints amber and binds the
    failure outputs, exactly as it does when it runs on WAVE. The engine
    sentinel that carries the amber is consumed here and never becomes a value
    a user can bind."""

    _MESSAGE = "K8s ConfigMap 'cm-1' not found in namespace 'default'"
    _WARN_LINE = f"Read failed (NotFound): {_MESSAGE}"
    _BINDINGS = {
        "result": "k8s_result",
        "success": "k8s_success",
        "error": "k8s_error",
        "reason": "k8s_reason",
        "__block_warning": "k8s_warned",
    }

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    def _node(self) -> dict[str, Any]:
        return _make_plugin_node(
            "body-1", "k8s-get", dict(K8S_GET_CONFIG), output_bindings=dict(self._BINDINGS)
        )

    def _recorded_result(self, **extra_outputs: Any) -> dict[str, Any]:
        outputs: dict[str, Any] = {
            "result": {},
            "names": [],
            "count": 0,
            "success": False,
            "error": self._MESSAGE,
            "reason": "NotFound",
            "__block_warning": True,
        }
        outputs.update(extra_outputs)
        return {
            "return_value": {"__wave_type": "result", "outputs": outputs, "secrets": []},
            "logs": [{"level": "WARN", "message": self._WARN_LINE}],
            "status": "passed",
            "error": None,
        }

    async def _run(self, result: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any]]:
        run = await _run_body_block(self._node(), result)
        assert run.error is None
        return run.session, run.session_id, run.variables

    @pytest.mark.asyncio
    async def test_a_recorded_failure_paints_the_block_amber(self) -> None:
        session, _session_id, _variables = await self._run(self._recorded_result())

        assert session["block_states"]["body-1"] == "warning"

    @pytest.mark.asyncio
    async def test_a_recorded_failure_binds_its_outputs(self) -> None:
        _session, _session_id, variables = await self._run(self._recorded_result())

        assert variables["k8s_success"] is False
        assert variables["k8s_error"] == self._MESSAGE
        assert variables["k8s_reason"] == "NotFound"

    @pytest.mark.asyncio
    async def test_the_warning_sentinel_never_becomes_a_bound_value(self) -> None:
        """The binding deliberately names the sentinel: every sibling output
        binds and that one finds nothing."""
        _session, _session_id, variables = await self._run(self._recorded_result())

        assert variables["k8s_error"] == self._MESSAGE
        assert "k8s_warned" not in variables

    @pytest.mark.asyncio
    async def test_the_warning_sentinel_is_stripped_before_the_bindings(self) -> None:
        captured: dict[str, Any] = {}

        def _capture(result: Any, *_args: Any) -> None:
            captured["result"] = result

        with patch.object(_wb_signals, "_assign_output_bindings", _capture):
            await _run_body_block(self._node(), self._recorded_result())

        assert "__block_warning" not in captured["result"]
        assert captured["result"]["success"] is False

    @pytest.mark.asyncio
    async def test_the_recorded_warning_line_replays_at_warn_level(self) -> None:
        _session, session_id, _variables = await self._run(self._recorded_result())

        entries = log_streaming_service.get_logs(session_id)
        assert any(
            entry["message"] == self._WARN_LINE and entry["level"] == "WARN" for entry in entries
        )

    @pytest.mark.asyncio
    async def test_a_clean_kubernetes_answer_still_paints_passed(self) -> None:
        result = {
            "return_value": {
                "__wave_type": "result",
                "outputs": {"result": {}, "success": True, "error": "", "reason": ""},
                "secrets": [],
            },
            "logs": [],
            "status": "passed",
            "error": None,
        }

        session, _session_id, variables = await self._run(result)

        assert session["block_states"]["body-1"] == "passed"
        assert variables["k8s_success"] is True


class TestEngineDispatch:
    """The engine routes a remote-execution node to the container executor.

    Remote Execution is engine-dispatched (not a registered plugin/control):
    _run_and_route_node intercepts the elementType and hands off to
    execute_remote_container, so the plugin lookup path is never taken.
    """

    @pytest.mark.asyncio
    async def test_run_and_route_dispatches_remote_execution(self) -> None:
        from wavecore.api.services.workbench.execution import _run_and_route_node
        from wavecore.api.services.workbench.node_helpers import _extract_node_fields

        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node = _make_remote_node("rex-1", session_id="host-sess-1")
        node_map = {"rex-1": node}
        nf = _extract_node_fields(node)

        dispatched = AsyncMock()
        with patch.object(_remote_exec, "execute_remote_container", dispatched):
            status = await _run_and_route_node(
                nf=nf,
                variables={},
                session_id=session["session_id"],
                session=session,
                node_id="rex-1",
                block_name="Remote Execution",
                output_bindings={},
                adj={"rex-1": []},
                node_map=node_map,
                executed=set(),
                exec_queue=[],
                environment_id=None,
            )

        assert status == "passed"
        dispatched.assert_awaited_once()


class TestRemoteBodyMembership:
    """find_enclosing_remote_container maps a node in a body to its innermost container."""

    def test_remotable_block_in_a_body_finds_its_container(self) -> None:
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("http-1", "body")]}

        assert _remote_exec.find_enclosing_remote_container("http-1", adj, node_map) == "rex-1"

    def test_non_remotable_block_in_a_body_finds_its_container(self) -> None:
        # A run that starts on a Log in the body still runs the way the body does.
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "log-1": _make_plugin_node("log-1", "log", {"message": "'hi'"}),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("log-1", "body")]}

        assert _remote_exec.find_enclosing_remote_container("log-1", adj, node_map) == "rex-1"

    def test_remotable_block_outside_any_body_has_no_container(self) -> None:
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        # http-1 hangs off the `then` egress, not the body.
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("http-1", "then")]}

        assert _remote_exec.find_enclosing_remote_container("http-1", adj, node_map) is None

    def test_remotable_block_with_no_container_returns_none(self) -> None:
        node_map = {"http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG))}

        assert _remote_exec.find_enclosing_remote_container("http-1", {}, node_map) is None

    def test_remotable_block_deep_in_the_body_chain_finds_its_container(self) -> None:
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "log-1": _make_plugin_node("log-1", "log", {"message": "'a'"}),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {
            "rex-1": [("log-1", "body")],
            "log-1": [("http-1", None)],
        }

        assert _remote_exec.find_enclosing_remote_container("http-1", adj, node_map) == "rex-1"

    def test_body_that_cycles_without_reaching_the_block_has_no_container(self) -> None:
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "log-a": _make_plugin_node("log-a", "log", {"message": "'a'"}),
            "log-b": _make_plugin_node("log-b", "log", {"message": "'b'"}),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        # rex body loops log-a <-> log-b; http-1 hangs off nothing.
        adj: dict[str, list[tuple[str, str | None]]] = {
            "rex-1": [("log-a", "body")],
            "log-a": [("log-b", None)],
            "log-b": [("log-a", None)],
        }

        assert _remote_exec.find_enclosing_remote_container("http-1", adj, node_map) is None


class TestStandaloneRemoteBlockRouting:
    """Run Current / from-here on a remotable body block routes to the host session:
    run remotely if it is live, fail clearly if not - NEVER run the plugin locally."""

    _CLOSED = (
        "This block runs on a remote host, but its SSH session '{session}' is closed or not "
        "connected. Open it first (Run Current on the SSH Session Open block), then run this block."
    )

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()

    async def _run_on_its_own(
        self,
        ssh_registry: SSHSessionRegistry,
        container: dict[str, Any],
        *,
        from_here: bool = False,
    ) -> tuple[dict[str, Any], AsyncMock, AsyncMock]:
        from tests.api.services.workbench.parallel_harness import make_session
        from wavecore.api.services.workbench import execution as _execution

        session_id = str(uuid.uuid4())
        session = make_session(session_id)
        session["ssh_session_registry"] = ssh_registry
        wb_common._workbench_sessions[session_id] = session
        nodes = [container, _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG))]
        edges = [
            {"source": "start-node", "target": "rex-1"},
            {"source": "rex-1", "target": "http-1", "sourceHandle": "body"},
        ]
        target = {"start_node_id" if from_here else "single_node_id": "http-1"}
        local_run = AsyncMock()
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_wb_plugins, "_execute_plugin", local_run),
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _execution._execute_workflow(session_id, nodes, edges, {}, **target)
        return session, local_run, run_on_worker

    @pytest.mark.asyncio
    async def test_closed_session_fails_without_running_locally(self) -> None:
        container = _make_remote_node("rex-1", session_id="host-sess-1")

        session, local_run, run_on_worker = await self._run_on_its_own(
            SSHSessionRegistry(), container
        )

        assert session["error"] == self._CLOSED.format(session="host-sess-1")
        assert session["block_states"]["http-1"] == "failed"
        local_run.assert_not_awaited()
        run_on_worker.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_session_id_fails_without_running_locally(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")

        session, local_run, _run_on_worker = await self._run_on_its_own(
            registry, _make_remote_node("rex-1")
        )

        assert session["error"] == self._CLOSED.format(session="(unset)")
        local_run.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_run_from_here_with_a_closed_session_fails_without_running_locally(
        self,
    ) -> None:
        container = _make_remote_node("rex-1", session_id="host-sess-1")

        session, local_run, _run_on_worker = await self._run_on_its_own(
            SSHSessionRegistry(), container, from_here=True
        )

        assert session["error"] == self._CLOSED.format(session="host-sess-1")
        local_run.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_live_session_runs_the_block_on_the_host_not_locally(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        container = _make_remote_node("rex-1", session_id="host-sess-1")

        session, local_run, run_on_worker = await self._run_on_its_own(registry, container)

        # Ran on the host worker, never locally on WAVE.
        run_on_worker.assert_awaited_once()
        assert run_on_worker.await_args.args[1] == "http-client"
        local_run.assert_not_awaited()
        assert session["status"] == "passed"


class TestRemoteBodySecretParity:
    """A remote body block gets the SAME secret protection (REQ-3.1.3.5)
    as a local block - the harness masked Inputs/Outputs echo, run-wide
    registration of user-marked secret outputs, and registration of the remote
    HTTP response credential headers, so neither a marked remote output nor a
    server-issued cookie shows in the clear."""

    _AUTH = "Bearer remote-secret-auth"
    _BODY = "remote-secret-body"
    _COOKIE = "session=remote-cookie-leak"

    @pytest.fixture(autouse=True)
    def _clean_sessions(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()

    def _http_body_node(self, node_id: str = "body-1") -> dict[str, Any]:
        return {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": "HTTP",
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {
                    "values": {
                        "method": "GET",
                        "url": "http://target.local/health",
                        "headers": {"Authorization": self._AUTH, "Accept": "application/json"},
                    },
                    "outputBindings": {"body": "resp_body"},
                    "outputSecretFields": ["body"],
                    "profileBindings": [],
                },
                "expressionFields": [],
                "templateFields": [],
                "variableExpressionKeys": [],
            },
        }

    def _remote_result(self) -> dict[str, Any]:
        return {
            "return_value": {
                "status_code": 200,
                "body": self._BODY,
                "headers": {"Set-Cookie": self._COOKIE, "Content-Type": "application/json"},
            },
            "logs": [{"level": "INFO", "message": "HTTP 200"}],
            "status": "passed",
            "error": None,
        }

    async def _run_body(self, registry: SecretRegistry) -> str:
        run = await _run_body_block(
            self._http_body_node("body-1"), self._remote_result(), secret_registry=registry
        )
        assert run.error is None
        return run.session_id

    @staticmethod
    def _find_line(session_id: str, prefix: str) -> str | None:
        for entry in log_streaming_service.get_logs(session_id):
            if entry["message"].startswith(prefix):
                return entry["message"]
        return None

    async def test_remote_body_emits_masked_inputs_line(self) -> None:
        session_id = await self._run_body(SecretRegistry())

        assert self._find_line(session_id, "Inputs: ") is not None

    async def test_remote_body_emits_masked_outputs_line(self) -> None:
        session_id = await self._run_body(SecretRegistry())

        assert self._find_line(session_id, "Outputs: ") is not None

    async def test_remote_body_masks_catalog_header_in_inputs_line(self) -> None:
        session_id = await self._run_body(SecretRegistry())

        line = self._find_line(session_id, "Inputs: ")
        assert line is not None
        assert "remote-secret-auth" not in line
        assert "********" in line
        assert "application/json" in line

    async def test_remote_body_masks_marked_output_in_outputs_line(self) -> None:
        session_id = await self._run_body(SecretRegistry())

        line = self._find_line(session_id, "Outputs: ")
        assert line is not None
        assert self._BODY not in line
        assert "********" in line

    async def test_remote_body_registers_marked_output_value(self) -> None:
        registry = SecretRegistry()

        await self._run_body(registry)

        assert self._BODY in registry.scan_values()

    async def test_remote_http_response_credential_is_registered(self) -> None:
        registry = SecretRegistry()

        await self._run_body(registry)

        assert self._COOKIE in registry.scan_values()

    async def test_remote_body_masks_a_url_password_in_inputs_line(self) -> None:
        node = self._http_body_node()
        node["data"]["config"]["values"]["url"] = "http://wave:url-s3cr3t@target.local/health"
        run = await _run_body_block(node, self._remote_result(), secret_registry=SecretRegistry())

        line = self._find_line(run.session_id, "Inputs: ")
        assert line is not None
        assert '"url":"http://wave:********@target.local/health"' in line
        assert "url-s3cr3t" not in line


class TestRemoteReplayOrdering:
    """Fix 4: secret registration precedes the worker-log replay, so a credential
    carried in a worker log line replays masked; a failed run still replays its
    logs before the failure raises."""

    _COOKIE = "session=replay-cookie-leak"
    _BODY = "replay-secret-body"

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    async def _replay_lines(self, node: dict[str, Any], result: dict[str, Any]) -> list[str]:
        run = await _run_body_block(node, result)
        return [entry["message"] for entry in log_streaming_service.get_logs(run.session_id)]

    async def test_response_credential_in_worker_log_replays_masked(self) -> None:
        node = _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG))
        result = {
            "return_value": {
                "status_code": 200,
                "body": "ok",
                "headers": {"Set-Cookie": self._COOKIE},
            },
            "logs": [{"level": "INFO", "message": f"redirect hop carried {self._COOKIE}"}],
            "status": "passed",
            "error": None,
        }

        lines = await self._replay_lines(node, result)

        replayed = next(line for line in lines if "redirect hop carried" in line)
        assert self._COOKIE not in replayed
        assert "********" in replayed

    async def test_marked_secret_output_in_worker_log_replays_masked(self) -> None:
        node = _make_plugin_node(
            "body-1", "http-client", dict(HTTP_BODY_CONFIG), output_secret_fields=["body"]
        )
        result = {
            "return_value": {"status_code": 200, "body": self._BODY, "headers": {}},
            "logs": [{"level": "INFO", "message": f"worker echoed {self._BODY}"}],
            "status": "passed",
            "error": None,
        }

        lines = await self._replay_lines(node, result)

        replayed = next(line for line in lines if "worker echoed" in line)
        assert self._BODY not in replayed
        assert "********" in replayed

    async def test_failed_worker_run_still_replays_its_logs(self) -> None:
        node = _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG))
        result = {
            "return_value": None,
            "logs": [{"level": "INFO", "message": "worker progress before the failure"}],
            "status": "failed",
            "error": "boom on host",
        }

        run = await _run_body_block(node, result)

        assert str(run.error) == "Remote Execution failed on host 'prod-host': boom on host"
        lines = [entry["message"] for entry in log_streaming_service.get_logs(run.session_id)]
        assert any("worker progress before the failure" in line for line in lines)


class TestABodyBlocksLinesCarryItsSource:
    """A block that runs on the remote host writes every line under its own Source: the
    lines WAVE writes for it and the worker's lines it replays (EXEC-25)."""

    _DESCRIPTION = "Asks the service whether it is up before the load starts"

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    async def _block_lines(self, label: str, result: dict[str, Any]) -> list[dict[str, Any]]:
        node = _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG), label=label)
        node["data"]["description"] = self._DESCRIPTION
        run = await _run_body_block(node, result)
        return [
            entry
            for entry in log_streaming_service.get_logs(run.session_id)
            if entry.get("blockId") == "http-1" and entry["source"] != "SYSTEM"
        ]

    async def test_the_lines_wave_writes_carry_the_type_and_the_name(self) -> None:
        lines = await self._block_lines("Check health", _passing_run_result())

        echoed = {
            line["message"].split(":")[0]: line["source"]
            for line in lines
            if line["message"].startswith(("Inputs:", "Outputs:"))
        }
        assert echoed == {"Inputs": "HTTP : Check health", "Outputs": "HTTP : Check health"}

    async def test_the_replayed_worker_line_carries_the_type_and_the_name(self) -> None:
        lines = await self._block_lines("Check health", _passing_run_result())

        replayed = [line["source"] for line in lines if line["message"] == "HTTP 200"]
        assert replayed == ["HTTP : Check health"]

    async def test_every_line_of_the_block_carries_the_same_source(self) -> None:
        lines = await self._block_lines("Check health", _passing_run_result())

        assert len(lines) == 3
        assert {line["source"] for line in lines} == {"HTTP : Check health"}

    @pytest.mark.parametrize("label", ["HTTP", "HTTP Client"], ids=["palette", "catalog"])
    async def test_a_block_named_as_its_type_shows_the_type_alone(self, label: str) -> None:
        lines = await self._block_lines(label, _passing_run_result())

        assert len(lines) == 3
        assert {line["source"] for line in lines} == {"HTTP"}

    async def test_a_failed_run_replays_its_lines_under_the_same_source(self) -> None:
        result = {
            "return_value": None,
            "logs": [{"level": "ERROR", "message": "connection refused"}],
            "status": "failed",
            "error": "boom on host",
        }

        lines = await self._block_lines("Check health", result)

        replayed = [line["source"] for line in lines if line["message"] == "connection refused"]
        assert replayed == ["HTTP : Check health"]

    async def test_the_description_is_in_no_source(self) -> None:
        lines = await self._block_lines("Check health", _passing_run_result())

        assert [line["source"] for line in lines if self._DESCRIPTION in line["source"]] == []


class TestRemoteMaterialization:
    """The worker answers in JSON-safe envelopes only, so WAVE turns them back
    into the runtime values a block binds - and does it before anything reads,
    logs or registers an output, or the raw envelope leaks into all three."""

    _PLANTED = "planted-envelope-secret"
    _TABLE_ENVELOPE = {
        "__wave_type": "table",
        "columns": [{"name": "NAME", "type": "string"}, {"name": "CPU", "type": "float"}],
        "rows": [["pod-a", "0.5"]],
    }
    _YAML_ENVELOPE = {"__wave_type": "yaml", "value": {"kind": "ConfigMap", "metadata": {}}}

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    @staticmethod
    def _envelope_result(
        outputs: dict[str, Any],
        secrets: list[str] | None = None,
        logs: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return {
            "return_value": {
                "__wave_type": "result",
                "outputs": outputs,
                "secrets": secrets or [],
            },
            "logs": logs or [],
            "status": "passed",
            "error": None,
        }

    async def _run_body(
        self, node: dict[str, Any], result: dict[str, Any]
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        run = await _run_body_block(node, result)
        assert run.error is None
        return run.session, run.session_id, run.variables

    @pytest.mark.asyncio
    async def test_a_table_envelope_binds_as_a_table(self) -> None:
        node = _make_plugin_node(
            "body-1", "k8s-get", dict(K8S_GET_CONFIG), output_bindings={"result": "usage"}
        )

        _session, _session_id, variables = await self._run_body(
            node, self._envelope_result({"result": dict(self._TABLE_ENVELOPE)})
        )

        assert isinstance(variables["usage"], Table)
        assert variables["usage"].col_names() == ["NAME", "CPU"]

    @pytest.mark.asyncio
    async def test_a_yaml_envelope_binds_as_rendered_text(self) -> None:
        node = _make_plugin_node(
            "body-1", "k8s-get", dict(K8S_GET_CONFIG), output_bindings={"result": "manifest"}
        )

        _session, _session_id, variables = await self._run_body(
            node, self._envelope_result({"result": dict(self._YAML_ENVELOPE)})
        )

        assert variables["manifest"] == "kind: ConfigMap\nmetadata: {}\n"

    @pytest.mark.asyncio
    async def test_a_plain_worker_answer_binds_unchanged(self) -> None:
        """The HTTP response shape carries no envelope tag and must survive as it is."""
        node = _make_plugin_node(
            "body-1", "http-client", dict(HTTP_BODY_CONFIG), output_bindings={"body": "resp_body"}
        )

        _session, _session_id, variables = await self._run_body(node, _passing_run_result())

        assert variables["resp_body"] == "ok"

    @pytest.mark.asyncio
    async def test_materialize_runs_before_every_output_consumer(self) -> None:
        node = _make_plugin_node("body-1", "k8s-get", dict(K8S_GET_CONFIG))
        order: list[str] = []
        real_materialize = _remote_exec.materialize

        def _materialize(value: Any, register_secret: Any = None) -> Any:
            order.append("materialize")
            return real_materialize(value, register_secret)

        def _spy(name: str) -> Any:
            def _record(*_args: Any, **_kwargs: Any) -> None:
                order.append(name)

            return _record

        with (
            patch.object(_remote_exec, "materialize", _materialize),
            patch.object(_remote_exec, "_register_secret_output_values", _spy("secret-outputs")),
            patch.object(
                _remote_exec, "_register_remote_response_credentials", _spy("response-creds")
            ),
            patch.object(_remote_exec, "_replay_remote_logs", _spy("replay-logs")),
            patch.object(_wb_signals, "_assign_output_bindings", _spy("bindings")),
        ):
            await _run_body_block(node, self._envelope_result({"result": {}}))

        assert order == [
            "materialize",
            "secret-outputs",
            "response-creds",
            "replay-logs",
            "bindings",
        ]

    @pytest.mark.asyncio
    async def test_an_envelope_secret_is_registered_with_the_run(self) -> None:
        node = _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_CONFIG))
        session, _session_id, _variables = await self._run_body(
            node, self._envelope_result({"session": "opaque"}, secrets=[self._PLANTED])
        )

        assert self._PLANTED in session["secret_registry"].scan_values()

    @pytest.mark.asyncio
    async def test_an_envelope_secret_masks_the_replayed_worker_log(self) -> None:
        """Registration precedes the replay, so a worker line carrying the value
        reaches the console masked."""
        node = _make_plugin_node("body-1", "k8s-connect", dict(K8S_CONNECT_CONFIG))
        result = self._envelope_result(
            {"session": "opaque"},
            secrets=[self._PLANTED],
            logs=[{"level": "INFO", "message": f"minted {self._PLANTED} for the run"}],
        )

        _session, session_id, _variables = await self._run_body(node, result)

        lines = [entry["message"] for entry in log_streaming_service.get_logs(session_id)]
        replayed = next(line for line in lines if "minted" in line)
        assert self._PLANTED not in replayed
        assert "********" in replayed

    @pytest.mark.asyncio
    async def test_a_marked_secret_output_registers_from_the_converted_value(self) -> None:
        """A raw envelope carries no output named 'result', so this value can
        only register if the conversion already happened."""
        node = _make_plugin_node(
            "body-1",
            "k8s-get",
            dict(K8S_GET_CONFIG),
            output_secret_fields=["result"],
            output_bindings={"result": "manifest"},
        )
        envelope = {"__wave_type": "yaml", "value": {"token": "planted-yaml-secret"}}

        session, _session_id, variables = await self._run_body(
            node, self._envelope_result({"result": envelope})
        )

        assert variables["manifest"] == "token: planted-yaml-secret\n"
        assert "token: planted-yaml-secret\n" in session["secret_registry"].scan_values()


class TestRemoteKubernetesRouting:
    """Every Kubernetes block a Remote body may carry reaches the cluster from the
    execution host, not from WAVE - the write and exec blocks included."""

    @staticmethod
    def _graph(element_type: str) -> tuple[dict[str, Any], dict[str, list[tuple[str, str | None]]]]:
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node(
                "body-1", element_type, dict(K8S_BODY_CONFIGS[element_type])
            ),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
        return node_map, adj

    def test_every_kubernetes_element_type_is_marked_remotable(self) -> None:
        from wavecore.core.plugin_registry import get_plugin

        local_only = []
        for element_type in sorted(K8S_BODY_CONFIGS):
            plugin = get_plugin(element_type, "1.0.0")
            assert plugin is not None
            if not plugin.metadata.get("remotable", False):
                local_only.append(element_type)

        assert local_only == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("element_type", sorted(K8S_BODY_CONFIGS))
    async def test_a_kubernetes_body_block_routes_to_the_worker(self, element_type: str) -> None:
        registry, _conn = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map, adj = self._graph(element_type)

        worker = MagicMock()
        worker.host = "prod-host"
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        local_exec = AsyncMock(return_value={})
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_wb_plugins, "_execute_plugin", local_exec),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        run_on_worker.assert_awaited_once()
        assert run_on_worker.await_args.args[1] == element_type
        local_exec.assert_not_awaited()


class TestRemoteApplySecretOrdering:
    """Over the wire: the Secret data values an Apply envelope carries register
    with the run before any worker line replays and before any output binds, so a
    recorded Apply failure can never print the data it refused."""

    _WARN_PREFIX = "Apply failed (Invalid):"
    _WARN_LINE = (
        f"{_WARN_PREFIX} Secret 'app-secret' rejected with "
        f"stringData {APPLY_SECRET_PLAINTEXT} and data {APPLY_SECRET_BASE64}"
    )
    _ADJ: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    def _prime(self) -> tuple[dict[str, Any], str]:
        ssh_registry, _conn = _ssh_registry_with("host-sess-1")
        return _prime_masking_session(ssh_registry)

    @staticmethod
    def _node_map() -> dict[str, Any]:
        return {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node(
                "body-1",
                "k8s-apply",
                dict(K8S_BODY_CONFIGS["k8s-apply"]),
                label="Apply",
                output_bindings={"result": "apply_result"},
            ),
        }

    @staticmethod
    def _recorded_result(logs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "return_value": {
                "__wave_type": "result",
                "outputs": {
                    "result": {},
                    "success": False,
                    "error": "Secret 'app-secret' rejected",
                    "reason": "Invalid",
                    "__block_warning": True,
                },
                "secrets": [APPLY_SECRET_PLAINTEXT, APPLY_SECRET_BASE64],
            },
            "logs": logs or [],
            "status": "passed",
            "error": None,
        }

    async def _drive(
        self,
        session: dict[str, Any],
        result: dict[str, Any],
        extra: list[Any] | None = None,
    ) -> None:
        worker = MagicMock()
        worker.host = "prod-host"
        with ExitStack() as stack:
            stack.enter_context(
                patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker))
            )
            stack.enter_context(
                patch.object(_remote_exec, "run_on_worker", AsyncMock(return_value=result))
            )
            stack.enter_context(patch.object(_remote_exec, "close_worker", AsyncMock()))
            stack.enter_context(
                patch.object(_wb_plugins, "_execute_plugin", AsyncMock(return_value={}))
            )
            for patcher in extra or []:
                stack.enter_context(patcher)
            await _run_container("rex-1", self._node_map(), self._ADJ, session)

    @staticmethod
    def _recording_registry(registry: Any, calls: list[tuple[Any, str, str | None]]) -> Any:
        """Patch the run registry so every registration is captured in order."""
        real_register = registry.register_value

        def _record(value: Any, source: str, exempt_block: str | None = None) -> None:
            calls.append((value, source, exempt_block))
            real_register(value, source, exempt_block)

        return patch.object(registry, "register_value", _record)

    @pytest.mark.asyncio
    async def test_envelope_secrets_register_before_the_replay_and_the_bindings(self) -> None:
        session, _session_id = self._prime()
        calls: list[tuple[Any, str, str | None]] = []

        def _mark(name: str) -> Any:
            def _record(*_args: Any, **_kwargs: Any) -> None:
                calls.append((None, name, None))

            return _record

        await self._drive(
            session,
            self._recorded_result(),
            extra=[
                self._recording_registry(session["secret_registry"], calls),
                patch.object(_remote_exec, "_replay_remote_logs", _mark("replay-logs")),
                patch.object(_wb_signals, "_assign_output_bindings", _mark("bindings")),
            ],
        )

        tracked = ("remote:envelope", "replay-logs", "bindings")
        order = [
            f"{source}:{value}" if value is not None else source
            for value, source, _exempt in calls
            if source in tracked
        ]
        assert order == [
            f"remote:envelope:{APPLY_SECRET_PLAINTEXT}",
            f"remote:envelope:{APPLY_SECRET_BASE64}",
            "replay-logs",
            "bindings",
        ]

    @pytest.mark.asyncio
    async def test_every_envelope_secret_value_is_registered_with_the_run(self) -> None:
        session, _session_id = self._prime()

        await self._drive(session, self._recorded_result())

        scanned = session["secret_registry"].scan_values()
        assert APPLY_SECRET_PLAINTEXT in scanned
        assert APPLY_SECRET_BASE64 in scanned

    @pytest.mark.asyncio
    async def test_the_envelope_secrets_register_under_the_envelope_source(self) -> None:
        session, _session_id = self._prime()
        calls: list[tuple[Any, str, str | None]] = []

        await self._drive(
            session,
            self._recorded_result(),
            extra=[self._recording_registry(session["secret_registry"], calls)],
        )

        planted = [
            (source, exempt_block)
            for value, source, exempt_block in calls
            if value in (APPLY_SECRET_PLAINTEXT, APPLY_SECRET_BASE64)
        ]
        assert planted == [("remote:envelope", None), ("remote:envelope", None)]

    @pytest.mark.asyncio
    async def test_the_recorded_warning_line_replays_without_the_secret_data(self) -> None:
        session, session_id = self._prime()

        await self._drive(
            session,
            self._recorded_result(logs=[{"level": "WARN", "message": self._WARN_LINE}]),
        )

        replayed = [
            entry["message"]
            for entry in log_streaming_service.get_logs(session_id)
            if entry["message"].startswith(self._WARN_PREFIX)
        ]
        assert len(replayed) == 1
        assert not any(APPLY_SECRET_PLAINTEXT in line for line in replayed)
        assert not any(APPLY_SECRET_BASE64 in line for line in replayed)
        assert "********" in replayed[0]

    @pytest.mark.asyncio
    async def test_an_envelope_whose_outputs_are_not_a_mapping_is_refused(self) -> None:
        session, _session_id = self._prime()
        result = {
            "return_value": {"__wave_type": "result", "outputs": [], "secrets": []},
            "logs": [],
            "status": "passed",
            "error": None,
        }
        expected = (
            "Remote Execution failed on host 'prod-host': "
            "Remote result envelope carries no outputs"
        )

        with pytest.raises(RuntimeError, match=exact(expected)):
            await self._drive(session, result)


class TestRemoteBodyCancel:
    """A canceled run tears the worker down through the run's worker registry:
    the host is stopped first, then the session is closed, so a Stop during a
    remote block leaves the host as it was found (SHRUN-15)."""

    _ADJ: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}

    @staticmethod
    def _node_map() -> dict[str, Any]:
        return {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG)),
        }

    async def _cancel_mid_body(self, session: dict[str, Any], order: list[str]) -> None:
        """Cancel the run while the body block is still in flight on the host."""
        worker = MagicMock()
        worker.host = "prod-host"
        worker.close.side_effect = lambda: order.append("close")
        in_flight = asyncio.Event()

        async def _never_answers(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            in_flight.set()
            await asyncio.sleep(3600)
            raise AssertionError("the body block was never canceled")

        async def _close(_worker: Any) -> None:
            order.append("close")

        def _stop(_worker: Any) -> None:
            order.append("stop")

        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(_remote_exec, "run_on_worker", _never_answers),
            patch.object(_remote_exec, "close_worker", _close),
            patch.object(_worker_registry, "stop_worker", _stop),
        ):
            task = asyncio.create_task(
                _run_container("rex-1", self._node_map(), self._ADJ, session)
            )
            await in_flight.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    @pytest.mark.asyncio
    async def test_cancel_stops_the_host_before_closing_the_session(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        order: list[str] = []

        await self._cancel_mid_body(session, order)

        assert order[0] == "stop"
        assert "close" in order[1:]

    @pytest.mark.asyncio
    async def test_cancel_tears_the_worker_down_through_the_registry(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        run_registry = RemoteWorkerRegistry()
        session["remote_worker_registry"] = run_registry
        closed: list[str] = []
        real_close = run_registry.close

        def _spy(remote_session_id: str) -> bool:
            closed.append(remote_session_id)
            return real_close(remote_session_id)

        run_registry.close = _spy

        await self._cancel_mid_body(session, [])

        assert len(closed) == 1

    def test_teardown_stops_the_host_and_still_flips_connected(self) -> None:
        """The stop goes in front of the close, and a worker record's bound
        Connected variable still reads false afterwards."""
        pushes: list[tuple[str, Any]] = []

        def _push(name: str, value: Any) -> None:
            pushes.append((name, value))

        order: list[str] = []
        worker = MagicMock()
        worker.close.side_effect = lambda: order.append("close")
        variables: dict[str, Any] = {"conn_ok": True}
        run_registry = RemoteWorkerRegistry(push_variable=_push)
        run_registry.register("rw1", worker, "ssh-1", "prod-host", "conn_ok", variables=variables)

        with patch.object(_worker_registry, "stop_worker", lambda _worker: order.append("stop")):
            run_registry.close("rw1")

        assert order == ["stop", "close"]
        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]


class TestRemoteBodyProfileFailure:
    """A body block whose profile cannot load fails at that block."""

    @pytest.fixture(autouse=True)
    def _clean(self) -> Any:
        yield
        wb_common._workbench_sessions.clear()
        log_streaming_service._session_logs.clear()
        log_streaming_service._session_registries.clear()

    @pytest.mark.asyncio
    async def test_a_profile_that_cannot_load_fails_the_remote_body_block(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1", host="prod-host")
        session, session_id = _prime_masking_session(registry)
        body = _make_plugin_node("body-1", "http-client", dict(HTTP_BODY_CONFIG), label="Body")
        body["data"]["config"]["profileBindings"] = [{"profileId": "p1", "alias": "api"}]
        node_map = {"rex-1": _make_remote_node("rex-1", session_id="host-sess-1"), "body-1": body}
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
        worker = MagicMock()
        worker.host = "prod-host"
        with (
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
            patch.object(
                _remote_exec, "run_on_worker", AsyncMock(return_value=_passing_run_result())
            ),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
            patch(
                "wavecore.api.services.profiles.service.get_profile_config_for_execution",
                MagicMock(side_effect=RuntimeError("cannot unseal profile p1")),
            ),
        ):
            with pytest.raises(RuntimeError):
                await _run_container("rex-1", node_map, adj, session)

        lines = [entry["message"] for entry in log_streaming_service.get_logs(session_id)]
        assert session["block_states"]["body-1"] == "failed"
        assert [line for line in lines if line.startswith("Block 'Body' failed:")] == [
            "Block 'Body' failed: cannot unseal profile p1"
        ]


def _certificates() -> Any:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    from wavecore.api.services.network import certificates

    return certificates


def _trust_spec(source: str, additional_pem: str = "", additional_count: int = 0) -> Any:
    from wavecore.connectivity import trust_store

    return trust_store.TrustSpec(
        source=source,
        additional_pem=additional_pem,
        additional_count=additional_count,
        builtin_label="June 2026",
    )


def _trust_sent(awaited: Any) -> Any:
    """The trust a run_on_worker call carried, positional or by name."""
    args, kwargs = awaited
    return kwargs["trust"] if "trust" in kwargs else args[4]


_ADDITIONAL_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"


class TestTheTrustSpecTravelsWithEachRequest:
    """REQ-4.5.16: a remote body block verifies by the WAVE host's trust spec, sent per request."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("element_type", "config"),
        [
            pytest.param("http-client", HTTP_BODY_CONFIG, id="http"),
            pytest.param("k8s-get", K8S_GET_CONFIG, id="k8s-get"),
        ],
    )
    async def test_the_request_carries_the_current_trust_spec_in_wire_form(
        self, element_type: str, config: dict[str, Any]
    ) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "body-1": _make_plugin_node("body-1", element_type, dict(config)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {"rex-1": [("body-1", "body")]}
        spec = _trust_spec("host", _ADDITIONAL_PEM, 1)
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_certificates(), "current_trust_spec", return_value=spec),
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        run_on_worker.assert_awaited_once()
        assert _trust_sent(run_on_worker.await_args) == {
            "source": "host",
            "additional_pem": _ADDITIONAL_PEM,
            "additional_count": 1,
            "builtin_label": "June 2026",
        }

    @pytest.mark.asyncio
    async def test_each_request_reads_the_trust_spec_when_it_is_sent(self) -> None:
        registry, _ = _ssh_registry_with("host-sess-1")
        session = _make_session(registry)
        node_map = {
            "rex-1": _make_remote_node("rex-1", session_id="host-sess-1"),
            "http-1": _make_plugin_node("http-1", "http-client", dict(HTTP_BODY_CONFIG)),
            "http-2": _make_plugin_node("http-2", "http-client", dict(HTTP_BODY_CONFIG)),
        }
        adj: dict[str, list[tuple[str, str | None]]] = {
            "rex-1": [("http-1", "body")],
            "http-1": [("http-2", None)],
        }
        specs = [_trust_spec("builtin"), _trust_spec("host", _ADDITIONAL_PEM, 1)]
        run_on_worker = AsyncMock(return_value=_passing_run_result())
        with (
            patch.object(_certificates(), "current_trust_spec", side_effect=specs),
            patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
            patch.object(_remote_exec, "run_on_worker", run_on_worker),
            patch.object(_remote_exec, "close_worker", AsyncMock()),
        ):
            await _run_container("rex-1", node_map, adj, session)

        assert [_trust_sent(awaited) for awaited in run_on_worker.await_args_list] == [
            specs[0].to_wire(),
            specs[1].to_wire(),
        ]
