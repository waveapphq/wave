"""K8s Delete plugin tests (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-5).

Delete removes one object by name or every object a label selector matches, with
kubectl's own cascade, grace period and wait-until-gone controls. It takes kubectl's
answers on a missing target: a name that is already gone is an error unless
'Ignore not found' is ticked, while a selector that matches nothing is a pass with
count 0. It carries the shared, gated success/error/reason output core and
the fail-or-record Failure Handling control.
"""

import asyncio
import urllib.parse
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    patch_verb_client,
    required_conditions,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.plugins.k8s_delete import K8sDeletePlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "resource_type",
    "kind",
    "kind_custom",
    "delete_by",
    "name",
    "label_selector",
    "ignore_not_found",
    "cascade",
    "grace_period_seconds",
    "wait_until_gone",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

# Rows the sheet shows only under a mode; none of them is unconditionally required.
CONDITIONALLY_VISIBLE_PARAMS = [
    "kind",
    "kind_custom",
    "name",
    "label_selector",
    "ignore_not_found",
]

TRIM_PARAMS = {
    "session",
    "kind_custom",
    "name",
    "label_selector",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
}

# Rows the read blocks carry and Delete deliberately does not (K8SWRITE-5).
ABSENT_PARAMS = ["field_selector", "all_namespaces", "output_format"]

EXPECTED_OUTPUTS = [
    ("summary", "table"),
    ("names", "array"),
    ("count", "integer"),
    ("success", "boolean"),
    ("error", "string"),
    ("reason", "string"),
]

RECORD_GATE = {"field": "on_error", "values": ["record"]}

_CORE_DESCRIPTIONS = {
    "success": (
        "True when the cluster carried out the operation without error; false when "
        "On error is Record and continue and the cluster refused it"
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty otherwise"
    ),
    "reason": (
        "The cluster reason for the failure, like NotFound or Forbidden; empty when the "
        "operation succeeded"
    ),
}

_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}
_DEPLOYMENTS = {"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
_NODES = {"Node": resource("Node", "nodes", namespaced=False)}
_WIDGETS = {"widgets": resource("Widget", "widgets", group_version="acme.io/v1")}

_CONFIGMAP_PATH = "/api/v1/namespaces/apps/configmaps"
_SERVER_DETAIL = "the server is currently unable to handle the request"
_FORBIDDEN_DETAIL = 'configmaps "probe-a" is forbidden: User "dev" cannot delete resource'
_FORBIDDEN_MESSAGE = f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}"
_SERVER_MESSAGE = (
    f"Kubernetes could not delete ConfigMap 'probe-a' in namespace 'apps': {_SERVER_DETAIL}"
)
_NOT_FOUND_MESSAGE = "K8s ConfigMap 'probe-a' not found in namespace 'apps'"
_SELECTOR_WAIT_TIMEOUT = (
    "Timed out after 5 seconds waiting for configmaps matching app=web to be deleted"
)
# A pause this long is capped at the time left, so the wait polls once more and then gives up.
_PAUSE_PAST_DEADLINE = 30


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _accepted(name: str = "probe-a", plural: str = "configmaps") -> tuple[int, dict[str, Any]]:
    """The Status the apiserver returns when it accepts a delete by name."""
    return (
        200,
        {
            "kind": "Status",
            "apiVersion": "v1",
            "status": "Success",
            "details": {"name": name, "kind": plural},
        },
    )


def _gone(name: str = "probe-a", plural: str = "configmaps") -> tuple[int, dict[str, Any]]:
    """The answer a poll gets once the object is really gone."""
    return (404, _failure("NotFound", f'{plural} "{name}" not found', 404))


def _still_there(name: str = "probe-a") -> tuple[int, dict[str, Any]]:
    """The answer a poll gets while the object is still being removed."""
    return (
        200,
        {
            "kind": "ConfigMap",
            "apiVersion": "v1",
            "metadata": {"name": name, "namespace": NAMESPACE, "deletionTimestamp": "2026-08-27"},
        },
    )


def _refused_poll() -> tuple[int, dict[str, Any]]:
    """The answer a poll gets when the cluster refuses the read."""
    return (403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))


def _broken_poll() -> tuple[int, dict[str, Any]]:
    """The answer a poll gets when the read breaks inside the cluster."""
    return (500, _failure("InternalError", _SERVER_DETAIL, 500))


def _collection(*names: str) -> tuple[int, dict[str, Any]]:
    """The list the apiserver returns for a delete on a collection."""
    return (
        200,
        {
            "kind": "ConfigMapList",
            "apiVersion": "v1",
            "items": [{"metadata": {"name": name, "namespace": NAMESPACE}} for name in names],
        },
    )


