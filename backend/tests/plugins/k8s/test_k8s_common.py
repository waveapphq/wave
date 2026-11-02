"""_k8s_common shared-module tests (REQ-5.1.1, REQ-4.5.5, REQ-3.4.1.5).

The module keeps the WAVE-side surface of the K8s blocks: the pydantic-side
parameter validators, the shared parameter and output descriptors, and the
prepare hooks Apply and Copy open their runs with. The sync verb bridge lives in
_verb_bridge and is tested there.
"""

import importlib
import inspect
import json
import re
from pathlib import Path
from typing import Any
from unittest.mock import call, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import execute_context
from wavecore.plugins import _k8s_common as common
from wavecore.plugins._executor_base import validate_enum_from_schema
from wavecore.plugins._k8s_common import require_impersonation_user, require_session


def require_context(params: dict[str, Any]) -> Any:
    """Resolved on call so a broken import fails its own tests, not this module's collection."""
    from wavecore.connectivity.k8s.verbs._context import require_context as _require_context

    return _require_context(params)


def client_options(params: dict[str, Any]) -> Any:
    """Resolved on call so a broken import fails its own tests, not this module's collection."""
    from wavecore.connectivity.k8s.verbs._resources import client_options as _client_options

    return _client_options(params)


def _plugin(name: str) -> Any:
    """Imported on call so a broken plugin import fails its own tests, not collection."""
    return importlib.import_module(f"wavecore.plugins.{name}")


_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_MISSING_SESSION_MESSAGE = "Missing required parameter: session"
_EMPTY_SESSION_MESSAGE = (
    "Parameter 'session' is set but what it points at is empty: check it names the "
    "variable a K8s Connect block assigns its 'session' output to, and that Connect "
    "ran before this block"
)
_GROUPS_WITHOUT_USER_MESSAGE = (
    "Parameter 'impersonate_groups' cannot be used on its own: set 'impersonate_user' to the "
    "user to run the request as, or clear the groups"
)
_SERVER = "https://k8s.example:6443"


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _config(
    cluster: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
    namespace: str | None = "default",
) -> dict[str, Any]:
    cluster_map: dict[str, Any] = {"server": _SERVER}
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


class TestRequireSession:
    """The first check every read verb runs: nothing set apart from set-but-empty."""

    def test_an_absent_session_param_is_missing(self) -> None:
        with pytest.raises(ValueError, match=_exact(_MISSING_SESSION_MESSAGE)):
            require_session({})

    def test_a_none_session_is_missing(self) -> None:
        with pytest.raises(ValueError, match=_exact(_MISSING_SESSION_MESSAGE)):
            require_session({"session": None})

    def test_a_session_that_resolved_to_empty_says_it_is_empty(self) -> None:
        with pytest.raises(ValueError, match=_exact(_EMPTY_SESSION_MESSAGE)):
            require_session({"session": ""})

    def test_a_session_with_a_value_passes(self) -> None:
        require_session(_session())

    def test_a_whitespace_session_is_left_to_the_kubeconfig_check(self) -> None:
        require_session({"session": "   "})

        with pytest.raises(ValueError, match=_exact(_SESSION_MESSAGE)):
            require_context({"session": "   "})


class TestRequireImpersonationUser:
    """Groups with no user: the apiserver answers that pairing with a bare 500."""

    def test_groups_with_no_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=_exact(_GROUPS_WITHOUT_USER_MESSAGE)):
            require_impersonation_user({"impersonate_groups": "qa"})

    def test_several_groups_with_no_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=_exact(_GROUPS_WITHOUT_USER_MESSAGE)):
            require_impersonation_user({"impersonate_groups": "qa, ops"})

    def test_a_blank_user_alongside_groups_is_refused(self) -> None:
        with pytest.raises(ValueError, match=_exact(_GROUPS_WITHOUT_USER_MESSAGE)):
            require_impersonation_user({"impersonate_user": "", "impersonate_groups": "qa"})

    def test_groups_with_a_user_pass(self) -> None:
        require_impersonation_user({"impersonate_user": "dev", "impersonate_groups": "qa, ops"})

    def test_a_user_on_its_own_passes(self) -> None:
        require_impersonation_user({"impersonate_user": "dev"})

    def test_no_impersonation_at_all_passes(self) -> None:
        require_impersonation_user({})

    @pytest.mark.parametrize("value", ["", "   ", " , ", ",,"])
    def test_groups_that_resolve_to_nothing_are_not_groups(self, value: str) -> None:
        require_impersonation_user({"impersonate_groups": value})

    def test_a_non_string_groups_value_is_not_groups(self) -> None:
        require_impersonation_user({"impersonate_groups": ["qa"]})

    def test_the_refusal_matches_what_the_client_would_have_sent(self) -> None:
        params = {"impersonate_groups": "qa, ops"}
        options = client_options(params)

        assert options["impersonate_groups"] == ["qa", "ops"]
        assert options["impersonate_user"] is None
        with pytest.raises(ValueError, match=_exact(_GROUPS_WITHOUT_USER_MESSAGE)):
            require_impersonation_user(params)


