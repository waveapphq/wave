"""Shared fakes for every K8s block test (Connect, Get, Events, Logs, Top, Apply,
Delete, Scale, Rollout, Exec, Script, Cp).

One recording fake for the REST core, one recording fake for the exec channel, one
scripted stdout stream for the K8s Copy pull, a kubeconfig-shaped session builder,
the two session-check messages, the impersonation-pairing message, the gateway page
and the unreadable-body message a block meets when something other than the cluster
answers, and the parameter/context builders the block test files share.
"""

import importlib
import json
import re
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

from wavecore.connectivity.k8s.rest import K8sDiscoveryDenied, K8sResource

SERVER = "https://k8s.example:6443"
NAMESPACE = "apps"
MISSING_SESSION_MESSAGE = "Missing required parameter: session"
EMPTY_SESSION_MESSAGE = (
    "Parameter 'session' is set but what it points at is empty: check it names the "
    "variable a K8s Connect block assigns its 'session' output to, and that Connect "
    "ran before this block"
)
GROUPS_WITHOUT_USER_MESSAGE = (
    "Parameter 'impersonate_groups' cannot be used on its own: set 'impersonate_user' to the "
    "user to run the request as, or clear the groups"
)
GATEWAY_HTML = (
    b"<html><head><title>502 Bad Gateway</title></head>"
    b"<body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>"
)
UNREADABLE_BODY_MESSAGE = (
    "Kubernetes API response body is not JSON - check whether a proxy or gateway "
    "answered instead of the cluster"
)


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def required_conditions(param: dict[str, Any]) -> list[dict[str, Any]]:
    """Every conditional-requirement condition on a parameter, single form or conjunctive."""
    single = param.get("required_when")
    return ([single] if single else []) + list(param.get("required_when_all") or [])


def session_value(
    server: str = SERVER,
    namespace: str = NAMESPACE,
    token: str | None = "sa-tok",
) -> str:
    """A kubeconfig-shaped session string require_context accepts."""
    user: dict[str, Any] = {"token": token} if token else {}
    return json.dumps(
        {
            "apiVersion": "v1",
            "kind": "Config",
            "clusters": [{"name": "wave", "cluster": {"server": server}}],
            "users": [{"name": "wave", "user": user}],
            "contexts": [
                {
                    "name": "wave",
                    "context": {"cluster": "wave", "user": "wave", "namespace": namespace},
                }
            ],
            "current-context": "wave",
        }
    )


def block_params(**overrides: Any) -> dict[str, Any]:
    """The session every K8s block needs, plus the test's own parameters."""
    params: dict[str, Any] = {"session": session_value()}
    params.update(overrides)
    return params


def execute_context(
    params: dict[str, Any],
    register_secret: Any = None,
    logger: Any = None,
    artifacts_dir: str | None = None,
    testdata_dirs: list[str] | None = None,
) -> dict[str, Any]:
    """The execute() context; the optional keys are present only when supplied."""
    context: dict[str, Any] = {
        "parameters": params,
        "logger": logger or MagicMock(),
        "variables": {},
    }
    if register_secret is not None:
        context["register_secret"] = register_secret
    if artifacts_dir is not None:
        context["artifacts_dir"] = artifacts_dir
    if testdata_dirs is not None:
        context["testdata_dirs"] = testdata_dirs
    return context


def resource(
    kind: str,
    name: str,
    namespaced: bool = True,
    group_version: str = "v1",
) -> K8sResource:
    """A discovery hit for one kind, with the path root derived from the group."""
    root = "/api/v1" if group_version == "v1" else f"/apis/{group_version}"
    return K8sResource(
        kind=kind,
        name=name,
        namespaced=namespaced,
        group_version=group_version,
        path_root=root,
    )


@dataclass
class Call:
    """One request recorded by the fake core."""

    method: str
    path: str
    body: dict[str, Any] | None
    accept: str | None
    content_type: str | None
    raw: bool


