"""Wait Until control: metadata, engine signals, and design-time validation.

The control itself does no waiting - it declares its shape and hands the engine
the round parameters. The rounds live in
``wavecore/api/services/workbench/wait_until.py`` and are covered by
``tests/api/test_workbench_wait_until.py``.

REQ-3.5.4.3, REQ-3.5.4.4.
"""

import asyncio
from typing import Any

import pytest

from wavecore.controls.timing import WaitUntilControl
from wavecore.models.enums import ControlId

CONDITIONS: list[dict[str, Any]] = [
    {
        "id": "cond-1",
        "type": "literal",
        "variable": "phase",
        "value_type": "string",
        "operator": "equals",
        "reference_value": "Running",
    }
]


def metadata() -> dict[str, Any]:
    return WaitUntilControl().metadata


def parameters() -> list[Any]:
    return metadata()["parameter_schema"]


def parameter(name: str) -> Any:
    match = [param for param in parameters() if param.name == name]
    assert len(match) == 1, f"expected exactly one '{name}' parameter, got {match!r}"
    return match[0]


def run_validate(params: dict[str, Any]) -> None:
    asyncio.run(WaitUntilControl().validate(params))


def run_execute(context: dict[str, Any]) -> Any:
    return asyncio.run(WaitUntilControl().execute(context))


def execute_with(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"conditions": CONDITIONS, "timeout": 30000}
    params.update(overrides)
    result = run_execute({"parameters": params, "variables": {}})
    assert isinstance(result, dict)
    return result


class TestWaitUntilMetadata:
    """The declared shape every other surface reads."""

    def test_identity_is_the_registered_timing_control(self) -> None:
        data = metadata()
        assert data["id"] == ControlId.WAIT_UNTIL
        assert data["version"] == "1.0.0"
        assert data["name"] == "Wait Until"
        assert data["category"] == "timing"
        assert data["icon_name"] == "hourglass"

    def test_the_parameter_names_are_the_six_the_panel_renders(self) -> None:
        assert [param.name for param in parameters()] == [
            "conditions",
            "timeout",
            "check_interval",
            "message",
            "mode",
            "fail_current_scope",
        ]

    def test_conditions_is_a_required_assertion_list(self) -> None:
        # The condition is an assertion set, not a bare expression string.
        param = parameter("conditions")
        assert param.type == "array"
        assert param.required is True

    def test_timeout_is_a_required_positive_integer_in_milliseconds(self) -> None:
        param = parameter("timeout")
        assert param.type == "integer"
        assert param.required is True
        assert param.minimum == 1

    def test_check_interval_is_optional_and_defaults_to_one_second(self) -> None:
        param = parameter("check_interval")
        assert param.type == "integer"
        assert param.required is False
        assert param.default == 1000
        assert param.minimum == 1

    def test_message_is_an_optional_string(self) -> None:
        param = parameter("message")
        assert param.type == "string"
        assert param.required is False

    def test_mode_offers_retry_and_watch_and_defaults_to_retry(self) -> None:
        param = parameter("mode")
        assert param.type == "string"
        assert param.required is False
        assert param.default == "retry"
        assert param.enum_values == ["retry", "watch"]

    def test_fail_current_scope_is_an_optional_boolean_defaulting_off(self) -> None:
        # The timeout is informational unless the author opts in.
        param = parameter("fail_current_scope")
        assert param.type == "boolean"
        assert param.required is False
        assert param.default is False

    def test_fail_current_scope_says_giving_up_fails_the_block(self) -> None:
        assert parameter("fail_current_scope").description == (
            "When true, giving up fails the block and stops the flow"
        )

    def test_outputs_are_exactly_passed_and_elapsed(self) -> None:
        assert metadata()["output_schema"] == [
            {"name": "passed", "type": "boolean"},
            {"name": "elapsed", "type": "integer"},
        ]

    def test_structure_hints_declare_a_looping_container_with_retry_and_then(self) -> None:
        # The same shape Try/Catch, the loops and Switch use, so disabled
        # cascade-skip and skip-while-paused work without a special case.
        assert metadata()["structure_hints"] == {
            "type": "looping",
            "has_body": True,
            "branches": ["retry", "then"],
            "egress": "then",
        }


class TestWaitUntilRemovedSchema:
    """Section 4.6 deletions - no compat shim, WAVE is v1."""

    def test_the_bare_condition_string_parameter_is_gone(self) -> None:
        assert "condition" not in [param.name for param in parameters()]

    def test_poll_interval_is_gone(self) -> None:
        assert "poll_interval" not in [param.name for param in parameters()]

    def test_the_timed_out_output_is_gone(self) -> None:
        assert "timedOut" not in [out["name"] for out in metadata()["output_schema"]]


