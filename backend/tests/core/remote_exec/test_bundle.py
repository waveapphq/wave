"""
Remote Execution bundle-runtime builder contract tests (REQ-3.4.1.3).

build_bundle assembles the self-contained, pure-Python payload that a
Remote Execution container pushes over an SSH session and runs under a
remote interpreter. The bundle is a decoupled shim: it reads a JSON request
on stdin, dispatches to the referenced plugin's execute, and writes a JSON
response on stdout - never carrying pydantic or any compiled dependency, so
it runs under a bare host interpreter.
"""

import ast
import base64
import inspect
import json
import os
import queue
import shlex
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager, suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO, Any

import apsw
import certifi
import pytest

import wavecore
from tests.connectivity._proxy_servers import Proxy
from tests.core.remote_exec._vendorability import (
    import_sites,
    installed_root,
    is_stdlib,
    matches,
    module_listing,
    parses_at_the_floor,
    post_floor_names,
)
from tests.core.remote_exec.test_runner import local_probe
from tests.core.remote_exec.test_wheel_carry import tiny_wheel
from tests.plugins.http import tls_material
from wavecore.connectivity import k8s as k8s_package
from wavecore.core.remote_exec import bundle as bundle_module
from wavecore.core.remote_exec import runner
from wavecore.core.remote_exec.bundle import _vendored_sources, build_bundle, worker_bootstrap
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.remote_exec.runner import REMOTE_PYTHON_FLOOR
from wavecore.core.table import Table


class _EchoHandler(BaseHTTPRequestHandler):
    """Local test server: 200 with a JSON body, or 404 for /missing."""

    def do_GET(self) -> None:  # noqa: N802 - http.server contract
        if self.path == "/missing":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args: Any) -> None:  # silence the test server
        pass


class _CaptureHandler(BaseHTTPRequestHandler):
    """Echoes the received method, header pairs, and body back as JSON."""

    def do_GET(self) -> None:  # noqa: N802 - http.server contract
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        payload = json.dumps(
            {
                "method": self.command,
                "path": self.path,
                "header_pairs": [[key, value] for key, value in self.headers.items()],
                "body": body,
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: Any) -> None:  # silence the test server
        pass


@contextmanager
def _serve(handler: type[BaseHTTPRequestHandler]) -> Iterator[int]:
    """Serve ``handler`` on an ephemeral local port for one test."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        thread.join()


def _run_bundle(request: dict[str, Any], *, isolated: bool = False) -> dict[str, Any]:
    """Run the bundle under a bare interpreter (as a remote host would) and
    return its JSON response - the real end-to-end path, no SSH, no mocks.

    Mirrors the runner: the vendored payload rides stdin (byte-count line then
    source) behind the tiny bootstrap, then the request line, whose answer is
    read before stdin closes.
    ``isolated`` adds -S so host site-packages can never mask a vendoring gap.
    """
    [response] = _run_bundle_lines([request], isolated=isolated)
    return response


# Source rewrites applied to the emitted worker before it runs. Registering a
# purpose-built plugin in the test keeps test-only code out of the production
# bundle; no shipped plugin imports on demand or returns an unserializable value.
_IMPORT_PROBE = (
    "_PLUGINS = {",
    '_PLUGINS = {"import-probe": lambda params, variables, logs: '
    '[__import__(name, {}, {}, ["*"]).__name__ for name in params["modules"]], ',
)
_UNSERIALIZABLE_PLUGIN = (
    "_PLUGINS = {",
    '_PLUGINS = {"boom": lambda params, variables, logs: '
    '(logs.append({"level": "INFO", "message": "before the bad return"}), '
    '{"names": set()})[1], ',
)

_LOGGER_PROBE = (
    "_PLUGINS = {",
    '_PLUGINS = {"logger-probe": lambda params, variables, logs: '
    '[_logger(logs)(line[0], line[1]) for line in params["lines"]], ',
)

_REGISTRY_PROBE = (
    "_PLUGINS = {",
    '_PLUGINS = {"registry-probe": lambda params, variables, logs: '
    'sorted(name for name in _PLUGINS if name != "registry-probe"), ',
)

_FILE_PROBE = (
    "_PLUGINS = {",
    '_PLUGINS = {"file-probe": lambda params, variables, logs: '
    '[__import__(name, {}, {}, ["*"]).__file__ for name in params["modules"]], ',
)

# An empty module imports without error, so the probe also reads the library's version.
_SQLITE_BUILD_PROBE = (
    "_PLUGINS = {",
    '_PLUGINS = {"sqlite-build-probe": lambda params, variables, logs: '
    '[__import__("apsw").__file__, __import__("apsw").sqlitelibversion()], ',
)

_K8S_WRITE_VERB_MODULES = [
    "wavecore.connectivity.k8s.verbs._manifest",
    "wavecore.connectivity.k8s.verbs.apply",
    "wavecore.connectivity.k8s.verbs.delete",
    "wavecore.connectivity.k8s.verbs.scale",
    "wavecore.connectivity.k8s.verbs.rollout",
    "wavecore.connectivity.k8s.verbs.exec",
    "wavecore.connectivity.k8s.verbs.script",
    "wavecore.connectivity.k8s.verbs.cp",
]
_K8S_CORE_MODULES = [
    "wavecore.connectivity.k8s.rest",
    "wavecore.connectivity.k8s.ws",
    "wavecore.connectivity.k8s.verbs.connect",
    "wavecore.connectivity.k8s.verbs.get",
    "wavecore.connectivity.k8s.verbs.events",
    "wavecore.connectivity.k8s.verbs.logs",
    "wavecore.connectivity.k8s.verbs.top",
    *_K8S_WRITE_VERB_MODULES,
]
_K8S_PLUGIN_IDS = [
    "k8s-connect",
    "k8s-get",
    "k8s-events",
    "k8s-logs",
    "k8s-top",
    "k8s-apply",
    "k8s-delete",
    "k8s-scale",
    "k8s-rollout",
    "k8s-exec",
    "k8s-script",
    "k8s-copy",
]
_HELM_CORE_MODULES = [
    "wavecore.connectivity.helm._cli",
    "wavecore.connectivity.helm.verbs.install",
    "wavecore.connectivity.helm.verbs.upgrade",
    "wavecore.connectivity.helm.verbs.rollback",
    "wavecore.connectivity.helm.verbs.uninstall",
    "wavecore.connectivity.helm.verbs.test",
    "wavecore.connectivity.helm.verbs.status",
]
_HELM_PLUGIN_IDS = [
    "helm-install",
    "helm-upgrade",
    "helm-rollback",
    "helm-uninstall",
    "helm-test",
    "helm-status",
]
_FILE_IO_MODULE = "wavecore.plugins._file_ops"
_LAUNCHER_MODULE = "wavecore.plugins._process_group"
_NETCAT_CORE = "wavecore.plugins._netcat_core"
_PORTS = "wavecore.plugins._ports"
_PLURAL = "wavecore.plugins._plural"
_NETCAT_MODULES = [_NETCAT_CORE, _PORTS]
_NETCAT_WAVECORE_IMPORTS = {
    _PORTS,
    _PLURAL,
    "wavecore.connectivity.k8s.verbs._outputs",
    "wavecore.plugins._tls_material",
}
_NETCAT_IMPORT_LINE = "from wavecore.plugins import _netcat_core as netcat_core"
_NETCAT_ENTRY = (
    '"netcat": lambda params, variables, logs: '
    "asyncio.run(netcat_core.run(params, _logger(logs))),"
)
_POST_FLOOR_NAMES = frozenset(
    {
        "asyncio.TaskGroup",
        "asyncio.timeout",
        "datetime.UTC",
        "enum.StrEnum",
        "hashlib.file_digest",
        "itertools.batched",
        "tomllib",
        "typing.Self",
        "typing.override",
    }
)
_BUNDLE_PLUGIN_IDS = [
    "http-client",
    "file-io",
    "python",
    "netcat",
    "ping",
    "sql-client",
    "opensearch",
    *_K8S_PLUGIN_IDS,
    *_HELM_PLUGIN_IDS,
]
_SQL_PACKAGE = "wavecore.connectivity.sql"
_SQL_DIALECTS = [
    f"{_SQL_PACKAGE}.dialects.{name}" for name in ("postgres", "mysql", "oracle", "mssql", "sqlite")
]
_SQL_DRIVER_SOURCES = ["pg8000", "scramp", "asn1crypto", "dateutil", "pymysql", "pytds"]
_SQL_CARRIED_UNITS = [
    *_SQL_DRIVER_SOURCES,
    _SQL_PACKAGE,
    "wavecore.plugins._sql_core",
    "wavecore.plugins._tls_material",
]
_SQL_IMPORTS = [
    "pg8000",
    "pymysql",
    "pytds",
    "scramp",
    "asn1crypto",
    "dateutil",
    _SQL_PACKAGE,
    f"{_SQL_PACKAGE}.dialects",
    *_SQL_DIALECTS,
    "wavecore.plugins._sql_core",
]
_OPENSEARCH_PACKAGE = "wavecore.connectivity.opensearch"
_OPENSEARCH_CORE = "wavecore.plugins._opensearch_core"
_TLS_CONTEXT = "wavecore.connectivity.tls_context"
_URL_CREDENTIALS = "wavecore.connectivity.url_credentials"
_HELD_RUN = "wavecore.plugins._held_run"
_OPENSEARCH_CARRIED_UNITS = [
    _OPENSEARCH_PACKAGE,
    _TLS_CONTEXT,
    _URL_CREDENTIALS,
    _HELD_RUN,
    _OPENSEARCH_CORE,
]
_OPENSEARCH_IMPORTS = [
    _TLS_CONTEXT,
    _URL_CREDENTIALS,
    _HELD_RUN,
    _OPENSEARCH_PACKAGE,
    f"{_OPENSEARCH_PACKAGE}.dql",
    _OPENSEARCH_CORE,
]
_OPENSEARCH_IMPORT_LINE = "from wavecore.plugins import _opensearch_core as opensearch_core"
_OPENSEARCH_ENTRY = (
    '"opensearch": lambda params, variables, logs: ' "opensearch_core.run(params, _logger(logs)),"
)

# The most one worker run may take before the harness gives up on it.
_WORKER_RUN_TIMEOUT_S = 60


def _pump(stream: IO[bytes], lines: queue.Queue[bytes]) -> None:
    """Forward each line the worker writes, then b"" once its output ends."""
    for line in stream:
        lines.put(line)
    lines.put(b"")


def _time_left(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())


def _run_bundle_lines(
    requests: list[dict[str, Any]],
    *,
    isolated: bool = False,
    source_patch: tuple[str, str] | None = None,
    frames: Sequence[str] = (),
    command: Sequence[str] | None = None,
    env: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Feed N request lines to ONE worker process and return its N responses.

    The sibling of _run_bundle for anything a single response cannot express -
    chiefly that the worker is still answering after a bad request.
    ``source_patch`` rewrites the emitted worker source once before it runs.
    ``frames`` are lines the worker answers nothing to, written ahead of the requests.
    ``command`` starts the worker in place of the bare bootstrap; ``env`` is its environment.
    """
    payload = build_bundle("http-client")
    if source_patch is not None:
        old, new = source_patch
        text = payload.decode("utf-8")
        assert old in text
        payload = text.replace(old, new, 1).encode("utf-8")
    interpreter = [sys.executable, "-S"] if isolated else [sys.executable]
    deadline = time.monotonic() + _WORKER_RUN_TIMEOUT_S
    with tempfile.TemporaryFile() as stderr:
        proc = subprocess.Popen(
            command or [*interpreter, "-c", worker_bootstrap()],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr,
            env=env,
        )
        assert proc.stdin is not None and proc.stdout is not None
        lines: queue.Queue[bytes] = queue.Queue()
        threading.Thread(target=_pump, args=(proc.stdout, lines), daemon=True).start()
        received: list[bytes] = []
        try:
            # The runner's order: one request at a time, its answer read before stdin closes.
            with suppress(BrokenPipeError):
                proc.stdin.write(f"{len(payload)}\n".encode() + payload)
                for frame in frames:
                    proc.stdin.write(frame.encode("utf-8"))
                for request in requests:
                    proc.stdin.write((json.dumps(request) + "\n").encode())
                    proc.stdin.flush()
                    received.append(lines.get(timeout=_time_left(deadline)))
                    if not received[-1]:
                        break
            with suppress(BrokenPipeError):
                proc.stdin.close()
            while received[-1:] != [b""]:
                received.append(lines.get(timeout=_time_left(deadline)))
            proc.stdout.close()
            proc.wait(timeout=_time_left(deadline))
        finally:
            with suppress(BrokenPipeError):
                proc.stdin.close()
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        stderr.seek(0)
        assert proc.returncode == 0, stderr.read().decode()
    return [json.loads(line) for line in received if line.strip()]


class TestBundleExecution:
    """The emitted bundle actually runs HTTP under a bare python3 interpreter."""

    def test_bundle_runs_http_get_and_returns_the_response(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {"method": "GET", "url": f"http://127.0.0.1:{port}/health"},
                    "variables": {},
                }
            )
        finally:
            server.shutdown()
            thread.join()

        assert response["status"] == "passed"
        assert response["return_value"]["status_code"] == 200
        assert response["return_value"]["body"] == '{"ok": true}'
        assert any("HTTP 200" in entry["message"] for entry in response["logs"])

    def test_bundle_runs_without_host_site_packages(self) -> None:
        """Every vendored import must ride the bundle: six went missing on bare hosts."""
        server = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {"method": "GET", "url": f"http://127.0.0.1:{port}/health"},
                    "variables": {},
                },
                isolated=True,
            )
        finally:
            server.shutdown()
            thread.join()

        assert response["status"] == "passed"
        assert response["return_value"]["status_code"] == 200

    def test_the_k8s_core_imports_without_host_site_packages(self) -> None:
        """The Kubernetes REST core, the exec channel and every read verb resolve
        from the vendored source table alone - the host supplies nothing."""
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _K8S_CORE_MODULES}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _K8S_CORE_MODULES

    def test_bundle_surfaces_an_http_error_status(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {"method": "GET", "url": f"http://127.0.0.1:{port}/missing"},
                    "variables": {},
                }
            )
        finally:
            server.shutdown()
            thread.join()

        assert response["status"] == "passed"
        assert response["return_value"]["status_code"] == 404
        assert response["return_value"]["body"] == "not found"

    def test_bundle_reports_an_unknown_plugin_as_failed(self) -> None:
        response = _run_bundle({"plugin_id": "sql", "params": {}, "variables": {}})

        assert response["status"] == "failed"
        assert "sql" in response["error"]
        assert "not available in the remote bundle" in response["error"]


