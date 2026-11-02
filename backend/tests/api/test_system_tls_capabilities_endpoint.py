"""GET /system/tls-capabilities: the fixed TLS cipher-suite catalog endpoint.

Serves {ciphers: [{openssl, iana, min_version, max_version}], defaults:
{block: {"<min>-<max>": [openssl names]}}} for the FE cipher picker and the
gray Cipher Suites default - static and host-independent, read-only, standard
success envelope and caching posture matching GET /system/info.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.connectivity import tls_capabilities

_VERSIONS = ("1.0", "1.1", "1.2", "1.3")
_RANGES = [(low, high) for i, low in enumerate(_VERSIONS) for high in _VERSIONS[i:]]


@pytest.fixture
def client() -> TestClient:
    """Create FastAPI test client."""
    from wavecore.api.app import app

    return TestClient(app)


class TestGetTlsCapabilitiesEndpoint:
    def test_returns_200_with_success_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/system/tls-capabilities")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "meta" in data
        assert "request_id" in data["meta"]

    def test_payload_serves_the_static_catalog(self, client: TestClient) -> None:
        response = client.get("/api/v1/system/tls-capabilities")

        payload = response.json()["data"]
        assert payload == tls_capabilities.capabilities()
        for row in payload["ciphers"]:
            assert set(row) == {"openssl", "iana", "min_version", "max_version"}

    def test_payload_serves_a_default_per_block_for_every_ordered_tls_range(
        self, client: TestClient
    ) -> None:
        defaults = client.get("/api/v1/system/tls-capabilities").json()["data"]["defaults"]

        assert set(defaults) == {"http-client", "k8s-connect"}
        expected_keys = {f"{low}-{high}" for low, high in _RANGES}
        assert set(defaults["http-client"]) == expected_keys
        assert set(defaults["k8s-connect"]) == expected_keys

    @pytest.mark.parametrize(("low", "high"), _RANGES)
    def test_each_default_is_the_list_the_run_uses_for_an_unset_field(
        self, client: TestClient, low: str, high: str
    ) -> None:
        defaults = client.get("/api/v1/system/tls-capabilities").json()["data"]["defaults"]

        key = f"{low}-{high}"
        assert defaults["http-client"][key] == tls_capabilities.suites_for_range(low, high)
        assert defaults["k8s-connect"][key] == tls_capabilities.suites_for_range(low, high)

    def test_sets_long_cache_headers(self, client: TestClient) -> None:
        response = client.get("/api/v1/system/tls-capabilities")

        assert response.status_code == 200
        assert "max-age=" in response.headers["Cache-Control"]

    def test_read_only_and_stable_across_calls(self, client: TestClient) -> None:
        first = client.get("/api/v1/system/tls-capabilities").json()["data"]
        second = client.get("/api/v1/system/tls-capabilities").json()["data"]

        assert first == second

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        with patch("wavecore.api.routes.system.tls_capabilities.capabilities") as mock_caps:
            mock_caps.side_effect = RuntimeError("Unexpected error")

            response = client.get("/api/v1/system/tls-capabilities")

        assert response.status_code == 500
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "INTERNAL_ERROR"
        assert "correlation_id" in data["error"]
