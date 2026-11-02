"""K8s Apply plugin tests (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Apply writes one object from a short form or any number of objects from a
hand-typed manifest, either bringing them to match with a server-side apply
patch or creating them and refusing an object that is already there. It
reports what happened in a Summary table, registers every Secret value it
writes, and carries the gated success/error/reason output core (K8SWRITE-1,
K8SWRITE-8).
"""

import json
import urllib.parse
from typing import Any
from unittest.mock import MagicMock, call

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    block_params,
    exact,
    execute_context,
    patch_verb_client,
    required_conditions,
    resource,
)
from tests.plugins.k8s._k8s_fixtures import (
    FakeK8sClient as SharedFakeK8sClient,
)
from wavecore.connectivity.k8s.rest import K8sApiError, K8sResource
from wavecore.core.expressions.errors import NullValueError
from wavecore.core.table import Table
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.k8s_apply import K8sApplyPlugin

APPLY_PATCH_CONTENT_TYPE = "application/apply-patch+yaml"

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "define_with",
    "manifest",
    "kind",
    "name",
    "data",
    "secret_data",
    "secret_type",
    "job_from",
    "cronjob_name",
    "image",
    "command",
    "if_exists",
    "output_format",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

CONDITIONALLY_REQUIRED_PARAMS = ["manifest", "kind", "name", "cronjob_name", "image"]

SECRET_PARAMS = {"session", "secret_data"}

TRIMMED_PARAMS = [
    "session",
    "name",
    "cronjob_name",
    "image",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
]

ENUM_PARAMS = {
    "define_with",
    "kind",
    "secret_type",
    "job_from",
    "if_exists",
    "output_format",
    "on_error",
}

# 'kind' is absent: a blank kind reads as an unfilled row and is reported missing.
BLANK_ENUM_ROWS = [
    ("define_with", "manifest, form"),
    ("secret_type", "Opaque, kubernetes.io/tls, kubernetes.io/dockerconfigjson"),
    ("job_from", "image, cronjob"),
    ("if_exists", "update, fail"),
    ("output_format", "map, json, yaml"),
    ("on_error", "fail, record"),
]

OUTPUT_FORMAT_DESCRIPTION = (
    "Shape of 'result': the applied object, or the same object as JSON or YAML text"
)

GATED_OUTPUTS = {"error", "reason"}
RECORD_GATE = {"field": "on_error", "values": ["record"]}

# Result's declared type follows Output Format, and map splits on Define with (K8SWRITE-4).
RESULT_TYPE_WHEN: list[dict[str, Any]] = [
    {"when": [{"field": "output_format", "values": ["json", "yaml"]}], "type": "string"},
    {"when": [{"field": "define_with", "values": ["manifest"]}], "type": "array"},
]

RESULT_TYPE_MATRIX = [
    ("map", "form", "map"),
    ("map", "manifest", "array"),
    ("json", "form", "string"),
    ("json", "manifest", "string"),
    ("yaml", "form", "string"),
    ("yaml", "manifest", "string"),
]

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

_MANIFEST_KIND_MESSAGE = "Parameter 'manifest' must include 'apiVersion' and 'kind'"
_MANIFEST_NAME_MESSAGE = "Parameter 'manifest' must include 'metadata.name'"
_UNCLOSED_QUOTE_MESSAGE = "Parameter 'command' has an unclosed quote"

_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}
_SECRETS = {"Secret": resource("Secret", "secrets")}
_JOBS = {"Job": resource("Job", "jobs", group_version="batch/v1")}
# The version the cluster prefers, so a document naming another one must route away from it.
_WIDGETS = {"Widget": resource("Widget", "widgets", group_version="example.com/v1")}
_JOBS_AND_CRONJOBS = {
    **_JOBS,
    "CronJob": resource("CronJob", "cronjobs", group_version="batch/v1"),
}

_CONFIGMAP_COLLECTION = "/api/v1/namespaces/apps/configmaps"
_JOB_COLLECTION = "/apis/batch/v1/namespaces/apps/jobs"
_APPLY_QUERY = {"fieldManager": ["wave"], "force": ["true"]}
_CREATE_QUERY = {"fieldManager": ["wave"], "fieldValidation": ["Strict"]}

_CRONJOB_TEMPLATE_SPEC: dict[str, Any] = {
    "template": {
        "spec": {
            "containers": [{"name": "worker", "image": "busybox:1.36"}],
            "restartPolicy": "Never",
        }
    },
    "backoffLimit": 4,
}
_CRONJOB = {
    "apiVersion": "batch/v1",
    "kind": "CronJob",
    "metadata": {"name": "nightly", "namespace": NAMESPACE},
    "spec": {"schedule": "0 2 * * *", "jobTemplate": {"spec": _CRONJOB_TEMPLATE_SPEC}},
}


