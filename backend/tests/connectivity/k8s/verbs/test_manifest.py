"""K8s manifest helper tests (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

The manifest helpers ride into the remote bundle with the write verbs, so they
read the canonical JSON the engine sends, vet every document before anything
reaches the cluster, build the one object the Apply form describes, split a
typed command line into arguments, and list every Secret value a manifest
carries so the run can mask it.
"""

import ast
import importlib
import inspect
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import exact

_MODULE_NAME = "wavecore.connectivity.k8s.verbs._manifest"

_PARSE_PREFIX = "Parameter 'manifest' is not valid YAML or JSON: "
_NO_VALUE_DETAIL = "Expecting value: line 1 column 1 (char 0)"
_NO_DELIMITER_DETAIL = "Expecting ',' delimiter: line 1 column 20 (char 19)"
_KIND_MESSAGE = "Parameter 'manifest' must include 'apiVersion' and 'kind'"
_NAME_MESSAGE = "Parameter 'manifest' must include 'metadata.name'"
_UNCLOSED_COMMAND_MESSAGE = "Parameter 'command' has an unclosed quote"
_UNCLOSED_INTERPRETER_MESSAGE = "Parameter 'interpreter' has an unclosed quote"

_YAML_TEXT = "apiVersion: v1\nkind: ConfigMap\n"
_TRUNCATED_JSON = '{"apiVersion": "v1"'

_CONFIG_MAP = {
    "apiVersion": "v1",
    "kind": "ConfigMap",
    "metadata": {"name": "probe-a"},
    "data": {"count": "3"},
}
_SECRET_DOCUMENT = {
    "apiVersion": "v1",
    "kind": "Secret",
    "metadata": {"name": "probe-b"},
}

_PASSWORD = "s3cr3t"
_PASSWORD_B64 = "czNjcjN0"
_USER = "admin"
_USER_B64 = "YWRtaW4="
_TOKEN = "rotated"
_TOKEN_B64 = "cm90YXRlZA=="
_NOT_BASE64 = "!!!not-b64"
_NOT_TEXT_B64 = "//4="


def _module() -> ModuleType:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    return importlib.import_module(_MODULE_NAME)


def parse_manifest(text: str) -> list[dict[str, Any]]:
    """The documents a canonical JSON manifest declares, in the order they were typed."""
    return _module().parse_manifest(text)


def _filled(document: dict[str, Any], *keys: str) -> Any:
    """Whether every named key of one document holds text."""
    return _module()._filled(document, *keys)


def synthesize_manifest(params: dict[str, Any]) -> dict[str, Any]:
    """The one object the Apply form describes."""
    return _module().synthesize_manifest(params)


def split_command(text: str, *, name: str = "command") -> list[str]:
    """The argument list one typed command line describes."""
    return _module().split_command(text, name=name)


def secret_values(documents: list[dict[str, Any]]) -> list[Any]:
    """Every Secret value the documents carry, plaintext and encoded."""
    return _module().secret_values(documents)


def _text(*documents: Any) -> str:
    """The canonical JSON the engine hands the core: one object, or an array of them."""
    return json.dumps(documents[0] if len(documents) == 1 else list(documents))


def _named(metadata: Any) -> dict[str, Any]:
    """A document whose apiVersion and kind pass, carrying the metadata the test names."""
    return {"apiVersion": "v1", "kind": "ConfigMap", "metadata": metadata}


def _form_params(**overrides: Any) -> dict[str, Any]:
    """The Apply form as the engine fills it in, plus the test's own answers."""
    params: dict[str, Any] = {"define_with": "form", "kind": "ConfigMap", "name": "probe-a"}
    params.update(overrides)
    return params


def _job_params(**overrides: Any) -> dict[str, Any]:
    """The Apply form filled in for a Job built from an image."""
    return _form_params(
        kind="Job", name="probe", job_from="image", image="busybox:1.36", **overrides
    )