class TestBundleHelmRegistration:
    """The Helm core rides the payload and all six Helm blocks dispatch inside it."""

    def test_the_helm_core_imports_without_host_site_packages(self) -> None:
        """The runner and the six verbs resolve from the vendored source table alone."""
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _HELM_CORE_MODULES}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _HELM_CORE_MODULES

    def test_every_helm_module_is_keyed_by_its_full_dotted_name(self) -> None:
        bundle = build_bundle("http-client")

        for name in _HELM_CORE_MODULES:
            assert f"'{name}'".encode() in bundle, name

    def test_every_helm_plugin_id_dispatches(self) -> None:
        """A registered id never reports the unknown-plugin error, whatever helm
        would have answered."""
        responses = _run_bundle_lines(
            [
                {"plugin_id": plugin_id, "params": {}, "variables": {}}
                for plugin_id in _HELM_PLUGIN_IDS
            ],
            isolated=True,
        )

        assert len(responses) == len(_HELM_PLUGIN_IDS)
        for plugin_id, response in zip(_HELM_PLUGIN_IDS, responses, strict=True):
            assert response["error"], plugin_id
            assert "not available in the remote bundle" not in response["error"], plugin_id

    def test_the_worker_names_the_execution_host_for_the_missing_helm_row(self) -> None:
        """The remote wording needs a host name; the worker supplies its own."""
        text = build_bundle("http-client").decode("utf-8")

        assert "REMOTE_HOST" in text
        assert "socket.gethostname()" in text


class TestBundleFileIORegistration:
    """The stdlib File I/O core rides the payload and answers on the host's own files."""

    def test_the_file_ops_module_is_keyed_by_its_full_dotted_name(self) -> None:
        bundle = build_bundle("http-client")

        assert f"'{_FILE_IO_MODULE}'".encode() in bundle

    def test_the_worker_imports_the_core_under_the_file_ops_alias(self) -> None:
        text = build_bundle("http-client").decode("utf-8")

        assert "from wavecore.plugins import _file_ops as file_ops" in text

    def test_the_dispatch_entry_runs_the_core_with_the_bundle_logger(self) -> None:
        text = build_bundle("http-client").decode("utf-8")

        assert '"file-io": lambda params, variables, logs: file_ops.run(params, _logger(logs))' in (
            text
        )

    def test_the_file_ops_module_imports_without_host_site_packages(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": [_FILE_IO_MODULE]}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == [_FILE_IO_MODULE]

    def test_a_read_round_trips_through_the_built_bundle(self, tmp_path: Path) -> None:
        source = tmp_path / "notes.txt"
        source.write_text("host side\n", encoding="utf-8")

        response = _run_bundle(
            {
                "plugin_id": "file-io",
                "params": {"operation": "read", "path": str(source)},
                "variables": {},
            },
            isolated=True,
        )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["__wave_type"] == "result"
        assert response["return_value"]["outputs"] == {"content": "host side\n"}

    def test_a_write_round_trips_through_the_built_bundle(self, tmp_path: Path) -> None:
        target = tmp_path / "made" / "out.txt"

        response = _run_bundle(
            {
                "plugin_id": "file-io",
                "params": {"operation": "write", "path": str(target), "content": "written\n"},
                "variables": {},
            },
            isolated=True,
        )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["__wave_type"] == "result"
        assert response["return_value"]["outputs"] == {}
        assert target.read_text(encoding="utf-8") == "written\n"

    def test_a_missing_file_reports_the_exact_message(self, tmp_path: Path) -> None:
        absent = tmp_path / "gone.txt"

        response = _run_bundle(
            {
                "plugin_id": "file-io",
                "params": {"operation": "read", "path": str(absent)},
                "variables": {},
            },
            isolated=True,
        )

        assert response["status"] == "failed"
        assert response["error"] == f"File not found: {absent}"

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    @pytest.mark.parametrize("operation", ["read", "write"])
    def test_a_wave_side_scheme_is_refused_on_the_remote_host(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scheme: str, operation: str
    ) -> None:
        monkeypatch.chdir(tmp_path)
        params = {"operation": operation, "path": f"{scheme}out/x.txt", "content": "x"}

        response = _run_bundle(
            {"plugin_id": "file-io", "params": params, "variables": {}}, isolated=True
        )

        assert response["status"] == "failed"
        assert response["error"] == (
            f"{scheme} paths are not available on the remote host - "
            "use an absolute or relative path on the remote host"
        )
        assert list(tmp_path.iterdir()) == []

    def test_a_relative_path_resolves_against_the_folder_the_worker_starts_in(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = tmp_path / "home"
        home.mkdir()
        monkeypatch.chdir(home)

        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "file-io",
                    "params": {"operation": "write", "path": "notes/in.txt", "content": "here\n"},
                    "variables": {},
                },
                {
                    "plugin_id": "file-io",
                    "params": {
                        "operation": "copy",
                        "source": "notes/in.txt",
                        "destination": "../out.txt",
                    },
                    "variables": {},
                },
            ],
            isolated=True,
        )

        assert [response["status"] for response in responses] == ["passed", "passed"]
        assert (home / "notes" / "in.txt").read_text(encoding="utf-8") == "here\n"
        assert (tmp_path / "out.txt").read_text(encoding="utf-8") == "here\n"

    def test_a_parent_segment_through_a_missing_folder_is_normalized_first(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)

        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "file-io",
                    "params": {"operation": "write", "path": "made/../out.txt", "content": "x\n"},
                    "variables": {},
                },
                {
                    "plugin_id": "file-io",
                    "params": {"operation": "read", "path": "gone/../out.txt"},
                    "variables": {},
                },
            ],
            isolated=True,
        )

        assert [response["status"] for response in responses] == ["passed", "passed"], [
            response["error"] for response in responses
        ]
        assert responses[1]["return_value"]["outputs"] == {"content": "x\n"}
        assert sorted(entry.name for entry in tmp_path.iterdir()) == ["out.txt"]


def _module_source(dotted: str) -> str:
    """A wavecore module's source read from disk by its dotted name, never imported."""
    relative = Path(*dotted.split(".")[1:]).with_suffix(".py")
    return (Path(str(wavecore.__file__)).parent / relative).read_text(encoding="utf-8")


