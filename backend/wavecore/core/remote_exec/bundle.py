"""Remote Execution bundle-runtime builder (REQ-3.4.1.3).

build_bundle assembles the self-contained, pure-Python payload a Remote
Execution container pushes over an SSH session and runs under a remote
interpreter. The payload reads a JSON request on stdin, dispatches to the
referenced plugin, and writes a JSON response on stdout - built only on the
standard library plus the bundled pure-Python TLS engine (no compiled
dependency, no pydantic), so it runs under a bare host interpreter.

The bundle vendors tlslite-ng + ecdsa and WAVE's own pure-Python TLS engine
as source, served in-memory by a meta-path finder, so HTTPS runs with the
same protocol-version / cipher / mutual-TLS behavior remotely as locally,
independent of the host's OpenSSL. Because the vendored source is far larger
than a command-line argument allows, the payload travels over stdin behind a
tiny bootstrap; worker_bootstrap() is the command that reads and runs it.

HTTP runs through a shim inside the worker: urllib over a tlslite-backed
socket, producing the same response shape the local httpx plugin returns
(status_code / headers / body / content_type / response_time / final_url).
It sends the request body on any method when one is present and composes
the Auth section's header (Basic, Bearer token, API key) before dispatch,
the composed header overwriting a same-named manual header
case-insensitively. It follows the execution host's own proxy variables: an
https request opens a tunnel through that proxy and then handshakes with the
target (REQ-3.4.3.9).

The Kubernetes blocks, read and write alike, dispatch onto the vendored
wavecore.connectivity.k8s verb core - the same source that runs locally - so a
cluster refusal reads the same on both loci. Each verb logs through a
two-argument callable that records {level, message} entries the run replays.

The Helm blocks ride the same way onto the vendored wavecore.connectivity.helm
core, driving the execution host's own helm executable; the worker names that
host so a missing helm reports where it was looked for.

The File I/O block runs the vendored stdlib core wavecore.plugins._file_ops
against the host's own paths.

The Netcat block runs the vendored stdlib core wavecore.plugins._netcat_core,
with its port check wavecore.plugins._ports, so the ports are dialed from the
host; no SSH tunnel lookup happens there.

The Ping block runs the vendored stdlib core wavecore.plugins._ping_core, so the
echo requests leave the host itself; the worker names that host so a machine that
refuses an unprivileged ICMP socket reports where it was refused.

The SQL block runs the vendored core wavecore.plugins._sql_core over the
wavecore.connectivity.sql dialects. PostgreSQL's, MySQL's and SQL Server's
pure-Python drivers ride as source; the compiled builds SQLite, Oracle and SQL
Server's TLS need arrive as a wheel line ({"wheels": [...]}) that the worker unpacks
into its scratch folder, which is on sys.path from the start and removed at
stop (SQL-15).

The OpenSearch block runs the vendored stdlib core wavecore.plugins._opensearch_core
over wavecore.connectivity.opensearch, dialing the Cluster URL from the host.

Each request carries the trust a blank CA uses (REQ-4.5.16); the worker sets it and
a run-log sink for that request, and the bundle carries WAVE's built-in list.

The worker runs every request in a forked process of its own, in a process
group of its own, and keeps reading its stdin meanwhile. Requests carry an id
and answers carry the same id, so several requests run at once. A cancel line
({"cancel": id}) ends that request's group and writes no answer for it; a stop
line ({"stop": true}) and stdin EOF alike end every request's group and then
the worker within STOP_GRACE_S, writing no further answer, so a stopped run
leaves the remote host as it was found (REQ-3.2.2.4).
"""

import inspect
import os
from importlib import import_module, metadata
from types import ModuleType

import ecdsa
import six
import tlslite

from wavecore.connectivity import (
    block_outputs,
    helm,
    k8s,
    opensearch,
    proxy,
    run_log,
    sql,
    tls_capabilities,
    tls_context,
    trust_store,
    url_credentials,
    web_address,
)
from wavecore.plugins import (
    _file_ops,
    _held_run,
    _local_process,
    _local_process_runtime,
    _local_process_watchdog,
    _netcat_core,
    _opensearch_core,
    _ping_core,
    _plural,
    _ports,
    _process_group,
    _python_bridge,
    _sql_core,
    _tls_material,
    _user_patterns,
    http_tls,
)

# Tiny stdin bootstrap: read the length-prefixed worker payload, then run it.
# The worker keeps reading request lines from the same stdin afterward.
_BOOTSTRAP = (
    "import sys;"
    "_n=int(sys.stdin.buffer.readline());"
    "_src=sys.stdin.buffer.read(_n);"
    "exec(compile(_src,'<wave-worker>','exec'),{'__name__':'__main__'})"
)