def _first_container(job: dict[str, Any]) -> dict[str, Any]:
    containers: list[dict[str, Any]] = job["spec"]["template"]["spec"]["containers"]
    return containers[0]


def _secret(**fields: Any) -> dict[str, Any]:
    """One Secret document carrying whichever data maps the test names."""
    return {"apiVersion": "v1", "kind": "Secret", "metadata": {"name": "db"}, **fields}


def _import_roots() -> set[str]:
    """The root package of every import the module's own source carries."""
    source = Path(str(_module().__file__)).read_text(encoding="utf-8")
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            roots.add(node.module.split(".")[0])
    return roots


class TestParseManifest:
    """The engine sends canonical JSON, so the core reads JSON and nothing else."""

    def test_a_json_object_is_one_document(self) -> None:
        assert parse_manifest(_text(_CONFIG_MAP)) == [_CONFIG_MAP]

    def test_a_json_array_keeps_the_order_the_documents_were_typed_in(self) -> None:
        documents = parse_manifest(_text(_CONFIG_MAP, _SECRET_DOCUMENT))

        assert [document["metadata"]["name"] for document in documents] == ["probe-a", "probe-b"]

    def test_a_json_array_carries_every_key_of_every_document(self) -> None:
        assert parse_manifest(_text(_CONFIG_MAP, _SECRET_DOCUMENT)) == [
            _CONFIG_MAP,
            _SECRET_DOCUMENT,
        ]

    def test_yaml_text_is_not_a_manifest(self) -> None:
        with pytest.raises(ValueError, match=exact(_PARSE_PREFIX + _NO_VALUE_DETAIL)):
            parse_manifest(_YAML_TEXT)

    def test_empty_text_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_PARSE_PREFIX + _NO_VALUE_DETAIL)):
            parse_manifest("")

    def test_an_unparsable_document_names_the_parser_detail(self) -> None:
        with pytest.raises(ValueError, match=exact(_PARSE_PREFIX + _NO_DELIMITER_DETAIL)):
            parse_manifest(_TRUNCATED_JSON)

    def test_every_document_is_vetted_not_only_the_first(self) -> None:
        with pytest.raises(ValueError, match=exact(_KIND_MESSAGE)):
            parse_manifest(_text(_CONFIG_MAP, {"apiVersion": "v1"}))

    def test_a_name_with_spaces_around_it_is_kept_verbatim(self) -> None:
        documents = parse_manifest(_text(_named({"name": " probe-a "})))

        assert documents[0]["metadata"]["name"] == " probe-a "

    def test_an_empty_json_array_declares_no_object_and_is_refused(self) -> None:
        """The engine sends '[]' for a stream of only '---', and kubectl refuses that file too."""
        with pytest.raises(ValueError, match=exact(_KIND_MESSAGE)):
            parse_manifest("[]")


