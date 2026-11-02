"""App startup registers WAVE's proxy resolver and serves the Proxy pages.

A block that uses the proxy asks the Proxy setting for its route, read when each request
is made (REQ-4.7.14, REQ-3.4.2.10); startup hands that reader to the proxy core. The Proxy
pages have a router of their own, beside the SSH Hosts and Certificates routers.
"""

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api import app as app_module
from wavecore.api.app import app
from wavecore.api.services.network import proxy as proxy_settings
from wavecore.connectivity import proxy


def _through_the_proxy(scheme: str, host: str, port: int) -> bool:
    return True


@pytest.fixture
def no_resolver() -> Iterator[None]:
    """No resolver before the test, and none left behind for the tests that follow."""
    proxy.set_resolver(None)
    yield
    proxy.set_resolver(None)


class TestStartupRegistersTheProxyResolver:
    """Startup hands the Settings reader to the proxy core, beside the other startup steps."""

    def test_startup_invokes_register_proxy_resolver(self) -> None:
        # os._exit is mocked so a regressed startup gate cannot kill the test process.
        with (
            patch.object(proxy_settings, "register_proxy_resolver") as register,
            patch.object(app_module.os, "_exit") as mock_exit,
        ):
            with TestClient(app):
                pass

        register.assert_called_once_with()
        mock_exit.assert_not_called()

    @pytest.mark.usefixtures("no_resolver")
    def test_after_startup_a_request_gets_the_proxy_settings_hold(self) -> None:
        endpoint = proxy.ProxyEndpoint(
            host="proxy.lab.example", port=3128, username=None, password=None
        )
        settings = proxy.ProxySpec(https=endpoint, http=endpoint, through_proxy=_through_the_proxy)

        with (
            patch.object(proxy_settings, "current_proxy_spec", return_value=settings),
            patch.object(app_module.os, "_exit"),
        ):
            with TestClient(app):
                active = proxy.active_proxy()

        assert active == settings


class TestTheProxyPagesAreServed:
    """The Proxy router is included in the app."""

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/network/proxy"),
            ("patch", "/network/proxy"),
            ("get", "/network/proxy/blocks"),
            ("post", "/network/proxy/validate"),
        ],
    )
    def test_the_endpoint_is_registered(self, method: str, path: str) -> None:
        paths = app.openapi()["paths"]

        assert method in paths.get(path, {})
