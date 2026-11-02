"""The OpenSearch block through the run's SSH tunnels (REQ-5.1.2, OS-14).

prepare() settles on WAVE what only WAVE knows: a Cluster URL on 127.0.0.1 or localhost at an
open tunnel's Local Port dials the tunnel as written, while the certificate name, SNI and Host
header use the far host; the Basic credential's header text is handed back to be masked.
"""

import base64
import re
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.connectivity.opensearch.fakes import enqueue_json, field_caps_answer, port_of, record_sni
from tests.plugins.http.conftest import RecordingHTTPServer, TLSMaterial
from tests.plugins.netcat.conftest import tunnel_registry
from tests.plugins.opensearch.conftest import (
    FakeTimer,
    FixedClock,
    LogRecorder,
    host_of,
    os_context,
    os_params,
    served,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.opensearch import OpenSearchPlugin, prepare

LOCAL = 15432
FAR = "opensearch.internal:9200"
ROUTED = {"server_name": "opensearch.internal", "host_header": "opensearch.internal:9200"}
NO_INDEX = field_caps_answer({}, [])


def basic(username: str, password: str) -> str:
    """The Basic credential's header text, as the block sends it after `Basic `."""
    return base64.b64encode(f"{username}:{password}".encode()).decode("ascii")


def registry_for(case: str, port: int = LOCAL) -> SSHSessionRegistry | None:
    """A run whose tunnel on `port` is open, closed, or elsewhere, per `case`."""
    if case == "registry None":
        return None
    registry = tunnel_registry({port + 1 if case == "other port" else port: FAR}, MagicMock())
    if case == "tunnel closed":
        assert registry.close_tunnel(f"t{port}") is True
    return registry


def optional_keys(case: str, port: int = LOCAL) -> dict[str, Any]:
    """The context keys of a run shaped by `case`; no key at all without a registry."""
    return {} if case == "no registry" else {"ssh_session_registry": registry_for(case, port)}


def prepared(params: dict[str, Any], **optional: Any) -> tuple[dict[str, Any], list[str]]:
    return prepare(params, os_context(params, **optional))


class TestATunneledUrl:
    """A loopback Cluster URL on an open tunnel's Local Port: the far host names the cluster."""

    @pytest.mark.parametrize(
        "url",
        ["http://127.0.0.1:15432", "https://localhost:15432", "http://127.0.0.1:15432/os/"],
        ids=["address", "name", "gateway-prefix"],
    )
    def test_the_far_host_becomes_the_server_name_and_the_host_header(self, url: str) -> None:
        ssh_connection = MagicMock()
        params = os_params(url=url)

        core, values = prepared(
            params, ssh_session_registry=tunnel_registry({LOCAL: FAR}, ssh_connection)
        )

        assert core == {**params, **ROUTED}
        assert values == []
        assert ssh_connection.mock_calls == []

    @pytest.mark.parametrize(
        ("url", "port"),
        [("https://localhost", 443), ("http://127.0.0.1", 80)],
        ids=["https-443", "http-80"],
    )
    def test_a_url_without_a_port_looks_up_the_scheme_default_port(
        self, url: str, port: int
    ) -> None:
        params = os_params(url=url)

        core, _values = prepared(params, ssh_session_registry=tunnel_registry({port: FAR}, None))

        assert core == {**params, **ROUTED}


class TestAnUntunneledUrl:
    """Any other host, port or run leaves the params as they are: the URL names the cluster."""

    @pytest.mark.parametrize(
        ("case", "url"),
        [
            ("no registry", "http://127.0.0.1:15432"),
            ("registry None", "http://127.0.0.1:15432"),
            ("tunnel closed", "https://localhost:15432"),
            ("other port", "http://127.0.0.1:15432"),
            ("open tunnel", "https://opensearch.internal:15432"),
            ("open tunnel", "http://127.0.0.2:15432"),
            ("open tunnel", "http://[::1]:15432"),
        ],
    )
    def test_no_route_adds_nothing(self, case: str, url: str) -> None:
        params = os_params(url=url)

        core, values = prepared(params, **optional_keys(case))

        assert core == params
        assert values == []

    @pytest.mark.parametrize(
        "url",
        ["", "http://", "https://:15432"],
        ids=["empty", "scheme-only", "port-without-host"],
    )
    def test_a_blank_host_is_passed_through(self, url: str) -> None:
        params = os_params(url=url)

        core, values = prepared(params, ssh_session_registry=tunnel_registry({LOCAL: FAR}, None))

        assert core == params
        assert values == []

    @pytest.mark.parametrize(
        "url",
        [
            "ftp://127.0.0.1:15432",
            "127.0.0.1:15432",
            "http://127.0.0.1:99999",
            "https://127.0.0.1:abc",
            "http://wave:s3cr3t@127.0.0.1:15432",
            "http://127.0.0.1:15432/?pretty",
            "http://127.0.0.1:15432#top",
        ],
        ids=[
            "other-scheme",
            "no-scheme",
            "port-past-65535",
            "port-not-a-number",
            "credentials",
            "query",
            "fragment",
        ],
    )
    def test_a_url_that_does_not_parse_is_passed_through_for_the_core_to_refuse(
        self, url: str
    ) -> None:
        params = os_params(url=url)

        core, values = prepared(params, ssh_session_registry=tunnel_registry({LOCAL: FAR}, None))

        assert core == params
        assert values == []


class TestTheBasicCredentialIsMasked:
    """With Username set, prepare hands back the Basic header text as a value to mask."""

    @pytest.mark.parametrize(
        ("overrides", "values"),
        [
            pytest.param(
                {"username": "wave", "password": "s3cr3t"},
                ["d2F2ZTpzM2NyM3Q="],
                id="username-and-password",
            ),
            pytest.param({"username": "wave"}, [basic("wave", "")], id="username-alone"),
            pytest.param(
                {"username": "wave", "password": ""}, [basic("wave", "")], id="empty-password"
            ),
            pytest.param(
                {"username": "wave", "password": None}, [basic("wave", "")], id="none-password"
            ),
            pytest.param(
                {"username": "wäve", "password": "pässwörd"},
                [basic("wäve", "pässwörd")],
                id="utf8",
            ),
            pytest.param({}, [], id="no-credentials"),
            pytest.param({"username": ""}, [], id="empty-username"),
            pytest.param({"username": None}, [], id="none-username"),
            pytest.param({"api_key": "os_key"}, [], id="api-key"),
            pytest.param({"bearer_token": "eyJ.x.y"}, [], id="bearer-token"),
        ],
    )
    def test_the_values_to_mask(self, overrides: dict[str, Any], values: list[str]) -> None:
        params = os_params(**overrides)

        core, masked = prepared(params)

        assert masked == values
        assert core == params

    def test_a_tunnel_and_a_credential_together(self) -> None:
        params = os_params(url="https://localhost:15432", username="wave", password="s3cr3t")

        core, values = prepared(params, ssh_session_registry=tunnel_registry({LOCAL: FAR}, None))

        assert core == {**params, **ROUTED}
        assert values == ["d2F2ZTpzM2NyM3Q="]


class TestThroughExecute:
    """The block dials the tunnel's Local Port and names the far host on the wire."""

    @pytest.fixture(autouse=True)
    def _fixed_time(self, clock: FixedClock, deadline: type[FakeTimer]) -> None:
        """A fixed now and a deadline timer that never fires on its own."""

    async def test_the_host_header_names_the_far_host(
        self, os_http: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        enqueue_json(os_http, NO_INDEX)
        registry = tunnel_registry({port_of(os_http): FAR}, MagicMock())

        out = await OpenSearchPlugin().execute(
            os_context(served(os_http), log, ssh_session_registry=registry)
        )

        assert out["success"] is True
        assert [request["headers"]["host"] for request in os_http.requests] == [FAR]

    async def test_the_far_host_is_the_server_name_and_the_checked_name(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial, log: LogRecorder
    ) -> None:
        enqueue_json(os_https, NO_INDEX)
        names = record_sni(os_https)
        registry = tunnel_registry({port_of(os_https): "localhost:9200"}, MagicMock())
        params = served(os_https, ca_cert=tls_material.ca_cert_pem)

        out = await OpenSearchPlugin().execute(
            os_context(params, log, ssh_session_registry=registry)
        )

        assert out["success"] is True
        assert names == ["localhost"]
        assert os_https.requests[0]["headers"]["host"] == "localhost:9200"

    async def test_a_far_host_the_certificate_does_not_name_fails_verification(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial, log: LogRecorder
    ) -> None:
        registry = tunnel_registry({port_of(os_https): FAR}, MagicMock())
        params = served(os_https, ca_cert=tls_material.ca_cert_pem, on_error="record")

        out = await OpenSearchPlugin().execute(
            os_context(params, log, ssh_session_registry=registry)
        )

        prefix = f"Could not connect to OpenSearch at 127.0.0.1:{port_of(os_https)}: "
        assert re.match(rf"^{re.escape(prefix)}.*CERTIFICATE_VERIFY_FAILED.*$", out["error"])
        assert (out["success"], out["reason"]) == (False, "Unreachable")
        assert os_https.requests == []

    async def test_verify_off_still_sends_the_far_host_name(
        self, os_https: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        enqueue_json(os_https, NO_INDEX)
        names = record_sni(os_https)
        registry = tunnel_registry({port_of(os_https): FAR}, MagicMock())
        params = served(os_https, verify_ssl=False)

        await OpenSearchPlugin().execute(os_context(params, log, ssh_session_registry=registry))

        assert names == ["opensearch.internal"]
        assert os_https.requests[0]["headers"]["host"] == FAR

    async def test_without_a_tunnel_the_url_names_the_cluster(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial, log: LogRecorder
    ) -> None:
        enqueue_json(os_https, NO_INDEX)
        names = record_sni(os_https)
        registry = tunnel_registry({port_of(os_https) + 1: FAR}, MagicMock())
        params = served(os_https, ca_cert=tls_material.ca_cert_pem)

        out = await OpenSearchPlugin().execute(
            os_context(params, log, ssh_session_registry=registry)
        )

        assert out["success"] is True
        assert names == [None]
        assert os_https.requests[0]["headers"]["host"] == host_of(os_https)

    async def test_the_basic_credential_is_masked_before_the_first_request(
        self, os_http: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        enqueue_json(os_http, NO_INDEX)
        registered: list[tuple[str, int]] = []
        params = served(os_http, username="wave", password="s3cr3t")

        def register_secret(value: str) -> None:
            registered.append((value, len(os_http.requests)))

        out = await OpenSearchPlugin().execute(
            os_context(params, log, register_secret=register_secret)
        )

        assert out["success"] is True
        assert registered == [("d2F2ZTpzM2NyM3Q=", 0)]
        assert os_http.requests[0]["headers"]["authorization"] == "Basic d2F2ZTpzM2NyM3Q="