class TestManifestVetting:
    """Every document names its kind and its object before anything reaches the cluster."""

    @pytest.mark.parametrize(
        "document",
        [
            pytest.param({"kind": "ConfigMap", "metadata": {"name": "probe-a"}}, id="no api"),
            pytest.param({"apiVersion": "v1", "metadata": {"name": "probe-a"}}, id="no kind"),
            pytest.param(_named({"name": "probe-a"}) | {"apiVersion": ""}, id="blank api"),
            pytest.param(_named({"name": "probe-a"}) | {"apiVersion": "   "}, id="spaced api"),
            pytest.param(_named({"name": "probe-a"}) | {"apiVersion": None}, id="null api"),
            pytest.param(_named({"name": "probe-a"}) | {"apiVersion": 1}, id="numeric api"),
            pytest.param(_named({"name": "probe-a"}) | {"kind": ""}, id="blank kind"),
            pytest.param(_named({"name": "probe-a"}) | {"kind": "   "}, id="spaced kind"),
            pytest.param(_named({"name": "probe-a"}) | {"kind": None}, id="null kind"),
            pytest.param(_named({"name": "probe-a"}) | {"kind": 7}, id="numeric kind"),
        ],
    )
    def test_a_document_with_no_api_version_or_kind_is_refused(self, document: Any) -> None:
        with pytest.raises(ValueError, match=exact(_KIND_MESSAGE)):
            parse_manifest(_text(document))

    @pytest.mark.parametrize(
        "text",
        ["7", '"probe-a"', "null", "true"],
        ids=["number", "string", "null", "boolean"],
    )
    def test_a_document_that_is_not_an_object_is_refused(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(_KIND_MESSAGE)):
            parse_manifest(text)

    def test_the_api_version_check_runs_before_the_name_check(self) -> None:
        with pytest.raises(ValueError, match=exact(_KIND_MESSAGE)):
            parse_manifest(_text({"metadata": {}}))

    @pytest.mark.parametrize(
        "metadata",
        [
            pytest.param({}, id="no name"),
            pytest.param({"name": ""}, id="blank name"),
            pytest.param({"name": "   "}, id="spaced name"),
            pytest.param({"name": None}, id="null name"),
            pytest.param({"name": 7}, id="numeric name"),
            pytest.param("bogus", id="metadata is text"),
            pytest.param([1, 2], id="metadata is a list"),
        ],
    )
    def test_a_document_with_no_metadata_name_is_refused(self, metadata: Any) -> None:
        with pytest.raises(ValueError, match=exact(_NAME_MESSAGE)):
            parse_manifest(_text(_named(metadata)))

    def test_a_document_with_no_metadata_at_all_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_NAME_MESSAGE)):
            parse_manifest(_text({"apiVersion": "v1", "kind": "ConfigMap"}))


class TestFilled:
    """A manifest key counts as given only when it holds text."""

    def test_a_key_that_holds_text_passes(self) -> None:
        assert _filled({"apiVersion": "v1", "kind": "ConfigMap"}, "apiVersion", "kind")

    def test_a_missing_key_does_not_pass(self) -> None:
        assert not _filled({"apiVersion": "v1"}, "apiVersion", "kind")

    @pytest.mark.parametrize(
        "value",
        ["", "   ", None, 7, ["ConfigMap"]],
        ids=["blank", "spaced", "null", "number", "list"],
    )
    def test_a_key_that_holds_no_text_does_not_pass(self, value: Any) -> None:
        assert not _filled({"kind": value}, "kind")