def _params_by_name(plugin: K8sDeletePlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sDeletePlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _split(path: str) -> tuple[str, dict[str, list[str]]]:
    base, _, query = path.partition("?")
    return base, urllib.parse.parse_qs(query)


def _construction(fake: FakeK8sClient) -> tuple[Any, Any, dict[str, Any]]:
    call = fake.factory.call_args
    kwargs = dict(call.kwargs)
    context = call.args[0] if call.args else kwargs.pop("context", None)
    if "timeout" in kwargs:
        timeout = kwargs.pop("timeout")
    else:
        timeout = call.args[1] if len(call.args) > 1 else None
    return context, timeout, kwargs


def _name_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "ConfigMap", "delete_by": "name", "name": "probe-a"}
    params.update(overrides)
    return block_params(**params)


def _selector_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "kind": "ConfigMap",
        "delete_by": "selector",
        "label_selector": "app=web",
    }
    params.update(overrides)
    return block_params(**params)


async def _execute(
    fake: FakeK8sClient,
    params: dict[str, Any],
    logger: Any = None,
    poll_interval: float = 0,
) -> Any:
    """Run the block with the pause between polls under the test's control."""
    with (
        patch("wavecore.connectivity.k8s.verbs.delete._POLL_INTERVAL_SECONDS", poll_interval),
        patch_verb_client("delete", fake),
    ):
        # Bounded so a wait that never ends fails here instead of stalling the suite.
        return await asyncio.wait_for(
            K8sDeletePlugin().execute(execute_context(params, None, logger)), timeout=5.0
        )


@contextmanager
def _short_deadline(readings: list[float] | None = None) -> Iterator[None]:
    """A clock whose later readings sit past any deadline, so an endless wait gives up in-test."""
    queued = iter([0.0] if readings is None else readings)
    clock = SimpleNamespace(
        monotonic=lambda: next(queued, float("inf")), sleep=lambda _seconds: None
    )
    with patch("wavecore.connectivity.k8s.verbs.delete.time", clock):
        yield


async def _run_until_deadline(
    fake: FakeK8sClient, params: dict[str, Any], logger: Any = None
) -> Any:
    """Run against the expired clock."""
    with _short_deadline():
        return await _execute(fake, params, logger)


def _never_gone_client() -> FakeK8sClient:
    """A named delete the cluster accepts, then polls that always say it is still there."""
    return FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS, default=_still_there())


