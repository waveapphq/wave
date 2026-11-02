"""The family-neutral parameter and output builders (REQ-3.4.2.2).

The record gate, the On error enum, the timeout integer, the positive-number check, the
blank / integer / boolean / floor row checks, the show_when gate, the Max size (MiB) / Max
files rows with their check, the number-row default reader and the success / error /
reason output core that every fail-or-record block declares. The K8s
family builds its cluster wording on the same builders, so its shipped descriptors are
unchanged; tests/plugins/k8s/test_k8s_common.py stays green as it is.
"""

import inspect
import re
from typing import Any

import pytest

from wavecore.plugins import _k8s_common, _shared_params

OUTPUT_KEYS = {"name", "type", "secret", "description", "show_when"}
FAMILY_WORDS = ("k8s", "kubernetes", "kubectl", "cluster", "namespace", "helm")

K8S_ON_ERROR_DESCRIPTION = (
    "What a cluster error does: 'fail' stops the block, 'record' sets "
    "success=false with the error and reason and continues"
)
K8S_TIMEOUT_DEFAULT = 30
K8S_TIMEOUT_DESCRIPTION = "Request timeout in seconds. Default: 30."
K8S_SUCCESS_DESCRIPTION = (
    "True when the cluster carried out the operation without error; false "
    "when On error is Record and continue and the cluster refused it"
)
K8S_REASON_DESCRIPTION = (
    "The cluster reason for the failure, like NotFound or Forbidden; empty "
    "when the operation succeeded"
)
GENERIC_ERROR_DESCRIPTION = (
    "The error message when the operation failed under Record and continue; empty otherwise"
)
LOCAL_SUCCESS_DESCRIPTION = (
    "True when the script passed. False when it failed and On error is Record and continue."
)
LOCAL_REASON_DESCRIPTION = "Why it failed: Timeout; empty when it passed."


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