class TestSynthesizeManifest:
    """The Apply form describes exactly one object; this is the object it describes."""

    def test_a_config_map_carries_its_data_verbatim(self) -> None:
        obj = synthesize_manifest(_form_params(data={"count": "3"}))

        assert obj == {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": "probe-a"},
            "data": {"count": "3"},
        }

    @pytest.mark.parametrize(
        "overrides",
        [{}, {"data": None}, {"data": {}}],
        ids=["absent", "null", "empty"],
    )
    def test_a_config_map_with_no_data_is_still_an_object(self, overrides: Any) -> None:
        obj = synthesize_manifest(_form_params(**overrides))

        assert obj["kind"] == "ConfigMap"
        assert obj["metadata"]["name"] == "probe-a"
        assert obj["data"] == {}

    def test_a_form_with_no_kind_describes_a_config_map(self) -> None:
        assert synthesize_manifest({}) == {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": ""},
            "data": {},
        }

    def test_the_data_map_is_copied_not_aliased(self) -> None:
        data = {"count": "3"}

        obj = synthesize_manifest(_form_params(data=data))
        data["count"] = "9"

        assert obj["data"] == {"count": "3"}

    def test_a_name_that_is_not_text_is_written_as_text(self) -> None:
        assert synthesize_manifest(_form_params(name=None))["metadata"]["name"] == "None"

    def test_a_secret_writes_plaintext_to_string_data(self) -> None:
        params = _form_params(kind="Secret", name="db", data={"password": _PASSWORD})

        obj = synthesize_manifest(params)

        assert obj["apiVersion"] == "v1"
        assert obj["kind"] == "Secret"
        assert obj["metadata"]["name"] == "db"
        assert obj["stringData"] == {"password": _PASSWORD}

    def test_a_secret_never_writes_the_base64_data_field(self) -> None:
        params = _form_params(kind="Secret", name="db", data={"password": _PASSWORD})

        assert "data" not in synthesize_manifest(params)

    @pytest.mark.parametrize(
        "secret_type", ["Opaque", "kubernetes.io/tls", "kubernetes.io/dockerconfigjson"]
    )
    def test_a_secret_carries_the_type_it_was_given(self, secret_type: str) -> None:
        params = _form_params(kind="Secret", name="db", secret_type=secret_type, data={})

        assert synthesize_manifest(params)["type"] == secret_type

    @pytest.mark.parametrize(
        "overrides",
        [{}, {"secret_type": ""}, {"secret_type": None}],
        ids=["absent", "blank", "null"],
    )
    def test_a_secret_with_no_type_carries_no_type_key(self, overrides: Any) -> None:
        params = _form_params(kind="Secret", name="db", data={}, **overrides)

        assert "type" not in synthesize_manifest(params)

    def test_a_job_from_an_image_runs_that_image(self) -> None:
        obj = synthesize_manifest(_job_params())

        assert obj["apiVersion"] == "batch/v1"
        assert obj["kind"] == "Job"
        assert obj["metadata"]["name"] == "probe"
        assert _first_container(obj)["image"] == "busybox:1.36"

    def test_the_job_container_is_named_after_the_job(self) -> None:
        assert _first_container(synthesize_manifest(_job_params()))["name"] == "probe"

    def test_a_job_pod_never_restarts(self) -> None:
        obj = synthesize_manifest(_job_params())

        assert obj["spec"]["template"]["spec"]["restartPolicy"] == "Never"

    def test_a_job_with_no_image_carries_an_empty_image(self) -> None:
        params = _form_params(kind="Job", name="probe", job_from="image")

        assert _first_container(synthesize_manifest(params))["image"] == ""

    def test_a_job_command_reaches_the_wire_as_a_list(self) -> None:
        obj = synthesize_manifest(_job_params(command='sh -c "echo hi there"'))

        assert _first_container(obj)["command"] == ["sh", "-c", "echo hi there"]

    @pytest.mark.parametrize(
        "overrides",
        [{}, {"command": ""}, {"command": "   "}, {"command": None}],
        ids=["absent", "blank", "spaced", "null"],
    )
    def test_a_job_with_no_command_leaves_the_image_entrypoint_alone(self, overrides: Any) -> None:
        obj = synthesize_manifest(_job_params(**overrides))

        assert "command" not in _first_container(obj)

    def test_a_job_command_with_an_unclosed_quote_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_COMMAND_MESSAGE)):
            synthesize_manifest(_job_params(command='sh -c "echo hi'))


class TestSplitCommand:
    """One typed command line becomes the argument list the container runs."""

    def test_a_quoted_argument_stays_one_argument(self) -> None:
        assert split_command('sh -c "echo hi there"') == ["sh", "-c", "echo hi there"]

    def test_an_escaped_space_stays_inside_its_argument(self) -> None:
        assert split_command("echo a\\ b") == ["echo", "a b"]

    def test_a_single_word_is_one_argument(self) -> None:
        assert split_command("echo") == ["echo"]

    def test_an_empty_command_is_no_arguments(self) -> None:
        assert split_command("") == []

    def test_a_whitespace_only_command_is_no_arguments(self) -> None:
        assert split_command("   \t  ") == []

    @pytest.mark.parametrize("text", ['echo "unclosed', "echo 'unclosed"], ids=["double", "single"])
    def test_an_unclosed_quote_is_refused_by_name(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_COMMAND_MESSAGE)):
            split_command(text)

    def test_the_caller_can_name_the_parameter_the_message_blames(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_INTERPRETER_MESSAGE)):
            split_command('sh -c "unclosed', name="interpreter")

    def test_the_parameter_name_is_keyword_only_and_defaults_to_command(self) -> None:
        parameter = inspect.signature(_module().split_command).parameters["name"]

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default == "command"