class FakeK8sClient:
    """Replays scripted (status, body) pairs and records every request."""

    def __init__(
        self,
        responses: list[Any] | None = None,
        resources: dict[str, K8sResource] | None = None,
        default: Any = (200, {}),
    ) -> None:
        self.responses: deque[Any] = deque(responses or [])
        self.resources: dict[str, K8sResource] = resources or {}
        self.default = default
        self.calls: list[Call] = []
        self.discoveries: list[str] = []
        self.discovery_calls: list[tuple[str, str | None]] = []
        self.factory: Any = None
        self.last_warnings: list[str] = []

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        *,
        accept: str | None = None,
        raw: bool = False,
        content_type: str | None = None,
    ) -> tuple[int, Any]:
        """Record the call and hand back the next scripted pair, or raise it."""
        self.calls.append(Call(method, path, body, accept, content_type, raw))
        item = self.responses.popleft() if self.responses else self.default
        if isinstance(item, Exception):
            raise item
        status, payload = item
        return status, payload

    def discover(self, kind: str, api_version: str | None = None) -> K8sResource | None:
        """Record the lookup; an unscripted kind is a discovery miss."""
        self.discoveries.append(kind)
        self.discovery_calls.append((kind, api_version))
        return self.resources.get(kind)

    @property
    def last(self) -> Call:
        """The most recent recorded request."""
        return self.calls[-1]


class DeniedDiscoveryClient(FakeK8sClient):
    """A fake core whose discovery walk the cluster refuses with a 401 or 403 Status."""

    def __init__(self, status: int, body: dict[str, Any]) -> None:
        super().__init__()
        self.status = status
        self.body = body

    def discover(self, kind: str, api_version: str | None = None) -> K8sResource | None:
        """Record the lookup, then refuse it the way a denied walk does."""
        self.discoveries.append(kind)
        self.discovery_calls.append((kind, api_version))
        raise K8sDiscoveryDenied(self.status, self.body)


def patch_client(module: str, client: FakeK8sClient) -> Any:
    """Patch one plugin module's K8sClient so it constructs the fake."""
    factory = MagicMock(return_value=client)
    client.factory = factory
    return patch(f"wavecore.plugins.{module}.K8sClient", factory)


EXEC_MODULE = "wavecore.connectivity.k8s.ws"
EXEC_TARGET = f"{EXEC_MODULE}.exec_in_pod"


@dataclass
class ExecCall:
    """One exec recorded by the fake channel."""

    context: Any
    namespace: str | None
    pod: str
    container: str | None
    command: list[str]
    stdin: str | bytes | None
    timeout: int
    impersonate_user: str | None
    impersonate_groups: list[str] | None
    max_output_bytes: int | None = None


class FakeExecChannel:
    """Replays scripted exec results and records every exec call.

    Sync on purpose: exec_in_pod is sync and the blocks reach it through
    asyncio.to_thread, so an async stub would never run.
    """

    def __init__(self, results: list[Any] | None = None) -> None:
        self.results: deque[Any] = deque(results or [])
        self.calls: list[ExecCall] = []
        self.factory: Any = None

    def __call__(
        self,
        context: Any,
        namespace: str | None,
        pod: str,
        container: str | None,
        command: list[str],
        stdin: str | bytes | None,
        timeout: int,
        *,
        impersonate_user: str | None = None,
        impersonate_groups: list[str] | None = None,
        max_output_bytes: int | None = None,
    ) -> tuple[str, str, int]:
        """Record the call and hand back the next scripted result, or raise it."""
        self.calls.append(
            ExecCall(
                context,
                namespace,
                pod,
                container,
                list(command),
                stdin,
                timeout,
                impersonate_user,
                impersonate_groups,
                max_output_bytes,
            )
        )
        if not self.results:
            raise AssertionError(
                f"FakeExecChannel has no scripted result for exec call {len(self.calls)}: "
                "queue one (stdout, stderr, exit_code) tuple or exception per expected exec"
            )
        item = self.results.popleft()
        if isinstance(item, Exception):
            raise item
        stdout, stderr, exit_code = item
        return stdout, stderr, exit_code

    @property
    def last(self) -> ExecCall:
        """The most recent recorded exec."""
        return self.calls[-1]


def patch_exec(channel: FakeExecChannel) -> Any:
    """Patch the exec-channel seam every K8s exec block calls."""
    importlib.import_module(EXEC_MODULE)  # a missing ws module must read as a missing module
    factory = MagicMock(side_effect=channel)
    channel.factory = factory
    return patch(EXEC_TARGET, factory)


STDOUT_TARGET = f"{EXEC_MODULE}.exec_stdout"


@dataclass
class StdoutCall:
    """One streamed exec recorded by the fake stdout stream."""

    context: Any
    namespace: str | None
    pod: str
    container: str | None
    command: list[str]
    timeout: float
    impersonate_user: str | None
    impersonate_groups: list[str] | None