def by_name(descriptors: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {descriptor["name"]: descriptor for descriptor in descriptors}


def local_core(*, gated: bool) -> list[dict[str, Any]]:
    """The core as a local-process block asks for it, with its own wording injected."""
    return _shared_params.output_core(
        gated=gated,
        success_description=LOCAL_SUCCESS_DESCRIPTION,
        reason_description=LOCAL_REASON_DESCRIPTION,
    )


class TestRecordGate:
    """One gate value for every block that can record a failure and continue."""

    def test_the_gate_shows_a_row_only_under_record_and_continue(self) -> None:
        assert _shared_params.RECORD_GATE == {"field": "on_error", "values": ["record"]}

    def test_a_gated_core_carries_a_copy_rather_than_the_module_constant(self) -> None:
        gated = by_name(local_core(gated=True))

        assert gated["error"]["show_when"] is not _shared_params.RECORD_GATE
        assert gated["reason"]["show_when"] is not gated["error"]["show_when"]

    def test_rewriting_a_gate_on_one_descriptor_leaves_the_constant_alone(self) -> None:
        gated = by_name(local_core(gated=True))
        gated["error"]["show_when"] = {"field": "on_error", "values": ["fail"]}

        assert _shared_params.RECORD_GATE == {"field": "on_error", "values": ["record"]}


class TestOnErrorParameter:
    """The failure-handling enum, with each family's own wording handed in."""

    def test_it_is_an_optional_two_value_enum_defaulting_to_fail(self) -> None:
        param = _shared_params.on_error_parameter("Fail the block, or record and continue.")

        assert param["name"] == "on_error"
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "fail"
        assert param["enum_values"] == ["fail", "record"]

    def test_the_description_is_the_one_the_caller_hands_in(self) -> None:
        assert _shared_params.on_error_parameter("Ours")["description"] == "Ours"

    def test_the_k8s_descriptor_is_the_shared_builder_with_the_cluster_wording(self) -> None:
        assert _k8s_common.on_error_parameter() == _shared_params.on_error_parameter(
            K8S_ON_ERROR_DESCRIPTION
        )

    def test_the_factory_hands_out_a_fresh_descriptor(self) -> None:
        first = _shared_params.on_error_parameter("Ours")
        first["default"] = "record"

        assert _shared_params.on_error_parameter("Ours")["default"] == "fail"

    def test_the_enum_list_is_not_shared_between_descriptors(self) -> None:
        first = _shared_params.on_error_parameter("Ours")
        first["enum_values"].append("retry")

        assert _shared_params.on_error_parameter("Ours")["enum_values"] == ["fail", "record"]


class TestTimeoutParameter:
    """The timeout integer with a floor of 1, the same on every Block that declares it."""

    def test_it_is_an_optional_integer_carrying_the_given_default(self) -> None:
        param = _shared_params.timeout_parameter(300, "Seconds before WAVE stops the run.")

        assert param == {
            "name": "timeout",
            "type": "integer",
            "required": False,
            "default": 300,
            "minimum": 1,
            "description": "Seconds before WAVE stops the run.",
        }

    def test_a_different_default_lands(self) -> None:
        assert _shared_params.timeout_parameter(30, "Ours")["default"] == 30

    def test_the_builder_declares_a_minimum_of_one(self) -> None:
        assert _shared_params.timeout_parameter(300, "Ours")["minimum"] == 1

    def test_the_k8s_descriptor_is_the_shared_builder_with_the_request_wording(self) -> None:
        assert _k8s_common.timeout_parameter() == _shared_params.timeout_parameter(
            K8S_TIMEOUT_DEFAULT, K8S_TIMEOUT_DESCRIPTION
        )

    def test_the_k8s_descriptor_carries_the_minimum_of_one(self) -> None:
        assert _k8s_common.timeout_parameter()["minimum"] == 1

    def test_the_factory_hands_out_a_fresh_descriptor(self) -> None:
        first = _shared_params.timeout_parameter(300, "Ours")
        first["default"] = 1

        assert _shared_params.timeout_parameter(300, "Ours")["default"] == 300


class TestRequirePositive:
    """A set duration must be a real one, whatever parameter carries it."""

    @pytest.mark.parametrize("value", [0, -1])
    def test_zero_and_negative_are_refused(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            _shared_params.require_positive({"timeout": value}, "timeout")

    def test_an_absent_setting_passes(self) -> None:
        _shared_params.require_positive({}, "timeout")

    def test_a_none_setting_passes(self) -> None:
        _shared_params.require_positive({"timeout": None}, "timeout")

    @pytest.mark.parametrize("value", [1, 300])
    def test_a_positive_value_passes(self, value: int) -> None:
        _shared_params.require_positive({"timeout": value}, "timeout")

    def test_the_message_names_the_parameter_it_was_asked_about(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'tail_lines' must be positive")):
            _shared_params.require_positive({"tail_lines": 0}, "tail_lines")


class TestBlank:
    """A text row counts as unset when it is None or only whitespace."""

    @pytest.mark.parametrize("value", [None, "", "   ", "\t\n"])
    def test_none_and_whitespace_are_blank(self, value: Any) -> None:
        assert _shared_params.blank(value) is True

    @pytest.mark.parametrize("value", ["x", " x ", 0, False, [], {}])
    def test_anything_else_is_set(self, value: Any) -> None:
        assert _shared_params.blank(value) is False


class TestBlankNumber:
    """A number row counts as unset when it is None or the empty string only."""

    @pytest.mark.parametrize("value", [None, ""])
    def test_none_and_the_empty_string_are_blank(self, value: Any) -> None:
        assert _shared_params.blank_number(value) is True

    @pytest.mark.parametrize("value", ["  ", 0, 0.0, False, "0"])
    def test_anything_else_is_set(self, value: Any) -> None:
        assert _shared_params.blank_number(value) is False


class TestCheckInteger:
    """A set number row must be a whole number; a bool is not one."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param({}, id="absent"),
            pytest.param({"port": None}, id="none"),
            pytest.param({"port": ""}, id="empty"),
            pytest.param({"port": 0}, id="zero"),
            pytest.param({"port": 5432}, id="positive"),
            pytest.param({"port": -3}, id="negative"),
        ],
    )
    def test_an_unset_row_or_an_integer_passes(self, params: dict[str, Any]) -> None:
        _shared_params.check_integer(params, "port")

    @pytest.mark.parametrize("value", [True, False, 1.5, 2.0, "5", "  "])
    def test_anything_else_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'port' must be an integer")):
            _shared_params.check_integer({"port": value}, "port")

    def test_the_message_names_the_parameter_it_was_asked_about(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'max_rows' must be an integer")):
            _shared_params.check_integer({"max_rows": "ten"}, "max_rows")


class TestCheckBoolean:
    """A set switch must be true or false; text and numbers are refused."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param({}, id="absent"),
            pytest.param({"tls": None}, id="none"),
            pytest.param({"tls": True}, id="true"),
            pytest.param({"tls": False}, id="false"),
        ],
    )
    def test_an_unset_row_or_a_boolean_passes(self, params: dict[str, Any]) -> None:
        _shared_params.check_boolean(params, "tls")

    @pytest.mark.parametrize("value", ["true", "", 1, 0])
    def test_anything_else_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'tls' must be a boolean")):
            _shared_params.check_boolean({"tls": value}, "tls")

    def test_the_message_names_the_parameter_it_was_asked_about(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'verify_ssl' must be a boolean")):
            _shared_params.check_boolean({"verify_ssl": "yes"}, "verify_ssl")


class TestCheckAtLeast:
    """A set integer below its floor is refused with the caller's own message."""

    MESSAGE = "Parameter 'batch_size' must be at least 1"

    def test_an_integer_below_the_floor_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(self.MESSAGE)):
            _shared_params.check_at_least({"batch_size": 0}, "batch_size", 1, self.MESSAGE)

    @pytest.mark.parametrize("value", [1, 500])
    def test_the_floor_and_above_pass(self, value: int) -> None:
        _shared_params.check_at_least({"batch_size": value}, "batch_size", 1, self.MESSAGE)

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param({}, id="absent"),
            pytest.param({"batch_size": None}, id="none"),
            pytest.param({"batch_size": "0"}, id="text"),
            pytest.param({"batch_size": 0.5}, id="float"),
        ],
    )
    def test_a_row_that_is_not_a_set_integer_is_left_to_the_type_check(
        self, params: dict[str, Any]
    ) -> None:
        _shared_params.check_at_least(params, "batch_size", 1, self.MESSAGE)

    def test_the_message_is_carried_verbatim(self) -> None:
        message = "Max rows cannot be negative"

        with pytest.raises(ValueError, match=exact(message)):
            _shared_params.check_at_least({"max_rows": -1}, "max_rows", 0, message)