def _signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


_ENUM_MESSAGE = "Parameter 'on_error' must be one of: fail, record; Actual value was 'continue'."
_PARAM_KEYS = {
    "name",
    "type",
    "trim",
    "required",
    "default",
    "secret",
    "enum_values",
    "minimum",
    "description",
}
_OUTPUT_KEYS = {"name", "type", "secret", "description", "show_when"}
# The stock kinds of the window's Kind picker, in its order (K8SREAD-5).
_STOCK_KINDS = [
    "CronJob",
    "DaemonSet",
    "Deployment",
    "Job",
    "Pod",
    "ReplicaSet",
    "StatefulSet",
    "Endpoints",
    "Ingress",
    "NetworkPolicy",
    "Service",
    "ConfigMap",
    "Secret",
    "ServiceAccount",
    "PersistentVolume",
    "PersistentVolumeClaim",
    "StorageClass",
    "ClusterRole",
    "ClusterRoleBinding",
    "Namespace",
    "Node",
    "Role",
    "RoleBinding",
]
_KIND_PICKERS = [
    ("k8s_get", "K8sGetPlugin", "kind"),
    ("k8s_events", "K8sEventsPlugin", "object_kind"),
    ("k8s_delete", "K8sDeletePlugin", "kind"),
]


def _by_name(parameters: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {parameter["name"]: parameter for parameter in parameters}


class TestAlwaysHardFail:
    """The always-hard-fail classes raise under both on_error values."""

    def test_an_invalid_parameter_is_rejected_before_dispatch(self) -> None:
        with pytest.raises(ValueError, match=_exact(_ENUM_MESSAGE)):
            validate_enum_from_schema("on_error", "continue", [common.on_error_parameter()])


class TestKindPickers:
    """Get's Kind, Events' Object Kind and Delete's Kind offer one kind list, default Pod."""

    @staticmethod
    def _picker(module: str, plugin: str, name: str) -> dict[str, Any]:
        parameters = getattr(_plugin(module), plugin)().metadata["parameters"]
        return _by_name(parameters)[name]

    @pytest.mark.parametrize(("module", "plugin", "name"), _KIND_PICKERS)
    def test_the_picker_offers_the_stock_kinds_in_the_windows_order(
        self, module: str, plugin: str, name: str
    ) -> None:
        assert self._picker(module, plugin, name)["enum_values"] == _STOCK_KINDS

    @pytest.mark.parametrize(("module", "plugin", "name"), _KIND_PICKERS)
    def test_the_picker_defaults_to_pod(self, module: str, plugin: str, name: str) -> None:
        assert self._picker(module, plugin, name)["default"] == "Pod"

    @pytest.mark.parametrize(("module", "plugin", "name"), _KIND_PICKERS)
    def test_the_picker_stays_a_string_row_that_is_not_required_outright(
        self, module: str, plugin: str, name: str
    ) -> None:
        picker = self._picker(module, plugin, name)

        assert (picker["type"], picker["required"]) == ("string", False)


class TestParameterFactories:
    """The shared parameter and output-core descriptors the four read verbs reuse."""

    def test_session_is_a_required_trimmed_secret_string(self) -> None:
        param = common.session_parameter()

        assert param["name"] == "session"
        assert param["type"] == "string"
        assert param["required"] is True
        assert param["secret"] is True
        assert param["trim"] is True
        assert "default" not in param
        assert param["description"]

    def test_timeout_is_an_optional_integer_defaulting_to_thirty(self) -> None:
        param = common.timeout_parameter()

        assert param["name"] == "timeout"
        assert param["type"] == "integer"
        assert param["required"] is False
        assert param["default"] == 30
        assert param["minimum"] == 1
        assert param["description"]

    def test_namespace_group_leads_with_all_namespaces_when_the_verb_offers_it(self) -> None:
        names = [param["name"] for param in common.namespace_parameters(True)]

        assert names == ["all_namespaces", "namespace"]

    def test_namespace_group_omits_all_namespaces_when_the_verb_has_none(self) -> None:
        names = [param["name"] for param in common.namespace_parameters(False)]

        assert names == ["namespace"]

    def test_all_namespaces_is_a_boolean_defaulting_to_false(self) -> None:
        param = _by_name(common.namespace_parameters(True))["all_namespaces"]

        assert param["type"] == "boolean"
        assert param["required"] is False
        assert param["default"] is False

    def test_namespace_is_an_optional_trimmed_string(self) -> None:
        param = _by_name(common.namespace_parameters(True))["namespace"]

        assert param["type"] == "string"
        assert param["required"] is False
        assert param["trim"] is True
        assert "default" not in param

    def test_impersonation_is_two_optional_trimmed_strings(self) -> None:
        params = common.impersonation_parameters()

        assert [param["name"] for param in params] == ["impersonate_user", "impersonate_groups"]
        assert all(param["type"] == "string" for param in params)
        assert all(param["required"] is False for param in params)
        assert all(param["trim"] is True for param in params)

    def test_on_error_is_a_two_value_enum_defaulting_to_fail(self) -> None:
        param = common.on_error_parameter()

        assert param["name"] == "on_error"
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "fail"
        assert param["enum_values"] == ["fail", "record"]

    def test_every_shared_parameter_carries_a_description(self) -> None:
        params = [
            common.session_parameter(),
            common.timeout_parameter(),
            common.on_error_parameter(),
            *common.namespace_parameters(True),
            *common.impersonation_parameters(),
        ]

        assert all(param["description"] for param in params)

    def test_no_shared_parameter_leaks_a_frontend_only_key(self) -> None:
        params = [
            common.session_parameter(),
            common.timeout_parameter(),
            common.on_error_parameter(),
            *common.namespace_parameters(True),
            *common.impersonation_parameters(),
        ]

        assert all(set(param) <= _PARAM_KEYS for param in params)

    def test_output_core_is_success_error_reason_in_order(self) -> None:
        outputs = common.output_core(gated=False)

        assert [(output["name"], output["type"]) for output in outputs] == [
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_output_core_carries_descriptions_and_no_secret_flags(self) -> None:
        outputs = common.output_core(gated=False)

        assert all(output["description"] for output in outputs)
        assert all(output.get("secret") is not True for output in outputs)
        assert all(set(output) <= _OUTPUT_KEYS for output in outputs)

    def test_session_factory_returns_a_fresh_descriptor(self) -> None:
        first = common.session_parameter()
        first["required"] = False

        assert common.session_parameter()["required"] is True

    def test_namespace_factory_returns_fresh_descriptors(self) -> None:
        first = common.namespace_parameters(True)
        first[0]["default"] = True

        assert common.namespace_parameters(True)[0]["default"] is False


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
_RECORD_GATE = {"field": "on_error", "values": ["record"]}
_DEFAULT_FORMAT_DESCRIPTION = (
    "Shape of 'result': 'map' is the parsed object or list, 'table' is a WAVE "
    "table with the columns kubectl prints, 'json' and 'yaml' are the object "
    "as JSON or YAML text"
)
_APPLY_FORMAT_DESCRIPTION = (
    "Shape of 'result': the applied object, or the same object as JSON or YAML text"
)


def _core_by_name(*, gated: bool) -> dict[str, dict[str, Any]]:
    return {output["name"]: output for output in common.output_core(gated=gated)}


class TestOutputCoreGating:
    """The core reads the same for every verb, and its two error rows can hide."""

    def test_gated_is_keyword_only_and_has_no_default(self) -> None:
        parameter = _signature_of(common.output_core, "gated")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_three_descriptions_are_verb_neutral(self, gated: bool) -> None:
        outputs = _core_by_name(gated=gated)

        assert {name: output["description"] for name, output in outputs.items()} == (
            _CORE_DESCRIPTIONS
        )

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_order_is_success_error_reason_in_both_modes(self, gated: bool) -> None:
        outputs = common.output_core(gated=gated)

        assert [(output["name"], output["type"]) for output in outputs] == [
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_an_ungated_core_hides_nothing(self) -> None:
        assert all("show_when" not in output for output in common.output_core(gated=False))

    def test_a_gated_core_hides_the_error_row_until_the_block_records(self) -> None:
        assert _core_by_name(gated=True)["error"]["show_when"] == _RECORD_GATE

    def test_a_gated_core_hides_the_reason_row_until_the_block_records(self) -> None:
        assert _core_by_name(gated=True)["reason"]["show_when"] == _RECORD_GATE

    @pytest.mark.parametrize("gated", [False, True])
    def test_success_is_never_gated(self, gated: bool) -> None:
        assert "show_when" not in _core_by_name(gated=gated)["success"]

    def test_gating_adds_no_other_key(self) -> None:
        assert all(set(output) <= _OUTPUT_KEYS for output in common.output_core(gated=True))

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_factory_returns_fresh_descriptors(self, gated: bool) -> None:
        first = common.output_core(gated=gated)
        first[0]["name"] = "changed"

        assert common.output_core(gated=gated)[0]["name"] == "success"


class TestOutputFormatParameter:
    """The format enum keeps its shipped shape and takes the option list a verb offers."""

    def test_formats_and_description_are_keyword_only(self) -> None:
        for name in ("formats", "description"):
            assert (
                _signature_of(common.output_format_parameter, name).kind
                is inspect.Parameter.KEYWORD_ONLY
            )

    def test_the_no_argument_call_is_the_shipped_read_descriptor(self) -> None:
        param = common.output_format_parameter()

        assert param["name"] == "output_format"
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "map"
        assert param["enum_values"] == ["map", "table", "json", "yaml"]

    def test_the_no_argument_call_keeps_the_shipped_description(self) -> None:
        assert common.output_format_parameter()["description"] == _DEFAULT_FORMAT_DESCRIPTION

    def test_a_verb_with_no_table_gets_exactly_the_three_it_asked_for(self) -> None:
        param = common.output_format_parameter(formats=("map", "json", "yaml"))

        assert param["enum_values"] == ["map", "json", "yaml"]

    def test_a_shortened_option_list_still_defaults_to_map(self) -> None:
        param = common.output_format_parameter(formats=("map", "json", "yaml"))

        assert param["default"] == "map"

    def test_a_verb_can_carry_its_own_description(self) -> None:
        param = common.output_format_parameter(
            formats=("map", "json", "yaml"), description=_APPLY_FORMAT_DESCRIPTION
        )

        assert param["description"] == _APPLY_FORMAT_DESCRIPTION

    def test_the_descriptor_leaks_no_frontend_only_key(self) -> None:
        param = common.output_format_parameter(formats=("map", "json", "yaml"))

        assert set(param) <= _PARAM_KEYS

    def test_the_factory_returns_a_fresh_descriptor(self) -> None:
        first = common.output_format_parameter()
        first["default"] = "yaml"

        assert common.output_format_parameter()["default"] == "map"


_SECRET_ENCODED = "czNjcjN0"
_FORM_SECRET_VALUES = ["s3cr3t", "czNjcjN0", "admin", "YWRtaW4="]
_MANIFEST_SECRET_VALUES = ["czNjcjN0", "s3cr3t"]
_SECRET_MANIFEST = json.dumps(
    {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "db"},
        "data": {"password": _SECRET_ENCODED},
    }
)
_CONFIG_MAP_MANIFEST = json.dumps(
    {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": "probe-a"},
        "data": {"count": "3"},
    }
)
_RESOLVER = "wavecore.plugins.k8s_copy.resolve_plugin_path"
_ARTIFACTS_DIR = "/runs/42/artifacts"
_TESTDATA_DIRS = ["/data"]
_POD_PATH = "/etc/config/app.conf"
_PULL_TARGET = "artifact://out.txt"
_PUSH_SOURCE = "testdata://seed.txt"
_LOCAL_PULL_PATH = "/runs/42/artifacts/out.txt"
_LOCAL_PUSH_PATH = "/data/seed.txt"


class TestApplyPrepare:
    """Apply's hook masks every Secret value the block is about to write, before it writes it."""

    def test_a_form_mode_secret_carries_its_plaintext_and_its_base64(self) -> None:
        params = {
            "define_with": "form",
            "kind": "Secret",
            "name": "db",
            "secret_data": {"password": "s3cr3t", "user": "admin"},
        }

        prepared, values = _plugin("k8s_apply").prepare(params, execute_context(params))

        assert values == _FORM_SECRET_VALUES
        assert prepared is params

    def test_a_manifest_mode_secret_carries_its_encoded_value_and_its_plaintext(self) -> None:
        params = {"define_with": "manifest", "manifest": _SECRET_MANIFEST}

        prepared, values = _plugin("k8s_apply").prepare(params, execute_context(params))

        assert values == _MANIFEST_SECRET_VALUES
        assert prepared is params

    def test_the_hook_hands_the_verb_the_params_it_was_given(self) -> None:
        params = {"define_with": "manifest", "manifest": _SECRET_MANIFEST}

        prepared, _values = _plugin("k8s_apply").prepare(params, execute_context(params))

        assert prepared == {"define_with": "manifest", "manifest": _SECRET_MANIFEST}

    @pytest.mark.parametrize(
        "params",
        [
            {"define_with": "manifest", "manifest": _CONFIG_MAP_MANIFEST},
            {"define_with": "form", "kind": "ConfigMap", "name": "probe-a", "data": {"count": "3"}},
        ],
        ids=["manifest", "form"],
    )
    def test_a_config_map_carries_no_secret_values(self, params: dict[str, Any]) -> None:
        _prepared, values = _plugin("k8s_apply").prepare(params, execute_context(params))

        assert values == []


class TestCopyPrepare:
    """Copy's hook resolves the WAVE side of the transfer before the verb sees a path."""

    def test_a_pull_resolves_the_target_path_as_a_write(self) -> None:
        params = {
            "direction": "from_pod",
            "source_path": f"  {_POD_PATH} ",
            "target_path": f" {_PULL_TARGET} ",
        }
        context = execute_context(
            params, artifacts_dir=_ARTIFACTS_DIR, testdata_dirs=_TESTDATA_DIRS
        )

        with patch(_RESOLVER, return_value=Path(_LOCAL_PULL_PATH)) as resolver:
            prepared, values = _plugin("k8s_copy").prepare(params, context)

        assert resolver.call_args_list == [
            call(_PULL_TARGET, _ARTIFACTS_DIR, _TESTDATA_DIRS, read_only_ok=False)
        ]
        assert prepared["target_path"] == _LOCAL_PULL_PATH
        assert prepared["source_path"] == _POD_PATH
        assert values == []

    def test_a_push_resolves_the_source_path_as_a_read(self) -> None:
        params = {
            "direction": "to_pod",
            "source_path": f" {_PUSH_SOURCE} ",
            "target_path": f" {_POD_PATH}  ",
        }
        context = execute_context(
            params, artifacts_dir=_ARTIFACTS_DIR, testdata_dirs=_TESTDATA_DIRS
        )

        with patch(_RESOLVER, return_value=Path(_LOCAL_PUSH_PATH)) as resolver:
            prepared, values = _plugin("k8s_copy").prepare(params, context)

        assert resolver.call_args_list == [
            call(_PUSH_SOURCE, _ARTIFACTS_DIR, _TESTDATA_DIRS, read_only_ok=True)
        ]
        assert prepared["source_path"] == _LOCAL_PUSH_PATH
        assert prepared["target_path"] == _POD_PATH
        assert values == []

    def test_a_copy_with_no_direction_pulls(self) -> None:
        params = {"source_path": _POD_PATH, "target_path": _PULL_TARGET}
        context = execute_context(params, artifacts_dir=_ARTIFACTS_DIR)

        with patch(_RESOLVER, return_value=Path(_LOCAL_PULL_PATH)) as resolver:
            prepared, _values = _plugin("k8s_copy").prepare(params, context)

        assert resolver.call_args_list == [
            call(_PULL_TARGET, _ARTIFACTS_DIR, None, read_only_ok=False)
        ]
        assert prepared["target_path"] == _LOCAL_PULL_PATH

    def test_the_callers_params_are_left_alone_and_ride_along_whole(self) -> None:
        params = {
            "direction": "to_pod",
            "source_path": _PUSH_SOURCE,
            "target_path": _POD_PATH,
            "pod": "web-1",
        }
        context = execute_context(params, testdata_dirs=_TESTDATA_DIRS)

        with patch(_RESOLVER, return_value=Path(_LOCAL_PUSH_PATH)):
            prepared, _values = _plugin("k8s_copy").prepare(params, context)

        assert prepared is not params
        assert params["source_path"] == _PUSH_SOURCE
        assert prepared["pod"] == "web-1"
        assert prepared["direction"] == "to_pod"