def _unvendorable_imports(source: str, allowed: set[str]) -> set[str]:
    """Every name the source imports that is neither standard library nor in `allowed`."""
    offending: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            targets = [(alias.name, alias.name) for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            targets = [(module, f"{module}.{alias.name}") for alias in node.names]
        else:
            continue
        for module, target in targets:
            stdlib = module.split(".")[0] in sys.stdlib_module_names
            if not (stdlib or module in allowed or target in allowed):
                offending.add(target)
    return offending


def _post_floor_names(source: str) -> set[str]:
    """The past-the-floor stdlib names the source reads, by import or by dotted attribute."""
    read: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            read |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            read |= {f"{node.module}.{alias.name}" for alias in node.names}
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            read.add(f"{node.value.id}.{node.attr}")
    return read & _POST_FLOOR_NAMES


class TestBundleNetcatRegistration:
    """The stdlib Netcat core and its port check ride the payload (NETCAT-11, REQ-3.4.1.9)."""

    @pytest.mark.parametrize("module", _NETCAT_MODULES)
    def test_the_module_is_keyed_by_its_full_dotted_name(self, module: str) -> None:
        assert f"'{module}'".encode() in build_bundle("http-client")

    @pytest.mark.parametrize("module", _NETCAT_MODULES)
    def test_the_module_rides_as_its_source_on_disk(self, module: str) -> None:
        sources = _vendored_sources()

        assert module in sources
        assert sources[module] == _module_source(module)

    def test_the_worker_imports_the_core_on_a_line_of_its_own(self) -> None:
        lines = build_bundle("http-client").decode("utf-8").splitlines()

        assert _NETCAT_IMPORT_LINE in lines

    def test_the_dispatch_entry_runs_the_core_under_asyncio_with_the_bundle_logger(self) -> None:
        assert _NETCAT_ENTRY in build_bundle("http-client").decode("utf-8")

    def test_the_module_docstring_names_the_netcat_core(self) -> None:
        assert _NETCAT_CORE in (bundle_module.__doc__ or "")

    def test_the_netcat_modules_import_without_host_site_packages(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _NETCAT_MODULES}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _NETCAT_MODULES

    def test_a_check_round_trips_through_the_built_bundle(self) -> None:
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            port = server.getsockname()[1]
            params = {"host": "127.0.0.1", "port": port, "timeout": 1}
            response = _run_bundle(
                {"plugin_id": "netcat", "params": params, "variables": {}}, isolated=True
            )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["__wave_type"] == "result"
        outputs = materialize(response["return_value"])
        results = outputs["results"]
        assert isinstance(results, Table)
        assert results.row_count() == 1
        *cells, time_ms = results.row(0).to_list()
        assert cells == [port, "tcp", "open", ""]
        assert isinstance(time_ms, int) and not isinstance(time_ms, bool)
        assert outputs["success"] is True


class TestTheNetcatCoreStaysVendorable:
    """Both modules are copied verbatim onto a host whose floor is Python 3.10."""

    def test_the_core_imports_only_the_stdlib_and_the_carried_cores(self) -> None:
        source = _module_source(_NETCAT_CORE)

        assert _unvendorable_imports(source, _NETCAT_WAVECORE_IMPORTS) == set()

    def test_the_port_check_imports_only_the_stdlib(self) -> None:
        assert _unvendorable_imports(_module_source(_PORTS), set()) == set()

    @pytest.mark.parametrize("module", _NETCAT_MODULES)
    def test_the_module_makes_no_relative_import(self, module: str) -> None:
        tree = ast.parse(_module_source(module))

        assert [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level] == []

    @pytest.mark.parametrize("module", _NETCAT_MODULES)
    def test_the_module_reads_no_name_past_the_interpreter_floor(self, module: str) -> None:
        assert _post_floor_names(_module_source(module)) == set()

    @pytest.mark.parametrize("module", _NETCAT_MODULES)
    def test_the_module_parses_at_the_interpreter_floor(self, module: str) -> None:
        ast.parse(_module_source(module), feature_version=REMOTE_PYTHON_FLOOR)

    def test_the_core_never_names_the_builtin_timeout_error(self) -> None:
        """On the 3.10 floor asyncio.TimeoutError is not the builtin TimeoutError."""
        tree = ast.parse(_module_source(_NETCAT_CORE))

        builtin = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Name) and node.id == "TimeoutError"
        ]
        assert builtin == []


class TestBundleCountWordingVendoring:
    """The count wording the carried cores share rides the payload as its source on disk."""

    def test_the_module_rides_under_its_dotted_name_as_its_source_on_disk(self) -> None:
        assert _vendored_sources().get(_PLURAL) == _module_source(_PLURAL)


def _carried_unit_root(unit: str) -> Path | None:
    """Where a carried unit lives on disk: a wavecore package or module, or an installed package."""
    if not unit.startswith("wavecore."):
        return installed_root(unit)
    target = Path(str(wavecore.__file__)).parent.joinpath(*unit.split(".")[1:])
    return target if target.is_dir() else target.with_suffix(".py")


class TestBundleSqlVendoring:
    """The SQL drivers carried as source, the SQL package and its core ride the payload."""

    @pytest.mark.parametrize("unit", _SQL_CARRIED_UNITS)
    def test_every_module_rides_under_its_dotted_name_as_its_source_on_disk(
        self, unit: str
    ) -> None:
        root = _carried_unit_root(unit)
        assert root is not None and root.exists(), f"{unit} is not on disk"
        listing = module_listing(unit, root)
        sources = _vendored_sources()

        drifted = [
            dotted
            for dotted, path in listing
            if sources.get(dotted) != path.read_text(encoding="utf-8")
        ]

        assert listing
        assert drifted == []

    def test_the_sql_modules_import_without_host_site_packages(self) -> None:
        """Every dialect imports on a host that carries no driver of its own."""
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _SQL_IMPORTS}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _SQL_IMPORTS

    def test_the_worker_holds_its_started_groups_on_the_shared_launcher(self) -> None:
        lines = [line.strip() for line in build_bundle("http-client").decode("utf-8").splitlines()]

        assert "_process_group.RUNNING.set(_started)" in lines


class TestBundleOpensearchVendoring:
    """The OpenSearch REST core, its DQL translator and the block core ride along (REQ-5.1.2)."""

    @pytest.mark.parametrize("unit", _OPENSEARCH_CARRIED_UNITS)
    def test_every_module_rides_under_its_dotted_name_as_its_source_on_disk(
        self, unit: str
    ) -> None:
        root = _carried_unit_root(unit)
        assert root is not None and root.exists(), f"{unit} is not on disk"
        listing = module_listing(unit, root)
        sources = _vendored_sources()

        drifted = [
            dotted
            for dotted, path in listing
            if sources.get(dotted) != path.read_text(encoding="utf-8")
        ]

        assert listing
        assert drifted == []

    def test_the_package_rides_whole_with_its_dql_translator(self) -> None:
        sources = _vendored_sources()

        assert f"{_OPENSEARCH_PACKAGE}.dql" in sources
        assert f"{_OPENSEARCH_PACKAGE}.dql._translate" in sources

    def test_the_opensearch_modules_import_without_host_site_packages(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _OPENSEARCH_IMPORTS}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _OPENSEARCH_IMPORTS

    def test_the_worker_imports_the_core_on_a_line_of_its_own(self) -> None:
        lines = build_bundle("http-client").decode("utf-8").splitlines()

        assert _OPENSEARCH_IMPORT_LINE in lines

    def test_the_dispatch_entry_runs_the_core_with_the_bundle_logger(self) -> None:
        assert _OPENSEARCH_ENTRY in build_bundle("http-client").decode("utf-8")

    def test_the_query_dsl_vocabulary_stays_on_wave(self) -> None:
        """The editor's API spec extract is WAVE-side data: no wavecore.api source travels."""
        sources = _vendored_sources()

        assert [name for name in sources if name.startswith("wavecore.api")] == []
        assert b"api-spec-extract" not in build_bundle("http-client")


class TestBundleWheelCarry:
    """A compiled driver arrives as a wheel line, unpacks into the worker's own scratch folder,
    imports from there, and leaves with the worker (SQL-15)."""

    def test_a_pushed_wheel_imports_from_the_worker_scratch_folder(self, tmp_path: Path) -> None:
        wheel = tiny_wheel(tmp_path / "wave_probe_pkg-1.0-py3-none-any.whl", body="VALUE = 1\n")

        responses = _run_bundle_lines(
            [{"plugin_id": "file-probe", "params": {"modules": ["wave_probe_pkg"]}}],
            isolated=True,
            source_patch=_FILE_PROBE,
            frames=[runner.wheel_frame([wheel])],
        )

        assert len(responses) == 1
        assert responses[0]["status"] == "passed", responses[0]["error"]
        [module_file] = responses[0]["return_value"]
        package_dir = Path(module_file).parent
        assert package_dir.name == "wave_probe_pkg"
        assert package_dir.parent.name == "wheels"
        assert package_dir.parent.parent.name.startswith("wave-worker-")

    def test_the_scratch_folder_is_gone_once_the_worker_stops(self, tmp_path: Path) -> None:
        wheel = tiny_wheel(tmp_path / "wave_probe_pkg-1.0-py3-none-any.whl")

        [response] = _run_bundle_lines(
            [{"plugin_id": "file-probe", "params": {"modules": ["wave_probe_pkg"]}}],
            isolated=True,
            source_patch=_FILE_PROBE,
            frames=[runner.wheel_frame([wheel])],
        )

        scratch = Path(response["return_value"][0]).parents[2]
        assert scratch.name.startswith("wave-worker-")
        assert not scratch.exists()

    def test_the_worker_keeps_answering_after_a_wheel_line(self, tmp_path: Path) -> None:
        wheel = tiny_wheel(tmp_path / "wave_probe_pkg-1.0-py3-none-any.whl")

        responses = _run_bundle_lines(
            [
                {"plugin_id": "import-probe", "params": {"modules": ["json"]}},
                {"plugin_id": "import-probe", "params": {"modules": ["wave_probe_pkg"]}},
            ],
            isolated=True,
            source_patch=_IMPORT_PROBE,
            frames=[runner.wheel_frame([wheel])],
        )

        assert [response["return_value"] for response in responses] == [
            ["json"],
            ["wave_probe_pkg"],
        ]

    def test_the_real_oracle_wheels_for_this_interpreter_import_without_site_packages(
        self,
    ) -> None:
        """A missing cache fails here naming scripts/fetch-remote-wheels.sh; it never skips."""
        paths = runner.select_wheels(local_probe(), "oracle", "localhost")

        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": ["oracledb"]}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
            frames=[runner.wheel_frame(paths)],
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == ["oracledb"]

    def test_the_real_sqlite_build_for_this_interpreter_loads_without_site_packages(
        self,
    ) -> None:
        """A missing cache fails here naming scripts/fetch-remote-wheels.sh; it never skips."""
        paths = runner.select_wheels(local_probe(), "sqlite", "localhost")

        # Starts a child Python.
        [response] = _run_bundle_lines(
            [{"plugin_id": "sqlite-build-probe", "params": {}}],
            isolated=True,
            source_patch=_SQLITE_BUILD_PROBE,
            frames=[runner.wheel_frame(paths)],
        )

        assert response["status"] == "passed", response["error"]
        module_file, version = response["return_value"]
        package_dir = Path(module_file).parent
        assert (package_dir.name, package_dir.parent.name) == ("apsw", "wheels")
        assert package_dir.parent.parent.name.startswith("wave-worker-")
        assert version == apsw.sqlitelibversion()


