"""K8s Connect verb tests (REQ-5.1.1, REQ-4.6.3, REQ-4.5.5, REQ-3.4.1.5).

connect.run is the sync core behind the K8s Connect block: it version-checks the
cluster through the REST core, optionally mints a service-account run token, and
returns the wire envelope carrying the emitted session and the raw cluster
version. It always hard-fails - there is no output core and no record mode.
"""

import base64
import inspect
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import SERVER, exact
from wavecore.connectivity import tls_capabilities
from wavecore.connectivity.k8s.verbs import connect
from wavecore.connectivity.k8s.verbs._context import require_context

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.connect.K8sClient"
_VERSION = "v1.33.0"
_MINTED_TOKEN = "minted-token"
_MINTED_EXPIRY = "2026-08-19T15:00:00Z"
_CA_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jYS1wZW0=\n-----END CERTIFICATE-----\n"
_CERT_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jbGllbnQ=\n-----END CERTIFICATE-----\n"
_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END PRIVATE KEY-----\n"


class _Log:
    """Records the (level, message) pairs a verb writes."""

    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.entries.append((level, message))


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _client_mock(
    version: str = _VERSION,
    granted: tuple[str, str] = (_MINTED_TOKEN, _MINTED_EXPIRY),
) -> MagicMock:
    client_cls = MagicMock()
    client_cls.return_value.server_version.return_value = version
    client_cls.return_value.token_request.return_value = granted
    return client_cls


def _params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"api_url": SERVER}
    params.update(overrides)
    return params


def _token_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "acquire_run_token": True,
        "run_token_service_account": "wave-tests",
    }
    params.update(overrides)
    return _params(**params)


def _run(
    params: dict[str, Any],
    client_cls: MagicMock | None = None,
    log: Any = None,
) -> dict[str, Any]:
    cls = client_cls if client_cls is not None else _client_mock()
    with patch(_CLIENT_TARGET, cls):
        envelope: dict[str, Any] = connect.run(params, log if log is not None else _Log())
    return envelope


