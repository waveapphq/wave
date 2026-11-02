"""K8s verb-core session context tests (REQ-5.1.1, REQ-3.4.1.5).

require_context parses the session param (the kubeconfig-shaped JSON Config a
K8s Connect block emits) into a frozen K8sContext, and serialize_context renders
one back out. Both halves live in the verb core, so a vendored copy reads and
writes the same session a local run does, using nothing but the standard library.
"""

import base64
import dataclasses
import json
import re
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import SERVER
from wavecore.connectivity.k8s.verbs._context import (
    K8sContext,
    require_context,
    serialize_context,
)

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_CA_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jYS1wZW0=\n-----END CERTIFICATE-----\n"
_CERT_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jbGllbnQ=\n-----END CERTIFICATE-----\n"
_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END PRIVATE KEY-----\n"
_ON_ERROR_MODES = ["fail", "record"]
_CONFIG_KEYS = ["apiVersion", "kind", "clusters", "users", "contexts", "current-context"]


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _config(
    cluster: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
    namespace: str | None = "default",
) -> dict[str, Any]:
    cluster_map: dict[str, Any] = {"server": SERVER}
    cluster_map.update(cluster or {})
    context_map: dict[str, Any] = {"cluster": "wave", "user": "wave"}
    if namespace is not None:
        context_map["namespace"] = namespace
    return {
        "apiVersion": "v1",
        "kind": "Config",
        "clusters": [{"name": "wave", "cluster": cluster_map}],
        "users": [{"name": "wave", "user": dict(user or {})}],
        "contexts": [{"name": "wave", "context": context_map}],
        "current-context": "wave",
    }


def _session(**kwargs: Any) -> dict[str, Any]:
    return {"session": json.dumps(_config(**kwargs))}


def _without(key: str) -> str:
    config = _config()
    del config[key]
    return json.dumps(config)


_REJECTED_SESSIONS = [
    pytest.param("not json {", id="not-json"),
    pytest.param("42", id="json-scalar"),
    pytest.param('"a string"', id="json-string"),
    pytest.param("[]", id="json-list"),
    pytest.param("{}", id="empty-object"),
    pytest.param(_without("clusters"), id="missing-clusters"),
    pytest.param(_without("users"), id="missing-users"),
    pytest.param(_without("contexts"), id="missing-contexts"),
    pytest.param(json.dumps({**_config(), "clusters": []}), id="empty-clusters"),
    pytest.param(json.dumps({**_config(), "kind": "NotAConfig"}), id="wrong-kind"),
    pytest.param(json.dumps(_config(cluster={"server": None})), id="cluster-without-server"),
]


class TestRequireContext:
    """Session parse into the frozen context, with the exact reject message."""

    def test_minimal_config_parses_with_defaults(self) -> None:
        context = require_context(_session())

        assert isinstance(context, K8sContext)
        assert context.server == SERVER
        assert context.verify is True
        assert context.ca_cert is None
        assert context.server_name is None
        assert context.token is None
        assert context.client_cert is None
        assert context.client_key is None
        assert context.namespace == "default"
        assert context.tls_min_version == "1.2"
        assert context.tls_max_version == "1.3"
        assert context.cipher_suites is None

    def test_token_credential_is_recovered(self) -> None:
        context = require_context(_session(user={"token": "sa-tok"}))

        assert context.token == "sa-tok"

    def test_client_cert_pair_is_recovered(self) -> None:
        user = {
            "client-certificate-data": _b64(_CERT_PEM),
            "client-key-data": _b64(_KEY_PEM),
        }

        context = require_context(_session(user=user))

        assert context.client_cert == _CERT_PEM
        assert context.client_key == _KEY_PEM

    def test_ca_and_server_name_are_recovered(self) -> None:
        cluster = {
            "certificate-authority-data": _b64(_CA_PEM),
            "tls-server-name": "kwok-internal",
        }

        context = require_context(_session(cluster=cluster))

        assert context.ca_cert == _CA_PEM
        assert context.server_name == "kwok-internal"

    def test_skip_verify_is_recovered(self) -> None:
        context = require_context(_session(cluster={"insecure-skip-tls-verify": True}))

        assert context.verify is False

    def test_tls_constraint_extension_is_recovered(self) -> None:
        cluster = {
            "extensions": [
                {
                    "name": "wave",
                    "extension": {
                        "tls_min_version": "1.0",
                        "tls_max_version": "1.2",
                        "cipher_suites": ["ECDHE-ECDSA-AES128-GCM-SHA256"],
                    },
                }
            ]
        }

        context = require_context(_session(cluster=cluster))

        assert context.tls_min_version == "1.0"
        assert context.tls_max_version == "1.2"
        assert context.cipher_suites == ["ECDHE-ECDSA-AES128-GCM-SHA256"]

    def test_namespace_is_recovered(self) -> None:
        context = require_context(_session(namespace="apps"))

        assert context.namespace == "apps"

    def test_missing_namespace_falls_back_to_default(self) -> None:
        context = require_context(_session(namespace=None))

        assert context.namespace == "default"

    def test_context_is_frozen(self) -> None:
        context = require_context(_session())

        with pytest.raises(dataclasses.FrozenInstanceError):
            context.server = "https://other.example"

    @pytest.mark.parametrize("session_value", _REJECTED_SESSIONS)
    def test_unreadable_session_values_are_rejected(self, session_value: str) -> None:
        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context({"session": session_value})

    def test_absent_session_param_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context({})

    def test_non_string_session_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context({"session": {"apiVersion": "v1"}})


class TestAlwaysHardFail:
    """The always-hard-fail classes raise under both on_error values."""

    @pytest.mark.parametrize("on_error", _ON_ERROR_MODES)
    @pytest.mark.parametrize("session_value", _REJECTED_SESSIONS)
    def test_a_rejected_session_raises_in_both_modes(
        self, session_value: str, on_error: str
    ) -> None:
        params = {"session": session_value, "on_error": on_error}

        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context(params)

    @pytest.mark.parametrize("on_error", _ON_ERROR_MODES)
    def test_an_absent_session_raises_in_both_modes(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context({"on_error": on_error})


class TestSerializeContext:
    """The emit side sits beside the parse side, and neither leaves the standard library."""

    def test_the_session_is_json_text_in_kubeconfig_key_order(self) -> None:
        session = serialize_context(K8sContext(server=SERVER, namespace="apps"))

        config = json.loads(session)

        assert list(config) == _CONFIG_KEYS
        assert config["kind"] == "Config"
        assert config["current-context"] == "wave"

    def test_a_full_credential_session_parses_back_into_the_same_context(self) -> None:
        context = K8sContext(
            server=SERVER,
            ca_cert=_CA_PEM,
            verify=False,
            server_name="kwok-internal",
            tls_min_version="1.0",
            tls_max_version="1.2",
            cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256"],
            token="sa-tok",
            client_cert=_CERT_PEM,
            client_key=_KEY_PEM,
            namespace="apps",
        )

        assert require_context({"session": serialize_context(context)}) == context

    def test_the_tls_pins_ride_the_wave_cluster_extension(self) -> None:
        context = K8sContext(server=SERVER, cipher_suites=["TLS_AES_128_GCM_SHA256"])

        cluster = json.loads(serialize_context(context))["clusters"][0]["cluster"]

        assert cluster["extensions"] == [
            {
                "name": "wave",
                "extension": {
                    "tls_min_version": "1.2",
                    "tls_max_version": "1.3",
                    "cipher_suites": ["TLS_AES_128_GCM_SHA256"],
                },
            }
        ]