class TestBundleWorkerUtf8Mode:
    """The worker's text and file names are UTF-8 whatever its host's locale (REQ-4.6.9)."""

    def test_non_ascii_text_comes_back_unchanged_on_a_host_that_is_not_utf8(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        text = "Grüße 測試"
        target = tmp_path / f"{text}.txt"
        write = {"operation": "write", "path": str(target), "content": text}
        read = {"operation": "read", "path": str(target)}

        # Starts a child Python with the command the runner sends a remote host.
        responses = _run_bundle_lines(
            [
                {"plugin_id": "file-io", "params": write, "variables": {}},
                {"plugin_id": "file-io", "params": read, "variables": {}},
            ],
            command=shlex.split(runner._worker_command(shlex.quote(sys.executable))),
            env=non_utf8_child_env,
        )

        assert [response["status"] for response in responses] == ["passed", "passed"], [
            response["error"] for response in responses
        ]
        assert responses[1]["return_value"]["outputs"] == {"content": text}
        assert os.listdir(os.fsencode(tmp_path)) == [f"{text}.txt".encode()]


class TestBundleK8sRegistration:
    """All twelve Kubernetes blocks dispatch inside the bundle."""

    def test_every_k8s_plugin_id_dispatches(self) -> None:
        """One worker answers all twelve: a registered id never reports the
        unknown-plugin error, whatever the cluster answer would have been."""
        responses = _run_bundle_lines(
            [
                {"plugin_id": plugin_id, "params": {}, "variables": {}}
                for plugin_id in _K8S_PLUGIN_IDS
            ],
            isolated=True,
        )

        assert len(responses) == len(_K8S_PLUGIN_IDS)
        for plugin_id, response in zip(_K8S_PLUGIN_IDS, responses, strict=True):
            # Each id answers for itself: a verb that kills the worker takes the rest with it.
            assert response["error"], plugin_id
            assert "not available in the remote bundle" not in response["error"], plugin_id

    def test_an_unregistered_id_reports_the_exact_message(self) -> None:
        """%r quotes a string id and renders a missing one as a bare None."""
        responses = _run_bundle_lines(
            [
                {"plugin_id": "sql", "params": {}, "variables": {}},
                {"params": {}, "variables": {}},
            ]
        )

        assert responses[0]["error"] == "Plugin 'sql' is not available in the remote bundle"
        assert responses[1]["error"] == "Plugin None is not available in the remote bundle"


class TestBundleDispatchKeys:
    """The registry is keyed by canvas element type, not by plugin metadata id."""

    def test_the_registry_holds_exactly_the_twenty_five_element_types(self) -> None:
        """The worker's keys are the twenty-five canvas element types, SQL and OpenSearch too."""
        from wavecore.api.services.tests.service import KNOWN_PLUGIN_IDS

        responses = _run_bundle_lines(
            [{"plugin_id": "registry-probe", "params": {}, "variables": {}}],
            source_patch=_REGISTRY_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == sorted(_BUNDLE_PLUGIN_IDS)
        assert set(_BUNDLE_PLUGIN_IDS) <= KNOWN_PLUGIN_IDS


class TestBundleVerbLogging:
    """A verb logs through a two-argument callable; the worker turns each call
    into the log record the run replays."""

    def test_the_log_callable_appends_level_and_message_records(self) -> None:
        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "logger-probe",
                    "params": {
                        "lines": [
                            ["INFO", "Read 3 ConfigMap object(s) from /api/v1/configmaps"],
                            ["WARN", "Read failed (NotFound): K8s ConfigMap 'cm' not found"],
                        ]
                    },
                    "variables": {},
                }
            ],
            source_patch=_LOGGER_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["logs"] == [
            {"level": "INFO", "message": "Read 3 ConfigMap object(s) from /api/v1/configmaps"},
            {"level": "WARN", "message": "Read failed (NotFound): K8s ConfigMap 'cm' not found"},
        ]

    def test_a_non_string_message_is_coerced(self) -> None:
        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "logger-probe",
                    "params": {"lines": [["INFO", 42]]},
                    "variables": {},
                }
            ],
            source_patch=_LOGGER_PROBE,
        )

        assert responses[0]["logs"] == [{"level": "INFO", "message": "42"}]


_K8S_NOT_FOUND_BODY = {
    "kind": "Status",
    "apiVersion": "v1",
    "status": "Failure",
    "message": 'configmaps "missing-cm" not found',
    "reason": "NotFound",
    "details": {"name": "missing-cm", "kind": "configmaps"},
    "code": 404,
}


class _K8sNotFoundHandler(BaseHTTPRequestHandler):
    """A fake apiserver: ConfigMap discovery succeeds, the named read 404s."""

    def do_GET(self) -> None:  # noqa: N802 - http.server contract
        if self.path == "/api/v1":
            self._send(
                200,
                {
                    "kind": "APIResourceList",
                    "groupVersion": "v1",
                    "resources": [
                        {
                            "name": "configmaps",
                            "singularName": "",
                            "namespaced": True,
                            "kind": "ConfigMap",
                            "verbs": ["get", "list"],
                            "shortNames": ["cm"],
                        }
                    ],
                },
            )
            return
        self._send(404, _K8S_NOT_FOUND_BODY)

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args: Any) -> None:  # silence the test server
        pass


_K8S_TYPED_PATCH_BODY = {
    "kind": "Status",
    "apiVersion": "v1",
    "status": "Failure",
    "message": (
        "failed to create typed patch object "
        "(default/demo-cm; /v1, Kind=ConfigMap): .data.count: "
        "expected string, got &value.valueUnstructured{Value:1}"
    ),
    "details": {},
    "code": 500,
}


class _K8sTypedPatchHandler(_K8sNotFoundHandler):
    """The same fake apiserver, refusing every server-side apply with a 500."""

    def do_PATCH(self) -> None:  # noqa: N802 - http.server contract
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._send(500, _K8S_TYPED_PATCH_BODY)


class TestBundleMessageParity:
    """A cluster refusal reads the same wherever the block ran: the verb core is
    the same source on both loci, so the worker's error is the local text."""

    def test_a_mapped_api_error_crosses_the_worker_unchanged(self) -> None:
        from wavecore.connectivity.k8s.verbs._context import K8sContext, serialize_context
        from wavecore.connectivity.k8s.verbs._errors import map_api_error

        expected = map_api_error(
            404, _K8S_NOT_FOUND_BODY, "ConfigMap", "missing-cm", "default", verb="read"
        )

        with _serve(_K8sNotFoundHandler) as port:
            session = serialize_context(
                K8sContext(server=f"http://127.0.0.1:{port}", namespace="default")
            )
            response = _run_bundle(
                {
                    "plugin_id": "k8s-get",
                    "params": {
                        "session": session,
                        "kind": "ConfigMap",
                        "name": "missing-cm",
                        "namespace": "default",
                        "on_error": "fail",
                    },
                    "variables": {},
                }
            )

        assert response["status"] == "failed"
        assert response["error"] == expected

    def test_a_typed_patch_rejection_crosses_the_worker_unchanged(self) -> None:
        """A manifest the cluster refuses reads the same remotely as it does locally."""
        from wavecore.connectivity.k8s.verbs._context import K8sContext, serialize_context
        from wavecore.connectivity.k8s.verbs._errors import map_api_error

        document = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": "demo-cm"},
            "data": {"count": 1},
        }
        expected = map_api_error(
            500, _K8S_TYPED_PATCH_BODY, "ConfigMap", "demo-cm", "default", verb="apply"
        )

        with _serve(_K8sTypedPatchHandler) as port:
            context = K8sContext(server=f"http://127.0.0.1:{port}", namespace="default")
            response = _run_bundle(
                {
                    "plugin_id": "k8s-apply",
                    "params": {
                        "session": serialize_context(context),
                        "manifest": json.dumps(document),
                        "namespace": "default",
                        "on_error": "fail",
                    },
                    "variables": {},
                }
            )

        assert response["status"] == "failed"
        assert response["error"] == expected


@contextmanager
def _tls_serve(tmp_path: Path, *, require_client_cert: bool = False) -> Iterator[tuple[int, str]]:
    """Serve the echo handler over TLS; yield (port, CA PEM) for one test."""
    root = tls_material.make_credential("Bundle Root", is_ca=True)
    server = tls_material.make_credential(
        "localhost", issuer=root, san_dns=["localhost"], san_ips=["127.0.0.1"]
    )
    cert_path = tmp_path / "server-cert.pem"
    key_path = tmp_path / "server-key.pem"
    cert_path.write_text(server.cert_pem)
    key_path.write_text(server.key_pem)

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert_path), str(key_path))
    if require_client_cert:
        ca_path = tmp_path / "ca.pem"
        ca_path.write_text(root.cert_pem)
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(str(ca_path))
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1], root.cert_pem
    finally:
        httpd.shutdown()
        thread.join()


class TestBundleTLSParity:
    """HTTPS runs remotely through the bundled pure-Python TLS engine."""

    def test_https_verifies_against_a_custom_ca(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {
                        "method": "GET",
                        "url": f"https://127.0.0.1:{port}/health",
                        "ca_cert": ca_pem,
                    },
                    "variables": {},
                }
            )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200

    def test_https_default_trust_rejects_an_unknown_ca(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, _ca_pem):
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {"method": "GET", "url": f"https://127.0.0.1:{port}/health"},
                    "variables": {},
                }
            )

        assert response["status"] == "failed"
        assert "Certificate verification failed" in response["error"]

    def test_https_verify_off_accepts_an_unknown_ca(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, _ca_pem):
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {
                        "method": "GET",
                        "url": f"https://127.0.0.1:{port}/health",
                        "verify_ssl": False,
                    },
                    "variables": {},
                }
            )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200

    def test_https_version_pin_is_honored(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {
                        "method": "GET",
                        "url": f"https://127.0.0.1:{port}/health",
                        "ca_cert": ca_pem,
                        "tls_max_version": "1.2",
                    },
                    "variables": {},
                }
            )

        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200

    def test_https_mutual_tls_at_tls13_presents_the_client_identity(self, tmp_path: Path) -> None:
        root = tls_material.make_credential("MTLS Root", is_ca=True)
        server = tls_material.make_credential(
            "localhost", issuer=root, san_dns=["localhost"], san_ips=["127.0.0.1"]
        )
        client = tls_material.make_credential("bundle-client", issuer=root)
        (tmp_path / "sc.pem").write_text(server.cert_pem)
        (tmp_path / "sk.pem").write_text(server.key_pem)
        (tmp_path / "ca.pem").write_text(root.cert_pem)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(str(tmp_path / "sc.pem"), str(tmp_path / "sk.pem"))
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(str(tmp_path / "ca.pem"))
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            response = _run_bundle(
                {
                    "plugin_id": "http-client",
                    "params": {
                        "method": "GET",
                        "url": f"https://127.0.0.1:{httpd.server_address[1]}/health",
                        "ca_cert": root.cert_pem,
                        "client_cert": client.cert_pem,
                        "client_key": client.key_pem,
                        "tls_min_version": "1.3",
                        "tls_max_version": "1.3",
                    },
                    "variables": {},
                }
            )
        finally:
            httpd.shutdown()
            thread.join()

        # min=max=1.3 admits no other version, so a 200 proves 1.3 mTLS carried data.
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200


