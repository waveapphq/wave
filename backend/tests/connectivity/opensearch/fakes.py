"""Scripted OpenSearch answers on the HTTP recording server (REQ-5.1.2).

Answer builders give plain dicts shaped like OpenSearch 3.8 answers; the fixtures and
helpers put them on the loopback recording server of `tests.plugins.http.conftest` and
read back what the block sent. No OpenSearch runs.
"""

import json
import socket
import ssl
import struct
import threading
from collections.abc import Generator, Iterator
from contextlib import contextmanager, suppress
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import pytest

from tests.plugins.http.conftest import (
    RecordingHTTPServer,
    TLSMaterial,
    _RecordingHandler,
)

METADATA_FIELDS = (
    "_id",
    "_index",
    "_routing",
    "_source",
    "_seq_no",
    "_version",
    "_ignored",
    "_field_names",
    "_nested_path",
    "_doc_count",
    "_feature",
    "_data_stream_timestamp",
)


class _PortRecordingHandler(_RecordingHandler):
    """Adds the client's source port, so one connection per request is observable."""

    def send_response(self, code: int, message: str | None = None) -> None:
        # Stamped before the answer goes out, so a client holding its answer always sees the port.
        server: Any = self.server
        server.requests[-1]["client_port"] = self.client_address[1]
        super().send_response(code, message)


def _started(server: RecordingHTTPServer, scheme: str) -> RecordingHTTPServer:
    # A short poll keeps shutdown() near-instant; the default 0.5 s poll dominates every test.
    threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
    ).start()
    server.base_url = f"{scheme}://127.0.0.1:{server.server_address[1]}"
    return server


def serve(
    material: TLSMaterial | None = None, require_client_cert: bool = False
) -> RecordingHTTPServer:
    """A started recording server: plain http, or https with the material's server pair."""
    server = RecordingHTTPServer(("127.0.0.1", 0))
    server.RequestHandlerClass = _PortRecordingHandler
    if material is None:
        return _started(server, "http")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(material.server_cert_path, material.server_key_path)
    if require_client_cert:
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(material.ca_cert_path)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    return _started(server, "https")


def stop(server: RecordingHTTPServer) -> None:
    server.shutdown()
    server.server_close()


@pytest.fixture
def os_http() -> Generator[RecordingHTTPServer, None, None]:
    """Plain http on `server.base_url`."""
    server = serve()
    yield server
    stop(server)


