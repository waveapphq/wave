"""App startup registers WAVE's certificate trust resolver and serves the network pages.

A blank CA Certificate trusts what Settings > Network > Certificates holds, read when each
connection is made (REQ-4.5.16); startup hands that reader to the trust core. The SSH Hosts
and Certificates pages each have a router of their own (REQ-4.5.14, REQ-4.5.16).
"""

from collections.abc import Iterator
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api import app as app_module
from wavecore.api.app import app


def _certificates() -> Any:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    from wavecore.api.services.network import certificates

    return certificates


def _trust_store() -> Any:
    from wavecore.connectivity import trust_store

    return trust_store


@pytest.fixture
def startup_resolver() -> Iterator[None]:
    """No resolver before the test; afterwards the one app startup registers, as other runs see."""
    _trust_store().set_resolver(None)
    yield
    _certificates().register_trust_resolver()


class TestStartupRegistersTheTrustResolver:
    """Startup hands the Settings reader to the trust core, beside the other startup checks."""

    def test_startup_invokes_register_trust_resolver(self) -> None:
        # os._exit is mocked so a regressed startup gate cannot kill the test process.
        with (
            patch.object(_certificates(), "register_trust_resolver") as register,
            patch.object(app_module.os, "_exit") as mock_exit,
        ):
            with TestClient(app):
                pass

        register.assert_called_once_with()
        mock_exit.assert_not_called()

    @pytest.mark.usefixtures("startup_resolver")
    def test_after_startup_a_blank_ca_trusts_what_settings_hold(self) -> None:
        settings = _trust_store().TrustSpec(
            source="host",
            additional_pem="-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
            additional_count=1,
            builtin_label="June 2026",
        )

        with (
            patch.object(_certificates(), "current_trust_spec", return_value=settings),
            patch.object(app_module.os, "_exit"),
        ):
            with TestClient(app):
                active = _trust_store().active_spec()

        assert active == settings


class TestTheNetworkPagesAreServed:
    """The SSH Hosts and Certificates routers are included in the app."""

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/network/ssh-hosts"),
            ("patch", "/network/ssh-hosts"),
            ("get", "/network/ssh-hosts/policy"),
            ("post", "/network/ssh-hosts/parse"),
            ("post", "/network/ssh-hosts/detect"),
            ("get", "/network/certificates"),
            ("patch", "/network/certificates"),
            ("post", "/network/certificates/parse"),
            ("get", "/network/certificates/builtin"),
            ("get", "/network/certificates/{certificate_id}"),
        ],
    )
    def test_the_endpoint_is_registered(self, method: str, path: str) -> None:
        paths = app.openapi()["paths"]

        assert method in paths.get(path, {})