class TestGate:
    """A show_when gate: the controlling row and the values that show the gated row."""

    def test_one_value(self) -> None:
        assert _shared_params.gate("operation", "run_sql") == {
            "field": "operation",
            "values": ["run_sql"],
        }

    def test_several_values_keep_their_order(self) -> None:
        assert _shared_params.gate("database_type", "postgresql", "mysql", "oracle") == {
            "field": "database_type",
            "values": ["postgresql", "mysql", "oracle"],
        }

    def test_each_call_hands_out_a_fresh_gate(self) -> None:
        first = _shared_params.gate("mode", "search")
        second = _shared_params.gate("mode", "search")

        assert first is not second
        assert first["values"] is not second["values"]


class TestOutputCore:
    """Success, error and reason: one shape for every family, the wording injected."""

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_order_is_success_error_reason(self, gated: bool) -> None:
        assert [(output["name"], output["type"]) for output in local_core(gated=gated)] == [
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    @pytest.mark.parametrize("name", ["gated", "success_description", "reason_description"])
    def test_every_argument_is_keyword_only(self, name: str) -> None:
        parameter = signature_of(_shared_params.output_core, name)

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY

    def test_gated_has_no_default(self) -> None:
        parameter = signature_of(_shared_params.output_core, "gated")

        assert parameter.default is inspect.Parameter.empty

    def test_an_ungated_core_hides_nothing(self) -> None:
        assert all("show_when" not in output for output in local_core(gated=False))

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_a_gated_core_hides_the_two_failure_rows(self, name: str) -> None:
        assert by_name(local_core(gated=True))[name]["show_when"] == _shared_params.RECORD_GATE

    def test_a_gated_core_never_hides_success(self) -> None:
        assert "show_when" not in by_name(local_core(gated=True))["success"]

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_injected_wording_lands_on_success_and_reason(self, gated: bool) -> None:
        outputs = by_name(local_core(gated=gated))

        assert outputs["success"]["description"] == LOCAL_SUCCESS_DESCRIPTION
        assert outputs["reason"]["description"] == LOCAL_REASON_DESCRIPTION

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_error_wording_is_the_builders_own(self, gated: bool) -> None:
        outputs = by_name(local_core(gated=gated))

        assert outputs["error"]["description"] == GENERIC_ERROR_DESCRIPTION

    @pytest.mark.parametrize("gated", [False, True])
    def test_no_output_leaks_a_key_outside_the_descriptor_contract(self, gated: bool) -> None:
        assert all(set(output) <= OUTPUT_KEYS for output in local_core(gated=gated))

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_factory_hands_out_fresh_descriptors(self, gated: bool) -> None:
        first = local_core(gated=gated)
        first[0]["name"] = "changed"

        assert local_core(gated=gated)[0]["name"] == "success"

    @pytest.mark.parametrize("gated", [False, True])
    def test_the_k8s_core_is_the_shared_core_with_the_cluster_wording(self, gated: bool) -> None:
        assert _k8s_common.output_core(gated=gated) == _shared_params.output_core(
            gated=gated,
            success_description=K8S_SUCCESS_DESCRIPTION,
            reason_description=K8S_REASON_DESCRIPTION,
        )


class TestFamilyNeutrality:
    """The module carries no family's vocabulary, so any block can build on it."""

    def test_no_family_wording_survives_in_the_shared_module(self) -> None:
        source = inspect.getsource(_shared_params).lower()

        assert [word for word in FAMILY_WORDS if word in source] == []

    def test_the_shared_module_imports_no_family_module(self) -> None:
        assert "_k8s_common" not in inspect.getsource(_shared_params)


SFTP_SIZE_DESCRIPTION = (
    "Largest total a download may bring, in MiB. The block adds up the match before it writes "
    "anything and refuses a larger one. 0 means no limit."
)
SFTP_FILES_DESCRIPTION = (
    "Most files a download may bring. The block counts the match before it writes anything and "
    "refuses more. 0 means no limit."
)
COPY_SIZE_DESCRIPTION = (
    "Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes over "
    "and removes what it wrote. 0 means no limit."
)
COPY_FILES_DESCRIPTION = (
    "Most files a copy from the pod may write. The copy stops the moment it goes over and removes "
    "what it wrote. 0 means no limit."
)
MAX_SIZE_NOT_INTEGER = "Parameter 'max_size_mib' must be an integer"
MAX_FILES_NOT_INTEGER = "Parameter 'max_files' must be an integer"
MAX_SIZE_BELOW_ZERO = "Max size (MiB) must be 0 or more"
MAX_FILES_BELOW_ZERO = "Max files must be 0 or more"
LIMIT_ARGUMENTS = (
    "max_size_mib",
    "max_files",
    "show_when",
    "size_description",
    "files_description",
)


def sftp_limit_rows(show_when: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """The limit rows as the SFTP Download asks for them."""
    return _shared_params.limit_parameters(
        max_size_mib=1024,
        max_files=10000,
        show_when=_shared_params.gate("operation", "download") if show_when is None else show_when,
        size_description=SFTP_SIZE_DESCRIPTION,
        files_description=SFTP_FILES_DESCRIPTION,
    )


class TestLimitParameters:
    """The Max size (MiB) and Max files rows, one shape for every bounded transfer (SFTP-6)."""

    def test_the_sftp_download_rows_are_exact(self) -> None:
        assert sftp_limit_rows() == [
            {
                "name": "max_size_mib",
                "type": "integer",
                "required": False,
                "default": 1024,
                "minimum": 0,
                "show_when": {"field": "operation", "values": ["download"]},
                "description": SFTP_SIZE_DESCRIPTION,
            },
            {
                "name": "max_files",
                "type": "integer",
                "required": False,
                "default": 10000,
                "minimum": 0,
                "show_when": {"field": "operation", "values": ["download"]},
                "description": SFTP_FILES_DESCRIPTION,
            },
        ]

    def test_the_k8s_copy_from_pod_rows_are_exact(self) -> None:
        rows = _shared_params.limit_parameters(
            max_size_mib=256,
            max_files=10000,
            show_when=_shared_params.gate("direction", "from_pod"),
            size_description=COPY_SIZE_DESCRIPTION,
            files_description=COPY_FILES_DESCRIPTION,
        )

        assert rows == [
            {
                "name": "max_size_mib",
                "type": "integer",
                "required": False,
                "default": 256,
                "minimum": 0,
                "show_when": {"field": "direction", "values": ["from_pod"]},
                "description": COPY_SIZE_DESCRIPTION,
            },
            {
                "name": "max_files",
                "type": "integer",
                "required": False,
                "default": 10000,
                "minimum": 0,
                "show_when": {"field": "direction", "values": ["from_pod"]},
                "description": COPY_FILES_DESCRIPTION,
            },
        ]

    def test_max_size_comes_before_max_files(self) -> None:
        assert [row["name"] for row in sftp_limit_rows()] == ["max_size_mib", "max_files"]

    def test_neither_row_declares_a_maximum(self) -> None:
        assert all("maximum" not in row for row in sftp_limit_rows())

    def test_the_defaults_are_the_ones_handed_in(self) -> None:
        rows = _shared_params.limit_parameters(
            max_size_mib=0,
            max_files=5,
            show_when=_shared_params.gate("operation", "download"),
            size_description="Size",
            files_description="Files",
        )

        assert [(row["default"], row["description"]) for row in rows] == [
            (0, "Size"),
            (5, "Files"),
        ]

    @pytest.mark.parametrize("name", LIMIT_ARGUMENTS)
    def test_every_argument_is_keyword_only(self, name: str) -> None:
        parameter = signature_of(_shared_params.limit_parameters, name)

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty

    def test_rewriting_the_callers_gate_afterwards_leaves_the_rows_alone(self) -> None:
        show_when = _shared_params.gate("operation", "download")
        rows = sftp_limit_rows(show_when)

        show_when["field"] = "direction"
        show_when["values"] = ["from_pod"]

        assert [row["show_when"] for row in rows] == [
            {"field": "operation", "values": ["download"]},
            {"field": "operation", "values": ["download"]},
        ]

    def test_each_row_holds_its_own_copy_of_the_gate(self) -> None:
        show_when = _shared_params.gate("operation", "download")
        rows = sftp_limit_rows(show_when)

        assert rows[0]["show_when"] is not show_when
        assert rows[1]["show_when"] is not show_when
        assert rows[0]["show_when"] is not rows[1]["show_when"]

    def test_the_factory_hands_out_fresh_rows(self) -> None:
        first = sftp_limit_rows()
        first[0]["default"] = 1

        assert sftp_limit_rows()[0]["default"] == 1024


class TestCheckLimits:
    """Max size (MiB) and Max files: whole numbers, 0 or more, blank means not set."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param({}, id="absent"),
            pytest.param({"max_size_mib": None, "max_files": None}, id="none"),
            pytest.param({"max_size_mib": "", "max_files": ""}, id="empty"),
            pytest.param({"max_size_mib": 0, "max_files": 0}, id="zero-means-no-limit"),
            pytest.param({"max_size_mib": 1024, "max_files": 10000}, id="defaults"),
            pytest.param({"max_size_mib": 10**9, "max_files": 10**9}, id="no-maximum"),
            pytest.param({"max_size_mib": None, "max_files": 1}, id="one-set"),
        ],
    )
    def test_an_unset_row_zero_or_a_positive_integer_passes(self, params: dict[str, Any]) -> None:
        assert _shared_params.check_limits(params) is None

    @pytest.mark.parametrize("value", [True, False, 1.5, 2.0, "10", "  ", "ten"])
    def test_a_max_size_that_is_not_an_integer_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact(MAX_SIZE_NOT_INTEGER)):
            _shared_params.check_limits({"max_size_mib": value})

    @pytest.mark.parametrize("value", [True, False, 1.5, 2.0, "10", "  ", "ten"])
    def test_a_max_files_that_is_not_an_integer_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact(MAX_FILES_NOT_INTEGER)):
            _shared_params.check_limits({"max_files": value})

    @pytest.mark.parametrize("value", [-1, -1024])
    def test_a_max_size_below_zero_is_refused(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact(MAX_SIZE_BELOW_ZERO)):
            _shared_params.check_limits({"max_size_mib": value})

    @pytest.mark.parametrize("value", [-1, -10000])
    def test_a_max_files_below_zero_is_refused(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact(MAX_FILES_BELOW_ZERO)):
            _shared_params.check_limits({"max_files": value})

    @pytest.mark.parametrize(
        ("params", "message"),
        [
            pytest.param(
                {"max_size_mib": "ten", "max_files": "many"},
                MAX_SIZE_NOT_INTEGER,
                id="max-size-type-first",
            ),
            pytest.param(
                {"max_size_mib": "ten", "max_files": -1},
                MAX_SIZE_NOT_INTEGER,
                id="max-size-type-before-max-files-floor",
            ),
            pytest.param(
                {"max_size_mib": -1, "max_files": "many"},
                MAX_FILES_NOT_INTEGER,
                id="both-types-before-either-floor",
            ),
            pytest.param(
                {"max_size_mib": -1, "max_files": -1},
                MAX_SIZE_BELOW_ZERO,
                id="max-size-floor-before-max-files-floor",
            ),
            pytest.param(
                {"max_size_mib": 0, "max_files": -1},
                MAX_FILES_BELOW_ZERO,
                id="max-files-floor-last",
            ),
        ],
    )
    def test_the_checks_run_in_order(self, params: dict[str, Any], message: str) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            _shared_params.check_limits(params)

    def test_other_rows_are_not_its_concern(self) -> None:
        assert _shared_params.check_limits({"timeout": "soon", "max_rows": -1}) is None


class TestNumberSetting:
    """A number row as given, or its default when it is absent, None or the empty string."""

    @pytest.mark.parametrize("value", [2222, 1, -5])
    def test_a_set_value_is_returned_as_given(self, value: int) -> None:
        assert _shared_params.number_setting({"port": value}, "port", 22) == value

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param({}, id="absent"),
            pytest.param({"port": None}, id="none"),
            pytest.param({"port": ""}, id="empty"),
        ],
    )
    def test_an_unset_row_gives_the_default(self, params: dict[str, Any]) -> None:
        assert _shared_params.number_setting(params, "port", 22) == 22

    def test_zero_stays_zero(self) -> None:
        assert (
            _shared_params.number_setting({"keep_alive_interval": 0}, "keep_alive_interval", 30)
            == 0
        )

    @pytest.mark.parametrize("default", [0, 300])
    def test_the_default_is_the_one_asked_for(self, default: int) -> None:
        assert _shared_params.number_setting({"timeout": ""}, "timeout", default) == default

    def test_only_the_named_row_is_read(self) -> None:
        assert _shared_params.number_setting({"port": 2222}, "timeout", 300) == 300