class TestBundlePayload:
    """build_bundle - shape and purity of the emitted payload."""

    def test_build_bundle_returns_bytes(self) -> None:
        bundle = build_bundle("http-client")

        assert isinstance(bundle, bytes)

    def test_build_bundle_is_non_empty(self) -> None:
        bundle = build_bundle("http-client")

        assert len(bundle) > 0

    def test_bundle_is_utf8_python_source(self) -> None:
        """The payload is pure-Python source text (no binary blobs)."""
        bundle = build_bundle("http-client")

        text = bundle.decode("utf-8")
        assert text.strip() != ""

    def test_bundle_carries_no_pydantic_or_pyyaml(self) -> None:
        """No pydantic / pydantic-core, and no PyYAML - the Kubernetes core
        carries the "yaml" output-format name, so the guard targets the module
        (its import and its calls), never the bare word."""
        bundle = build_bundle("http-client")

        assert b"pydantic" not in bundle
        assert b"pydantic_core" not in bundle
        assert b"import yaml" not in bundle
        assert b"from yaml" not in bundle
        assert b"yaml.safe_dump" not in bundle
        assert b"yaml.safe_load" not in bundle

    def test_a_nested_package_is_keyed_by_its_full_dotted_name(self) -> None:
        """A nested package keyed one level too shallow imports as k8s.rest, which
        no vendored module ever asks for; top-level packages keep their keys."""
        bundle = build_bundle("http-client")

        assert b"'wavecore.connectivity.k8s.rest'" in bundle
        assert b"'k8s.rest'" not in bundle
        assert b"'tlslite.api'" in bundle
        assert b"'ecdsa.curves'" in bundle

    def test_the_k8s_package_init_source_is_not_blanked(self) -> None:
        """The real package __init__ rides the bundle; a synthetic empty entry
        for the same name would silently replace it."""
        bundle = build_bundle("http-client")

        assert b"'wavecore.connectivity.k8s': ''" not in bundle
        assert b"Kubernetes Connectivity Subpackage" in bundle

    def test_bundle_references_the_requested_plugin(self) -> None:
        bundle = build_bundle("http-client")

        assert b"http-client" in bundle

    def test_bundle_is_deterministic_for_the_same_inputs(self) -> None:
        first = build_bundle("http-client")
        second = build_bundle("http-client")

        assert first == second


class TestBundleWriteVerbVendoring:
    """The write and exec verbs ride the payload, and nothing under the Kubernetes
    tree reaches for pyyaml - the purity scan reads every source and every docstring."""

    def test_every_write_verb_module_is_keyed_by_its_full_dotted_name(self) -> None:
        bundle = build_bundle("http-client")

        for name in _K8S_WRITE_VERB_MODULES:
            assert f"'{name}'".encode() in bundle, name

    def test_no_bundled_k8s_source_reaches_for_pyyaml(self) -> None:
        root = Path(inspect.getfile(k8s_package)).parent
        sources = {
            str(path.relative_to(root)): path.read_text(encoding="utf-8")
            for path in sorted(root.rglob("*.py"))
        }
        expected = {f"verbs/{name.rsplit('.', 1)[-1]}.py" for name in _K8S_WRITE_VERB_MODULES}

        assert expected <= set(sources)
        for filename, source in sources.items():
            for needle in ("import yaml", "from yaml", "yaml.safe_dump", "yaml.safe_load"):
                assert needle not in source, f"{filename}: {needle}"

    def test_the_exec_verb_is_imported_under_an_alias(self) -> None:
        """A bare exec import would shadow the builtin inside the worker source."""
        text = build_bundle("http-client").decode("utf-8")

        assert "exec as exec_verb" in text
        assert "exec_verb.run(" in text


class TestBundleProtocol:
    """build_bundle - the emitted shim speaks the stdin/stdout JSON protocol."""

    def test_bundle_reads_stdin_and_writes_stdout(self) -> None:
        """The shim's worker loop wires stdin -> execute -> stdout."""
        text = build_bundle("http-client").decode("utf-8")

        assert "stdin" in text
        assert "stdout" in text

    def test_bundle_uses_json_framing(self) -> None:
        """Plain dict in / JSON out - the shim serializes with json, not pydantic."""
        text = build_bundle("http-client").decode("utf-8")

        assert "json" in text


class TestBundleWorkerResilience:
    """A response that cannot be serialized fails its own request only.

    Serializing inside the dispatch guard is what keeps the worker alive: with
    the encode outside it, one bad return value kills the process and every
    later block in the same Remote Execution container dies at the transport.
    """

    def test_an_unserializable_return_fails_only_its_own_request(self) -> None:
        with _serve(_EchoHandler) as port:
            responses = _run_bundle_lines(
                [
                    {"plugin_id": "boom", "params": {}, "variables": {}},
                    {
                        "plugin_id": "http-client",
                        "params": {"method": "GET", "url": f"http://127.0.0.1:{port}/health"},
                        "variables": {},
                    },
                ],
                source_patch=_UNSERIALIZABLE_PLUGIN,
            )

        assert len(responses) == 2
        assert responses[0]["status"] == "failed"
        assert responses[0]["return_value"] is None
        assert "not JSON serializable" in responses[0]["error"]
        # The same worker answers the NEXT request: it never died.
        assert responses[1]["status"] == "passed"
        assert responses[1]["return_value"]["status_code"] == 200

    def test_logs_written_before_an_unserializable_return_still_arrive(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "boom", "params": {}, "variables": {}}],
            source_patch=_UNSERIALIZABLE_PLUGIN,
        )

        assert responses[0]["logs"] == [{"level": "INFO", "message": "before the bad return"}]


def _wire_capture(port: int, params: dict[str, Any]) -> dict[str, Any]:
    """Run the shim against the capture server and return what hit the wire."""
    request = {
        "plugin_id": "http-client",
        "params": {"url": f"http://127.0.0.1:{port}/echo", **params},
        "variables": {},
    }
    response = _run_bundle(request)
    assert response["status"] == "passed", response["error"]
    return json.loads(response["return_value"]["body"])


def _header_values(capture: dict[str, Any], name: str) -> list[str]:
    """The received values of every header matching ``name`` case-insensitively."""
    return [value for key, value in capture["header_pairs"] if key.lower() == name.lower()]


class TestShimBodyOnAnyMethod:
    """Parity: the shim sends the body on ANY method when one is present."""

    def test_get_with_body_reaches_the_wire(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(port, {"method": "GET", "body": "ping"})

        assert capture["method"] == "GET"
        assert capture["body"] == "ping"

    def test_empty_body_sends_nothing(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(port, {"method": "GET", "body": ""})

        assert capture["body"] == ""
        assert _header_values(capture, "Content-Length") == []


class TestShimAuthComposition:
    """Section 8 twin: the shim composes the Auth header per auth_mode and the
    composed header overwrites a same-named manual header case-insensitively."""

    def test_basic_mode_composes_the_authorization_header(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "wave",
                    "auth_password": "s3cret",
                },
            )

        expected = "Basic " + base64.b64encode(b"wave:s3cret").decode("ascii")
        assert _header_values(capture, "Authorization") == [expected]

    def test_bearer_mode_composes_the_authorization_header(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-123",
                },
            )

        assert _header_values(capture, "Authorization") == ["Bearer tok-123"]

    def test_api_key_mode_composes_the_named_header(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-Custom-Key",
                    "auth_key": "open-sesame",
                },
            )

        assert _header_values(capture, "X-Custom-Key") == ["open-sesame"]

    def test_api_key_mode_defaults_the_header_name(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_key": "open-sesame",
                },
            )

        assert _header_values(capture, "X-API-Key") == ["open-sesame"]

    def test_composed_header_overwrites_same_name_case_insensitively(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-123",
                    "headers": {"authorization": "stale-manual"},
                },
            )

        assert _header_values(capture, "Authorization") == ["Bearer tok-123"]
        assert all(value != "stale-manual" for _key, value in capture["header_pairs"])

    def test_basic_mode_with_empty_credentials_fails_before_sending(self) -> None:
        """Guard twin: no silent 'Basic Og==' remotely; port 9 proves pre-send."""
        response = _run_bundle(
            {
                "plugin_id": "http-client",
                "params": {
                    "method": "GET",
                    "url": "http://127.0.0.1:9/",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                },
                "variables": {},
            }
        )

        assert response["status"] == "failed"
        assert response["error"] == 'Auth mode "Basic" requires Username and Password'

    def test_bearer_mode_with_empty_token_fails_before_sending(self) -> None:
        response = _run_bundle(
            {
                "plugin_id": "http-client",
                "params": {
                    "method": "GET",
                    "url": "http://127.0.0.1:9/",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                },
                "variables": {},
            }
        )

        assert response["status"] == "failed"
        assert response["error"] == 'Auth mode "Bearer token" requires a Token'

    def test_api_key_mode_with_empty_key_fails_before_sending(self) -> None:
        response = _run_bundle(
            {
                "plugin_id": "http-client",
                "params": {
                    "method": "GET",
                    "url": "http://127.0.0.1:9/",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                },
                "variables": {},
            }
        )

        assert response["status"] == "failed"
        assert response["error"] == 'Auth mode "API key" requires Header Name and Key'

    def test_auth_disabled_leaves_manual_headers_untouched(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port,
                {
                    "method": "GET",
                    "auth_enabled": False,
                    "headers": {"Authorization": "Bearer manual-token"},
                },
            )

        assert _header_values(capture, "Authorization") == ["Bearer manual-token"]