def _outputs(params: dict[str, Any], client_cls: MagicMock | None = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(params, client_cls)["outputs"]
    return outputs


def _session_config(outputs: dict[str, Any]) -> dict[str, Any]:
    config: dict[str, Any] = json.loads(outputs["session"])
    return config


def _cluster(outputs: dict[str, Any]) -> dict[str, Any]:
    cluster: dict[str, Any] = _session_config(outputs)["clusters"][0]["cluster"]
    return cluster


def _user(outputs: dict[str, Any]) -> dict[str, Any]:
    user: dict[str, Any] = _session_config(outputs)["users"][0]["user"]
    return user


def _extension(outputs: dict[str, Any]) -> dict[str, Any]:
    extension: dict[str, Any] = _cluster(outputs)["extensions"][0]["extension"]
    return extension


def _constructed_context(client_cls: MagicMock) -> Any:
    call = client_cls.call_args
    return call.args[0] if call.args else call.kwargs["context"]


def _constructed_timeout(client_cls: MagicMock) -> Any:
    call = client_cls.call_args
    if "timeout" in call.kwargs:
        return call.kwargs["timeout"]
    return call.args[1] if len(call.args) > 1 else None


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(connect.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(connect.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(connect.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_the_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_params(token="sa-tok", ca_cert=_CA_PEM))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_the_outputs_are_exactly_the_session_and_the_cluster_version(self) -> None:
        outputs = _outputs(_params())

        assert set(outputs) == {"session", "cluster_version"}
        assert isinstance(outputs["session"], str)
        assert isinstance(outputs["cluster_version"], str)

    def test_connect_carries_no_output_core(self) -> None:
        outputs = _outputs(_params())

        assert "success" not in outputs
        assert "error" not in outputs
        assert "reason" not in outputs
        assert "__block_warning" not in outputs


class TestSecrets:
    """Connect masks its session through the output schema, not the envelope list."""

    def test_a_plain_connect_reports_no_secrets(self) -> None:
        envelope = _run(_params(token="sa-tok"))

        assert envelope["secrets"] == []

    def test_a_minted_run_token_adds_no_envelope_secret(self) -> None:
        envelope = _run(_token_params())

        assert envelope["secrets"] == []


class TestEmittedSession:
    """The session is a kubectl-compatible JSON Config named wave."""

    def test_the_session_is_a_config_named_wave(self) -> None:
        config = _session_config(_outputs(_params(token="sa-tok")))

        assert config["apiVersion"] == "v1"
        assert config["kind"] == "Config"
        assert config["current-context"] == "wave"
        assert [entry["name"] for entry in config["clusters"]] == ["wave"]
        assert [entry["name"] for entry in config["users"]] == ["wave"]
        assert [entry["name"] for entry in config["contexts"]] == ["wave"]
        assert config["clusters"][0]["cluster"]["server"] == SERVER
        assert config["contexts"][0]["context"]["cluster"] == "wave"
        assert config["contexts"][0]["context"]["user"] == "wave"

    def test_the_cluster_version_is_the_raw_git_version(self) -> None:
        outputs = _outputs(_params(), _client_mock(version="v1.28.5-eks-5e0fdde"))

        assert outputs["cluster_version"] == "v1.28.5-eks-5e0fdde"

    def test_a_token_only_credential_form(self) -> None:
        assert _user(_outputs(_params(token="sa-tok"))) == {"token": "sa-tok"}

    def test_a_certificate_only_credential_form(self) -> None:
        outputs = _outputs(_params(client_cert=_CERT_PEM, client_key=_KEY_PEM))

        assert _user(outputs) == {
            "client-certificate-data": _b64(_CERT_PEM),
            "client-key-data": _b64(_KEY_PEM),
        }

    def test_both_credential_forms_together(self) -> None:
        outputs = _outputs(_params(token="sa-tok", client_cert=_CERT_PEM, client_key=_KEY_PEM))

        assert _user(outputs) == {
            "token": "sa-tok",
            "client-certificate-data": _b64(_CERT_PEM),
            "client-key-data": _b64(_KEY_PEM),
        }

    def test_an_anonymous_credential_form(self) -> None:
        assert _user(_outputs(_params())) == {}

    def test_the_ca_and_the_server_name_are_embedded(self) -> None:
        cluster = _cluster(_outputs(_params(ca_cert=_CA_PEM, tls_server_name="kwok-internal")))

        assert cluster["certificate-authority-data"] == _b64(_CA_PEM)
        assert cluster["tls-server-name"] == "kwok-internal"

    def test_skip_verify_is_embedded_only_when_verification_is_off(self) -> None:
        assert _cluster(_outputs(_params(verify_ssl=False)))["insecure-skip-tls-verify"] is True
        assert "insecure-skip-tls-verify" not in _cluster(_outputs(_params()))

    def test_the_namespace_is_carried_and_defaults_to_default(self) -> None:
        named = _session_config(_outputs(_params(namespace="apps")))
        unnamed = _session_config(_outputs(_params()))

        assert named["contexts"][0]["context"]["namespace"] == "apps"
        assert unnamed["contexts"][0]["context"]["namespace"] == "default"


class TestTlsConstraintExtension:
    """The TLS pins ride the wave cluster extension so the value stays kubectl-loadable."""

    def test_unset_ciphers_record_the_effective_list_for_the_default_range(self) -> None:
        assert _cluster(_outputs(_params()))["extensions"] == [
            {
                "name": "wave",
                "extension": {
                    "tls_min_version": "1.2",
                    "tls_max_version": "1.3",
                    "cipher_suites": tls_capabilities.suites_for_range("1.2", "1.3"),
                },
            }
        ]

    def test_unset_ciphers_on_a_narrowed_range_record_only_in_range_suites(self) -> None:
        extension = _extension(_outputs(_params(tls_max_version="1.2")))

        assert extension["cipher_suites"] == tls_capabilities.suites_for_range("1.2", "1.2")

    def test_unset_ciphers_on_a_tls13_only_range_record_the_tls13_family(self) -> None:
        extension = _extension(_outputs(_params(tls_min_version="1.3")))

        assert extension["cipher_suites"] == tls_capabilities.suites_for_range("1.3", "1.3")

    @pytest.mark.parametrize(
        ("low", "high"),
        [
            (low, high)
            for i, low in enumerate(("1.0", "1.1", "1.2", "1.3"))
            for high in ("1.0", "1.1", "1.2", "1.3")[i:]
        ],
    )
    def test_unset_ciphers_record_the_default_the_tls_capabilities_serve(
        self, low: str, high: str
    ) -> None:
        defaults = tls_capabilities.capabilities()["defaults"]["k8s-connect"]

        extension = _extension(_outputs(_params(tls_min_version=low, tls_max_version=high)))

        assert extension["cipher_suites"] == defaults[f"{low}-{high}"]

    def test_an_explicit_empty_cipher_list_passes_through(self) -> None:
        assert _extension(_outputs(_params(cipher_suites=[])))["cipher_suites"] == []

    def test_explicit_pins_are_carried_verbatim(self) -> None:
        pins = ["ECDHE-ECDSA-AES128-GCM-SHA256", "TLS_AES_128_GCM_SHA256"]
        outputs = _outputs(
            _params(tls_min_version="1.0", tls_max_version="1.2", cipher_suites=pins)
        )

        assert _extension(outputs) == {
            "tls_min_version": "1.0",
            "tls_max_version": "1.2",
            "cipher_suites": pins,
        }


class TestVersionFloor:
    """The 1.19 floor via /version: parsed compare, raw report."""

    def test_a_version_below_the_floor_reports_the_raw_git_version(self) -> None:
        message = "WAVE needs Kubernetes 1.19 or newer - this cluster reports v1.18.3"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(), _client_mock(version="v1.18.3"))

    def test_the_floor_version_itself_passes(self) -> None:
        assert _outputs(_params(), _client_mock(version="v1.19.0"))["cluster_version"] == "v1.19.0"

    def test_the_minor_version_compares_numerically_not_lexically(self) -> None:
        outputs = _outputs(_params(), _client_mock(version="v1.100.1"))

        assert outputs["cluster_version"] == "v1.100.1"

    def test_a_failed_version_read_wraps_the_detail(self) -> None:
        client_cls = _client_mock()
        client_cls.return_value.server_version.side_effect = RuntimeError("connection reset")
        message = f"Could not read the Kubernetes version from {SERVER}: connection reset"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(), client_cls)

    def test_an_unrecognized_git_version_reads_as_an_unreadable_version(self) -> None:
        message = (
            f"Could not read the Kubernetes version from {SERVER}: "
            "unrecognized gitVersion 'unknown'"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(), _client_mock(version="unknown"))

    def test_a_version_below_the_floor_never_mints_a_run_token(self) -> None:
        client_cls = _client_mock(version="v1.18.3")

        with pytest.raises(ValueError):
            _run(_token_params(), client_cls)

        client_cls.return_value.token_request.assert_not_called()


class TestRunToken:
    """Run-token acquisition: the request, the session swap, the granted expiry."""

    def test_the_request_carries_the_service_account_namespace_and_duration(self) -> None:
        client_cls = _client_mock()

        _run(
            _token_params(run_token_namespace="ops", run_token_duration=3600),
            client_cls,
        )

        token_request = client_cls.return_value.token_request
        assert token_request.call_count == 1
        args, kwargs = token_request.call_args
        assert list(args) + list(kwargs.values()) == ["wave-tests", "ops", 3600]

    def test_the_request_defaults_the_namespace_and_the_duration(self) -> None:
        client_cls = _client_mock()

        _run(_token_params(), client_cls)

        args, kwargs = client_cls.return_value.token_request.call_args
        assert list(args) + list(kwargs.values()) == ["wave-tests", "default", 14400]

    def test_the_granted_token_replaces_the_supplied_one(self) -> None:
        outputs = _outputs(_token_params(token="org-token"))

        assert _user(outputs) == {"token": _MINTED_TOKEN}

    def test_the_swap_leaves_every_other_session_value_alone(self) -> None:
        outputs = _outputs(
            _token_params(namespace="apps", ca_cert=_CA_PEM, tls_server_name="kwok-internal")
        )
        config = _session_config(outputs)

        assert config["clusters"][0]["cluster"]["certificate-authority-data"] == _b64(_CA_PEM)
        assert config["clusters"][0]["cluster"]["tls-server-name"] == "kwok-internal"
        assert config["contexts"][0]["context"]["namespace"] == "apps"

    def test_no_token_is_requested_while_the_toggle_is_off(self) -> None:
        client_cls = _client_mock()

        _run(_params(), client_cls)

        client_cls.return_value.token_request.assert_not_called()

    def test_a_refused_token_request_names_the_service_account(self) -> None:
        detail = (
            "Kubernetes API request POST /api/v1/namespaces/ops/serviceaccounts/"
            "wave-tests/token failed (403): tokenrequests is forbidden"
        )
        client_cls = _client_mock()
        client_cls.return_value.token_request.side_effect = RuntimeError(detail)
        message = (
            "Could not get a run token for service account 'wave-tests' "
            f"in namespace 'ops': {detail}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(_token_params(run_token_namespace="ops"), client_cls)


class TestClientConstruction:
    """Connect hands the REST core the parsed context and the timeout, nothing else."""

    def test_the_client_receives_the_parsed_context(self) -> None:
        client_cls = _client_mock()

        _run(
            _params(
                namespace="apps",
                timeout=45,
                token="sa-tok",
                ca_cert=_CA_PEM,
                tls_server_name="kwok-internal",
                tls_min_version="1.0",
                tls_max_version="1.2",
                cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256"],
            ),
            client_cls,
        )
        context = _constructed_context(client_cls)

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.ca_cert == _CA_PEM
        assert context.verify is True
        assert context.server_name == "kwok-internal"
        assert context.tls_min_version == "1.0"
        assert context.tls_max_version == "1.2"
        assert context.cipher_suites == ["ECDHE-ECDSA-AES128-GCM-SHA256"]
        assert context.namespace == "apps"
        assert _constructed_timeout(client_cls) == 45

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        client_cls = _client_mock()

        _run(_params(), client_cls)

        assert _constructed_timeout(client_cls) == 30

    def test_the_client_context_carries_the_same_ciphers_the_session_records(self) -> None:
        client_cls = _client_mock()

        outputs = _outputs(_params(), client_cls)

        assert (
            _constructed_context(client_cls).cipher_suites == _extension(outputs)["cipher_suites"]
        )

    def test_connect_asks_for_no_impersonation(self) -> None:
        client_cls = _client_mock()

        _run(_params(), client_cls)

        assert "impersonate_user" not in client_cls.call_args.kwargs
        assert "impersonate_groups" not in client_cls.call_args.kwargs

    def test_the_version_is_read_once_off_the_constructed_client(self) -> None:
        client_cls = _client_mock()

        _run(_params(), client_cls)

        assert client_cls.return_value.server_version.call_count == 1


class TestLogging:
    """The exact console lines, in order, through the log callable."""

    def test_a_plain_connect_logs_the_version_and_the_endpoint(self) -> None:
        log = _Log()

        _run(_params(), log=log)

        assert log.entries == [("INFO", f"Connected to Kubernetes {_VERSION} at {SERVER}")]

    def test_a_run_token_logs_the_grant_after_the_connection(self) -> None:
        log = _Log()

        _run(_token_params(), log=log)

        assert log.entries == [
            ("INFO", f"Connected to Kubernetes {_VERSION} at {SERVER}"),
            ("INFO", f"Run token for service account 'wave-tests' granted until {_MINTED_EXPIRY}"),
        ]

    def test_a_version_below_the_floor_logs_nothing(self) -> None:
        log = _Log()

        with pytest.raises(ValueError):
            _run(_params(), _client_mock(version="v1.18.3"), log=log)

        assert log.entries == []

    def test_a_refused_token_request_logs_only_the_connection_line(self) -> None:
        client_cls = _client_mock()
        client_cls.return_value.token_request.side_effect = RuntimeError("denied")
        log = _Log()

        with pytest.raises(ValueError):
            _run(_token_params(), client_cls, log=log)

        assert log.entries == [("INFO", f"Connected to Kubernetes {_VERSION} at {SERVER}")]


class TestEmitParseRoundtrip:
    """Connect's emitted session parses back into the same context values."""

    def test_full_credential_session_roundtrips(self) -> None:
        params = {
            "api_url": SERVER,
            "namespace": "apps",
            "token": "sa-tok",
            "ca_cert": _CA_PEM,
            "tls_server_name": "kwok-internal",
            "client_cert": _CERT_PEM,
            "client_key": _KEY_PEM,
            "tls_min_version": "1.0",
            "tls_max_version": "1.2",
            "cipher_suites": ["ECDHE-ECDSA-AES128-GCM-SHA256", "TLS_AES_128_GCM_SHA256"],
        }

        outputs = _outputs(params)
        context = require_context({"session": outputs["session"]})

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.ca_cert == _CA_PEM
        assert context.verify is True
        assert context.server_name == "kwok-internal"
        assert context.client_cert == _CERT_PEM
        assert context.client_key == _KEY_PEM
        assert context.tls_min_version == "1.0"
        assert context.tls_max_version == "1.2"
        assert context.cipher_suites == [
            "ECDHE-ECDSA-AES128-GCM-SHA256",
            "TLS_AES_128_GCM_SHA256",
        ]
        assert context.namespace == "apps"

    def test_anonymous_skip_verify_session_roundtrips(self) -> None:
        outputs = _outputs({"api_url": SERVER, "verify_ssl": False})
        context = require_context({"session": outputs["session"]})

        assert context.server == SERVER
        assert context.verify is False
        assert context.token is None
        assert context.client_cert is None
        assert context.client_key is None
        assert context.ca_cert is None
        assert context.server_name is None
        assert context.namespace == "default"
        assert context.tls_min_version == "1.2"
        assert context.tls_max_version == "1.3"
        assert context.cipher_suites == tls_capabilities.suites_for_range("1.2", "1.3")