@pytest.fixture
def os_https(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    """https for 127.0.0.1 and localhost, signed by `tls_material.ca_cert_path`."""
    server = serve(tls_material)
    yield server
    stop(server)


@pytest.fixture
def os_mtls(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    """https that requires a client certificate signed by the same CA."""
    server = serve(tls_material, require_client_cert=True)
    yield server
    stop(server)


def port_of(server: RecordingHTTPServer) -> int:
    return int(server.server_address[1])


def record_sni(server: RecordingHTTPServer) -> list[str | None]:
    """The server names later handshakes send (None when the client sends no SNI)."""
    names: list[str | None] = []
    listening: Any = server.socket
    listening.context.sni_callback = lambda _sock, name, _context: names.append(name)
    return names


def hit(
    doc_id: str,
    source: dict[str, Any],
    sort: list[Any] | None = None,
    index: str = "logs-1",
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "_index": index,
        "_id": doc_id,
        "_score": None if sort is not None else 1.0,
        "_source": source,
    }
    if sort is not None:
        entry["sort"] = sort
    return entry


def search_answer(
    hits: list[dict[str, Any]],
    total: int,
    relation: str = "eq",
    *,
    skipped: int = 0,
    failed: int = 0,
    timed_out: bool = False,
    shard_failures: list[dict[str, Any]] | None = None,
    aggregations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    shard_total = failed + skipped + 1
    shards: dict[str, Any] = {
        "total": shard_total,
        "successful": shard_total - failed,
        "skipped": skipped,
        "failed": failed,
    }
    if shard_failures is None and failed:
        shard_failures = [
            {
                "shard": number,
                "index": "logs-1",
                "node": "node-1",
                "reason": {"type": "query_shard_exception", "reason": "failed to create query"},
            }
            for number in range(failed)
        ]
    if shard_failures is not None:
        shards["failures"] = shard_failures
    answer: dict[str, Any] = {
        "took": 3,
        "timed_out": timed_out,
        "_shards": shards,
        "hits": {"total": {"value": total, "relation": relation}, "max_score": None, "hits": hits},
    }
    if aggregations is not None:
        answer["aggregations"] = aggregations
    return answer


def field_caps_answer(
    fields: dict[str, str | list[str]],
    indices: list[str],
    *,
    not_aggregatable: tuple[str, ...] = (),
    metadata: bool = True,
) -> dict[str, Any]:
    """`fields` maps a name to its type, or to several types across the indexes."""
    caps: dict[str, Any] = {}
    if metadata:
        caps.update({name: {name: {"type": name, "searchable": True}} for name in METADATA_FIELDS})
    for name, kinds in fields.items():
        listed = [kinds] if isinstance(kinds, str) else kinds
        caps[name] = {
            kind: {"type": kind, "searchable": True, "aggregatable": name not in not_aggregatable}
            for kind in listed
        }
        if len(listed) > 1:
            for position, kind in enumerate(listed):
                caps[name][kind]["indices"] = [indices[position % len(indices)]]
    return {"indices": indices, "fields": caps}


def resolve_index_answer(
    indices: tuple[str, ...] | list[str] = (),
    aliases: tuple[str, ...] | list[str] = (),
    data_streams: tuple[str, ...] | list[str] = (),
) -> dict[str, Any]:
    return {
        "indices": [{"name": name, "attributes": ["open"]} for name in indices],
        "aliases": [{"name": name, "indices": list(indices[:1])} for name in aliases],
        "data_streams": [
            {
                "name": name,
                "backing_indices": [f".ds-{name}-000001"],
                "timestamp_field": "@timestamp",
            }
            for name in data_streams
        ],
    }


def error_answer(
    error_type: str,
    reason: str,
    status: int,
    root_cause: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    causes = [{"type": error_type, "reason": reason}] if root_cause is None else root_cause
    return {"error": {"root_cause": causes, "type": error_type, "reason": reason}, "status": status}


def unknown_query_answer() -> dict[str, Any]:
    """The cluster's answer (3.8.0, probed) to `{"matchall": {}}` inside `bool.filter`."""
    cause = {
        "type": "parsing_exception",
        "reason": "unknown query [matchall] did you mean any of [match_all, match]?",
        "line": 1,
        "col": 169,
    }
    return {
        "error": {
            "root_cause": [cause],
            "type": "x_content_parse_exception",
            "reason": "[1:169] [bool] failed to parse field [filter]",
            "caused_by": {
                **cause,
                "caused_by": {
                    "type": "named_object_not_found_exception",
                    "reason": "[1:169] unknown field [matchall]",
                },
            },
        },
        "status": 400,
    }


def enqueue_json(
    server: RecordingHTTPServer, payload: Any, status: int = 200, delay: float = 0.0
) -> None:
    server.enqueue(
        status=status,
        body=json.dumps(payload).encode(),
        content_type="application/json",
        delay=delay,
    )


def enqueue_text(
    server: RecordingHTTPServer,
    text: str,
    status: int = 200,
    content_type: str | None = "application/json",
    headers: list[tuple[str, str]] | None = None,
    delay: float = 0.0,
) -> None:
    """An answer body given byte for byte (exact number digits, non-JSON pages)."""
    server.enqueue(
        status=status, headers=headers, body=text.encode(), content_type=content_type, delay=delay
    )


def sent(server: RecordingHTTPServer, index: int) -> dict[str, Any]:
    """Request `index` as sent: `path` stays percent-encoded; `query` is decoded."""
    record = server.requests[index]
    parts = urlsplit(record["path"])
    return {
        "method": record["method"],
        "path": parts.path,
        "query": dict(parse_qsl(parts.query, keep_blank_values=True)),
        "headers": record["headers"],
        "raw_path": record["path"],
        "body": record["body"],
    }


def sent_json(server: RecordingHTTPServer, index: int) -> Any:
    return json.loads(server.requests[index]["body"])


@contextmanager
def silent_listener() -> Iterator[int]:
    """A port whose TCP connect succeeds and which never says a byte."""
    listener = socket.create_server(("127.0.0.1", 0), backlog=8)
    try:
        yield int(listener.getsockname()[1])
    finally:
        listener.close()


class ClosingServer:
    """Reads each request head, then closes (or resets) without an answer; counts connections."""

    def __init__(self, reset: bool = False) -> None:
        self.reset = reset
        self.connections = 0
        self.listener = socket.create_server(("127.0.0.1", 0), backlog=8)
        self.port = int(self.listener.getsockname()[1])
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while True:
            try:
                conn, _address = self.listener.accept()
            except OSError:
                return
            self.connections += 1
            conn.recv(65536)
            if self.reset:
                conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            conn.close()


@contextmanager
def closing_server(reset: bool = False) -> Iterator[ClosingServer]:
    server = ClosingServer(reset)
    try:
        yield server
    finally:
        with suppress(OSError):
            server.listener.shutdown(socket.SHUT_RDWR)
        server.listener.close()