class TestWaitUntilExecuteSignals:
    """execute() emits the round parameters the engine consumes."""

    def test_execute_flags_the_node_as_a_wait(self) -> None:
        assert execute_with()["__wait_until"] is True

    def test_execute_carries_the_condition_list_verbatim(self) -> None:
        assert execute_with()["__condition"] == CONDITIONS

    def test_the_deadline_rides_its_own_key_not_the_loop_timeout(self) -> None:
        # signals["timeout"] routes a control through _dispatch_loop's
        # asyncio.wait_for, which FAILS the session.
        result = execute_with(timeout=30000)
        assert result["__wait_timeout"] == 30000
        assert "__timeout" not in result

    def test_execute_carries_the_check_interval(self) -> None:
        assert execute_with(check_interval=250)["__check_interval"] == 250

    def test_an_omitted_check_interval_falls_back_to_one_second(self) -> None:
        assert execute_with()["__check_interval"] == 1000

    def test_execute_carries_the_timeout_message(self) -> None:
        assert execute_with(message="pod never reached Running")["__wait_message"] == (
            "pod never reached Running"
        )

    def test_an_omitted_message_emits_none(self) -> None:
        assert execute_with()["__wait_message"] is None

    def test_execute_carries_the_fail_current_scope_choice(self) -> None:
        assert execute_with(fail_current_scope=True)["__wait_fail_scope"] is True

    def test_fail_current_scope_defaults_off(self) -> None:
        assert execute_with()["__wait_fail_scope"] is False

    def test_execute_carries_the_wait_mode(self) -> None:
        assert execute_with(mode="watch")["__mode"] == "watch"

    def test_an_omitted_mode_is_retry(self) -> None:
        # A fresh drop waits with a retry lane, the shape that works today.
        assert execute_with()["__mode"] == "retry"

    def test_execute_writes_to_the_session_logger_when_one_is_present(self) -> None:
        logged: list[str] = []

        class _Logger:
            def info(self, message: str) -> None:
                logged.append(message)

        result = asyncio.run(
            WaitUntilControl().execute(
                {
                    "parameters": {"conditions": CONDITIONS, "timeout": 30000},
                    "variables": {},
                    "logger": _Logger(),
                }
            )
        )

        assert isinstance(result, dict)
        assert logged, "execute must announce the wait on the session logger"

    def test_execute_without_parameters_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^parameters key is required in context$"):
            run_execute({})


class TestWaitUntilValidate:
    """Every design-time rejection, with its exact message."""

    def test_a_complete_configuration_validates(self) -> None:
        run_validate(
            {
                "conditions": CONDITIONS,
                "timeout": 30000,
                "check_interval": 500,
                "message": "gave up",
                "mode": "watch",
                "fail_current_scope": True,
            }
        )

    def test_the_minimum_configuration_validates(self) -> None:
        run_validate({"conditions": CONDITIONS, "timeout": 1})

    def test_missing_conditions_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^conditions parameter is required$"):
            run_validate({"timeout": 30000})

    @pytest.mark.parametrize("conditions", ["phase == 'Running'", {"variable": "phase"}, 3])
    def test_non_list_conditions_are_rejected(self, conditions: Any) -> None:
        with pytest.raises(ValueError, match=r"^conditions must be a list$"):
            run_validate({"conditions": conditions, "timeout": 30000})

    def test_an_empty_condition_list_is_rejected(self) -> None:
        # An empty RETRY LANE is legal; an empty CONDITION set is not -
        # a wait that can never pass is a misconfiguration.
        with pytest.raises(ValueError, match=r"^at least one condition is required$"):
            run_validate({"conditions": [], "timeout": 30000})

    def test_missing_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^timeout parameter is required$"):
            run_validate({"conditions": CONDITIONS})

    @pytest.mark.parametrize("timeout", [0, -1, 1.5, "30000", True, None, [30000]])
    def test_a_non_positive_integer_timeout_is_rejected(self, timeout: Any) -> None:
        with pytest.raises(ValueError, match=r"^timeout must be a positive integer$"):
            run_validate({"conditions": CONDITIONS, "timeout": timeout})

    @pytest.mark.parametrize("interval", [0, -5, 2.5, "1000", True, [1000]])
    def test_a_non_positive_integer_check_interval_is_rejected(self, interval: Any) -> None:
        with pytest.raises(ValueError, match=r"^check_interval must be a positive integer$"):
            run_validate({"conditions": CONDITIONS, "timeout": 30000, "check_interval": interval})

    def test_an_absent_check_interval_is_not_range_checked(self) -> None:
        run_validate({"conditions": CONDITIONS, "timeout": 30000})

    @pytest.mark.parametrize("mode", ["poll", "RETRY", "", "single"])
    def test_an_unknown_mode_is_rejected(self, mode: str) -> None:
        with pytest.raises(ValueError, match=r"^mode must be 'retry' or 'watch'$"):
            run_validate({"conditions": CONDITIONS, "timeout": 30000, "mode": mode})

    @pytest.mark.parametrize("mode", ["retry", "watch"])
    def test_both_declared_modes_validate(self, mode: str) -> None:
        run_validate({"conditions": CONDITIONS, "timeout": 30000, "mode": mode})