class FakeExecStdout:
    """Scripts one ws.exec_stdout stream and stands in for the ExecStdout it yields."""

    def __init__(
        self,
        stdout: bytes = b"",
        stderr: str = "",
        exit_code: int = 0,
        *,
        chunk_size: int = 4096,
        open_error: Exception | None = None,
        read_error: Exception | None = None,
        read_error_at: int | None = None,
        finish_error: Exception | None = None,
        on_read: Callable[[int], None] | None = None,
    ) -> None:
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.chunk_size = chunk_size
        self.open_error = open_error
        # The stream breaks here: read and finish both raise read_error past this byte.
        self.read_error = read_error
        self.read_error_at = (
            len(stdout) if read_error_at is None else min(read_error_at, len(stdout))
        )
        self.finish_error = finish_error
        # Called with the bytes handed out so far, before every read.
        self.on_read = on_read
        self.calls: list[StdoutCall] = []
        self.handed_out = 0
        self.reads = 0
        self.requested: list[int] = []
        self.finish_calls = 0
        self.finished = False
        self.is_open = False
        self.closed = False

    def __call__(
        self,
        context: Any,
        namespace: str | None,
        pod: str,
        container: str | None,
        command: list[str],
        timeout: float,
        *,
        impersonate_user: str | None = None,
        impersonate_groups: list[str] | None = None,
    ) -> AbstractContextManager["FakeExecStdout"]:
        """Record the call and hand back the context manager that yields this stream."""
        self.calls.append(
            StdoutCall(
                context,
                namespace,
                pod,
                container,
                list(command),
                timeout,
                impersonate_user,
                impersonate_groups,
            )
        )
        if len(self.calls) > 1:
            raise AssertionError(
                f"FakeExecStdout scripts one stream, but exec_stdout was called {len(self.calls)} "
                "times: build one fake per expected exec"
            )
        return self._opened()

    @contextmanager
    def _opened(self) -> Iterator["FakeExecStdout"]:
        try:
            if self.open_error is not None:
                raise self.open_error
            self.is_open = True
            yield self
        finally:
            self.is_open = False
            self.closed = True

    def _require_open(self, action: str) -> None:
        if not self.is_open:
            raise AssertionError(
                f"FakeExecStdout.{action} was called outside the exec_stdout context"
            )

    def read(self, size: int = -1) -> bytes:
        """Up to size bytes of the scripted stdout (all that is left when negative)."""
        self._require_open("read")
        self.reads += 1
        self.requested.append(size)
        if self.on_read is not None:
            self.on_read(self.handed_out)
        end = self.read_error_at if self.read_error is not None else len(self.stdout)
        left = end - self.handed_out
        if left <= 0:
            if self.read_error is not None:
                raise self.read_error
            return b""
        take = left if size < 0 else min(size, self.chunk_size, left)
        piece = self.stdout[self.handed_out : self.handed_out + take]
        self.handed_out += take
        return piece

    def finish(self) -> tuple[str, int]:
        """The scripted (stderr, exit code), or the error the rest of the stream holds."""
        self._require_open("finish")
        self.finish_calls += 1
        if self.read_error is not None:
            raise self.read_error
        if self.finish_error is not None:
            raise self.finish_error
        self.finished = True
        return self.stderr, self.exit_code

    @property
    def last(self) -> StdoutCall:
        """The most recent recorded streamed exec."""
        return self.calls[-1]


def patch_exec_stdout(stream: FakeExecStdout) -> Any:
    """Patch the streaming seam a K8s Copy pull reads the pod's tar through."""
    importlib.import_module(EXEC_MODULE)  # a missing ws module must read as a missing module
    return patch(STDOUT_TARGET, stream)


@contextmanager
def patch_pull(stream: FakeExecStdout) -> Iterator[FakeExecChannel]:
    """Install the stream, plus an unscripted channel that fails any accumulate exec."""
    channel = FakeExecChannel()
    with patch_exec(channel), patch_exec_stdout(stream):
        yield channel


class RecordingLog:
    """Records the (level, message) pairs a sync verb writes through its log callable."""

    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.entries.append((level, message))

    @property
    def messages(self) -> list[str]:
        """Just the message halves, in order."""
        return [message for _level, message in self.entries]


def patch_verb_client(verb: str, client: FakeK8sClient) -> Any:
    """Patch one verb module's K8sClient so it constructs the fake."""
    factory = MagicMock(return_value=client)
    client.factory = factory
    return patch(f"wavecore.connectivity.k8s.verbs.{verb}.K8sClient", factory)