class FakeK8sClient(SharedFakeK8sClient):
    """The shared fake, recording the API version each discovery lookup carries."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.lookups: list[tuple[str, str | None]] = []

    def discover(self, kind: str, api_version: str | None = None) -> K8sResource | None:
        """Record the lookup and serve the kind at the version it was asked for."""
        self.lookups.append((kind, api_version))
        found = super().discover(kind)
        if found is None or api_version is None:
            return found
        return resource(found.kind, found.name, found.namespaced, api_version)


def _plugin() -> K8sApplyPlugin:
    """A fresh K8s Apply plugin."""
    return K8sApplyPlugin()


def _document(name: str, count: str = "3") -> dict[str, Any]:
    """The ConfigMap object one manifest document describes."""
    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": name},
        "data": {"count": count},
    }


def _manifest_text(name: str, count: str = "3") -> str:
    """One document, as the canonical JSON text the engine hands the plugin."""
    return json.dumps(_document(name, count))


def _manifest_list(*names: str) -> str:
    """Several documents, as the one JSON array that replaces a '---' stream."""
    return json.dumps([_document(name) for name in names])


def _document_with(**overrides: Any) -> str:
    """The ConfigMap document as JSON text, with the named keys replaced."""
    document: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": "probe-a"},
    }
    document.update(overrides)
    return json.dumps(document)


def _widget_text(api_version: str) -> str:
    """One custom-resource document as JSON text, at the API version it names."""
    return json.dumps({"apiVersion": api_version, "kind": "Widget", "metadata": {"name": "w1"}})


def _secret_object(name: str, **payload: Any) -> dict[str, Any]:
    """One Opaque Secret document carrying the given data map."""
    return {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": name},
        "type": "Opaque",
        **payload,
    }


def _unparsable_message(text: str) -> str:
    """The exact refusal a manifest the JSON parser cannot read earns."""
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        return f"Parameter 'manifest' is not valid YAML or JSON: {exc}"
    raise AssertionError(f"{text!r} parses as JSON")


_MANIFEST_ONE = _manifest_text("probe-a")
_MANIFEST_TWO = _manifest_list("probe-a", "probe-b")
_MANIFEST_THREE = _manifest_list("probe-a", "probe-b", "probe-c")
_NO_KIND_DOCUMENT = json.dumps({"apiVersion": "v1"})
_NOT_JSON = '{"apiVersion": "v1",'
_YAML_NOT_JSON = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: probe-a\n"


def _applied(name: str, namespace: str = NAMESPACE) -> dict[str, Any]:
    """The ConfigMap the cluster answers an apply with."""
    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": name, "namespace": namespace, "resourceVersion": "42"},
        "data": {"count": "3"},
    }


# kubectl -o yaml prints keys alphabetically, and every K8s block's yaml output matches it.
_APPLIED_ONE_YAML = (
    "apiVersion: v1\n"
    "data:\n"
    "  count: '3'\n"
    "kind: ConfigMap\n"
    "metadata:\n"
    "  name: probe-a\n"
    "  namespace: apps\n"
    "  resourceVersion: '42'\n"
)
_APPLIED_TWO_YAML = (
    "- apiVersion: v1\n"
    "  data:\n"
    "    count: '3'\n"
    "  kind: ConfigMap\n"
    "  metadata:\n"
    "    name: probe-a\n"
    "    namespace: apps\n"
    "    resourceVersion: '42'\n"
    "- apiVersion: v1\n"
    "  data:\n"
    "    count: '3'\n"
    "  kind: ConfigMap\n"
    "  metadata:\n"
    "    name: probe-b\n"
    "    namespace: apps\n"
    "    resourceVersion: '42'\n"
)


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _split(path: str) -> tuple[str, dict[str, list[str]]]:
    base, _, query = path.partition("?")
    return base, urllib.parse.parse_qs(query)


def _construction(fake: FakeK8sClient) -> tuple[Any, Any, dict[str, Any]]:
    call_args = fake.factory.call_args
    kwargs = dict(call_args.kwargs)
    context = call_args.args[0] if call_args.args else kwargs.pop("context", None)
    if "timeout" in kwargs:
        timeout = kwargs.pop("timeout")
    else:
        timeout = call_args.args[1] if len(call_args.args) > 1 else None
    return context, timeout, kwargs


def _params_by_name() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in _plugin().metadata["parameters"]}


def _outputs_by_name() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in _plugin().metadata["output_schema"]}


def _manifest_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"define_with": "manifest", "manifest": _MANIFEST_ONE}
    params.update(overrides)
    return block_params(**params)


def _form_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "define_with": "form",
        "kind": "ConfigMap",
        "name": "probe-a",
        "data": {"count": "3"},
    }
    params.update(overrides)
    return block_params(**params)


def _secret_params(**overrides: Any) -> dict[str, Any]:
    """The Secret form. Its values ride 'secret_data'; the ConfigMap 'data' row stays filled
    so every Secret test also proves the Secret form never reads it."""
    params: dict[str, Any] = {
        "kind": "Secret",
        "name": "db",
        "secret_data": {"password": "s3cr3t"},
    }
    params.update(overrides)
    return _form_params(**params)


def _job_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "define_with": "form",
        "kind": "Job",
        "name": "probe",
        "job_from": "image",
        "image": "busybox:1.36",
    }
    params.update(overrides)
    return block_params(**params)


def _writes(fake: FakeK8sClient) -> list[Any]:
    return [entry for entry in fake.calls if entry.method in ("PATCH", "POST")]


def _summary_rows(result: dict[str, Any]) -> list[list[Any]]:
    table: Table = result["summary"]
    return [row.to_list() for row in table]


async def _execute(
    fake: FakeK8sClient,
    params: dict[str, Any],
    register_secret: Any = None,
    logger: Any = None,
) -> Any:
    with patch_verb_client("apply", fake):
        return await _plugin().execute(execute_context(params, register_secret, logger))


class TestMetadata:
    """Plugin identity, the nineteen parameters, and the seven outputs."""

    def test_plugin_instantiates(self) -> None:
        assert _plugin() is not None

    def test_identity(self) -> None:
        meta = _plugin().metadata

        assert meta["id"] == "k8s-apply"
        assert meta["name"] == "K8s Apply"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in _plugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_parameter_list_is_exactly_nineteen_rows(self) -> None:
        assert len(_plugin().metadata["parameters"]) == 19

    def test_remotable_is_true(self) -> None:
        assert _plugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert _plugin().metadata["proxy_support"] == "supported"

    def test_session_is_the_only_required_parameter(self) -> None:
        params = _params_by_name()

        assert params["session"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("required") is False

    def test_parameter_types(self) -> None:
        params = _params_by_name()

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["define_with"]["type"] == "string"
        assert params["manifest"]["type"] == "string"
        assert params["kind"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["data"]["type"] == "map"
        assert params["secret_data"]["type"] == "map"
        assert params["secret_type"]["type"] == "string"
        assert params["job_from"]["type"] == "string"
        assert params["cronjob_name"]["type"] == "string"
        assert params["image"]["type"] == "string"
        assert params["command"]["type"] == "string"
        assert params["if_exists"]["type"] == "string"
        assert params["output_format"]["type"] == "string"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_the_manifest_row_declares_a_json_wire_format(self) -> None:
        assert _params_by_name()["manifest"]["wire_format"] == "json"

    def test_defaults(self) -> None:
        params = _params_by_name()

        assert params["timeout"]["default"] == 30
        assert params["define_with"]["default"] == "manifest"
        assert params["kind"]["default"] == "ConfigMap"
        assert params["secret_type"]["default"] == "Opaque"
        assert params["job_from"]["default"] == "image"
        assert params["if_exists"]["default"] == "update"
        assert params["output_format"]["default"] == "map"
        assert params["on_error"]["default"] == "fail"

    def test_the_free_text_rows_declare_no_default(self) -> None:
        params = _params_by_name()

        for name in (
            "session",
            "manifest",
            "name",
            "data",
            "secret_data",
            "cronjob_name",
            "image",
            "command",
        ):
            assert "default" not in params[name]

    def test_the_session_and_the_secret_data_rows_are_the_secret_ones(self) -> None:
        params = _params_by_name()

        for name in EXPECTED_PARAM_ORDER:
            if name in SECRET_PARAMS:
                assert params[name]["secret"] is True
            else:
                assert params[name].get("secret") is not True

    def test_the_secret_data_row_is_secret_and_the_config_map_data_row_is_not(self) -> None:
        params = _params_by_name()

        assert params["secret_data"]["secret"] is True
        assert params["data"].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name()

        for name in TRIMMED_PARAMS:
            assert params[name]["trim"] is True

    def test_the_manifest_and_command_bodies_keep_their_whitespace(self) -> None:
        params = _params_by_name()

        assert params["manifest"].get("trim") is not True
        assert params["command"].get("trim") is not True

    def test_enum_values(self) -> None:
        params = _params_by_name()

        assert params["define_with"]["enum_values"] == ["manifest", "form"]
        assert params["kind"]["enum_values"] == ["ConfigMap", "Secret", "Job"]
        assert params["secret_type"]["enum_values"] == [
            "Opaque",
            "kubernetes.io/tls",
            "kubernetes.io/dockerconfigjson",
        ]
        assert params["job_from"]["enum_values"] == ["image", "cronjob"]
        assert params["if_exists"]["enum_values"] == ["update", "fail"]
        assert params["output_format"]["enum_values"] == ["map", "json", "yaml"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_output_format_offers_no_table_option(self) -> None:
        params = _params_by_name()

        assert "table" not in params["output_format"]["enum_values"]

    def test_output_format_is_one_field_not_two(self) -> None:
        names = [p["name"] for p in _plugin().metadata["parameters"]]

        assert names.count("output_format") == 1

    def test_the_two_data_rows_appear_once_each(self) -> None:
        names = [p["name"] for p in _plugin().metadata["parameters"]]

        assert names.count("data") == 1
        assert names.count("secret_data") == 1

    def test_the_two_data_rows_describe_the_kind_each_one_carries(self) -> None:
        params = _params_by_name()

        assert "ConfigMap" in params["data"]["description"]
        assert "Secret" not in params["data"]["description"]
        assert "Secret" in params["secret_data"]["description"]
        assert "ConfigMap" not in params["secret_data"]["description"]

    def test_output_format_carries_its_own_description(self) -> None:
        params = _params_by_name()

        assert params["output_format"]["description"] == OUTPUT_FORMAT_DESCRIPTION

    def test_only_the_seven_mode_params_are_enums(self) -> None:
        params = _params_by_name()

        assert {name for name, param in params.items() if "enum_values" in param} == ENUM_PARAMS

    def test_every_parameter_carries_a_description(self) -> None:
        for param in _plugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = _plugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("summary", "table"),
            ("result", "map"),
            ("names", "array"),
            ("count", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_no_created_output_is_declared(self) -> None:
        names = [o["name"] for o in _plugin().metadata["output_schema"]]

        assert "created" not in names

    def test_summary_is_declared_a_table(self) -> None:
        assert _outputs_by_name()["summary"]["type"] == "table"

    def test_every_output_carries_a_description(self) -> None:
        for output in _plugin().metadata["output_schema"]:
            assert output.get("description")

    def test_no_output_is_flagged_secret(self) -> None:
        for output in _plugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name()

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS


class TestOutputGating:
    """Error and Reason are hidden outside Record and continue; Success never is."""

    @pytest.mark.parametrize("name", sorted(GATED_OUTPUTS))
    def test_the_gated_outputs_render_only_under_record(self, name: str) -> None:
        assert _outputs_by_name()[name]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        assert "show_when" not in _outputs_by_name()["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        outputs = _plugin().metadata["output_schema"]

        gated = {o["name"] for o in outputs if "show_when" in o}

        assert gated == GATED_OUTPUTS


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_manifest_is_required_in_manifest_mode(self) -> None:
        params = _params_by_name()

        assert params["manifest"]["required_when"] == {
            "field": "define_with",
            "values": ["manifest"],
        }

    def test_kind_is_required_in_form_mode(self) -> None:
        params = _params_by_name()

        assert params["kind"]["required_when"] == {"field": "define_with", "values": ["form"]}

    def test_name_is_required_in_form_mode(self) -> None:
        params = _params_by_name()

        assert params["name"]["required_when"] == {"field": "define_with", "values": ["form"]}

    def test_cronjob_name_is_required_for_a_job_built_from_a_cronjob(self) -> None:
        params = _params_by_name()

        assert params["cronjob_name"]["required_when_all"] == [
            {"field": "define_with", "values": ["form"]},
            {"field": "kind", "values": ["Job"]},
            {"field": "job_from", "values": ["cronjob"]},
        ]

    def test_image_is_required_for_a_job_built_from_an_image(self) -> None:
        params = _params_by_name()

        assert params["image"]["required_when_all"] == [
            {"field": "define_with", "values": ["form"]},
            {"field": "kind", "values": ["Job"]},
            {"field": "job_from", "values": ["image"]},
        ]

    def test_only_the_five_mode_bound_params_are_conditionally_required(self) -> None:
        params = _params_by_name()

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == CONDITIONALLY_REQUIRED_PARAMS

    def test_no_conditionally_required_param_is_also_required(self) -> None:
        params = _params_by_name()

        for name in CONDITIONALLY_REQUIRED_PARAMS:
            assert params[name].get("required") is False

    def test_the_two_job_rows_are_the_only_conjunctive_ones(self) -> None:
        params = _params_by_name()

        conjunctive = [n for n in EXPECTED_PARAM_ORDER if params[n].get("required_when_all")]

        assert conjunctive == ["cronjob_name", "image"]

    def test_every_condition_reads_a_field_that_declares_a_default(self) -> None:
        """The gate falls back to the referenced field's default, so it must have one."""
        params = _params_by_name()

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert params[condition["field"]]["default"] is not None