class TestShimStringValueCoercion:
    """Plugin parity: the shim builds headers/query from host-resolved params,
    which carry evaluated {{ expression }} values. HTTP requires strings, so the
    shim coerces every value (non-str -> str, None -> "")."""

    def test_none_header_value_is_sent_as_empty_string(self) -> None:
        """An empty {{}} header resolves to None; urllib would crash on it raw."""
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(port, {"method": "GET", "headers": {"X-Empty": None}})

        assert _header_values(capture, "X-Empty") == [""]

    def test_non_string_header_value_is_coerced(self) -> None:
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(port, {"method": "GET", "headers": {"X-Count": 1}})

        assert _header_values(capture, "X-Count") == ["1"]

    def test_query_param_values_are_coerced(self) -> None:
        """A non-string query value stringifies; an empty {{}} one becomes ""."""
        with _serve(_CaptureHandler) as port:
            capture = _wire_capture(
                port, {"method": "GET", "query_params": {"n": 1, "empty": None}}
            )

        assert capture["path"] == "/echo?n=1&empty="


class TestBundleLauncherVendoring:
    """One launcher, carried to the host: the payload vendors the very module the
    local core imports, so a stop ends a process group the same way on the WAVE
    server and on an execution host (SHRUN-15)."""

    def test_the_launcher_module_is_keyed_by_its_full_dotted_name(self) -> None:
        bundle = build_bundle("http-client")

        assert f"'{_LAUNCHER_MODULE}'".encode() in bundle

    def test_the_vendored_launcher_is_the_source_on_disk(self) -> None:
        """No copy: what rides the payload is the file itself, byte for byte."""
        from wavecore.plugins import _process_group

        source = Path(inspect.getfile(_process_group)).read_text(encoding="utf-8")
        text = build_bundle("http-client").decode("utf-8")

        assert repr(source) in text

    def test_the_local_core_runs_on_the_same_launcher(self) -> None:
        """The runtime core reaches for the vendored module rather than spawning
        and killing on its own, so there is one implementation, not two."""
        from wavecore.plugins import _local_process

        assert "_process_group" in inspect.getsource(_local_process)


class TestBundleShellBlocksAbsent:
    """Neither shell block is remotable, so neither rides the payload: both run
    on the WAVE server even inside a Remote Execution body (SHRUN-1, SHRUN-17)."""

    def test_shell_script_is_not_in_the_bundle(self) -> None:
        assert "shell-script" not in _BUNDLE_PLUGIN_IDS
        assert b"shell-script" not in build_bundle("http-client")

    def test_shell_exec_is_not_in_the_bundle(self) -> None:
        assert "shell-exec" not in _BUNDLE_PLUGIN_IDS
        assert b"shell-exec" not in build_bundle("http-client")


# REQ-4.5.16 remote host rule: the trust spec rides each request; the worker verifies by it.
_TRUST_MODULES = ["wavecore.connectivity.trust_store", "wavecore.connectivity.run_log"]
_TRUST_LABEL = "June 2026"
_BUILT_IN_LINE = "Trusting WAVE's built-in certificate list (June 2026)"
_UNTRUSTED_LOCALHOST = (
    'Certificate verification failed: no trusted issuer found for certificate "CN=localhost"'
)

# Probes patched into the worker: each runs inside one request, after the worker set it up.
_TRUST_PROBE_SOURCE = """
def _probe_trust_store():
    return __import__("wavecore.connectivity.trust_store", {}, {}, ["*"])


def _probe_use_stores(params):
    _probe_trust_store().HOST_STORE_PATHS = tuple(params.get("stores", ()))


def _trust_probe(params, variables, logs):
    return _probe_trust_store().active_spec().to_wire()


def _anchors_probe(params, variables, logs):
    _probe_use_stores(params)
    return _tls_config(params["request"]).anchors_pem


def _store_probe(params, variables, logs):
    _probe_use_stores(params)
    return _PLUGINS["http-client"](params["request"], variables, logs)


def _run_log_probe(params, variables, logs):
    run_log = __import__("wavecore.connectivity.run_log", {}, {}, ["*"])
    for line in params["lines"]:
        run_log.log_once("INFO", line)
    return None
"""

_TRUST_PROBES = (
    "_PLUGINS = {",
    _TRUST_PROBE_SOURCE
    + '\n\n_PLUGINS = {"trust-probe": _trust_probe, "anchors-probe": _anchors_probe, '
    + '"store-probe": _store_probe, "run-log-probe": _run_log_probe, ',
)


def _trust(
    source: str = "builtin", additional_pem: str = "", additional_count: int = 0
) -> dict[str, Any]:
    """A trust spec in the wire form the workbench sends with each request."""
    return {
        "source": source,
        "additional_pem": additional_pem,
        "additional_count": additional_count,
        "builtin_label": _TRUST_LABEL,
    }


def _other_ca_pem() -> str:
    """A CA that signed nothing the test servers present."""
    return tls_material.make_credential("Unrelated Root", key_kind="ec256", is_ca=True).cert_pem


def _trust_entries(response: dict[str, Any]) -> list[dict[str, Any]]:
    return [entry for entry in response["logs"] if entry["message"].startswith("Trusting ")]


def _https_request(port: int, trust: dict[str, Any], **params: Any) -> dict[str, Any]:
    return {
        "plugin_id": "http-client",
        "params": {"method": "GET", "url": f"https://127.0.0.1:{port}/health", **params},
        "variables": {},
        "trust": trust,
    }


def _stores(tmp_path: Path, content: str | None) -> tuple[Path, Path]:
    """Two remote store locations: the first never exists, the second holds `content` when given."""
    folder = tmp_path / "remote-stores"
    folder.mkdir(exist_ok=True)
    missing, store = folder / "missing.crt", folder / "store.crt"
    if content is not None:
        store.write_text(content, encoding="utf-8")
    return missing, store


def _carried(names: frozenset[str], sources: dict[str, str]) -> bool:
    """Whether an import names a module the bundle serves with real source."""
    return any(sources.get(name) for name in names)


class TestBundleTrustVendoring:
    """trust_store and run_log ride the payload verbatim and run on a bare host interpreter."""

    @pytest.mark.parametrize("module", _TRUST_MODULES)
    def test_the_module_is_keyed_by_its_full_dotted_name(self, module: str) -> None:
        assert f"'{module}'".encode() in build_bundle("http-client")

    @pytest.mark.parametrize("module", _TRUST_MODULES)
    def test_the_module_rides_as_its_source_on_disk(self, module: str) -> None:
        sources = _vendored_sources()

        assert module in sources
        assert sources[module] == _module_source(module)

    @pytest.mark.parametrize("module", _TRUST_MODULES)
    def test_the_module_parses_at_the_interpreter_floor(self, module: str) -> None:
        source = _module_source(module)

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()

    @pytest.mark.parametrize("module", _TRUST_MODULES)
    def test_every_unguarded_import_is_stdlib_or_carried(self, module: str) -> None:
        relative = Path(*module.split(".")[1:]).with_suffix(".py")
        path = Path(str(wavecore.__file__)).parent / relative
        sources = _vendored_sources()

        outside = [
            sorted(site.names)
            for site in import_sites(module, path)
            if not site.guards and not (is_stdlib(site.names) or _carried(site.names, sources))
        ]

        assert outside == []

    def test_the_trust_modules_import_without_host_site_packages(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _TRUST_MODULES}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _TRUST_MODULES


class TestBundleTrustPerRequest:
    """The worker sets the active spec and a run-log sink from each request it serves."""

    def test_the_active_spec_is_the_trust_the_request_carries(self) -> None:
        trust = _trust("host", "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", 1)

        responses = _run_bundle_lines(
            [{"plugin_id": "trust-probe", "params": {}, "trust": trust}],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == trust

    def test_each_request_gets_the_spec_it_carries(self) -> None:
        first = _trust("builtin", "pem-a\n", 1)
        second = _trust("host")

        responses = _run_bundle_lines(
            [
                {"plugin_id": "trust-probe", "params": {}, "trust": first},
                {"plugin_id": "trust-probe", "params": {}, "trust": second},
            ],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert [response["return_value"] for response in responses] == [first, second]

    def test_a_line_logged_twice_in_one_request_is_answered_once(self) -> None:
        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "run-log-probe",
                    "params": {"lines": [_BUILT_IN_LINE, _BUILT_IN_LINE, "second line"]},
                    "trust": _trust(),
                },
                {
                    "plugin_id": "run-log-probe",
                    "params": {"lines": [_BUILT_IN_LINE]},
                    "trust": _trust(),
                },
            ],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert [response["logs"] for response in responses] == [
            [
                {"level": "INFO", "message": _BUILT_IN_LINE},
                {"level": "INFO", "message": "second line"},
            ],
            [{"level": "INFO", "message": _BUILT_IN_LINE}],
        ]