# The in-memory vendored-source loader. tlslite's inspect-based deprecation
# shims read source lines, so each module is registered in linecache.
_LOADER = """
import sys as _sys
import importlib.abc as _abc
import importlib.util as _util
import linecache as _linecache

_WAVE_SOURCES = __SOURCES__
_WAVE_DISTRIBUTIONS = __DISTRIBUTIONS__


def _dist_key(name):
    return name.replace("-", "_").replace(".", "_").lower()


class _WaveLoader(_abc.Loader):
    def __init__(self, name, source):
        self._name = name
        self._source = source

    def create_module(self, spec):
        return None

    def get_source(self, name):
        return self._source

    def exec_module(self, module):
        filename = "<wave-vendored:%s>" % self._name
        module.__file__ = filename
        lines = self._source.splitlines(keepends=True)
        _linecache.cache[filename] = (len(self._source), None, lines, filename)
        exec(compile(self._source, filename, "exec"), module.__dict__)


class _WaveFinder(_abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname not in _WAVE_SOURCES:
            return None
        is_pkg = any(name.startswith(fullname + ".") for name in _WAVE_SOURCES)
        loader = _WaveLoader(fullname, _WAVE_SOURCES[fullname])
        spec = _util.spec_from_loader(fullname, loader, is_package=is_pkg)
        if is_pkg:
            spec.submodule_search_locations = []
        return spec

    def find_distributions(self, context):
        # Only importlib.metadata asks, so it is loaded; pg8000 and scramp read their versions.
        from importlib import metadata

        class _WaveDistribution(metadata.Distribution):
            def __init__(self, name, version):
                self._text = "Name: %s\\nVersion: %s\\n" % (name, version)

            def read_text(self, filename):
                return self._text if filename == "METADATA" else None

            def locate_file(self, path):
                return path

        wanted = None if context.name is None else _dist_key(context.name)
        return [
            _WaveDistribution(name, version)
            for name, version in _WAVE_DISTRIBUTIONS.items()
            if wanted is None or _dist_key(name) == wanted
        ]


_sys.meta_path.insert(0, _WaveFinder())
"""