class TestResultTypeRules:
    """Result declares the type its Output Format and Define with return (K8SWRITE-4)."""

    def test_result_declares_the_two_rules_in_order(self) -> None:
        result = _outputs_by_name()["result"]

        assert result["type"] == "map"
        assert result["type_when"] == RESULT_TYPE_WHEN

    def test_no_other_output_carries_type_rules(self) -> None:
        for name, output in _outputs_by_name().items():
            if name == "result":
                continue
            assert "type_when" not in output

    def test_the_default_sheet_state_resolves_to_an_array(self) -> None:
        result = _outputs_by_name()["result"]

        resolved = resolve_output_type(result["type"], result["type_when"], {}, _params_by_name())

        assert resolved == "array"

    @pytest.mark.parametrize(("output_format", "define_with", "expected"), RESULT_TYPE_MATRIX)
    def test_every_format_and_mode_resolves(
        self, output_format: str, define_with: str, expected: str
    ) -> None:
        result = _outputs_by_name()["result"]
        values = {"output_format": output_format, "define_with": define_with}

        assert resolve_output_type(result["type"], result["type_when"], values) == expected


class TestValidation:
    """validate() - session, impersonation, enums, the per-mode required rows, the timeout."""

    async def test_manifest_mode_minimal_params_pass(self) -> None:
        await _plugin().validate(_manifest_params())

    async def test_form_mode_minimal_params_pass(self) -> None:
        await _plugin().validate(_form_params())

    async def test_a_full_form_block_passes(self) -> None:
        await _plugin().validate(
            _job_params(
                timeout=45,
                command='sh -c "echo hi there"',
                if_exists="fail",
                output_format="yaml",
                namespace="ops",
                impersonate_user="dev",
                impersonate_groups="qa, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await _plugin().validate({"define_with": "manifest", "manifest": _MANIFEST_ONE})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await _plugin().validate(_manifest_params(session=""))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await _plugin().validate(_manifest_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await _plugin().validate(
            _manifest_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )

    async def test_define_with_enum(self) -> None:
        message = (
            "Parameter 'define_with' must be one of: manifest, form; Actual value was 'wizard'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_manifest_params(define_with="wizard"))

    async def test_kind_enum(self) -> None:
        message = "Parameter 'kind' must be one of: ConfigMap, Secret, Job; Actual value was 'Pod'."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_form_params(kind="Pod"))

    async def test_a_namespace_kind_is_rejected_by_the_kind_enum(self) -> None:
        message = (
            "Parameter 'kind' must be one of: ConfigMap, Secret, Job; "
            "Actual value was 'Namespace'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_form_params(kind="Namespace"))

    async def test_secret_type_enum(self) -> None:
        message = (
            "Parameter 'secret_type' must be one of: Opaque, kubernetes.io/tls, "
            "kubernetes.io/dockerconfigjson; Actual value was 'kubernetes.io/basic-auth'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(
                _form_params(kind="Secret", secret_type="kubernetes.io/basic-auth")
            )

    async def test_job_from_enum(self) -> None:
        message = "Parameter 'job_from' must be one of: image, cronjob; Actual value was 'chart'."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_job_params(job_from="chart"))

    async def test_if_exists_enum(self) -> None:
        message = "Parameter 'if_exists' must be one of: update, fail; Actual value was 'skip'."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_manifest_params(if_exists="skip"))

    async def test_output_format_enum_names_only_three_options(self) -> None:
        message = (
            "Parameter 'output_format' must be one of: map, json, yaml; Actual value was 'table'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_manifest_params(output_format="table"))

    async def test_on_error_enum(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_manifest_params(on_error="ignore"))

    @pytest.mark.parametrize("name, allowed", BLANK_ENUM_ROWS)
    async def test_a_blank_enum_row_is_rejected_rather_than_defaulted(
        self, name: str, allowed: str
    ) -> None:
        message = f"Parameter '{name}' must be one of: {allowed}; Actual value was ''."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_manifest_params(**{name: ""}))

    async def test_a_blank_job_from_never_builds_a_job_with_no_image(self) -> None:
        message = "Parameter 'job_from' must be one of: image, cronjob; Actual value was ''."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_form_params(kind="Job", name="probe", job_from=""))

    async def test_missing_manifest_in_manifest_mode(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: manifest$"):
            await _plugin().validate(block_params(define_with="manifest"))

    async def test_blank_manifest_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: manifest$"):
            await _plugin().validate(block_params(define_with="manifest", manifest=""))

    async def test_manifest_is_required_when_define_with_is_absent(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: manifest$"):
            await _plugin().validate(block_params())

    async def test_manifest_is_not_required_in_form_mode(self) -> None:
        await _plugin().validate(_form_params())

    async def test_missing_kind_in_form_mode(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await _plugin().validate(block_params(define_with="form", name="probe-a"))

    async def test_blank_kind_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await _plugin().validate(_form_params(kind=""))

    async def test_missing_name_in_form_mode(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await _plugin().validate(block_params(define_with="form", kind="ConfigMap"))

    async def test_blank_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await _plugin().validate(_form_params(name="   "))

    async def test_neither_kind_nor_name_is_required_in_manifest_mode(self) -> None:
        await _plugin().validate(_manifest_params())

    async def test_missing_image_for_a_job_built_from_an_image(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: image$"):
            await _plugin().validate(_form_params(kind="Job", name="probe", job_from="image"))

    async def test_image_is_required_when_job_from_is_absent(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: image$"):
            await _plugin().validate(_form_params(kind="Job", name="probe"))

    async def test_missing_cronjob_name_for_a_job_built_from_a_cronjob(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: cronjob_name$"):
            await _plugin().validate(_form_params(kind="Job", name="probe", job_from="cronjob"))

    async def test_a_job_built_from_a_cronjob_needs_no_image(self) -> None:
        await _plugin().validate(
            _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")
        )

    async def test_a_job_built_from_an_image_needs_no_cronjob_name(self) -> None:
        await _plugin().validate(_job_params())

    async def test_a_config_map_needs_neither_job_row(self) -> None:
        await _plugin().validate(_form_params())

    async def test_neither_job_row_is_required_in_manifest_mode(self) -> None:
        await _plugin().validate(_manifest_params(kind="Job", job_from="image"))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_manifest_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_manifest_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await _plugin().validate(_manifest_params(timeout=1))

    async def test_an_empty_data_map_passes_on_a_config_map(self) -> None:
        await _plugin().validate(_form_params(data={}))

    async def test_an_empty_secret_data_map_passes_on_an_opaque_secret(self) -> None:
        await _plugin().validate(_secret_params(secret_data={}))

    @pytest.mark.parametrize("secret_type", ["kubernetes.io/tls", "kubernetes.io/dockerconfigjson"])
    async def test_a_typed_secret_is_not_pre_validated_for_its_keys(self, secret_type: str) -> None:
        await _plugin().validate(_secret_params(secret_type=secret_type, secret_data={}))


class TestManifestValidation:
    """A hand-typed manifest is parsed and vetted before the block ever runs."""

    async def test_an_unparsable_manifest_names_the_parser_detail(self) -> None:
        with pytest.raises(ValueError, match=exact(_unparsable_message(_NOT_JSON))):
            await _plugin().validate(_manifest_params(manifest=_NOT_JSON))

    async def test_text_that_is_valid_yaml_but_not_json_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_unparsable_message(_YAML_NOT_JSON))):
            await _plugin().validate(_manifest_params(manifest=_YAML_NOT_JSON))

    async def test_a_manifest_without_an_api_version_is_refused(self) -> None:
        text = json.dumps({"kind": "ConfigMap", "metadata": {"name": "probe-a"}})

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    async def test_a_manifest_without_a_kind_is_refused(self) -> None:
        text = json.dumps({"apiVersion": "v1", "metadata": {"name": "probe-a"}})

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    @pytest.mark.parametrize(
        "text",
        [
            _document_with(apiVersion=""),
            _document_with(apiVersion="   "),
            _document_with(apiVersion=None),
        ],
        ids=["blank", "whitespace", "null"],
    )
    async def test_a_manifest_whose_api_version_holds_no_text_is_refused(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    @pytest.mark.parametrize(
        "text",
        [_document_with(kind=""), _document_with(kind=None)],
        ids=["blank", "null"],
    )
    async def test_a_manifest_whose_kind_holds_no_text_is_refused(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    async def test_an_api_version_holding_no_text_never_reaches_the_cluster(self) -> None:
        fake = FakeK8sClient(resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _execute(fake, _manifest_params(manifest=_document_with(apiVersion=None)))

        assert fake.lookups == []
        assert fake.calls == []

    async def test_a_manifest_without_a_metadata_name_is_refused(self) -> None:
        text = json.dumps({"apiVersion": "v1", "kind": "ConfigMap", "metadata": {}})

        with pytest.raises(ValueError, match=exact(_MANIFEST_NAME_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    async def test_a_manifest_with_no_metadata_at_all_is_refused(self) -> None:
        text = json.dumps({"apiVersion": "v1", "kind": "ConfigMap"})

        with pytest.raises(ValueError, match=exact(_MANIFEST_NAME_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    async def test_every_document_is_vetted_not_only_the_first(self) -> None:
        text = json.dumps([_document("probe-a"), {"apiVersion": "v1"}])

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=text))

    async def test_a_json_array_is_read_as_one_document_per_element(self) -> None:
        await _plugin().validate(_manifest_params(manifest=_MANIFEST_THREE))

    async def test_a_top_level_scalar_is_one_document_that_declares_no_kind(self) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest="42"))

    async def test_a_manifest_that_declares_no_object_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest="[]"))

    async def test_a_manifest_that_declares_no_object_never_reaches_the_cluster(self) -> None:
        fake = FakeK8sClient(resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _execute(fake, _manifest_params(manifest="[]", output_format="yaml"))

        assert fake.lookups == []
        assert fake.calls == []

    async def test_a_form_block_never_parses_a_leftover_manifest(self) -> None:
        await _plugin().validate(_form_params(manifest=_NOT_JSON))

    async def test_the_enum_check_runs_before_the_manifest_check(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(
                _manifest_params(manifest=_NO_KIND_DOCUMENT, on_error="ignore")
            )

    async def test_the_manifest_check_runs_before_the_timeout_check(self) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(_manifest_params(manifest=_NO_KIND_DOCUMENT, timeout=0))


class TestManifestValidationAcrossTheEngine:
    """validate reads the canonical JSON the engine makes of whatever the block typed."""

    @staticmethod
    def _resolved(manifest: str) -> dict[str, Any]:
        from wavecore.core.execution.plugin_executor import (
            derive_parameter_metadata,
            resolve_parameters,
        )

        parameter_types, trim_fields, _references, wire_format_fields = derive_parameter_metadata(
            _plugin().metadata["parameters"]
        )
        return resolve_parameters(
            _manifest_params(manifest=manifest),
            set(),
            {},
            parameter_types,
            trim_fields=trim_fields,
            wire_format_fields=wire_format_fields,
        )

    async def test_a_manifest_of_only_a_separator_is_refused_as_declaring_no_kind(self) -> None:
        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            await _plugin().validate(self._resolved("---\n"))

    async def test_a_document_followed_by_a_trailing_separator_passes(self) -> None:
        await _plugin().validate(self._resolved(_YAML_NOT_JSON + "---\n"))


class TestCommandSplitting:
    """The Job form's Command is one typed line that becomes an argument list."""

    @staticmethod
    def _container(fake: FakeK8sClient) -> dict[str, Any]:
        body = fake.last.body or {}
        containers: list[dict[str, Any]] = body["spec"]["template"]["spec"]["containers"]
        return containers[0]

    async def test_a_quoted_argument_reaches_the_container_as_one_argument(self) -> None:
        fake = FakeK8sClient(responses=[(201, {})], resources=_JOBS)

        await _execute(fake, _job_params(command='sh -c "echo hi there"'))

        assert self._container(fake)["command"] == ["sh", "-c", "echo hi there"]

    async def test_an_escaped_space_stays_inside_its_argument(self) -> None:
        fake = FakeK8sClient(responses=[(201, {})], resources=_JOBS)

        await _execute(fake, _job_params(command="echo a\\ b"))

        assert self._container(fake)["command"] == ["echo", "a b"]

    async def test_an_empty_command_leaves_the_image_entrypoint_alone(self) -> None:
        fake = FakeK8sClient(responses=[(201, {})], resources=_JOBS)

        await _execute(fake, _job_params(command=""))

        assert "command" not in self._container(fake)

    async def test_a_whitespace_only_command_leaves_the_image_entrypoint_alone(self) -> None:
        fake = FakeK8sClient(responses=[(201, {})], resources=_JOBS)

        await _execute(fake, _job_params(command="   \t  "))

        assert "command" not in self._container(fake)

    @pytest.mark.parametrize("text", ['echo "unclosed', "echo 'unclosed"], ids=["double", "single"])
    async def test_an_unclosed_quote_is_refused_at_validate_time(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE_MESSAGE)):
            await _plugin().validate(_job_params(command=text))

    async def test_a_leftover_command_is_never_split_for_a_config_map(self) -> None:
        await _plugin().validate(_form_params(command='echo "unclosed'))

    async def test_a_leftover_command_is_never_split_for_a_job_from_a_cronjob(self) -> None:
        await _plugin().validate(
            _form_params(
                kind="Job",
                name="probe",
                job_from="cronjob",
                cronjob_name="nightly",
                command='echo "unclosed',
            )
        )

    async def test_a_leftover_command_is_never_split_in_manifest_mode(self) -> None:
        await _plugin().validate(_manifest_params(command='echo "unclosed'))


class TestManifestPathUpdate:
    """if_exists=update brings the object to match with a server-side apply patch."""

    async def test_the_object_is_applied_with_a_patch(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert fake.last.method == "PATCH"

    async def test_the_patch_carries_the_server_side_apply_media_type(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert fake.last.content_type == APPLY_PATCH_CONTENT_TYPE

    async def test_the_patch_names_wave_as_the_field_manager_and_forces_ownership(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert _split(fake.last.path) == (f"{_CONFIGMAP_COLLECTION}/probe-a", _APPLY_QUERY)

    async def test_the_patch_body_is_the_document_as_typed(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert fake.last.body == _document("probe-a")

    async def test_the_kind_is_discovered_from_the_document(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert fake.discoveries == ["ConfigMap"]

    async def test_a_one_document_manifest_still_comes_back_as_a_list(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert result["result"] == [_applied("probe-a")]
        assert isinstance(result["result"], list)

    async def test_names_and_count_describe_the_applied_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert result["names"] == ["probe-a"]
        assert result["count"] == 1

    async def test_the_session_namespace_is_used_when_no_namespace_is_specified(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert _split(fake.last.path)[0] == f"/api/v1/namespaces/{NAMESPACE}/configmaps/probe-a"

    async def test_a_specified_namespace_beats_the_session(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a", "ops"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"

    async def test_a_document_that_names_its_own_namespace_wins(self) -> None:
        text = json.dumps(
            {**_document("probe-a"), "metadata": {"name": "probe-a", "namespace": "own"}}
        )
        fake = FakeK8sClient(responses=[(200, _applied("probe-a", "own"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(manifest=text, namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/own/configmaps/probe-a"

    async def test_re_applying_the_same_document_sends_the_same_request(self) -> None:
        first = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        second = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(first, _manifest_params())
        await _execute(second, _manifest_params())

        assert first.last.path == second.last.path
        assert first.last.body == second.last.body
        assert first.last.content_type == second.last.content_type

    async def test_a_re_apply_is_a_success_that_returns_the_same_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert result["success"] is True
        assert result["result"] == [_applied("probe-a")]
        assert result["count"] == 1

    async def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.namespace == NAMESPACE
        assert timeout == 45

    async def test_the_client_timeout_defaults_to_30(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())
        _, timeout, _ = _construction(fake)

        assert timeout == 30

    async def test_impersonation_reaches_the_client(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(impersonate_user="dev", impersonate_groups="qa, ops"))
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] == "dev"
        assert extra["impersonate_groups"] == ["qa", "ops"]


class TestApiVersionRouting:
    """The document's own apiVersion resolves the write, the way kubectl apply does."""

    async def test_the_documents_api_version_reaches_the_lookup(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params())

        assert fake.lookups == [("ConfigMap", "v1")]

    async def test_a_non_preferred_version_is_written_at_the_version_the_document_names(
        self,
    ) -> None:
        text = _widget_text("example.com/v1beta1")
        applied = {
            "apiVersion": "example.com/v1beta1",
            "kind": "Widget",
            "metadata": {"name": "w1", "namespace": NAMESPACE},
        }
        fake = FakeK8sClient(responses=[(200, applied)], resources=_WIDGETS)

        await _execute(fake, _manifest_params(manifest=text))

        assert fake.lookups == [("Widget", "example.com/v1beta1")]
        assert _split(fake.last.path)[0] == "/apis/example.com/v1beta1/namespaces/apps/widgets/w1"

    async def test_each_document_resolves_with_the_version_it_names(self) -> None:
        text = json.dumps(
            [
                _document("probe-a"),
                {"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": "probe"}},
            ]
        )
        applied_job = {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {"name": "probe", "namespace": NAMESPACE},
        }
        fake = FakeK8sClient(
            responses=[(200, _applied("probe-a")), (201, applied_job)],
            resources={**_CONFIGMAPS, **_JOBS},
        )

        await _execute(fake, _manifest_params(manifest=text))

        assert fake.lookups == [("ConfigMap", "v1"), ("Job", "batch/v1")]

    async def test_the_form_resolves_the_version_it_synthesizes(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _form_params())

        assert fake.lookups == [("ConfigMap", "v1")]

    async def test_the_cronjob_template_read_names_no_version(self) -> None:
        applied_job = {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {"name": "probe", "namespace": NAMESPACE},
        }
        fake = FakeK8sClient(
            responses=[(200, _CRONJOB), (201, applied_job)], resources=_JOBS_AND_CRONJOBS
        )
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")

        await _execute(fake, params)

        assert fake.lookups == [("CronJob", None), ("Job", "batch/v1")]


class TestIfExistsFail:
    """if_exists=fail creates the object and surfaces the cluster's own already-exists row."""

    async def test_the_object_is_created_with_a_post_to_the_collection(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(if_exists="fail"))

        assert fake.last.method == "POST"
        assert _split(fake.last.path)[0] == _CONFIGMAP_COLLECTION

    async def test_the_create_asks_the_cluster_for_strict_field_validation(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(if_exists="fail"))

        assert _split(fake.last.path) == (_CONFIGMAP_COLLECTION, _CREATE_QUERY)

    async def test_an_unknown_field_is_rejected_rather_than_dropped(self) -> None:
        detail = (
            'ConfigMap in version "v1" cannot be handled as a ConfigMap: '
            'strict decoding error: unknown field "bogusTopLevel"'
        )
        fake = FakeK8sClient(
            responses=[(400, _failure("BadRequest", detail, 400))], resources=_CONFIGMAPS
        )
        message = f"Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(if_exists="fail"))

    async def test_the_post_carries_the_default_content_type(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(if_exists="fail"))

        assert fake.last.content_type is None

    async def test_the_post_body_is_the_document_as_typed(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(if_exists="fail"))

        assert fake.last.body == _document("probe-a")

    async def test_no_patch_is_ever_sent_in_fail_mode(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(if_exists="fail"))

        assert [entry.method for entry in _writes(fake)] == ["POST"]

    async def test_a_created_object_comes_back_in_result(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(if_exists="fail"))

        assert result["result"] == [_applied("probe-a")]
        assert result["success"] is True

    async def test_an_existing_object_surfaces_the_already_exists_row(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        fake = FakeK8sClient(responses=[(409, body)], resources=_CONFIGMAPS)
        message = "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(if_exists="fail"))

    async def test_the_already_exists_row_is_chosen_on_the_body_reason_not_the_status(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 500)
        fake = FakeK8sClient(responses=[(500, body)], resources=_CONFIGMAPS)
        message = "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(if_exists="fail"))

    async def test_an_existing_object_is_recordable_with_its_reason(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        fake = FakeK8sClient(responses=[(409, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(if_exists="fail", on_error="record"))

        assert result["success"] is False
        assert result["reason"] == "AlreadyExists"
        assert result["error"] == "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

    async def test_a_recorded_already_exists_leaves_the_unique_outputs_empty(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        fake = FakeK8sClient(responses=[(409, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(if_exists="fail", on_error="record"))

        assert result["result"] == []
        assert result["names"] == []
        assert result["count"] == 0
        assert result["summary"].row_count() == 0

    async def test_a_recorded_already_exists_names_the_apply_action(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        fake = FakeK8sClient(responses=[(409, body)], resources=_CONFIGMAPS)
        logger = MagicMock()

        await _execute(fake, _manifest_params(if_exists="fail", on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(
            "Apply failed (AlreadyExists): K8s ConfigMap 'probe-a' already exists "
            "in namespace 'apps'"
        )


class TestMultiDocumentManifest:
    """Several documents apply in order and never roll back (K8SWRITE-3)."""

    async def test_every_document_is_applied_in_the_order_it_was_typed(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert [_split(entry.path)[0] for entry in _writes(fake)] == [
            f"{_CONFIGMAP_COLLECTION}/probe-a",
            f"{_CONFIGMAP_COLLECTION}/probe-b",
        ]

    async def test_result_carries_one_entry_per_document(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert result["result"] == [_applied("probe-a"), _applied("probe-b")]

    async def test_names_and_count_describe_every_document(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert result["names"] == ["probe-a", "probe-b"]
        assert result["count"] == 2

    async def test_the_summary_carries_a_row_per_document(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (200, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert _summary_rows(result) == [
            ["configmap/probe-a", "created"],
            ["configmap/probe-b", "configured"],
        ]

    async def test_a_failure_at_the_second_document_fails_the_block_by_default(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (403, body)], resources=_CONFIGMAPS
        )
        message = "Kubernetes API permission denied: configmaps is forbidden"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(manifest=_MANIFEST_THREE))

    async def test_a_failure_at_the_second_document_stops_before_the_third(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (403, body)], resources=_CONFIGMAPS
        )

        with pytest.raises(ValueError):
            await _execute(fake, _manifest_params(manifest=_MANIFEST_THREE))

        assert [_split(entry.path)[0] for entry in _writes(fake)] == [
            f"{_CONFIGMAP_COLLECTION}/probe-a",
            f"{_CONFIGMAP_COLLECTION}/probe-b",
        ]

    async def test_a_failure_at_the_second_document_never_undoes_the_first(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (403, body)], resources=_CONFIGMAPS
        )

        with pytest.raises(ValueError):
            await _execute(fake, _manifest_params(manifest=_MANIFEST_THREE))

        assert [entry.method for entry in fake.calls if entry.method == "DELETE"] == []

    async def test_a_recorded_failure_reports_how_many_documents_landed(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (403, body)], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_THREE, on_error="record"))

        assert result["count"] == 1
        assert result["names"] == ["probe-a"]
        assert result["result"] == [_applied("probe-a")]

    async def test_a_recorded_failure_summarizes_only_what_landed(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (403, body)], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_THREE, on_error="record"))

        assert _summary_rows(result) == [["configmap/probe-a", "created"]]
        assert result["success"] is False
        assert result["reason"] == "Forbidden"

    async def test_a_failure_at_the_first_document_leaves_the_unique_outputs_empty(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO, on_error="record"))

        assert result["result"] == []
        assert result["names"] == []
        assert result["count"] == 0
        assert result["summary"].row_count() == 0


class TestFormPathConfigMap:
    """The ConfigMap form builds the object a manifest would have described."""

    async def test_the_form_sends_what_the_manifest_path_sends(self) -> None:
        form = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        typed = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(form, _form_params())
        await _execute(typed, _manifest_params())

        assert form.last.body == typed.last.body
        assert form.last.path == typed.last.path
        assert form.last.content_type == typed.last.content_type

    async def test_the_form_result_is_the_applied_object_itself(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params())

        assert result["result"] == _applied("probe-a")
        assert isinstance(result["result"], dict)

    async def test_names_and_count_describe_the_one_object(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params())

        assert result["names"] == ["probe-a"]
        assert result["count"] == 1

    async def test_an_empty_data_map_still_applies_the_object(self) -> None:
        applied = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": "probe-a", "namespace": NAMESPACE},
        }
        fake = FakeK8sClient(responses=[(201, applied)], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(data={}))

        assert result["success"] is True
        assert (fake.last.body or {}).get("data", {}) == {}
        assert result["count"] == 1

    async def test_the_secret_data_row_never_reaches_a_config_map(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _form_params(secret_data={"password": "s3cr3t"}))

        assert (fake.last.body or {})["data"] == {"count": "3"}
        assert "s3cr3t" not in json.dumps(fake.last.body)

    async def test_the_form_targets_a_specified_namespace(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a", "ops"))], resources=_CONFIGMAPS)

        await _execute(fake, _form_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"


class TestFormPathSecret:
    """The Secret form writes plaintext the cluster encodes; WAVE never base64s."""

    @staticmethod
    def _applied_secret() -> dict[str, Any]:
        return {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db", "namespace": NAMESPACE},
            "type": "Opaque",
        }

    async def test_the_values_are_written_to_string_data(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(fake, _secret_params())

        assert (fake.last.body or {})["stringData"] == {"password": "s3cr3t"}

    async def test_the_config_map_data_row_never_reaches_a_secret(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(fake, _secret_params(data={"count": "3"}))

        assert (fake.last.body or {})["stringData"] == {"password": "s3cr3t"}
        assert "count" not in json.dumps(fake.last.body)

    async def test_the_secret_never_carries_a_base64_data_field(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(fake, _secret_params())

        assert "data" not in (fake.last.body or {})

    async def test_no_value_is_encoded_on_the_way_out(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(fake, _secret_params())

        assert json.dumps(fake.last.body).count("czNjcjN0") == 0

    @pytest.mark.parametrize(
        "secret_type", ["Opaque", "kubernetes.io/tls", "kubernetes.io/dockerconfigjson"]
    )
    async def test_the_secret_type_reaches_the_wire(self, secret_type: str) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(fake, _secret_params(secret_type=secret_type, secret_data={}))

        assert (fake.last.body or {})["type"] == secret_type

    async def test_an_empty_secret_data_map_is_accepted_on_an_opaque_secret(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        result = await _execute(fake, _secret_params(secret_data={}))

        assert result["success"] is True
        assert result["count"] == 1
        assert (fake.last.body or {})["stringData"] == {}

    async def test_a_secret_with_no_secret_data_row_at_all_writes_an_empty_map(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)
        params = _form_params(kind="Secret", name="db")

        result = await _execute(fake, params)

        assert result["success"] is True
        assert (fake.last.body or {})["stringData"] == {}

    async def test_a_tls_secret_with_no_keys_still_reaches_the_cluster(self) -> None:
        detail = 'Secret "db" is invalid: data[tls.crt]: Required value'
        fake = FakeK8sClient(
            responses=[(422, _failure("Invalid", detail, 422))], resources=_SECRETS
        )
        params = _secret_params(secret_type="kubernetes.io/tls", secret_data={})

        with pytest.raises(ValueError):
            await _execute(fake, params)

        assert len(_writes(fake)) == 1

    async def test_the_apiserver_error_is_what_a_typed_secret_surfaces(self) -> None:
        detail = 'Secret "db" is invalid: data[tls.crt]: Required value'
        fake = FakeK8sClient(
            responses=[(422, _failure("Invalid", detail, 422))], resources=_SECRETS
        )
        params = _secret_params(secret_type="kubernetes.io/tls", secret_data={})
        message = f"Kubernetes could not apply Secret 'db' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    async def test_a_dockerconfigjson_secret_is_not_pre_validated_either(self) -> None:
        detail = 'Secret "db" is invalid: data[.dockerconfigjson]: Required value'
        fake = FakeK8sClient(
            responses=[(422, _failure("Invalid", detail, 422))], resources=_SECRETS
        )
        params = _secret_params(secret_type="kubernetes.io/dockerconfigjson", secret_data={})
        message = f"Kubernetes could not apply Secret 'db' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)


class TestFormPathJob:
    """The Job form runs an image, or runs what a CronJob would have run."""

    @staticmethod
    def _applied_job() -> dict[str, Any]:
        return {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {"name": "probe", "namespace": NAMESPACE},
            "spec": _CRONJOB_TEMPLATE_SPEC,
        }

    async def test_a_job_from_an_image_runs_that_image(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_job())], resources=_JOBS)

        await _execute(fake, _job_params())

        body = fake.last.body or {}
        assert body["apiVersion"] == "batch/v1"
        assert body["kind"] == "Job"
        assert body["spec"]["template"]["spec"]["containers"][0]["image"] == "busybox:1.36"

    async def test_a_job_rides_the_batch_api_path(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_job())], resources=_JOBS)

        await _execute(fake, _job_params())

        assert _split(fake.last.path) == (f"{_JOB_COLLECTION}/probe", _APPLY_QUERY)

    async def test_a_job_from_a_cronjob_reads_the_named_cronjob_first(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _CRONJOB), (201, self._applied_job())],
            resources=_JOBS_AND_CRONJOBS,
        )
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")

        await _execute(fake, params)

        assert fake.calls[0].method == "GET"
        assert _split(fake.calls[0].path)[0] == "/apis/batch/v1/namespaces/apps/cronjobs/nightly"

    async def test_a_job_from_a_cronjob_copies_the_job_template(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _CRONJOB), (201, self._applied_job())],
            resources=_JOBS_AND_CRONJOBS,
        )
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")

        await _execute(fake, params)

        assert (fake.last.body or {})["spec"] == _CRONJOB_TEMPLATE_SPEC

    async def test_a_job_from_a_cronjob_carries_the_form_name(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _CRONJOB), (201, self._applied_job())],
            resources=_JOBS_AND_CRONJOBS,
        )
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")

        await _execute(fake, params)

        body = fake.last.body or {}
        assert body["kind"] == "Job"
        assert body["metadata"]["name"] == "probe"
        assert _split(fake.last.path)[0] == f"{_JOB_COLLECTION}/probe"

    async def test_a_job_from_a_cronjob_never_carries_a_leftover_image(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _CRONJOB), (201, self._applied_job())],
            resources=_JOBS_AND_CRONJOBS,
        )
        params = _form_params(
            kind="Job",
            name="probe",
            job_from="cronjob",
            cronjob_name="nightly",
            image="leftover:1",
        )

        await _execute(fake, params)

        assert "leftover:1" not in json.dumps(fake.last.body)

    async def test_a_missing_cronjob_surfaces_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'cronjobs.batch "nightly" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_JOBS_AND_CRONJOBS)
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")
        message = "K8s CronJob 'nightly' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    async def test_a_missing_cronjob_writes_nothing(self) -> None:
        body = _failure("NotFound", 'cronjobs.batch "nightly" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_JOBS_AND_CRONJOBS)
        params = _form_params(kind="Job", name="probe", job_from="cronjob", cronjob_name="nightly")

        with pytest.raises(ValueError):
            await _execute(fake, params)

        assert _writes(fake) == []


class TestSummary:
    """Summary reports what the block did, whatever Output Format says (K8SWRITE-2)."""

    async def test_the_summary_is_a_wave_table(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert isinstance(result["summary"], Table)

    async def test_the_summary_declares_exactly_two_columns(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert result["summary"].col_names() == ["RESOURCE", "OUTCOME"]

    async def test_a_new_object_reads_created(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert _summary_rows(result) == [["configmap/probe-a", "created"]]

    async def test_an_existing_object_reads_configured(self) -> None:
        fake = FakeK8sClient(responses=[(200, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert _summary_rows(result) == [["configmap/probe-a", "configured"]]

    @pytest.mark.parametrize("status", [200, 201])
    async def test_the_outcome_is_never_unchanged(self, status: int) -> None:
        fake = FakeK8sClient(responses=[(status, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert _summary_rows(result)[0][1] in ("created", "configured")

    async def test_a_core_group_resource_carries_no_group(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params())

        assert _summary_rows(result)[0][0] == "configmap/probe-a"

    async def test_a_grouped_resource_carries_its_group(self) -> None:
        applied = {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {"name": "probe", "namespace": NAMESPACE},
        }
        fake = FakeK8sClient(responses=[(201, applied)], resources=_JOBS)

        result = await _execute(fake, _job_params())

        assert _summary_rows(result)[0][0] == "job.batch/probe"

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    async def test_the_summary_is_a_table_under_every_output_format(
        self, output_format: str
    ) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(output_format=output_format))

        assert isinstance(result["summary"], Table)
        assert result["summary"].col_names() == ["RESOURCE", "OUTCOME"]


class TestOutputFormats:
    """Output Format shapes Result and nothing else."""

    async def test_map_in_form_mode_is_the_applied_object(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(output_format="map"))

        assert result["result"] == _applied("probe-a")

    async def test_map_in_manifest_mode_is_a_list(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert result["result"] == [_applied("probe-a"), _applied("probe-b")]

    async def test_json_in_form_mode_is_the_object_as_text(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(output_format="json"))

        assert isinstance(result["result"], str)
        assert json.loads(result["result"]) == _applied("probe-a")

    async def test_json_in_manifest_mode_is_the_list_as_text(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(
            fake, _manifest_params(manifest=_MANIFEST_TWO, output_format="json")
        )

        assert json.loads(result["result"]) == [_applied("probe-a"), _applied("probe-b")]

    async def test_yaml_in_form_mode_is_the_object_with_its_keys_alphabetical(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(output_format="yaml"))

        assert result["result"] == _APPLIED_ONE_YAML

    async def test_yaml_in_manifest_mode_is_a_sequence_with_its_keys_alphabetical(self) -> None:
        fake = FakeK8sClient(
            responses=[(201, _applied("probe-a")), (201, _applied("probe-b"))],
            resources=_CONFIGMAPS,
        )

        result = await _execute(
            fake, _manifest_params(manifest=_MANIFEST_TWO, output_format="yaml")
        )

        assert result["result"] == _APPLIED_TWO_YAML

    async def test_yaml_for_an_object_the_cluster_returns_empty_is_empty_text(self) -> None:
        fake = FakeK8sClient(responses=[(200, {})], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(output_format="yaml"))

        assert result["result"] == ""

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    async def test_the_output_format_never_changes_what_goes_on_the_wire(
        self, output_format: str
    ) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _manifest_params(output_format=output_format))

        assert fake.last.method == "PATCH"
        assert fake.last.content_type == APPLY_PATCH_CONTENT_TYPE
        assert fake.last.body == _document("probe-a")

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    async def test_names_and_count_read_the_same_in_every_format(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(output_format=output_format))

        assert result["names"] == ["probe-a"]
        assert result["count"] == 1


class TestSecretMasking:
    """Every value written to a Secret registers with the run secret registry (REQ-4.5.6)."""

    @staticmethod
    def _applied_secret() -> dict[str, Any]:
        return {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db", "namespace": NAMESPACE},
            "type": "Opaque",
        }

    async def test_every_form_value_is_registered(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)
        params = _secret_params(secret_data={"password": "s3cr3t", "user": "admin"})

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert "s3cr3t" in registered
        assert "admin" in registered

    async def test_a_config_map_data_row_left_filled_registers_nothing(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)
        params = _secret_params(data={"count": "3"})

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert "s3cr3t" in registered
        assert "3" not in registered

    async def test_a_manifest_secret_registers_its_string_data(self) -> None:
        registered: list[Any] = []
        text = json.dumps(_secret_object("db", stringData={"password": "s3cr3t"}))
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(
            fake,
            _manifest_params(manifest=text),
            lambda value, revealed=False: registered.append(value),
        )

        assert "s3cr3t" in registered

    async def test_a_manifest_secret_registers_encoded_data_in_both_forms(self) -> None:
        registered: list[Any] = []
        text = json.dumps(_secret_object("db", data={"password": "czNjcjN0"}))
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        await _execute(
            fake,
            _manifest_params(manifest=text),
            lambda value, revealed=False: registered.append(value),
        )

        assert "czNjcjN0" in registered
        assert "s3cr3t" in registered

    @staticmethod
    def _returned_secret(encoded: str = "czNjcjN0") -> dict[str, Any]:
        """The Secret the cluster answers with: the value base64-encoded into 'data'."""
        return {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db", "namespace": NAMESPACE},
            "type": "Opaque",
            "data": {"password": encoded},
        }

    async def test_the_value_the_cluster_encodes_back_registers_in_both_forms(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(201, self._returned_secret())], resources=_SECRETS)
        params = _secret_params()

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert "czNjcjN0" in registered
        assert "s3cr3t" in registered

    async def test_a_returned_value_the_form_never_typed_still_registers(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(
            responses=[(201, self._returned_secret("cm90YXRlZA=="))], resources=_SECRETS
        )
        params = _secret_params()

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert "cm90YXRlZA==" in registered
        assert "rotated" in registered

    async def test_every_document_in_a_manifest_registers_what_it_gets_back(self) -> None:
        registered: list[Any] = []
        text = json.dumps(
            [
                _secret_object("db", stringData={"password": "first"}),
                _secret_object("api", stringData={"password": "second"}),
            ]
        )
        fake = FakeK8sClient(
            responses=[
                (201, self._returned_secret("Zmlyc3Q=")),
                (201, self._returned_secret("c2Vjb25k")),
            ],
            resources=_SECRETS,
        )

        await _execute(
            fake,
            _manifest_params(manifest=text),
            lambda value, revealed=False: registered.append(value),
        )

        assert {"Zmlyc3Q=", "first", "c2Vjb25k", "second"} <= set(registered)

    async def test_a_config_map_value_is_never_registered(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        await _execute(fake, _form_params(), lambda value, revealed=False: registered.append(value))

        assert registered == []

    async def test_a_run_without_a_registry_still_applies_the_secret(self) -> None:
        fake = FakeK8sClient(responses=[(201, self._applied_secret())], resources=_SECRETS)

        result = await _execute(fake, _secret_params())

        assert result["success"] is True


class TestClusterWarnings:
    """A Warning header the cluster sends back is surfaced, not dropped."""

    async def test_a_cluster_warning_is_logged(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        fake.last_warnings = ['unknown field "spec.foo"']
        logger = MagicMock()

        await _execute(fake, _manifest_params(), logger=logger)

        logger.warn.assert_called_once_with('Cluster warning: unknown field "spec.foo"')

    async def test_several_warnings_are_logged_in_the_order_received(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        fake.last_warnings = ["first", "second"]
        logger = MagicMock()

        await _execute(fake, _manifest_params(), logger=logger)

        assert logger.warn.call_args_list == [
            call("Cluster warning: first"),
            call("Cluster warning: second"),
        ]

    async def test_a_write_with_no_warnings_logs_none(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        logger = MagicMock()

        await _execute(fake, _manifest_params(), logger=logger)

        assert logger.warn.call_count == 0

    async def test_a_warning_does_not_fail_the_block(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        fake.last_warnings = ['unknown field "spec.foo"']

        result = await _execute(fake, _manifest_params())

        assert result["success"] is True
        assert "__block_warning" not in result


class TestApiErrors:
    """The shared error rows, rendered for the apply verb and the Apply action."""

    async def test_a_server_error_names_the_apply_verb(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = FakeK8sClient(
            responses=[(503, _failure("ServiceUnavailable", detail, 503))], resources=_CONFIGMAPS
        )
        message = f"Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_a_server_error_without_a_cluster_message_names_the_status(self) -> None:
        fake = FakeK8sClient(responses=[(502, {})], resources=_CONFIGMAPS)
        message = "Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps' (HTTP 502)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_401_renders_the_authentication_row(self) -> None:
        fake = FakeK8sClient(
            responses=[(401, _failure("Unauthorized", "Unauthorized", 401))],
            resources=_CONFIGMAPS,
        )
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_403_renders_the_permission_row(self) -> None:
        detail = 'configmaps is forbidden: user cannot patch resource "configmaps"'
        fake = FakeK8sClient(
            responses=[(403, _failure("Forbidden", detail, 403))], resources=_CONFIGMAPS
        )
        message = f"Kubernetes API permission denied: {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_the_recorded_warn_line_names_the_apply_action(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = FakeK8sClient(
            responses=[(503, _failure("ServiceUnavailable", detail, 503))], resources=_CONFIGMAPS
        )
        logger = MagicMock()

        await _execute(fake, _manifest_params(on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(
            "Apply failed (ServiceUnavailable): Kubernetes could not apply ConfigMap 'probe-a' "
            f"in namespace 'apps': {detail}"
        )

    async def test_a_missing_namespace_names_the_namespace_not_the_object(self) -> None:
        body = _failure("NotFound", 'namespaces "ghost" not found', 404)
        body["details"] = {"kind": "namespaces", "name": "ghost"}
        fake = FakeK8sClient(responses=[(404, body)], resources=_CONFIGMAPS)
        message = "K8s namespace 'ghost' not found"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(namespace="ghost"))

    async def test_a_malformed_manifest_answered_as_a_500_reads_as_a_rejection(self) -> None:
        detail = ".data.count: expected string, got &value.valueUnstructured{Value:3}"
        cluster_text = (
            "failed to create typed patch object " f"(apps/probe-a; /v1, Kind=ConfigMap): {detail}"
        )
        fake = FakeK8sClient(
            responses=[(500, {"kind": "Status", "message": cluster_text, "code": 500})],
            resources=_CONFIGMAPS,
        )
        message = f"Kubernetes rejected the manifest: {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_a_discovery_miss_names_the_kind_and_its_api_version(self) -> None:
        text = _widget_text("example.com/v1")
        fake = FakeK8sClient(resources={})
        message = (
            "This cluster has no resource kind 'Widget' in API version 'example.com/v1' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(manifest=text))

    async def test_a_discovery_miss_issues_no_write_request(self) -> None:
        text = _widget_text("example.com/v1")
        fake = FakeK8sClient(resources={})

        with pytest.raises(ValueError):
            await _execute(fake, _manifest_params(manifest=text))

        assert _writes(fake) == []

    async def test_a_recorded_failure_carries_the_warning_signal(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = FakeK8sClient(
            responses=[(503, _failure("ServiceUnavailable", detail, 503))], resources=_CONFIGMAPS
        )

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert result["__block_warning"] is True


class TestErrorReasonGate:
    """Under Fail the block a refusal unwinds past the bindings, so nothing is written."""

    async def test_a_cluster_refusal_raises_under_the_default_mode(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        message = "Kubernetes API permission denied: configmaps is forbidden"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params())

    async def test_no_error_or_reason_value_is_bound_when_the_block_raises(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        outputs: dict[str, Any] | None = None

        with pytest.raises(ValueError):
            outputs = await _execute(fake, _manifest_params())

        assert outputs is None

    async def test_record_mode_returns_normally_with_all_three_values(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == "Kubernetes API permission denied: configmaps is forbidden"
        assert result["reason"] == "Forbidden"

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(fake, _manifest_params(), logger=logger)

        assert logger.warn.call_count == 0


class TestOutputCore:
    """The output core and the fail-or-record dispatch on every path."""

    async def test_a_happy_apply_carries_the_full_core(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_happy_apply_returns_exactly_the_declared_outputs(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params())

        assert set(result) == {"summary", "result", "names", "count", "success", "error", "reason"}

    async def test_record_mode_returns_the_declared_outputs_and_the_warning_signal(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert set(result) == {
            "summary",
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    async def test_record_mode_leaves_an_empty_list_in_manifest_mode(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert result["result"] == []
        assert result["names"] == []
        assert result["count"] == 0

    async def test_record_mode_leaves_an_empty_map_in_form_mode(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _form_params(on_error="record"))

        assert result["result"] == {}

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_record_mode_returns_empty_text_under_the_text_formats(
        self, output_format: str
    ) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(
            fake, _manifest_params(on_error="record", output_format=output_format)
        )

        assert result["result"] == ""

    async def test_the_recorded_summary_still_declares_its_columns(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert isinstance(result["summary"], Table)
        assert result["summary"].col_names() == ["RESOURCE", "OUTCOME"]
        assert result["summary"].row_count() == 0

    async def test_record_mode_keeps_a_happy_apply_green(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)

        result = await _execute(fake, _manifest_params(on_error="record"))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""
        assert "__block_warning" not in result


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_bogus_session_raises(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _manifest_params(session="not-a-kubeconfig", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_transport_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: "
            "[Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_CONFIGMAPS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _manifest_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_invalid_params_raise_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_manifest_params(timeout=0, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_required_param_raises_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: manifest$"):
            await _plugin().validate(block_params(define_with="manifest", on_error=on_error))


class TestNamespaceDescription:
    """A write block's Namespace row says what it writes to, not what it reads from."""

    def test_the_namespace_row_does_not_say_read_from(self) -> None:
        description = _params_by_name()["namespace"]["description"]

        assert "read from" not in description

    def test_the_namespace_row_still_names_the_session_default(self) -> None:
        description = _params_by_name()["namespace"]["description"]

        assert "session default" in description


class TestFormNullEntries:
    """The form's ConfigMap and Secret values are text: a null value fails naming its key
    before anything reaches the cluster (REQ-3.1.3.21)."""

    @staticmethod
    async def _run_block(fake: FakeK8sClient, params: dict[str, Any]) -> Any:
        """One K8s Apply in the engine's order: validate, then execute."""
        await _plugin().validate(params)
        return await _execute(fake, params)

    async def test_a_null_config_map_value_fails_naming_its_key(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_CONFIGMAPS)
        params = _form_params(data={"count": "3", "k": None})

        with pytest.raises(NullValueError, match=exact("'k' in 'data' is null")):
            await self._run_block(fake, params)

        assert _writes(fake) == []

    async def test_a_null_secret_value_fails_naming_its_key(self) -> None:
        fake = FakeK8sClient(responses=[(201, _applied("probe-a"))], resources=_SECRETS)
        params = _secret_params(secret_data={"password": "s3cr3t", "k": None})

        with pytest.raises(NullValueError, match=exact("'k' in 'secret_data' is null")):
            await self._run_block(fake, params)

        assert _writes(fake) == []