class TestSecretValues:
    """Every value a Secret manifest carries is masked, whichever way it was written."""

    def test_string_data_carries_the_plaintext_and_its_base64(self) -> None:
        documents = [_secret(stringData={"password": _PASSWORD, "user": _USER})]

        assert secret_values(documents) == [_PASSWORD, _PASSWORD_B64, _USER, _USER_B64]

    def test_data_carries_the_encoded_value_and_its_plaintext(self) -> None:
        assert secret_values([_secret(data={"password": _PASSWORD_B64})]) == [
            _PASSWORD_B64,
            _PASSWORD,
        ]

    def test_string_data_comes_before_data_within_one_document(self) -> None:
        documents = [_secret(stringData={"password": _PASSWORD}, data={"token": _TOKEN_B64})]

        assert secret_values(documents) == [_PASSWORD, _PASSWORD_B64, _TOKEN_B64, _TOKEN]

    def test_several_documents_concatenate_in_list_order(self) -> None:
        documents = [
            _secret(stringData={"password": _PASSWORD}),
            _secret(data={"token": _TOKEN_B64}),
        ]

        assert secret_values(documents) == [_PASSWORD, _PASSWORD_B64, _TOKEN_B64, _TOKEN]

    @pytest.mark.parametrize("kind", ["ConfigMap", "Job"])
    def test_a_document_that_is_not_a_secret_carries_nothing(self, kind: str) -> None:
        documents = [{"apiVersion": "v1", "kind": kind, "data": {"password": _PASSWORD_B64}}]

        assert secret_values(documents) == []

    def test_a_data_value_that_is_not_base64_carries_only_itself(self) -> None:
        assert secret_values([_secret(data={"legacy": _NOT_BASE64})]) == [_NOT_BASE64]

    def test_a_data_value_whose_bytes_are_not_text_carries_only_itself(self) -> None:
        assert secret_values([_secret(data={"keystore": _NOT_TEXT_B64})]) == [_NOT_TEXT_B64]

    def test_a_data_value_that_is_not_text_carries_only_itself(self) -> None:
        assert secret_values([_secret(data={"count": 7})]) == [7]

    def test_a_string_data_value_that_is_not_text_carries_only_itself(self) -> None:
        assert secret_values([_secret(stringData={"count": 7, "empty": None})]) == [7, None]

    def test_a_mixed_string_data_map_encodes_only_its_text_values_in_order(self) -> None:
        documents = [_secret(stringData={"password": _PASSWORD, "count": 7, "user": _USER})]

        assert secret_values(documents) == [_PASSWORD, _PASSWORD_B64, 7, _USER, _USER_B64]

    def test_a_secret_with_neither_map_carries_nothing(self) -> None:
        assert secret_values([_secret()]) == []

    @pytest.mark.parametrize(
        "fields",
        [{"data": None}, {"stringData": None}, {"data": None, "stringData": None}],
        ids=["data", "string data", "both"],
    )
    def test_a_map_that_was_written_empty_carries_nothing(self, fields: Any) -> None:
        assert secret_values([_secret(**fields)]) == []

    def test_no_documents_carry_nothing(self) -> None:
        assert secret_values([]) == []

    def test_the_values_ride_the_envelope_as_json(self) -> None:
        documents = [_secret(stringData={"password": _PASSWORD}, data={"token": _TOKEN_B64})]

        assert json.loads(json.dumps(secret_values(documents))) == [
            _PASSWORD,
            _PASSWORD_B64,
            _TOKEN_B64,
            _TOKEN,
        ]


class TestTheManifestModuleStaysVendorable:
    """The helpers are copied onto the remote host, where only the standard library is there."""

    def test_the_module_never_imports_yaml(self) -> None:
        assert "yaml" not in _import_roots()

    def test_the_module_reads_json_and_splits_with_shlex(self) -> None:
        assert {"json", "shlex"} <= _import_roots()