class TestBundleWorkerAnchors:
    """The worker's TLS config trusts the block CA alone, else the request's trust set."""

    def test_a_blank_ca_trusts_the_additional_pem_then_the_bundled_list(self) -> None:
        additional = _other_ca_pem()

        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "anchors-probe",
                    "params": {"request": {"url": "https://127.0.0.1/"}},
                    "trust": _trust(additional_pem=additional, additional_count=1),
                }
            ],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == additional + certifi.contents()

    def test_a_set_ca_is_the_only_anchor_and_logs_no_trust_line(self) -> None:
        block_ca = _other_ca_pem()

        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "anchors-probe",
                    "params": {"request": {"url": "https://127.0.0.1/", "ca_cert": block_ca}},
                    "trust": _trust(additional_pem=_other_ca_pem(), additional_count=1),
                }
            ],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == block_ca
        assert _trust_entries(responses[0]) == []

    def test_the_host_source_trusts_the_remote_hosts_store_in_place_of_the_bundled_list(
        self, tmp_path: Path
    ) -> None:
        additional = _other_ca_pem()
        store_text = _other_ca_pem()
        missing, store = _stores(tmp_path, store_text)

        responses = _run_bundle_lines(
            [
                {
                    "plugin_id": "anchors-probe",
                    "params": {
                        "request": {"url": "https://127.0.0.1/"},
                        "stores": [str(missing), str(store)],
                    },
                    "trust": _trust("host", additional, 1),
                }
            ],
            isolated=True,
            source_patch=_TRUST_PROBES,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == additional + store_text


class TestBundleRemoteVerification:
    """A body block verifies on the remote host by the same rule, and names the source once."""

    def test_a_blank_ca_verifies_against_the_additional_certificates_sent(
        self, tmp_path: Path
    ) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            responses = _run_bundle_lines(
                [_https_request(port, _trust(additional_pem=ca_pem, additional_count=1))],
                isolated=True,
            )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"]["status_code"] == 200
        assert _trust_entries(responses[0]) == [
            {"level": "DEBUG", "message": f"{_BUILT_IN_LINE} and 1 additional certificate"}
        ]

    def test_each_request_logs_its_own_trust_line(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            trust = _trust(additional_pem=ca_pem, additional_count=1)
            responses = _run_bundle_lines(
                [_https_request(port, trust), _https_request(port, trust)], isolated=True
            )

        expected = [{"level": "DEBUG", "message": f"{_BUILT_IN_LINE} and 1 additional certificate"}]
        assert [_trust_entries(response) for response in responses] == [expected, expected]

    def test_the_request_trust_decides_whether_a_private_ca_verifies(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            responses = _run_bundle_lines(
                [
                    _https_request(port, _trust()),
                    _https_request(port, _trust(additional_pem=ca_pem, additional_count=1)),
                ],
                isolated=True,
            )

        assert [response["status"] for response in responses] == ["failed", "passed"]
        assert responses[0]["error"] == _UNTRUSTED_LOCALHOST

    def test_a_set_ca_replaces_the_additional_certificates(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            trust = _trust(additional_pem=ca_pem, additional_count=1)
            responses = _run_bundle_lines(
                [_https_request(port, trust), _https_request(port, trust, ca_cert=_other_ca_pem())],
                isolated=True,
            )

        assert [response["status"] for response in responses] == ["passed", "failed"]
        assert responses[1]["error"] == _UNTRUSTED_LOCALHOST

    def test_only_a_verified_blank_ca_request_names_the_source(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            trust = _trust(additional_pem=ca_pem, additional_count=1)
            responses = _run_bundle_lines(
                [
                    _https_request(port, trust),
                    _https_request(port, trust, ca_cert=ca_pem),
                    _https_request(port, trust, verify_ssl=False),
                ],
                isolated=True,
            )

        assert [response["status"] for response in responses] == ["passed"] * 3
        assert [_trust_entries(response) for response in responses] == [
            [{"level": "DEBUG", "message": f"{_BUILT_IN_LINE} and 1 additional certificate"}],
            [],
            [],
        ]

    def test_the_host_source_verifies_against_the_remote_hosts_store(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            missing, store = _stores(tmp_path, ca_pem)
            responses = _run_bundle_lines(
                [
                    {
                        "plugin_id": "store-probe",
                        "params": {
                            "request": _https_request(port, {})["params"],
                            "stores": [str(missing), str(store)],
                        },
                        "trust": _trust("host"),
                    }
                ],
                isolated=True,
                source_patch=_TRUST_PROBES,
            )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"]["status_code"] == 200
        assert _trust_entries(responses[0]) == [
            {"level": "DEBUG", "message": f"Trusting the remote host's certificate store {store}"}
        ]

    def test_the_host_source_adds_the_additional_certificates(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            missing, store = _stores(tmp_path, _other_ca_pem())
            responses = _run_bundle_lines(
                [
                    {
                        "plugin_id": "store-probe",
                        "params": {
                            "request": _https_request(port, {})["params"],
                            "stores": [str(missing), str(store)],
                        },
                        "trust": _trust("host", ca_pem, 1),
                    }
                ],
                isolated=True,
                source_patch=_TRUST_PROBES,
            )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert _trust_entries(responses[0]) == [
            {
                "level": "DEBUG",
                "message": (
                    f"Trusting the remote host's certificate store {store} "
                    "and 1 additional certificate"
                ),
            }
        ]

    def test_no_store_on_the_remote_host_fails_with_the_exact_message(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, _ca_pem):
            missing, store = _stores(tmp_path, None)
            responses = _run_bundle_lines(
                [
                    {
                        "plugin_id": "store-probe",
                        "params": {
                            "request": _https_request(port, {})["params"],
                            "stores": [str(missing), str(store)],
                        },
                        "trust": _trust("host"),
                    }
                ],
                isolated=True,
                source_patch=_TRUST_PROBES,
            )

        assert responses[0]["status"] == "failed"
        assert responses[0]["error"] == (
            f"No certificate store found on the remote host: looked in {missing}, {store}"
        )
        assert _trust_entries(responses[0]) == []


# SQL and K8s bodies reach WAVE's trust set without naming a place; the worker names it once.
_CONSUMER_PROBE_SOURCE = """
def _consumer_probe(params, variables, logs):
    __import__("wavecore.connectivity.trust_store", {}, {}, ["*"]).HOST_STORE_PATHS = tuple(
        params["stores"]
    )
    if params["consumer"] == "k8s":
        return __import__("wavecore.connectivity.k8s.rest", {}, {}, ["*"]).wave_anchors()
    tls_context = __import__("wavecore.connectivity.tls_context", {}, {}, ["*"])
    tls_context.build_context({"verify_ssl": True}, "db.internal")
    return None
"""

_CONSUMER_PROBE = (
    "_PLUGINS = {",
    _CONSUMER_PROBE_SOURCE + '\n\n_PLUGINS = {"consumer-probe": _consumer_probe, ',
)


def _consumer_request(consumer: str, stores: tuple[Path, Path]) -> dict[str, Any]:
    return {
        "plugin_id": "consumer-probe",
        "params": {"consumer": consumer, "stores": [str(path) for path in stores]},
        "trust": _trust("host"),
    }


class TestBundleRemoteWordingForEveryConsumer:
    """SQL, OpenSearch, K8s and Helm bodies name the remote host's store, as HTTP does."""

    @pytest.mark.parametrize("consumer", ["sql", "k8s"])
    def test_a_blank_ca_names_the_remote_hosts_store(self, tmp_path: Path, consumer: str) -> None:
        missing, store = _stores(tmp_path, _other_ca_pem())

        responses = _run_bundle_lines(
            [_consumer_request(consumer, (missing, store))],
            isolated=True,
            source_patch=_CONSUMER_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert _trust_entries(responses[0]) == [
            {"level": "DEBUG", "message": f"Trusting the remote host's certificate store {store}"}
        ]

    @pytest.mark.parametrize("consumer", ["sql", "k8s"])
    def test_no_store_on_the_remote_host_is_refused_naming_it(
        self, tmp_path: Path, consumer: str
    ) -> None:
        missing, store = _stores(tmp_path, None)

        responses = _run_bundle_lines(
            [_consumer_request(consumer, (missing, store))],
            isolated=True,
            source_patch=_CONSUMER_PROBE,
        )

        assert responses[0]["status"] == "failed"
        assert responses[0]["error"] == (
            f"No certificate store found on the remote host: looked in {missing}, {store}"
        )
        assert _trust_entries(responses[0]) == []


# REQ-4.7.14 remote host rule: the proxy core rides the payload, the route decision stays on WAVE.
_PROXY_MODULES = [
    "wavecore.connectivity.proxy",
    "wavecore.connectivity.web_address",
    "wavecore.plugins._user_patterns",
]
_ROUTE_DECISION = "wavecore.api.services.network._proxy_addresses"
_PROXY_VARIABLES = [
    name
    for variable in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY")
    for name in (variable, variable.lower())
]

_RESOLVER_PROBE_SOURCE = """
def _resolver_probe(params, variables, logs):
    proxy = __import__("wavecore.connectivity.proxy", {}, {}, ["*"])
    return proxy.active_proxy() is None
"""

_RESOLVER_PROBE = (
    "_PLUGINS = {",
    _RESOLVER_PROBE_SOURCE + '\n\n_PLUGINS = {"resolver-probe": _resolver_probe, ',
)


@pytest.fixture
def clean_proxy_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """The worker inherits this process's environment: it starts with no proxy variable set."""
    for name in _PROXY_VARIABLES:
        monkeypatch.delenv(name, raising=False)


def _imports_outside_the_bundle(module: str) -> list[list[str]]:
    """Each import that runs when the module loads and names neither stdlib nor a carried module."""
    relative = Path(*module.split(".")[1:]).with_suffix(".py")
    path = Path(str(wavecore.__file__)).parent / relative
    sources = _vendored_sources()
    return [
        sorted(site.names)
        for site in import_sites(module, path)
        if not site.guards and not (is_stdlib(site.names) or _carried(site.names, sources))
    ]


class TestBundleProxyVendoring:
    """The proxy core, the web address parser and the user-pattern check ride the payload."""

    @pytest.mark.parametrize("module", _PROXY_MODULES)
    def test_the_module_is_keyed_by_its_full_dotted_name(self, module: str) -> None:
        assert f"'{module}'".encode() in build_bundle("http-client")

    @pytest.mark.parametrize("module", _PROXY_MODULES)
    def test_the_module_rides_as_its_source_on_disk(self, module: str) -> None:
        sources = _vendored_sources()

        assert module in sources
        assert sources[module] == _module_source(module)

    @pytest.mark.parametrize("module", _PROXY_MODULES)
    def test_the_module_parses_at_the_interpreter_floor(self, module: str) -> None:
        source = _module_source(module)

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()

    @pytest.mark.parametrize("module", _PROXY_MODULES)
    def test_every_unguarded_import_is_stdlib_or_carried(self, module: str) -> None:
        assert _imports_outside_the_bundle(module) == []

    def test_the_proxy_modules_import_without_host_site_packages(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "import-probe", "params": {"modules": _PROXY_MODULES}}],
            isolated=True,
            source_patch=_IMPORT_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] == _PROXY_MODULES

    def test_the_route_decision_and_the_api_layer_stay_on_the_wave_host(self) -> None:
        sources = _vendored_sources()

        assert _ROUTE_DECISION not in sources
        assert [name for name in sources if matches(name, "wavecore.api")] == []


@pytest.mark.usefixtures("clean_proxy_environment")
class TestBundleWorkerProxyResolver:
    """The worker registers no proxy resolver: WAVE's proxy is never in force on a remote host."""

    def test_no_proxy_is_in_force_in_the_worker(self) -> None:
        responses = _run_bundle_lines(
            [{"plugin_id": "resolver-probe", "params": {}}],
            isolated=True,
            source_patch=_RESOLVER_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] is True

    def test_the_remote_hosts_proxy_variables_put_none_in_force(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for name in ("HTTPS_PROXY", "HTTP_PROXY"):
            monkeypatch.setenv(name, "http://proxy.example:3128")

        responses = _run_bundle_lines(
            [{"plugin_id": "resolver-probe", "params": {}}],
            isolated=True,
            source_patch=_RESOLVER_PROBE,
        )

        assert responses[0]["status"] == "passed", responses[0]["error"]
        assert responses[0]["return_value"] is True


# REQ-3.4.3.9: on a remote host the HTTP block uses that host's own proxy variables.
_TUNNEL_TARGET = "target.example"
_PROXY_LOGIN = ("wave", "s3cret")
_PROXY_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="

# Records each address the request dials and sends the dial to the test server's port instead.
_DIAL_PROBE_SOURCE = """
def _dial_probe(params, variables, logs):
    dialed = []
    dial = socket.create_connection

    def recording_dial(address, *args, **kwargs):
        dialed.append(list(address))
        return dial((address[0], params["listening_on"]), *args, **kwargs)

    socket.create_connection = recording_dial
    answer = _PLUGINS["http-client"](params["request"], variables, logs)
    return {"dialed": dialed, "status_code": answer["status_code"]}
"""

_DIAL_PROBE = (
    "_PLUGINS = {",
    _DIAL_PROBE_SOURCE + '\n\n_PLUGINS = {"dial-probe": _dial_probe, ',
)


def _get(url: str, **params: Any) -> dict[str, Any]:
    """One GET for the HTTP worker, bounded so a route that leads nowhere fails fast."""
    return {
        "plugin_id": "http-client",
        "params": {"method": "GET", "url": url, "timeout": 5, **params},
        "variables": {},
    }


def _dialed(listening_on: int, url: str, **params: Any) -> dict[str, Any]:
    """Run one GET whose dial is recorded and lands on `listening_on`; the worker's answer."""
    request = {
        "plugin_id": "dial-probe",
        "params": {"listening_on": listening_on, "request": _get(url, **params)["params"]},
    }
    [response] = _run_bundle_lines([request], isolated=True, source_patch=_DIAL_PROBE)
    return response


def _asked(proxy: Proxy) -> list[tuple[str, str]]:
    """The method and the target of each request the proxy received, in arrival order."""
    return [(request.method, request.target) for request in proxy.requests]


def _logins(proxy: Proxy) -> list[str | None]:
    """The Proxy-Authorization value of each request the proxy received, in arrival order."""
    return [request.headers.get("proxy-authorization") for request in proxy.requests]


def _with_login(proxy: Proxy) -> str:
    """The proxy's address as a proxy variable holds it when the proxy asks for a login."""
    username, password = _PROXY_LOGIN
    return f"http://{username}:{password}@{proxy.authority}"


def _direct_log(url: str) -> list[dict[str, str]]:
    """The whole log of a direct request answered 200: one line, and none about a proxy."""
    return [{"level": "INFO", "message": f"HTTP 200 {url}"}]


@contextmanager
def _tls_target(tmp_path: Path, name: str) -> Iterator[tuple[int, str]]:
    """Serve the echo handler over TLS, certified as `name` alone; yield (port, CA PEM)."""
    root = tls_material.make_credential("Tunnel Root", is_ca=True)
    leaf = tls_material.make_credential(name, issuer=root, san_dns=[name])
    cert_path, key_path = tmp_path / "target-cert.pem", tmp_path / "target-key.pem"
    cert_path.write_text(leaf.cert_pem)
    key_path.write_text(leaf.key_pem)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert_path), str(key_path))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _EchoHandler)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1], root.cert_pem
    finally:
        httpd.shutdown()
        thread.join()


@contextmanager
def _behind_a_proxy(
    tmp_path: Path, login: tuple[str, str] | None = None
) -> Iterator[tuple[Proxy, str]]:
    """A TLS target only a proxy can reach, and only as target.example; yield (proxy, CA PEM)."""
    with _tls_target(tmp_path, _TUNNEL_TARGET) as (port, ca_pem):
        with Proxy(upstream=("127.0.0.1", port), login=login) as proxy:
            yield proxy, ca_pem


@pytest.mark.usefixtures("clean_proxy_environment")
class TestBundleDefaultPort:
    """A URL that names no port is dialed on the port of its scheme."""

    def test_an_https_url_without_a_port_is_dialed_on_443(self, tmp_path: Path) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem):
            response = _dialed(port, "https://127.0.0.1/health", ca_cert=ca_pem)

        assert response["status"] == "passed", response["error"]
        assert response["return_value"] == {"dialed": [["127.0.0.1", 443]], "status_code": 200}

    def test_an_http_url_without_a_port_is_dialed_on_80(self) -> None:
        with _serve(_EchoHandler) as port:
            response = _dialed(port, "http://127.0.0.1/health")

        assert response["status"] == "passed", response["error"]
        assert response["return_value"] == {"dialed": [["127.0.0.1", 80]], "status_code": 200}


@pytest.mark.usefixtures("clean_proxy_environment")
class TestBundleHttpsThroughTheRemoteHostsProxy:
    """With HTTPS_PROXY on the remote host an https request opens a tunnel through that proxy,
    then completes the TLS handshake with the target behind it (REQ-3.4.3.9)."""

    def test_the_request_asks_the_proxy_for_a_tunnel_to_the_target(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with _behind_a_proxy(tmp_path) as (proxy, ca_pem):
            monkeypatch.setenv("HTTPS_PROXY", proxy.url)
            _run_bundle(
                _get(f"https://{_TUNNEL_TARGET}:8443/health", ca_cert=ca_pem), isolated=True
            )

        assert _asked(proxy) == [("CONNECT", f"{_TUNNEL_TARGET}:8443")]
        assert proxy.not_http == []

    def test_the_handshake_is_with_the_target_and_the_answer_matches_a_direct_request(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        url = f"https://{_TUNNEL_TARGET}:8443/health"
        with _behind_a_proxy(tmp_path) as (proxy, ca_pem):
            monkeypatch.setenv("HTTPS_PROXY", proxy.url)
            response = _run_bundle(_get(url, ca_cert=ca_pem), isolated=True)

        # The certificate holds the target's name alone, so any other name fails the handshake.
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200
        assert response["return_value"]["body"] == '{"ok": true}'
        assert response["return_value"]["final_url"] == url
        assert response["logs"] == _direct_log(url)

    def test_a_url_without_a_port_asks_for_a_tunnel_to_port_443(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with _behind_a_proxy(tmp_path) as (proxy, ca_pem):
            monkeypatch.setenv("HTTPS_PROXY", proxy.url)
            response = _run_bundle(
                _get(f"https://{_TUNNEL_TARGET}/health", ca_cert=ca_pem), isolated=True
            )

        assert _asked(proxy) == [("CONNECT", f"{_TUNNEL_TARGET}:443")]
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200

    def test_a_login_in_the_variable_reaches_the_proxy_with_the_tunnel_request(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with _behind_a_proxy(tmp_path, login=_PROXY_LOGIN) as (proxy, ca_pem):
            monkeypatch.setenv("HTTPS_PROXY", _with_login(proxy))
            response = _run_bundle(
                _get(f"https://{_TUNNEL_TARGET}:8443/health", ca_cert=ca_pem), isolated=True
            )

        assert _asked(proxy) == [("CONNECT", f"{_TUNNEL_TARGET}:8443")]
        assert _logins(proxy) == [_PROXY_LOGIN_HEADER]
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200


@pytest.mark.usefixtures("clean_proxy_environment")
class TestBundleHttpThroughTheRemoteHostsProxy:
    """With HTTP_PROXY on the remote host a plain http request is handed to that proxy whole."""

    def test_the_request_is_forwarded_under_its_absolute_address(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        url = f"http://{_TUNNEL_TARGET}:8080/health"
        with _serve(_EchoHandler) as port, Proxy(upstream=("127.0.0.1", port)) as proxy:
            monkeypatch.setenv("HTTP_PROXY", proxy.url)
            response = _run_bundle(_get(url), isolated=True)

        assert _asked(proxy) == [("GET", url)]
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200
        assert response["return_value"]["body"] == '{"ok": true}'
        assert response["return_value"]["final_url"] == url
        assert response["logs"] == _direct_log(url)

    def test_a_login_in_the_variable_reaches_the_proxy_with_the_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        url = f"http://{_TUNNEL_TARGET}:8080/health"
        with _serve(_EchoHandler) as port:
            with Proxy(upstream=("127.0.0.1", port), login=_PROXY_LOGIN) as proxy:
                monkeypatch.setenv("HTTP_PROXY", _with_login(proxy))
                response = _run_bundle(_get(url), isolated=True)

        assert _asked(proxy) == [("GET", url)]
        assert _logins(proxy) == [_PROXY_LOGIN_HEADER]
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200


@pytest.mark.usefixtures("clean_proxy_environment")
class TestBundleNoProxyOnTheRemoteHost:
    """A target the remote host's NO_PROXY names is dialed directly; the proxy sees nothing."""

    def test_an_https_target_is_dialed_directly(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with _tls_serve(tmp_path) as (port, ca_pem), Proxy() as proxy:
            monkeypatch.setenv("HTTPS_PROXY", proxy.url)
            monkeypatch.setenv("NO_PROXY", "127.0.0.1")
            response = _run_bundle(
                _get(f"https://127.0.0.1:{port}/health", ca_cert=ca_pem), isolated=True
            )
            untouched = proxy.untouched

        assert untouched
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200

    def test_an_http_target_is_dialed_directly(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with _serve(_EchoHandler) as port, Proxy() as proxy:
            monkeypatch.setenv("HTTP_PROXY", proxy.url)
            monkeypatch.setenv("NO_PROXY", "127.0.0.1")
            response = _run_bundle(_get(f"http://127.0.0.1:{port}/health"), isolated=True)
            untouched = proxy.untouched

        assert untouched
        assert response["status"] == "passed", response["error"]
        assert response["return_value"]["status_code"] == 200


_BASIC_PAIRS = [
    ("wave", "s3cret", "Basic d2F2ZTpzM2NyZXQ="),
    ("svc", "a:b", "Basic c3ZjOmE6Yg=="),
    ("jürgen", "pässwörd", "Basic asO8cmdlbjpww6Rzc3fDtnJk"),
    ("名前", "密码", "Basic 5ZCN5YmNOuWvhueggQ=="),
]


def _basic_values(port: int, pairs: Sequence[tuple[str, Any]]) -> list[list[str]]:
    """The Authorization values the capture server received, one Basic request per pair."""
    responses = _run_bundle_lines(
        [
            _get(
                f"http://127.0.0.1:{port}/echo",
                auth_enabled=True,
                auth_mode="basic",
                auth_username=username,
                auth_password=password,
            )
            for username, password in pairs
        ],
        isolated=True,
    )
    assert [response["status"] for response in responses] == ["passed"] * len(pairs)
    return [
        _header_values(json.loads(response["return_value"]["body"]), "Authorization")
        for response in responses
    ]


@pytest.mark.usefixtures("clean_proxy_environment")
class TestShimBasicAuthorizationValue:
    """Basic mode sends the word Basic, then `username:password` in UTF-8 as Base64."""

    def test_the_value_is_the_pair_in_utf8_as_base64(self) -> None:
        with _serve(_CaptureHandler) as port:
            sent = _basic_values(
                port, [(username, password) for username, password, _ in _BASIC_PAIRS]
            )

        assert sent == [[value] for _username, _password, value in _BASIC_PAIRS]

    def test_a_numeric_password_is_sent_as_its_text(self) -> None:
        with _serve(_CaptureHandler) as port:
            sent = _basic_values(port, [("wave", 12345)])

        assert sent == [["Basic d2F2ZToxMjM0NQ=="]]