def _selector_poll_client(poll: tuple[int, dict[str, Any]]) -> FakeK8sClient:
    """A selector delete the cluster accepts, then a poll that answers the same way for ever."""
    return FakeK8sClient(responses=[_collection("probe-a")], resources=_CONFIGMAPS, default=poll)


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sDeletePlugin() is not None

    def test_identity(self) -> None:
        meta = K8sDeletePlugin().metadata

        assert meta["id"] == "k8s-delete"
        assert meta["name"] == "K8s Delete"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_author(self) -> None:
        assert K8sDeletePlugin().metadata["author"] == "WAVE Framework"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sDeletePlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_parameter_count_is_exactly_sixteen(self) -> None:
        assert len(K8sDeletePlugin().metadata["parameters"]) == 16

    def test_remotable_is_true(self) -> None:
        assert K8sDeletePlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sDeletePlugin().metadata["proxy_support"] == "supported"

    def test_the_read_only_rows_are_absent(self) -> None:
        """No field selector, no all-namespaces tick and no output format (K8SWRITE-5)."""
        names = [p["name"] for p in K8sDeletePlugin().metadata["parameters"]]

        for absent in ABSENT_PARAMS:
            assert absent not in names

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["session"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("required") is False

    def test_conditionally_visible_params_are_never_descriptor_required(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        for name in CONDITIONALLY_VISIBLE_PARAMS:
            assert name in EXPECTED_PARAM_ORDER
            assert params[name].get("required") is False
        assert [n for n in EXPECTED_PARAM_ORDER if params[n].get("required")] == ["session"]

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["resource_type"]["type"] == "string"
        assert params["kind"]["type"] == "string"
        assert params["kind_custom"]["type"] == "string"
        assert params["delete_by"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["label_selector"]["type"] == "string"
        assert params["ignore_not_found"]["type"] == "boolean"
        assert params["cascade"]["type"] == "string"
        assert params["grace_period_seconds"]["type"] == "integer"
        assert params["wait_until_gone"]["type"] == "boolean"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["timeout"]["default"] == 30
        assert params["resource_type"]["default"] == "default"
        assert params["kind"]["default"] == "Pod"
        assert params["delete_by"]["default"] == "name"
        assert params["cascade"]["default"] == "background"
        assert params["on_error"]["default"] == "fail"

    def test_ignore_not_found_defaults_to_off(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["ignore_not_found"]["default"] is False

    def test_wait_until_gone_defaults_to_on(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["wait_until_gone"]["default"] is True

    def test_the_identity_and_grace_rows_declare_no_default(self) -> None:
        """An empty Grace Period means the kind's own default, so there is nothing to declare."""
        params = _params_by_name(K8sDeletePlugin())

        for name in ("kind_custom", "name", "label_selector", "grace_period_seconds"):
            assert "default" not in params[name]

    def test_session_is_the_only_secret_parameter(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        trimmed = {name for name in EXPECTED_PARAM_ORDER if params[name].get("trim")}

        assert trimmed == TRIM_PARAMS

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["resource_type"]["enum_values"] == ["default", "custom"]
        assert params["delete_by"]["enum_values"] == ["name", "selector"]
        assert params["cascade"]["enum_values"] == ["background", "foreground", "orphan"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_kind_is_the_stock_kind_choice_list(self) -> None:
        """The option list is the window's grouped picker, the same list as on K8s Get."""
        kind = _params_by_name(K8sDeletePlugin())["kind"]

        assert len(kind["enum_values"]) == 23
        assert kind["default"] in kind["enum_values"]

    def test_kind_custom_is_the_custom_mode_twin_of_kind(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["kind"]["required_when"] == {
            "field": "resource_type",
            "values": ["default"],
        }
        assert params["kind_custom"]["required_when"] == {
            "field": "resource_type",
            "values": ["custom"],
        }

    def test_the_four_mode_params_and_the_kind_are_enums(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"resource_type", "kind", "delete_by", "cascade", "on_error"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sDeletePlugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = K8sDeletePlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == EXPECTED_OUTPUTS

    def test_there_is_no_deleted_output(self) -> None:
        names = [o["name"] for o in K8sDeletePlugin().metadata["output_schema"]]

        assert "deleted" not in names

    def test_no_output_declares_type_rules(self) -> None:
        for output in K8sDeletePlugin().metadata["output_schema"]:
            assert "type_when" not in output

    def test_no_output_is_flagged_secret(self) -> None:
        for output in K8sDeletePlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sDeletePlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sDeletePlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS

    def test_error_and_reason_render_only_under_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sDeletePlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        """The deliberate exception: Success stays visible in both On error modes."""
        outputs = _outputs_by_name(K8sDeletePlugin())

        assert "show_when" not in outputs["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        gated = {o["name"] for o in K8sDeletePlugin().metadata["output_schema"] if "show_when" in o}

        assert gated == {"error", "reason"}


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_name_is_required_under_delete_by_name(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["name"]["required_when"] == {"field": "delete_by", "values": ["name"]}

    def test_label_selector_is_required_under_delete_by_selector(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        assert params["label_selector"]["required_when"] == {
            "field": "delete_by",
            "values": ["selector"],
        }

    def test_only_the_four_mode_bound_params_are_conditionally_required(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == ["kind", "kind_custom", "name", "label_selector"]

    def test_no_conditionally_required_param_is_also_required(self) -> None:
        params = _params_by_name(K8sDeletePlugin())

        for name in ("kind", "kind_custom", "name", "label_selector"):
            assert params[name].get("required") is False

    def test_every_condition_reads_a_field_that_declares_a_default(self) -> None:
        """The gate falls back to the referenced field's default, so it must have one."""
        params = _params_by_name(K8sDeletePlugin())

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert params[condition["field"]]["default"] is not None


class TestValidation:
    """validate() - required params per mode, enums, positivity, grace period."""

    async def test_name_mode_minimal_params_pass(self) -> None:
        await K8sDeletePlugin().validate(_name_params())

    async def test_selector_mode_minimal_params_pass(self) -> None:
        await K8sDeletePlugin().validate(_selector_params())

    async def test_full_params_pass(self) -> None:
        await K8sDeletePlugin().validate(
            block_params(
                timeout=45,
                resource_type="custom",
                kind_custom="widgets",
                delete_by="selector",
                label_selector="app=web",
                cascade="foreground",
                grace_period_seconds=10,
                wait_until_gone=False,
                namespace="other",
                impersonate_user="dev",
                impersonate_groups="qa, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sDeletePlugin().validate({"kind": "ConfigMap", "name": "probe-a"})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sDeletePlugin().validate(_name_params(session=""))

    async def test_missing_kind_under_the_default_resource_type(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await K8sDeletePlugin().validate(block_params(name="probe-a"))

    async def test_empty_kind_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await K8sDeletePlugin().validate(_name_params(kind=""))

    async def test_missing_kind_custom_under_the_custom_resource_type(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind_custom$"):
            await K8sDeletePlugin().validate(block_params(resource_type="custom", name="probe-a"))

    async def test_kind_is_not_required_under_the_custom_resource_type(self) -> None:
        await K8sDeletePlugin().validate(
            block_params(resource_type="custom", kind_custom="widgets", name="probe-a")
        )

    async def test_kind_custom_is_not_required_under_the_default_resource_type(self) -> None:
        await K8sDeletePlugin().validate(_name_params())

    async def test_missing_name_under_delete_by_name(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sDeletePlugin().validate(block_params(kind="ConfigMap", delete_by="name"))

    async def test_empty_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sDeletePlugin().validate(_name_params(name=""))

    async def test_name_defaults_to_required_when_delete_by_is_absent(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sDeletePlugin().validate(block_params(kind="ConfigMap"))

    async def test_name_is_not_required_under_delete_by_selector(self) -> None:
        await K8sDeletePlugin().validate(_selector_params())

    async def test_missing_label_selector_under_delete_by_selector(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: label_selector$"):
            await K8sDeletePlugin().validate(block_params(kind="ConfigMap", delete_by="selector"))

    async def test_empty_label_selector_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: label_selector$"):
            await K8sDeletePlugin().validate(_selector_params(label_selector=""))

    async def test_label_selector_is_not_required_under_delete_by_name(self) -> None:
        await K8sDeletePlugin().validate(_name_params())

    async def test_resource_type_enum(self) -> None:
        message = (
            "Parameter 'resource_type' must be one of: default, custom; "
            "Actual value was 'bogus'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(
                _name_params(resource_type="bogus", kind_custom="widgets")
            )

    async def test_delete_by_enum(self) -> None:
        message = (
            "Parameter 'delete_by' must be one of: name, selector; Actual value was 'everything'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(delete_by="everything"))

    async def test_cascade_enum(self) -> None:
        message = (
            "Parameter 'cascade' must be one of: background, foreground, orphan; "
            "Actual value was 'Background'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(cascade="Background"))

    async def test_on_error_enum(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(on_error="ignore"))

    async def test_zero_timeout_is_rejected(self) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sDeletePlugin().validate(_name_params(timeout=1))

    async def test_a_zero_grace_period_is_valid(self) -> None:
        """0 removes the object immediately, so it is a value and not an absence."""
        await K8sDeletePlugin().validate(_name_params(grace_period_seconds=0))

    async def test_a_zero_grace_period_survives_validation_as_zero(self) -> None:
        params = _name_params(grace_period_seconds=0)

        await K8sDeletePlugin().validate(params)

        assert params["grace_period_seconds"] == 0

    async def test_a_positive_grace_period_passes(self) -> None:
        await K8sDeletePlugin().validate(_name_params(grace_period_seconds=30))

    async def test_a_negative_grace_period_is_rejected(self) -> None:
        message = "Parameter 'grace_period_seconds' must be non-negative"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(grace_period_seconds=-1))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sDeletePlugin().validate(_name_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sDeletePlugin().validate(
            _name_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )


class TestKindResolution:
    """Default mode reads 'kind'; custom mode reads 'kind_custom', both through discovery."""

    async def test_the_declared_kind_is_discovered_once(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert fake.discoveries == ["ConfigMap"]

    async def test_a_custom_kind_is_discovered_verbatim(self) -> None:
        fake = FakeK8sClient(
            responses=[_accepted("w-1", "widgets"), _gone("w-1", "widgets")], resources=_WIDGETS
        )
        params = block_params(resource_type="custom", kind_custom="widgets", name="w-1")

        await _execute(fake, params)

        assert fake.discoveries == ["widgets"]

    async def test_a_discovery_miss_names_the_kind(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", name="w-1")
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    async def test_a_discovery_miss_issues_no_delete_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", name="w-1")

        with pytest.raises(ValueError):
            await _execute(fake, params)

        assert fake.calls == []


class TestExecuteNameMode:
    """delete_by=name removes exactly one object."""

    async def test_the_request_targets_the_named_object(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert fake.calls[0].method == "DELETE"
        assert _split(fake.calls[0].path)[0] == f"{_CONFIGMAP_PATH}/probe-a"

    async def test_the_delete_carries_no_body(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert fake.calls[0].body is None

    async def test_the_delete_asks_for_no_special_media_type(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert fake.calls[0].content_type is None
        assert fake.calls[0].accept is None
        assert fake.calls[0].raw is False

    async def test_names_and_count_describe_the_single_object(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert result["names"] == ["probe-a"]
        assert result["count"] == 1

    async def test_the_block_succeeds(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_happy_delete_returns_exactly_the_declared_outputs(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert set(result) == {"summary", "names", "count", "success", "error", "reason"}

    async def test_a_label_selector_left_behind_never_reaches_a_named_delete(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(label_selector="app=web"))

        assert "labelSelector" not in _split(fake.calls[0].path)[1]

    async def test_the_session_namespace_is_used_when_no_namespace_is_specified(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert _split(fake.calls[0].path)[0].startswith("/api/v1/namespaces/apps/")

    async def test_a_specified_namespace_wins(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(namespace="other"))

        assert _split(fake.calls[0].path)[0] == "/api/v1/namespaces/other/configmaps/probe-a"

    async def test_a_cluster_scoped_kind_never_carries_a_namespace_segment(self) -> None:
        fake = FakeK8sClient(
            responses=[_accepted("kwok-node-0", "nodes"), _gone("kwok-node-0", "nodes")],
            resources=_NODES,
        )

        await _execute(fake, _name_params(kind="Node", name="kwok-node-0"))

        assert _split(fake.calls[0].path)[0] == "/api/v1/nodes/kwok-node-0"

    async def test_a_named_group_kind_rides_its_own_path_root(self) -> None:
        fake = FakeK8sClient(
            responses=[_accepted("web", "deployments"), _gone("web", "deployments")],
            resources=_DEPLOYMENTS,
        )

        await _execute(fake, _name_params(kind="Deployment", name="web"))

        assert _split(fake.calls[0].path)[0] == "/apis/apps/v1/namespaces/apps/deployments/web"

    async def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert timeout == 45

    async def test_the_client_timeout_defaults_to_30(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert _construction(fake)[1] == 30

    async def test_impersonation_reaches_the_client(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(impersonate_user="dev", impersonate_groups="qa, ops"))

        assert _construction(fake)[2] == {
            "impersonate_user": "dev",
            "impersonate_groups": ["qa", "ops"],
        }


class TestExecuteSelectorMode:
    """delete_by=selector removes every object the label selector matches."""

    async def test_the_request_targets_the_collection(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params())

        assert fake.calls[0].method == "DELETE"
        assert _split(fake.calls[0].path)[0] == _CONFIGMAP_PATH

    async def test_the_label_selector_rides_the_query(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params())

        assert _split(fake.calls[0].path)[1]["labelSelector"] == ["app=web"]

    async def test_the_selector_delete_carries_the_same_query_keys_as_a_named_one(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params(cascade="orphan", grace_period_seconds=5))
        query = _split(fake.calls[0].path)[1]

        assert query["propagationPolicy"] == ["Orphan"]
        assert query["gracePeriodSeconds"] == ["5"]

    async def test_names_and_count_come_from_the_deleted_objects(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _selector_params())

        assert result["names"] == ["probe-a", "probe-b"]
        assert result["count"] == 2

    async def test_a_name_left_behind_never_reaches_a_selector_delete(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params(name="probe-z"))

        assert _split(fake.calls[0].path)[0] == _CONFIGMAP_PATH

    async def test_a_specified_namespace_wins(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params(namespace="other"))

        assert _split(fake.calls[0].path)[0] == "/api/v1/namespaces/other/configmaps"


class TestMissingTarget:
    """kubectl's own answers on a target that is not there."""

    async def test_a_missing_name_fails_the_block_by_default(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            await _execute(fake, _name_params())

    async def test_a_missing_name_fails_with_ignore_not_found_unticked(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            await _execute(fake, _name_params(ignore_not_found=False))

    async def test_a_missing_name_is_recordable(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == _NOT_FOUND_MESSAGE
        assert result["reason"] == "NotFound"

    async def test_ignore_not_found_turns_the_missing_name_into_a_pass(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(ignore_not_found=True))

        assert result["success"] is True
        assert result["count"] == 0
        assert result["names"] == []

    async def test_the_swallowed_404_reaches_no_failure_path(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        logger = MagicMock()

        result = await _execute(fake, _name_params(ignore_not_found=True), logger=logger)

        assert result["error"] == ""
        assert result["reason"] == ""
        assert "__block_warning" not in result
        assert logger.warn.call_count == 0

    async def test_a_swallowed_404_summarizes_nothing(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(ignore_not_found=True))

        assert result["summary"].row_count() == 0

    async def test_a_swallowed_404_never_waits_for_the_object(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(ignore_not_found=True))

        assert len(fake.calls) == 1

    @pytest.mark.parametrize("ignore_not_found", [True, False])
    async def test_a_selector_that_matches_nothing_passes(self, ignore_not_found: bool) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        result = await _execute(fake, _selector_params(ignore_not_found=ignore_not_found))

        assert result["success"] is True
        assert result["count"] == 0
        assert result["names"] == []

    async def test_a_selector_that_matches_nothing_summarizes_nothing(self) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        result = await _execute(fake, _selector_params())

        assert result["summary"].row_count() == 0

    async def test_a_selector_that_matches_nothing_never_waits(self) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        await _execute(fake, _selector_params())

        assert len(fake.calls) == 1


class TestCascade:
    """The three propagation policies, spelled the way the API spells them."""

    @pytest.mark.parametrize(
        ("cascade", "policy"),
        [("background", "Background"), ("foreground", "Foreground"), ("orphan", "Orphan")],
    )
    async def test_the_named_delete_sends_the_propagation_policy(
        self, cascade: str, policy: str
    ) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(cascade=cascade))

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == [policy]

    @pytest.mark.parametrize(
        ("cascade", "policy"),
        [("background", "Background"), ("foreground", "Foreground"), ("orphan", "Orphan")],
    )
    async def test_the_collection_delete_sends_the_propagation_policy(
        self, cascade: str, policy: str
    ) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        await _execute(fake, _selector_params(cascade=cascade))

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == [policy]

    async def test_background_is_what_an_unset_cascade_sends(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == ["Background"]


class TestGracePeriod:
    """The gracePeriodSeconds query key, present only when the row carries a number."""

    async def test_an_unset_grace_period_sends_no_query_key(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert "gracePeriodSeconds" not in _split(fake.calls[0].path)[1]

    async def test_a_grace_period_reaches_the_query(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(grace_period_seconds=30))

        assert _split(fake.calls[0].path)[1]["gracePeriodSeconds"] == ["30"]

    async def test_zero_is_sent_and_not_dropped(self) -> None:
        """0 means remove it now, which is the opposite of leaving the key out."""
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(grace_period_seconds=0))

        assert _split(fake.calls[0].path)[1]["gracePeriodSeconds"] == ["0"]

    async def test_the_grace_period_rides_alongside_the_cascade(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params(cascade="foreground", grace_period_seconds=15))
        query = _split(fake.calls[0].path)[1]

        assert query == {"propagationPolicy": ["Foreground"], "gracePeriodSeconds": ["15"]}


class TestWaitUntilGone:
    """The default wait polls the object until the cluster answers 404."""

    async def test_the_poll_reads_the_object_until_it_is_gone(self) -> None:
        fake = FakeK8sClient(
            responses=[_accepted(), _still_there(), _gone()], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _name_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET", "GET"]
        assert result["success"] is True

    async def test_the_poll_reads_the_plain_object_path(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert _split(fake.calls[1].path) == (f"{_CONFIGMAP_PATH}/probe-a", {})

    async def test_the_object_already_gone_on_the_first_poll_ends_the_wait(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert len(fake.calls) == 2

    async def test_the_wait_is_on_when_the_row_is_left_alone(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        await _execute(fake, _name_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]

    async def test_unticked_returns_as_soon_as_the_cluster_accepts(self) -> None:
        fake = FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(wait_until_gone=False))

        assert [call.method for call in fake.calls] == ["DELETE"]
        assert result["success"] is True
        assert result["count"] == 1

    async def test_the_selector_wait_polls_the_collection_until_it_is_empty(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection("probe-b"), _collection()],
            resources=_CONFIGMAPS,
        )

        result = await _execute(fake, _selector_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET", "GET"]
        assert _split(fake.calls[1].path)[1]["labelSelector"] == ["app=web"]
        assert result["count"] == 2

    async def test_an_unticked_selector_delete_never_polls(self) -> None:
        fake = FakeK8sClient(responses=[_collection("probe-a")], resources=_CONFIGMAPS)

        await _execute(fake, _selector_params(wait_until_gone=False))

        assert [call.method for call in fake.calls] == ["DELETE"]

    async def test_a_refused_selector_poll_is_not_read_as_gone(self) -> None:
        fake = _selector_poll_client(_refused_poll())

        with pytest.raises(ValueError, match=exact(_SELECTOR_WAIT_TIMEOUT)):
            await _run_until_deadline(fake, _selector_params(timeout=5))

    async def test_a_broken_selector_poll_is_not_read_as_gone(self) -> None:
        fake = _selector_poll_client(_broken_poll())

        with pytest.raises(ValueError, match=exact(_SELECTOR_WAIT_TIMEOUT)):
            await _run_until_deadline(fake, _selector_params(timeout=5))

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]

    async def test_a_refused_selector_poll_is_recordable(self) -> None:
        fake = _selector_poll_client(_refused_poll())

        result = await _run_until_deadline(fake, _selector_params(timeout=5, on_error="record"))

        assert result["success"] is False
        assert result["error"] == _SELECTOR_WAIT_TIMEOUT
        assert result["reason"] == "Timeout"
        assert result["count"] == 0

    async def test_running_out_of_time_fails_the_block(self) -> None:
        fake = _never_gone_client()
        message = "Timed out after 5 seconds waiting for configmap/probe-a to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_until_deadline(fake, _name_params(timeout=5))

    async def test_running_out_of_time_names_the_block_timeout(self) -> None:
        fake = _never_gone_client()
        message = "Timed out after 30 seconds waiting for configmap/probe-a to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_until_deadline(fake, _name_params())

    async def test_running_out_of_time_polled_at_least_once(self) -> None:
        fake = _never_gone_client()

        with pytest.raises(ValueError):
            await _run_until_deadline(fake, _name_params(timeout=5))

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]

    async def test_the_deadline_ends_a_wait_that_is_still_polling(self) -> None:
        fake = _never_gone_client()
        message = "Timed out after 0.05 seconds waiting for configmap/probe-a to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            # No seam here: the block's own timeout is the deadline under test.
            await _execute(fake, _name_params(timeout=0.05), poll_interval=_PAUSE_PAST_DEADLINE)

    @pytest.mark.parametrize(("timeout", "expected"), [(5, 5), (120, 120), (None, 30)])
    async def test_the_deadline_is_the_block_timeout(
        self, timeout: int | None, expected: int
    ) -> None:
        fake = _never_gone_client()
        params = _name_params() if timeout is None else _name_params(timeout=timeout)
        message = f"Timed out after {expected} seconds waiting for configmap/probe-a to be deleted"
        # Entry reading 0, then one reading just under the deadline and one just past it.
        readings = [0.0, expected - 0.001, expected + 0.001]

        with _short_deadline(readings), pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

        assert [call.method for call in fake.calls] == ["DELETE", "GET", "GET"]

    async def test_running_out_of_time_is_recordable(self) -> None:
        fake = _never_gone_client()
        message = "Timed out after 5 seconds waiting for configmap/probe-a to be deleted"

        result = await _run_until_deadline(fake, _name_params(timeout=5, on_error="record"))

        assert result["success"] is False
        assert result["error"] == message
        assert result["reason"] == "Timeout"

    async def test_a_recorded_timeout_logs_the_delete_shaped_warn_line(self) -> None:
        fake = _never_gone_client()
        logger = MagicMock()

        await _run_until_deadline(fake, _name_params(timeout=5, on_error="record"), logger)

        logger.warn.assert_called_once_with(
            "Delete failed (Timeout): Timed out after 5 seconds waiting for "
            "configmap/probe-a to be deleted"
        )


class TestSummary:
    """One row per deleted object, the resource in kubectl's type/name form."""

    async def test_the_columns_are_resource_and_outcome(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert isinstance(result["summary"], Table)
        assert result["summary"].col_names() == ["RESOURCE", "OUTCOME"]

    async def test_both_columns_are_strings(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert result["summary"].col_types() == ["string", "string"]

    async def test_a_named_delete_summarizes_one_row(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params())

        assert result["summary"].row_count() == 1
        assert result["summary"].row(0).to_list() == ["configmap/probe-a", "deleted"]

    async def test_a_grouped_kind_carries_its_group_in_the_resource_cell(self) -> None:
        fake = FakeK8sClient(
            responses=[_accepted("web", "deployments"), _gone("web", "deployments")],
            resources=_DEPLOYMENTS,
        )

        result = await _execute(fake, _name_params(kind="Deployment", name="web"))

        assert result["summary"].row(0).to_list() == ["deployment.apps/web", "deleted"]

    async def test_a_selector_delete_summarizes_one_row_per_object(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _selector_params())

        assert result["summary"].row_count() == 2
        assert result["summary"].row(0).to_list() == ["configmap/probe-a", "deleted"]
        assert result["summary"].row(1).to_list() == ["configmap/probe-b", "deleted"]

    async def test_an_unticked_wait_still_summarizes_the_delete(self) -> None:
        fake = FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(wait_until_gone=False))

        assert result["summary"].row(0).to_list() == ["configmap/probe-a", "deleted"]


class TestClusterRefusal:
    """The shared error mapper and the recorded-failure line, in Delete's own words."""

    async def test_a_server_error_on_a_named_delete_says_the_delete_failed(self) -> None:
        body = _failure("ServiceUnavailable", _SERVER_DETAIL, 503)
        fake = FakeK8sClient(responses=[(503, body)], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_SERVER_MESSAGE)):
            await _execute(fake, _name_params())

    async def test_a_server_error_on_a_selector_delete_names_the_kind_not_an_object(self) -> None:
        body = _failure("ServiceUnavailable", _SERVER_DETAIL, 503)
        fake = FakeK8sClient(responses=[(503, body)], resources=_CONFIGMAPS)
        message = (
            "Kubernetes could not delete ConfigMap objects in namespace 'apps': "
            f"{_SERVER_DETAIL}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _selector_params())

    async def test_403_renders_the_permission_row(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            await _execute(fake, _name_params())

    async def test_403_is_recordable_with_its_reason(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["error"] == _FORBIDDEN_MESSAGE
        assert result["reason"] == "Forbidden"

    async def test_a_refused_delete_issues_no_poll(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False
        assert len(fake.calls) == 1

    async def test_a_recorded_refusal_leaves_the_unique_outputs_empty(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["names"] == []
        assert result["count"] == 0
        assert isinstance(result["summary"], Table)
        assert result["summary"].row_count() == 0

    async def test_the_empty_summary_still_carries_its_columns(self) -> None:
        """A binding that reads a column name still resolves after a recorded failure."""
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["summary"].col_names() == ["RESOURCE", "OUTCOME"]

    async def test_a_recorded_refusal_carries_the_warning_signal(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_recorded_refusal_returns_the_declared_outputs_and_the_signal(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert set(result) == {
            "summary",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    async def test_a_recorded_refusal_logs_the_delete_shaped_warn_line(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        logger = MagicMock()

        await _execute(fake, _name_params(on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(f"Delete failed (Forbidden): {_FORBIDDEN_MESSAGE}")

    async def test_a_recorded_missing_name_logs_the_delete_shaped_warn_line(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        logger = MagicMock()

        await _execute(fake, _name_params(on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(f"Delete failed (NotFound): {_NOT_FOUND_MESSAGE}")

    async def test_a_happy_delete_logs_no_warning(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)
        logger = MagicMock()

        result = await _execute(fake, _name_params(on_error="record"), logger=logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.called is True

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(fake, _name_params(), logger=logger)

        assert logger.warn.call_count == 0


class TestErrorAndReasonGate:
    """Under Fail the block a raise unwinds past the binding, so nothing is bound."""

    async def test_a_cluster_refusal_raises_out_of_the_block_by_default(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        bound: dict[str, Any] | None = None

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            bound = await _execute(fake, _name_params())

        assert bound is None

    async def test_nothing_at_all_is_bound_when_the_block_fails(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        bound: dict[str, Any] | None = None

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            bound = await _execute(fake, _name_params(on_error="fail"))

        assert bound is None

    async def test_record_and_continue_returns_instead_of_raising(self) -> None:
        body = _failure("Forbidden", _FORBIDDEN_DETAIL, 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == _FORBIDDEN_MESSAGE
        assert result["reason"] == "Forbidden"

    async def test_record_and_continue_keeps_a_happy_delete_green(self) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""
        assert result["count"] == 1

    async def test_fail_is_the_default_mode(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            await _execute(fake, _name_params())


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_bogus_session_raises(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[_accepted(), _gone()], resources=_CONFIGMAPS)
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params(session="not-a-kubeconfig", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_transport_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: "
            "[Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_CONFIGMAPS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_request_timeout_raises(self, on_error: str) -> None:
        message = (
            "Kubernetes API request DELETE /api/v1/namespaces/apps/configmaps/probe-a "
            "timed out after 30 seconds"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_CONFIGMAPS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_invalid_params_raise_from_validate(self, on_error: str) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sDeletePlugin().validate(_name_params(timeout=0, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_required_param_raises_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sDeletePlugin().validate(block_params(kind="ConfigMap", on_error=on_error))


class TestNamespaceDescription:
    """A write block's Namespace row says what it writes to, not what it reads from."""

    def test_the_namespace_row_does_not_say_read_from(self) -> None:
        description = _params_by_name(K8sDeletePlugin())["namespace"]["description"]

        assert "read from" not in description

    def test_the_namespace_row_still_names_the_session_default(self) -> None:
        description = _params_by_name(K8sDeletePlugin())["namespace"]["description"]

        assert "session default" in description