# The worker: the HTTP shim plus the vendored K8s and Helm verbs, JSON stdin/stdout protocol.
_WORKER = """
import asyncio
import base64
import datetime
import http.client
import importlib
import io
import json
import os
import selectors
import shutil
import signal
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from wavecore.connectivity import run_log, trust_store
from wavecore.connectivity import web_address
from wavecore.connectivity.block_outputs import block_failure
from wavecore.connectivity.helm import _cli as helm_cli
from wavecore.connectivity.helm.verbs import install, rollback, status, uninstall, upgrade
from wavecore.connectivity.helm.verbs import test as test_verb
from wavecore.connectivity.k8s.verbs import apply, connect, cp, delete, events, get
from wavecore.connectivity.k8s.verbs import rollout, scale, script, top
from wavecore.connectivity.k8s.verbs import exec as exec_verb
from wavecore.connectivity.k8s.verbs import logs as logs_verb
from wavecore.plugins import _file_ops as file_ops
from wavecore.plugins import _local_process
from wavecore.plugins import _netcat_core as netcat_core
from wavecore.plugins import _opensearch_core as opensearch_core
from wavecore.plugins import _ping_core as ping_core
from wavecore.plugins import _local_process_runtime as runtime
from wavecore.plugins import _process_group
from wavecore.plugins import _sql_core as sql_core
from wavecore.plugins import _tls_material as tls_material
from wavecore.plugins import http_tls

# The missing-helm message names the host helm was looked for on.
helm_cli.REMOTE_HOST = socket.gethostname()
sql_core.REMOTE_HOST = socket.gethostname()
# Every blank-CA connection in a body names the remote host in its trust line and refusal.
trust_store.LOCATION = trust_store.REMOTE_HOST
# Every process a request launches is held here, so a stop can end it.
_started = _process_group.HeldGroups()
_process_group.RUNNING.set(_started)

REMOTE_PLUGIN_ID = "__PLUGIN_ID__"
_TRUST_PEM = __TRUST_PEM__
# The remote host has no certifi; WAVE's built-in list rides the bundle.
trust_store.set_builtin_pem(_TRUST_PEM)
_BINARY_MARKERS = ("image", "octet-stream", "application/pdf")
# How long a stopped request gets to unwind before the worker leaves anyway.
STOP_GRACE_S = 3
# How often the worker checks on requests it told to end.
_TICK_S = 0.02
_READ_CHUNK = 65536
# Everything the worker writes lives here and leaves with it.
_SCRATCH_DIR = tempfile.mkdtemp(prefix="wave-worker-")
# Pushed wheels unpack here; ahead of the host's own packages, so the carried build is used.
_WHEELS_DIR = os.path.join(_SCRATCH_DIR, "wheels")
os.mkdir(_WHEELS_DIR)
sys.path.insert(0, _WHEELS_DIR)


def _coerce_str(value):
    return "" if value is None else str(value)


def _auth_header(params):
    # Required-field guards twin the local plugin's pre-send raises.
    mode = params.get("auth_mode", "basic")
    if mode == "bearer":
        if not params.get("auth_token"):
            raise ValueError('Auth mode "Bearer token" requires a Token')
        return "Authorization", "Bearer %s" % params.get("auth_token", "")
    if mode == "api_key":
        name = str(params.get("auth_header_name") or "X-API-Key")
        if not params.get("auth_key"):
            raise ValueError('Auth mode "API key" requires Header Name and Key')
        return name, str(params.get("auth_key", ""))
    if not params.get("auth_username") or not params.get("auth_password"):
        raise ValueError('Auth mode "Basic" requires Username and Password')
    return "Authorization", web_address.basic_authorization(
        str(params["auth_username"]), str(params["auth_password"])
    )


def _apply_auth(params, headers):
    if not params.get("auth_enabled"):
        return
    name, value = _auth_header(params)
    for key in [k for k in headers if k.lower() == name.lower()]:
        del headers[key]
    headers[name] = value


def _tls_config(params):
    verify = params.get("verify_ssl", True)
    ca_cert = params.get("ca_cert")
    anchors = None
    if verify:
        anchors = (
            tls_material.read_pem(ca_cert)
            if ca_cert
            else trust_store.anchors_pem(trust_store.active_spec())
        )
    client_cert = params.get("client_cert")
    client_key = params.get("client_key")
    return http_tls.TLSClientConfig(
        min_version=params.get("tls_min_version", "1.2"),
        max_version=params.get("tls_max_version", "1.3"),
        cipher_names=params.get("cipher_suites"),
        verify=verify,
        anchors_pem=anchors,
        client_cert_pem=tls_material.read_pem(client_cert) if client_cert else None,
        client_key_pem=tls_material.read_pem(client_key) if client_key else None,
    )


class _TlsliteHTTPSConnection(http.client.HTTPConnection):
    default_port = 443

    def __init__(self, host, tls_config, timeout):
        http.client.HTTPConnection.__init__(self, host, timeout=timeout)
        self._tls_config = tls_config

    def connect(self):
        # Dials the host, or the proxy the opener named and the tunnel through it to the host.
        http.client.HTTPConnection.connect(self)
        result = http_tls.tls_handshake(
            self.sock,
            self._tls_config,
            self._tunnel_host or self.host,
            datetime.datetime.now(datetime.timezone.utc),
        )
        self.sock = result.connection


class _TlsliteHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, tls_config, timeout):
        urllib.request.HTTPSHandler.__init__(self)
        self._tls_config = tls_config
        self._timeout = timeout

    def https_open(self, req):
        return self.do_open(self._factory, req)

    def _factory(self, host, **kwargs):
        return _TlsliteHTTPSConnection(host, self._tls_config, self._timeout)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _http_client(params, variables, logs):
    method = str(params.get("method", "GET")).upper()
    url = params["url"]
    headers = {k: _coerce_str(v) for k, v in (params.get("headers") or {}).items()}
    _apply_auth(params, headers)
    query = {k: _coerce_str(v) for k, v in (params.get("query_params") or {}).items()}
    if query:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(query)

    body = params.get("body")
    data = body.encode("utf-8") if body else None
    timeout = params.get("timeout", 30)

    handlers = []
    if not params.get("allow_redirects", True):
        handlers.append(_NoRedirect())
    if urllib.parse.urlparse(url).scheme == "https":
        handlers.append(_TlsliteHTTPSHandler(_tls_config(params), timeout))
    opener = urllib.request.build_opener(*handlers)

    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    start = datetime.datetime.now().timestamp()
    try:
        resp = opener.open(request, timeout=timeout)
        status = resp.getcode()
        resp_headers = dict(resp.getheaders())
        raw = resp.read()
        final_url = resp.geturl()
    except urllib.error.HTTPError as exc:
        status = exc.code
        resp_headers = dict(exc.headers.items())
        raw = exc.read()
        final_url = url
    response_time = datetime.datetime.now().timestamp() - start

    content_type = resp_headers.get("Content-Type", "")
    if any(marker in content_type for marker in _BINARY_MARKERS):
        text = base64.b64encode(raw).decode("ascii")
    else:
        text = raw.decode("utf-8", errors="replace")

    logs.append({"level": "INFO", "message": "HTTP %s %s" % (status, url)})
    return {
        "status_code": status,
        "headers": resp_headers,
        "body": text,
        "content_type": content_type,
        "response_time": response_time,
        "final_url": final_url,
    }


_PY_NOUN = "Script"
# The interpreter is handed fd 3 by a shell redirect: the watchdog closes every inherited one.
_PY_REDIRECT = 'exec 3>"$1"\\nshift\\nexec "$@"\\n'
_PY_HOOK_NOT_REACHED = (
    "Variable exports were not read: the script did not end after the pattern match"
)
_PY_LOG_LEVELS = {
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "WARNING": "WARN",
    "ERROR": "ERROR",
    "CRITICAL": "ERROR",
}
_PY_EMPTY = {"stdout": "", "stderr": "", "exit_code": -1}


def _py_source_file(source, filename):
    path = os.path.join(_SCRATCH_DIR, filename)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(source)
    return path


# The spawned watchdog and the bridge resolve to what the worker wrote, never to a package file.
_local_process.WATCHDOG_PATH = _py_source_file(
    _WAVE_SOURCES["wavecore.plugins._local_process_watchdog"], "_local_process_watchdog.py"
)
_PY_BRIDGE = _py_source_file(
    _WAVE_SOURCES["wavecore.plugins._python_bridge"], "_python_bridge.py"
)
runtime.LOCUS = "on the remote host"


# The run console as the local-process runtime writes to it.
class _PyLogger:
    def __init__(self, log):
        self._log = log

    def debug(self, message):
        self._log("DEBUG", message)

    def info(self, message):
        self._log("INFO", message)

    def warn(self, message):
        self._log("WARN", message)

    def error(self, message):
        self._log("ERROR", message)


def _py_text(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)


def _py_working_dir(path):
    return runtime.require_existing_dir(file_ops.local_path(path))


def _py_script_file(path, cwd):
    file_ops.refuse_wave_scheme(path)
    resolved = os.path.abspath(os.path.join(cwd, path))
    if not os.path.isfile(resolved):
        raise ValueError("Script file not found: %s" % path)
    return resolved


def _py_environment(params):
    env = dict(os.environ)
    for key, value in (runtime.setting(params, "environment", {}) or {}).items():
        env[key] = _py_text(value)
    return env


def _py_interpreter(row, env, cwd):
    if not row.strip():
        return [sys.executable]
    return runtime.resolve_program(row, env, cwd, "interpreter")


def _py_records(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _py_final(records):
    for record in reversed(records):
        if "exports" in record:
            return record
    return None


def _py_input(value):
    # The wire's table envelope becomes the shape the bridge decodes.
    if isinstance(value, dict) and value.get("__wave_type") == "table":
        columns = value.get("columns") or []
        return {
            "__wave_type": "table",
            "columns": [column["name"] for column in columns],
            "types": [column["type"] for column in columns],
            "rows": value.get("rows") or [],
        }
    return value


def _py_export(value):
    # The bridge's table envelope becomes the storage shape WAVE materializes.
    if isinstance(value, dict) and value.get("__wave_type") == "table":
        return {
            "__wave_type": "table",
            "columns": [
                {"name": name, "type": kind}
                for name, kind in zip(value["columns"], value["types"], strict=True)
            ],
            "rows": value["rows"],
        }
    return value


def _py_failed(params, outputs, message, reason, log):
    core = block_failure(params, outputs, message, reason, log, action=_PY_NOUN)
    return {"__wave_type": "result", "outputs": core, "secrets": []}


def _py_prepare(params, private_dir, env, names):
    # (argv, working directory, channel path, interpreter argv) for one run.
    cwd = _py_working_dir(runtime.working_dir_setting(params))
    interpreter = _py_interpreter(runtime.setting(params, "interpreter", ""), env, cwd)
    mode = "source" if runtime.setting(params, "script_type", "source") == "source" else "file"
    if mode == "source":
        name = os.path.basename(params.get("script_name") or "") or "script.py"
        script = os.path.join(private_dir, name)
        with open(script, "w", encoding="utf-8") as handle:
            handle.write(runtime.setting(params, "script", ""))
    else:
        script = _py_script_file(runtime.setting(params, "script_file", ""), cwd)
    channel = os.path.join(private_dir, "channel")
    with open(channel, "w", encoding="utf-8"):
        pass
    arguments = [_py_text(row.get("value")) for row in runtime.setting(params, "arguments", [])]
    envelope = os.path.join(private_dir, "bridge-in.json")
    with open(envelope, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "version": 1,
                "mode": mode,
                "script": script,
                "working_dir": cwd,
                "argv": arguments,
                "inputs": {
                    name: _py_input(value)
                    for name, value in (runtime.setting(params, "input_vars", {}) or {}).items()
                },
                "exports": dict.fromkeys(names, ""),
            },
            handle,
        )
    env["WAVE_BRIDGE_IN"] = envelope
    argv = ["/bin/sh", "-c", _PY_REDIRECT, "sh", channel]
    argv += interpreter + [_PY_BRIDGE, script] + arguments
    return argv, cwd, channel, interpreter


def _py_exports(params, final, outcome, outputs, log):
    # Whether nothing was read although the block asked for exports; WAVE binds what comes back.
    names = list(runtime.setting(params, "script_variables", []))
    read = outcome.stop in ("pass", "fail") or (outcome.stop is None and outcome.ended_on_own)
    if not names or not read:
        return False
    if final is None:
        log("WARN", _PY_HOOK_NOT_REACHED)
        return True
    raw = final.get("exports") or {}
    bound = params.get("bound_exports") or []
    for name in names:
        if name not in bound:
            continue
        if name not in raw:
            log(
                "DEBUG",
                "Variable export '%s' was never set; the bound variable keeps its value" % name,
            )
        else:
            outputs[name] = _py_export(raw[name])
    return False


# The Python block on the remote host: the same runtime the WAVE server uses (PYRUN-12).
def _py_run(params, log):
    patterns = runtime.compile_patterns(params)
    names = list(runtime.setting(params, "script_variables", []))
    private_dir = tempfile.mkdtemp(prefix="run-", dir=_SCRATCH_DIR)
    try:
        env = _py_environment(params)
        try:
            argv, cwd, channel, interpreter = _py_prepare(params, private_dir, env, names)
        except OSError as exc:
            message = "Could not start the script: %s" % (exc.strerror or exc,)
            return _py_failed(params, dict(_PY_EMPTY), message, "StartFailed", log)
        except ValueError as exc:
            return _py_failed(params, dict(_PY_EMPTY), str(exc), "StartFailed", log)
        context = {
            "logger": _PyLogger(log),
            "output_secret_fields": params.get("output_secret_fields") or [],
        }
        spec = runtime.launch_spec(params, context, argv, cwd, env, patterns)
        outcome = asyncio.run(_local_process.run_local_process(spec))
        records = _py_records(channel)
        announced = bool(records) and records[0].get("hello") == "wave-bridge"
        if outcome.start_error is None and not announced:
            refused = "Interpreter is not Python 3.8 or newer: %s" % interpreter[0]
            return _py_failed(params, dict(_PY_EMPTY), refused, "StartFailed", log)
        for record in records:
            if record.get("log") is not None:
                log(_PY_LOG_LEVELS.get(record["log"], "INFO"), record.get("message", ""))
        outputs = runtime.stream_values(outcome)
        timeout = runtime.setting(params, "timeout", 300)
        message, reason = runtime.judge_outcome(outcome, _PY_NOUN, timeout, spec.secret_streams)
        final = _py_final(records)
        if final is not None and reason == "NonZeroExit" and final.get("error"):
            message, reason = str(final["error"]), "Exception"
            if "stderr" not in spec.secret_streams:
                log("ERROR", outcome.stderr)
        amber = _py_exports(params, final, outcome, outputs, log)
        if message is not None:
            return _py_failed(params, outputs, message, reason, log)
        result = runtime.passed(outputs)
        if amber:
            result["__block_warning"] = True
        return {"__wave_type": "result", "outputs": result, "secrets": []}
    finally:
        shutil.rmtree(private_dir, ignore_errors=True)


def _logger(logs):
    def log(level, message):
        logs.append({"level": level, "message": str(message)})

    return log


def _ping(params, logs):
    # The refused-ICMP message names the host the echo requests would have left.
    ping_core.REMOTE_HOST = socket.gethostname()
    return asyncio.run(ping_core.run(params, _logger(logs)))


_PLUGINS = {
    "http-client": _http_client,
    "file-io": lambda params, variables, logs: file_ops.run(params, _logger(logs)),
    "python": lambda params, variables, logs: _py_run(params, _logger(logs)),
    "netcat": lambda params, variables, logs: asyncio.run(netcat_core.run(params, _logger(logs))),
    "ping": lambda params, variables, logs: _ping(params, logs),
    "sql-client": lambda params, variables, logs: sql_core.run(params, _logger(logs)),
    "opensearch": lambda params, variables, logs: opensearch_core.run(params, _logger(logs)),
    "k8s-connect": lambda params, variables, logs: connect.run(params, _logger(logs)),
    "k8s-get": lambda params, variables, logs: get.run(params, _logger(logs)),
    "k8s-events": lambda params, variables, logs: events.run(params, _logger(logs)),
    "k8s-logs": lambda params, variables, logs: logs_verb.run(params, _logger(logs)),
    "k8s-top": lambda params, variables, logs: top.run(params, _logger(logs)),
    "k8s-apply": lambda params, variables, logs: apply.run(params, _logger(logs)),
    "k8s-delete": lambda params, variables, logs: delete.run(params, _logger(logs)),
    "k8s-scale": lambda params, variables, logs: scale.run(params, _logger(logs)),
    "k8s-rollout": lambda params, variables, logs: rollout.run(params, _logger(logs)),
    "k8s-exec": lambda params, variables, logs: exec_verb.run(params, _logger(logs)),
    "k8s-script": lambda params, variables, logs: script.run(params, _logger(logs)),
    "k8s-copy": lambda params, variables, logs: cp.run(params, _logger(logs)),
    "helm-install": lambda params, variables, logs: install.run(params, _logger(logs)),
    "helm-upgrade": lambda params, variables, logs: upgrade.run(params, _logger(logs)),
    "helm-rollback": lambda params, variables, logs: rollback.run(params, _logger(logs)),
    "helm-uninstall": lambda params, variables, logs: uninstall.run(params, _logger(logs)),
    "helm-test": lambda params, variables, logs: test_verb.run(params, _logger(logs)),
    "helm-status": lambda params, variables, logs: status.run(params, _logger(logs)),
}


def _dispatch(plugin_id, params, variables, logs):
    plugin = _PLUGINS.get(plugin_id)
    if plugin is None:
        raise RuntimeError("Plugin %r is not available in the remote bundle" % plugin_id)
    return plugin(params, variables, logs)


def _unpack_wheels(wheels):
    for wheel in wheels:
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(wheel["data"]))) as archive:
            archive.extractall(_WHEELS_DIR)
    importlib.invalidate_caches()


class _RequestEnded(BaseException):
    pass


def _failed_answer(request_id, logs, error):
    return json.dumps(
        {"id": request_id, "return_value": None, "logs": logs, "status": "failed", "error": error}
    )


def _line(answer):
    return (answer + "\\n").encode("utf-8")


def _use_trust(trust, logs):
    if trust is not None:
        trust_store.ACTIVE_SPEC.set(trust_store.TrustSpec.from_wire(trust))
    run_log.RUN_LOG.set(run_log.RunLog(_logger(logs)))


def _run(request):
    logs = []
    request_id = request.get("id")
    try:
        _use_trust(request.get("trust"), logs)
        return_value = _dispatch(
            request.get("plugin_id"),
            request.get("params", {}),
            request.get("variables", {}),
            logs,
        )
        # Serialized inside the guard: a bad return value fails its request, never the worker.
        return json.dumps(
            {
                "id": request_id,
                "return_value": return_value,
                "logs": logs,
                "status": "passed",
                "error": None,
            }
        )
    except Exception as exc:  # noqa: BLE001 - surfaced back over the JSON protocol
        return _failed_answer(request_id, logs, str(exc))


def _kill_started():
    _process_group.kill_group(os.getpid())
    _started.stop()


def _step_out(group):
    # Out of its own group first, so the group kill spares this process while it unwinds.
    try:
        os.setpgid(0, group)
    except OSError:
        pass


def _end_request(worker_group):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    _step_out(worker_group)
    _kill_started()
    raise _RequestEnded()


def _detach_stdio():
    # The session's streams carry the protocol; a request never reads or writes them.
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(2, 1)
    os.close(devnull)


def _write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def _serve_request(request, answer_fd, worker_group, inherited):
    # The forked request process: it answers through its pipe and never returns.
    try:
        signal.signal(signal.SIGTERM, lambda _signum, _frame: _end_request(worker_group))
        os.setpgid(0, 0)
        for fd in inherited:
            os.close(fd)
        _detach_stdio()
        _write_all(answer_fd, _line(_run(request)))
    except BaseException:  # noqa: BLE001 - an ended request leaves without an answer
        pass
    finally:
        os._exit(0)


def _buffered_input():
    # Lines the bootstrap's buffered reader already holds, else the first read of the session.
    stream = sys.stdin.buffer
    return stream.read1(len(stream.peek(1)))


class _Request:
    def __init__(self, request_id, pid):
        self.id = request_id
        self.pid = pid
        self.chunks = []


class _Worker:
    def __init__(self):
        self.group = os.getpgrp()
        self.selector = selectors.DefaultSelector()
        self.running = {}
        self.ending = {}
        self.pending = bytearray()

    def serve(self):
        # Returns at a stop line, when the session closes, or when nobody reads answers any more.
        if not self._take_input(_buffered_input()):
            return
        self.selector.register(0, selectors.EVENT_READ)
        while True:
            events = self.selector.select(_TICK_S if self.ending else None)
            # Answers first: a cancel on the input closes descriptors a stale event may still name.
            for key, _mask in sorted(events, key=lambda event: event[0].fd == 0):
                if not self._handle(key.fd):
                    return
            self._reap(time.monotonic())

    def stop(self):
        for fd in list(self.running):
            self._end(self._release(fd).pid)
        while self.ending:
            self._reap(time.monotonic())
            time.sleep(_TICK_S)

    def _handle(self, fd):
        if fd == 0:
            return self._take_input(os.read(0, _READ_CHUNK))
        return self._collect(fd)

    def _take_input(self, data):
        if not data:
            return False
        self.pending += data
        if b"\\n" not in data:
            return True
        *lines, rest = bytes(self.pending).split(b"\\n")
        self.pending = bytearray(rest)
        for line in lines:
            if line.strip() and not self._on_message(json.loads(line)):
                return False
        return True

    def _on_message(self, message):
        if message.get("stop"):
            return False
        if "cancel" in message:
            self._cancel(message["cancel"])
            return True
        if "wheels" in message:
            _unpack_wheels(message["wheels"])
            return True
        return self._start(message)

    def _start(self, request):
        try:
            read_fd, write_fd = os.pipe()
        except OSError as exc:
            return self._send(_line(_failed_answer(request.get("id"), [], str(exc))))
        try:
            pid = os.fork()
        except OSError as exc:
            os.close(read_fd)
            os.close(write_fd)
            return self._send(_line(_failed_answer(request.get("id"), [], str(exc))))
        if pid == 0:
            os.close(read_fd)
            _serve_request(request, write_fd, self.group, list(self.running))
        os.close(write_fd)
        self.running[read_fd] = _Request(request.get("id"), pid)
        self.selector.register(read_fd, selectors.EVENT_READ)
        return True

    def _collect(self, fd):
        request = self.running.get(fd)
        if request is None:
            return True
        chunk = os.read(fd, _READ_CHUNK)
        if chunk:
            request.chunks.append(chunk)
            return True
        self._release(fd)
        _process_group.kill_group(request.pid)
        status = os.waitpid(request.pid, 0)[1]
        answer = b"".join(request.chunks)
        if answer.endswith(b"\\n"):
            return self._send(answer)
        reason = "The request ended on the remote host without an answer (exit code %d)" % (
            os.waitstatus_to_exitcode(status)
        )
        return self._send(_line(_failed_answer(request.id, [], reason)))

    def _send(self, line):
        try:
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
        except OSError:
            return False
        return True

    def _cancel(self, request_id):
        for fd, request in list(self.running.items()):
            if request.id == request_id:
                self._release(fd)
                self._end(request.pid)
                return

    def _release(self, fd):
        self.selector.unregister(fd)
        os.close(fd)
        return self.running.pop(fd)

    def _end(self, pid):
        os.kill(pid, signal.SIGTERM)
        self.ending[pid] = time.monotonic() + STOP_GRACE_S

    def _reap(self, now):
        # A request told to end gets the grace to unwind; then it and its group are killed.
        for pid, deadline in list(self.ending.items()):
            if deadline <= now:
                _process_group.kill_group(pid)
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            elif os.waitpid(pid, os.WNOHANG)[0] == 0:
                continue
            del self.ending[pid]


def main():
    worker = _Worker()
    try:
        worker.serve()
    finally:
        worker.stop()
        shutil.rmtree(_SCRATCH_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
"""

_SYNTHETIC_PACKAGES = ("wavecore", "wavecore.plugins", "wavecore.connectivity")
# The SQL drivers carried as source and the libraries they import (SQL-15).
_SQL_DRIVER_PACKAGES = ("pg8000", "scramp", "asn1crypto", "dateutil", "pymysql", "pytds")
# The distributions whose source the bundle carries, so importlib.metadata knows their versions.
_CARRIED_DISTRIBUTIONS = (
    "tlslite-ng",
    "ecdsa",
    "six",
    "pg8000",
    "scramp",
    "asn1crypto",
    "python-dateutil",
    "PyMySQL",
    "python-tds",
)


def _collect_package(module: ModuleType) -> dict[str, str]:
    """Map every dotted module name in a package to its source text."""
    root = os.path.dirname(inspect.getfile(module))
    # A nested package sits one directory below the import base per dot in its name.
    base = root
    for _ in range(module.__name__.count(".") + 1):
        base = os.path.dirname(base)
    sources: dict[str, str] = {}
    for dirpath, _dirs, files in os.walk(root):
        for filename in sorted(files):
            if not filename.endswith(".py"):
                continue
            path = os.path.join(dirpath, filename)
            dotted = os.path.relpath(path, base)[:-3].replace(os.sep, ".")
            if dotted.endswith(".__init__"):
                dotted = dotted[: -len(".__init__")]
            with open(path, encoding="utf-8") as handle:
                sources[dotted] = handle.read()
    return sources


def _vendored_sources() -> dict[str, str]:
    """The in-memory source table: the pure-Python libraries and the WAVE cores it vendors."""
    sources: dict[str, str] = {}
    for package in (tlslite, ecdsa, k8s, helm, sql, opensearch):
        sources.update(_collect_package(package))
    for name in _SQL_DRIVER_PACKAGES:
        sources.update(_collect_package(import_module(name)))
    # ecdsa imports six at module load; bare hosts have no site-packages to supply it.
    with open(six.__file__, encoding="utf-8") as handle:
        sources["six"] = handle.read()
    for package in _SYNTHETIC_PACKAGES:
        sources[package] = ""
    with open(http_tls.__file__, encoding="utf-8") as handle:
        sources["wavecore.plugins.http_tls"] = handle.read()
    with open(tls_capabilities.__file__, encoding="utf-8") as handle:
        sources["wavecore.connectivity.tls_capabilities"] = handle.read()
    with open(tls_context.__file__, encoding="utf-8") as handle:
        sources["wavecore.connectivity.tls_context"] = handle.read()
    with open(url_credentials.__file__, encoding="utf-8") as handle:
        sources["wavecore.connectivity.url_credentials"] = handle.read()
    with open(_file_ops.__file__, encoding="utf-8") as handle:
        sources["wavecore.plugins._file_ops"] = handle.read()
    with open(_process_group.__file__, encoding="utf-8") as handle:
        sources["wavecore.plugins._process_group"] = handle.read()
    # The local-process runtime, its watchdog, the Python bridge (PYRUN-12), the block cores,
    # their output core and count wording, the trust core and the proxy core.
    for module in (
        block_outputs,
        _held_run,
        _local_process,
        _local_process_runtime,
        _local_process_watchdog,
        _python_bridge,
        _netcat_core,
        _opensearch_core,
        _ping_core,
        _plural,
        _ports,
        _sql_core,
        _tls_material,
        _user_patterns,
        proxy,
        run_log,
        trust_store,
        web_address,
    ):
        with open(str(module.__file__), encoding="utf-8") as handle:
            sources[module.__name__] = handle.read()
    return dict(sorted(sources.items()))


def worker_bootstrap() -> str:
    """The tiny command that reads the length-prefixed payload from stdin and runs it."""
    return _BOOTSTRAP


def build_bundle(plugin_module_ref: str) -> bytes:
    """Assemble the pure-Python worker payload for a remotable plugin.

    Deterministic: the same plugin id yields the same UTF-8 source bytes.
    Delivered over stdin behind worker_bootstrap() (too large for argv).
    """
    distributions = {name: metadata.version(name) for name in _CARRIED_DISTRIBUTIONS}
    loader = _LOADER.replace("__DISTRIBUTIONS__", repr(distributions)).replace(
        "__SOURCES__", repr(_vendored_sources())
    )
    worker = _WORKER.replace("__PLUGIN_ID__", plugin_module_ref).replace(
        "__TRUST_PEM__", repr(trust_store.builtin_pem())
    )
    return (loader + worker).encode("utf-8")
