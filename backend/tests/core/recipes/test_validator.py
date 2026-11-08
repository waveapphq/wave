"""Stage-1 validation catalog: blocks, settings, expressions, profiles, constructs.

REQ-5.2.7.3; every message is the exact catalog string. Registry-backed checks
call validate_recipe_doc directly; seam-ambiguous shape checks (constructs,
conditions, duplicate functions) go through compile_recipe.
"""

import re
from typing import Any

import pytest

from tests.core.recipes.conftest import (
    LOG_STEP,
    codes,
    create_library_function,
    create_profile,
    find_finding,
    make_recipe,
)
from tests.plugins._stub_plugin import register_stub_plugin

HTTP_SETTINGS_SORTED = (
    "allow_redirects, auth_enabled, auth_header_name, auth_key, auth_mode, auth_password, "
    "auth_token, auth_username, body, body_auto_headers, body_mode, ca_cert, cipher_suites, "
    "client_cert, client_key, file_content_type, file_path, file_source, form_fields, headers, "
    "max_redirects, max_size, method, parts, proxy_mode, query_params, "
    "response_mode, retry_backoff_factor, retry_count, retry_delay, retryable_status_codes, "
    "timeout, tls_max_version, tls_min_version, url, verify_ssl"
)

HTTP_OUTPUTS_SORTED = (
    "body, content_type, final_url, headers, response_time, sha256, size, status_code, trace"
)

COMPARISON: dict[str, Any] = {
    "variable": "transport",
    "operator": "equals",
    "value": "TCP",
    "value_type": "string",
}


def validate(text: str) -> list[dict[str, Any]]:
    from wavecore.core.recipes.parser import parse_recipe
    from wavecore.core.recipes.validator import validate_recipe_doc

    doc, parse_findings = parse_recipe(text)
    assert parse_findings == [], f"recipe must parse cleanly first: {parse_findings!r}"
    assert doc is not None
    return validate_recipe_doc(doc)


def compile_findings(text: str) -> list[dict[str, Any]]:
    from wavecore.core.recipes.compiler import compile_recipe

    findings: list[dict[str, Any]] = compile_recipe(text)["findings"]
    return findings


def http_step(**settings: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"url": "http://shop.local", "method": "GET"}
    values.update(settings)
    return {"block": "http-client", "settings": values}


def assert_message(pattern: str, actual: str) -> None:
    """A finding's text is pinned, so it is matched whole."""
    assert re.fullmatch(pattern, actual), f"{actual!r} does not match {pattern!r}"


def shell_script_step(capture: dict[str, str] | None = None, **settings: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"script": "echo hi"}
    values.update(settings)
    step: dict[str, Any] = {"block": "shell-script", "settings": values}
    if capture is not None:
        step["capture"] = capture
    return step


def shell_exec_step(capture: dict[str, str] | None = None, **settings: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"command": "ls -1"}
    values.update(settings)
    step: dict[str, Any] = {"block": "shell-exec", "settings": values}
    if capture is not None:
        step["capture"] = capture
    return step


class TestBlockCatalog:
    def test_clean_recipe_has_no_findings(self) -> None:
        assert validate(make_recipe([http_step(), LOG_STEP])) == []

    def test_unknown_block_is_gated(self) -> None:
        findings = validate(make_recipe([{"block": "no-such-block"}]))
        finding = find_finding(findings, "UNKNOWN_BLOCK")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Unknown block 'no-such-block'"
        assert finding["fix"] == "Use the list_blocks tool for the catalog of available blocks"

    def test_stub_block_is_a_warning_only(self) -> None:
        stub_id = register_stub_plugin()
        findings = validate(make_recipe([{"block": stub_id}]))
        finding = find_finding(findings, "STUB_BLOCK")
        assert finding["severity"] == "warning"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == (
            "Block 'test-stub' is not implemented yet and will fail at runtime"
        )
        assert finding["fix"] == "Choose an implemented block or accept the runtime failure"

    def test_ldap_client_is_an_unknown_block(self) -> None:
        findings = validate(make_recipe([{"block": "ldap-client"}]))
        finding = find_finding(findings, "UNKNOWN_BLOCK")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert_message(r"^Unknown block 'ldap-client'$", finding["problem"])
        assert finding["fix"] == "Use the list_blocks tool for the catalog of available blocks"

    def test_remote_execution_is_expressible_despite_missing_registry_entry(self) -> None:
        step = {"remote": {"settings": {"session_id": {"expr": "sid"}}, "body": [LOG_STEP]}}
        assert validate(make_recipe([step])) == []

    def test_a_block_without_output_type_rules_carries_an_empty_map(self) -> None:
        from wavecore.core.recipes.validator import load_block_catalog, remote_execution_entry

        assert load_block_catalog()["delay"].output_type_when == {}
        assert remote_execution_entry().output_type_when == {}

    def test_the_remote_execution_entry_maps_its_output_to_its_type(self) -> None:
        from wavecore.core.recipes.validator import remote_execution_entry

        assert remote_execution_entry().outputs == {"remote_session_id": "string"}

    def test_a_block_with_output_type_rules_carries_them(self) -> None:
        from wavecore.core.recipes.validator import load_block_catalog

        rules = load_block_catalog()["k8s-get"].output_type_when

        assert list(rules) == ["result"]
        assert [rule["type"] for rule in rules["result"]] == ["table", "string", "array"]


class TestSettingsCatalog:
    def test_unknown_setting_is_gated(self) -> None:
        findings = validate(make_recipe([http_step(lol=1)]))
        finding = find_finding(findings, "UNKNOWN_SETTING")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.lol"
        assert finding["problem"] == "Block 'http-client' has no setting 'lol'"
        assert finding["fix"] == f"Valid settings: {HTTP_SETTINGS_SORTED}"

    def test_missing_required_setting(self) -> None:
        findings = validate(make_recipe([{"block": "http-client", "settings": {"method": "GET"}}]))
        finding = find_finding(findings, "MISSING_REQUIRED_SETTING")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.url"
        assert finding["problem"] == "Required setting 'url' is missing for block 'http-client'"
        assert finding["fix"] == "Add settings.url"

    def test_required_setting_with_default_may_be_omitted(self) -> None:
        # http-client 'method' is required but carries a default of GET.
        findings = validate(
            make_recipe([{"block": "http-client", "settings": {"url": "http://x"}}])
        )
        assert findings == []

    def test_missing_required_setting_on_a_control_block(self) -> None:
        findings = validate(make_recipe([{"block": "delay", "settings": {}}]))
        finding = find_finding(findings, "MISSING_REQUIRED_SETTING")
        assert finding["problem"] == "Required setting 'duration' is missing for block 'delay'"
        assert finding["fix"] == "Add settings.duration"

    def test_setting_type_mismatch_string_for_integer(self) -> None:
        findings = validate(make_recipe([http_step(timeout="abc")]))
        finding = find_finding(findings, "INVALID_SETTING_TYPE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.timeout"
        assert finding["problem"] == (
            "Setting 'timeout' of block 'http-client' expects integer, got string"
        )
        assert finding["fix"] == "Provide an integer value"

    def test_setting_type_mismatch_integer_for_boolean(self) -> None:
        findings = validate(make_recipe([http_step(verify_ssl=5)]))
        finding = find_finding(findings, "INVALID_SETTING_TYPE")
        assert finding["problem"] == (
            "Setting 'verify_ssl' of block 'http-client' expects boolean, got integer"
        )

    def test_expression_setting_bypasses_the_type_check(self) -> None:
        findings = validate(make_recipe([http_step(timeout={"expr": "3 * 10"})]))
        assert findings == []

    def test_template_setting_bypasses_the_type_check(self) -> None:
        findings = validate(make_recipe([http_step(url="{{ base }}/home")]))
        assert findings == []

    def test_invalid_enum_value(self) -> None:
        findings = validate(make_recipe([http_step(method="YEET")]))
        finding = find_finding(findings, "INVALID_ENUM_VALUE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.method"
        assert finding["problem"] == (
            "Setting 'method' of block 'http-client' must be one of: "
            "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS"
        )
        assert finding["fix"] == "Use one of the listed values"


class TestHttpProxyChoice:
    """REQ-3.4.3.9: the HTTP block's proxy choice is the WAVE setting or off, nothing else."""

    @pytest.mark.parametrize("choice", ["wave-setting", "off"])
    def test_a_current_choice_is_clean(self, choice: str) -> None:
        assert validate(make_recipe([http_step(proxy_mode=choice)])) == []

    @pytest.mark.parametrize("written", ["off", "Off", "false", "no"])
    def test_off_written_without_quotes_is_clean(self, written: str) -> None:
        recipe = make_recipe([http_step(proxy_mode="off")]).replace("'off'", written)
        assert f"proxy_mode: {written}\n" in recipe
        assert validate(recipe) == []

    def test_a_yaml_true_stands_for_no_choice(self) -> None:
        recipe = make_recipe([http_step(proxy_mode="off")]).replace("'off'", "on")
        finding = find_finding(validate(recipe), "INVALID_SETTING_TYPE")
        assert finding["step"] == "flow[0].settings.proxy_mode"
        assert_message(
            r"^Setting 'proxy_mode' of block 'http-client' expects string, got boolean$",
            finding["problem"],
        )

    @pytest.mark.parametrize("choice", ["system", "explicit"])
    def test_a_system_or_explicit_proxy_mode_is_refused(self, choice: str) -> None:
        findings = validate(make_recipe([http_step(proxy_mode=choice)]))
        finding = find_finding(findings, "INVALID_ENUM_VALUE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.proxy_mode"
        assert_message(
            r"^Setting 'proxy_mode' of block 'http-client' must be one of: wave-setting, off$",
            finding["problem"],
        )

    def test_a_proxy_address_on_the_block_is_an_unknown_setting(self) -> None:
        findings = validate(make_recipe([http_step(proxy_url="http://proxy.local:3128")]))
        finding = find_finding(findings, "UNKNOWN_SETTING")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.proxy_url"
        assert_message(r"^Block 'http-client' has no setting 'proxy_url'$", finding["problem"])


class TestExpressionChecks:
    def test_invalid_expression_in_a_setting(self) -> None:
        findings = validate(make_recipe([http_step(timeout={"expr": "1 +"})]))
        finding = find_finding(findings, "INVALID_EXPRESSION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.timeout"
        assert finding["problem"].startswith("Expression is not valid: ")
        assert finding["fix"] is None

    def test_invalid_expression_inside_a_template(self) -> None:
        findings = validate(make_recipe([http_step(url="{{ 1 + }}/home")]))
        finding = find_finding(findings, "INVALID_EXPRESSION")
        assert finding["step"] == "flow[0].settings.url"
        assert finding["problem"].startswith("Expression is not valid: ")

    def test_invalid_expression_in_a_variable_declaration(self) -> None:
        text = make_recipe(
            [LOG_STEP],
            variables={"derived": {"type": "string", "expr": "1 +"}},
        )
        findings = validate(text)
        finding = find_finding(findings, "INVALID_EXPRESSION")
        assert finding["step"] == "variables.derived"

    def test_invalid_expression_in_a_condition(self) -> None:
        step = {"if": {"when": "1 +", "then": [LOG_STEP]}}
        findings = validate(make_recipe([step]))
        finding = find_finding(findings, "INVALID_EXPRESSION")
        assert finding["step"] == "flow[0]"

    def test_blocked_expression_pattern_is_an_error(self) -> None:
        findings = validate(make_recipe([http_step(timeout={"expr": "__import__('os')"})]))
        finding = find_finding(findings, "INVALID_EXPRESSION")
        assert finding["problem"].startswith("Expression is not valid: ")

    def test_undefined_variable_reference_is_not_a_stage1_error(self) -> None:
        # Stage 1 does no variable-reference analysis; the platform's
        # UNDECLARED_VARIABLE (stage 2) owns reference checking.
        findings = validate(make_recipe([http_step(timeout={"expr": "missing_var * 10"})]))
        assert findings == []


class TestCaptureCatalog:
    def test_unknown_capture_output(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"nope": "target"},
        }
        findings = validate(make_recipe([step]))
        finding = find_finding(findings, "UNKNOWN_CAPTURE_OUTPUT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].capture.nope"
        assert finding["problem"] == "Block 'http-client' has no output 'nope' to capture"
        assert finding["fix"] == f"Valid outputs: {HTTP_OUTPUTS_SORTED}"

    def test_known_capture_output_is_clean(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "code"},
        }
        assert validate(make_recipe([step])) == []

    def test_illegal_capture_target_name(self) -> None:
        """A capture target is a variable name; the save pipeline would rename it."""
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "bad target name"},
        }
        findings = validate(make_recipe([step]))
        finding = find_finding(findings, "INVALID_VARIABLE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].capture.status_code"
        assert finding["problem"] == (
            "Invalid capture target name: 'bad target name' (must match [a-zA-Z_][a-zA-Z0-9_]*)"
        )
        assert finding["fix"] == "Rename the capture target"


class TestProfileCatalog:
    def test_unknown_profile(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "profiles": [{"profile": "ghost", "alias": "cred", "fields": ["username"]}],
        }
        findings = validate(make_recipe([step]))
        finding = find_finding(findings, "UNKNOWN_PROFILE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Profile 'ghost' was not found"
        assert finding["fix"] == "Use the list_profiles tool for available profiles"

    def test_existing_profile_passes(self) -> None:
        create_profile("staging-creds")
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "profiles": [{"profile": "staging-creds", "alias": "cred", "fields": ["username"]}],
        }
        assert validate(make_recipe([step])) == []

    def test_binding_without_a_profile_name_is_skipped(self) -> None:
        step = dict(LOG_STEP, profiles=[{"alias": "cred", "fields": ["username"]}])
        assert validate(make_recipe([step])) == []

    def test_binding_whose_fields_are_not_a_list_is_skipped(self) -> None:
        create_profile("loose-fields")
        step = dict(LOG_STEP, profiles=[{"profile": "loose-fields", "fields": "username"}])
        assert validate(make_recipe([step])) == []

    def test_unknown_profile_field(self) -> None:
        """Binding a field the profile does not define fails only at run time today."""
        create_profile("field-creds")
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "profiles": [{"profile": "field-creds", "alias": "cred", "fields": ["no_such_field"]}],
        }
        findings = validate(make_recipe([step]))
        finding = find_finding(findings, "UNKNOWN_PROFILE_FIELD")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == ("Profile 'field-creds' has no field 'no_such_field'")
        assert finding["fix"] == "Valid fields: password, username"

    def test_a_typed_profile_binds_the_fields_its_environments_hold(self) -> None:
        from tests.conftest import TEST_ENVIRONMENT_ID
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile(
            "orders-db",
            "database",
            environment_values={
                TEST_ENVIRONMENT_ID: {"host": "db.local", "port": 5432, "database": "orders"}
            },
        )
        bound = [{"profile": "orders-db", "alias": "db", "fields": ["host", "port"]}]
        assert validate(make_recipe([dict(LOG_STEP, profiles=bound)])) == []

        wrong = [{"profile": "orders-db", "alias": "db", "fields": ["hostname"]}]
        finding = find_finding(
            validate(make_recipe([dict(LOG_STEP, profiles=wrong)])), "UNKNOWN_PROFILE_FIELD"
        )
        assert (finding["problem"], finding["fix"]) == (
            "Profile 'orders-db' has no field 'hostname'",
            "Valid fields: database, host, port",
        )

    def test_a_custom_profile_binds_the_fields_of_every_environment(self) -> None:
        from tests.conftest import TEST_ENVIRONMENT_ID
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile(
            "api-creds",
            "custom",
            config={"region": "eu"},
            environment_values={TEST_ENVIRONMENT_ID: {"token": "t-1"}},
        )
        bound = [{"profile": "api-creds", "alias": "api", "fields": ["region", "token"]}]
        assert validate(make_recipe([dict(LOG_STEP, profiles=bound)])) == []


class TestConstructShape:
    def test_if_without_then_is_malformed(self) -> None:
        findings = compile_findings(make_recipe([{"if": {"when": "x == 1"}}]))
        finding = find_finding(findings, "INVALID_CONSTRUCT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"].startswith("'if' construct is malformed: ")
        assert finding["fix"] is None

    def test_condition_must_be_string_or_comparison_mapping(self) -> None:
        findings = compile_findings(make_recipe([{"if": {"when": 42, "then": [LOG_STEP]}}]))
        finding = find_finding(findings, "INVALID_CONDITION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == (
            "Condition must be an expression string or a comparison mapping"
        )
        assert finding["fix"] == 'Use "expr string" or {variable, operator, value}'

    def test_switch_case_condition_must_be_string_or_comparison_mapping(self) -> None:
        flow = [{"switch": {"cases": [{"when": 42, "steps": [LOG_STEP]}]}}]
        finding = find_finding(compile_findings(make_recipe(flow)), "INVALID_CONDITION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == (
            "Condition must be an expression string or a comparison mapping"
        )
        assert finding["fix"] == 'Use "expr string" or {variable, operator, value}'

    def test_switch_with_cases_only_is_clean(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "1 == 1", "steps": [LOG_STEP]},
                        {"when": COMPARISON, "steps": [LOG_STEP]},
                    ]
                }
            },
            LOG_STEP,
        ]
        assert codes(compile_findings(make_recipe(flow))) == []

    def test_switch_with_cases_and_a_default_is_clean(self) -> None:
        flow = [
            {
                "switch": {
                    "label": "Route by status",
                    "cases": [{"when": "1 == 1", "steps": [LOG_STEP]}],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        assert codes(compile_findings(make_recipe(flow))) == []

    def test_switch_with_a_non_breaking_case_is_clean(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "1 == 1", "steps": [LOG_STEP], "break": False},
                        {"when": "2 == 2", "steps": [LOG_STEP], "break": True},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        assert codes(compile_findings(make_recipe(flow))) == []

    def test_a_well_formed_switch_emits_no_expression_finding(self) -> None:
        """No shape of a valid switch may be expression-checked into a finding."""
        # Guard: the removed 'on' key must not be expression-checked as an empty string.
        flows: list[list[Any]] = [
            [{"switch": {"cases": [{"when": "1 == 1", "steps": [LOG_STEP]}]}}, LOG_STEP],
            [
                {
                    "switch": {
                        "label": "Route by status",
                        "cases": [
                            {"when": COMPARISON, "steps": [LOG_STEP], "break": False},
                            {"when": "2 == 2", "steps": [LOG_STEP]},
                        ],
                        "default": [LOG_STEP],
                    }
                },
                LOG_STEP,
            ],
        ]
        for flow in flows:
            findings = compile_findings(make_recipe(flow))
            spurious = [f for f in findings if f["code"] == "INVALID_EXPRESSION"]
            assert spurious == [], f"switch emitted a spurious expression finding: {spurious!r}"

    def test_duplicate_local_function_names(self) -> None:
        functions = [
            {"name": "dup", "inputs": [], "outputs": [], "flow": [LOG_STEP]},
            {"name": "dup", "inputs": [], "outputs": [], "flow": [LOG_STEP]},
        ]
        findings = compile_findings(make_recipe([LOG_STEP], functions=functions))
        finding = find_finding(findings, "DUPLICATE_FUNCTION")
        assert finding["severity"] == "error"
        assert finding["step"] == "functions[dup]"
        assert finding["problem"] == "Local function 'dup' is defined more than once"
        assert finding["fix"] == "Rename one of the definitions"


class TestWaitUntilConstruct:
    """`wait_until` is a container step, never a leaf."""

    WAIT_VARIABLES: dict[str, Any] = {"pod_phase": {"type": "string", "value": ""}}

    def _findings(self, value: dict[str, Any]) -> list[dict[str, Any]]:
        return compile_findings(make_recipe([{"wait_until": value}], variables=self.WAIT_VARIABLES))

    def test_a_well_formed_retry_wait_is_clean(self) -> None:
        findings = self._findings(
            {
                "that": ["pod_phase == 'Running'"],
                "timeout": 30000,
                "interval": 250,
                "message": "gave up",
                "fail_current_scope": True,
                "retry": [LOG_STEP],
                "capture": {"passed": "ready", "elapsed": "waited"},
            }
        )
        assert [f for f in findings if f["severity"] == "error"] == []

    def test_a_well_formed_watch_wait_is_clean(self) -> None:
        findings = self._findings({"that": ["pod_phase == 'Running'"], "timeout": 30000})
        assert [f for f in findings if f["severity"] == "error"] == []

    def test_an_invalid_condition_expression_is_reported(self) -> None:
        findings = self._findings({"that": ["pod_phase =="], "timeout": 1})
        assert "INVALID_EXPRESSION" in codes(findings)

    def test_a_condition_that_is_neither_expression_nor_comparison_is_reported(self) -> None:
        findings = self._findings({"that": [42], "timeout": 1})
        assert "INVALID_CONDITION" in codes(findings)

    def test_a_comparison_condition_is_accepted(self) -> None:
        findings = compile_findings(
            make_recipe(
                [{"wait_until": {"that": [COMPARISON], "timeout": 1}}],
                variables={"transport": {"type": "string", "value": "TCP"}},
            )
        )
        assert [f for f in findings if f["severity"] == "error"] == []

    def test_capturing_an_output_the_wait_does_not_have_is_gated(self) -> None:
        findings = self._findings(
            {"that": ["pod_phase == 'Running'"], "timeout": 1, "capture": {"timedOut": "gave_up"}}
        )
        finding = find_finding(findings, "UNKNOWN_CAPTURE_OUTPUT")
        assert finding["problem"] == "Block 'wait-until' has no output 'timedOut' to capture"
        assert finding["fix"] == "Valid outputs: elapsed, passed"

    def test_both_declared_outputs_capture_cleanly(self) -> None:
        findings = self._findings(
            {
                "that": ["pod_phase == 'Running'"],
                "timeout": 1,
                "capture": {"passed": "ready", "elapsed": "waited"},
            }
        )
        assert "UNKNOWN_CAPTURE_OUTPUT" not in codes(findings)

    def test_a_retry_lane_step_is_validated_like_any_other_flow_step(self) -> None:
        findings = self._findings(
            {"that": ["pod_phase == 'Running'"], "timeout": 1, "retry": [{"block": "not-a-block"}]}
        )
        assert "UNKNOWN_BLOCK" in codes(findings)

    def test_the_condition_leaf_form_is_refused(self) -> None:
        findings = self._findings({"condition": "pod_phase == 'Running'", "timeout": 30000})
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["problem"] == "Unknown key 'condition' on a 'wait_until' construct"

    def test_a_poll_interval_key_is_refused(self) -> None:
        findings = self._findings(
            {"that": ["pod_phase == 'Running'"], "timeout": 1, "poll_interval": 1000}
        )
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["problem"] == "Unknown key 'poll_interval' on a 'wait_until' construct"

    def test_the_accepted_key_set_is_listed_in_the_fix(self) -> None:
        findings = self._findings({"that": ["1 == 1"], "timeout": 1, "nope": 1})
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["fix"] == (
            "Valid keys: capture, fail_current_scope, interval, label, message, retry, "
            "that, timeout"
        )


class TestMultipleFindings:
    def test_all_problems_are_reported_in_one_pass(self) -> None:
        flow = [
            {"block": "no-such-block"},
            http_step(lol=1),
            {"block": register_stub_plugin()},
        ]
        findings = validate(make_recipe(flow))
        assert codes(findings) == ["UNKNOWN_BLOCK", "UNKNOWN_SETTING", "STUB_BLOCK"]


class TestMalformedConstructShapes:
    """Every construct-shape rejection path."""

    def _malformed(self, flow: list[Any], fragment: str) -> None:
        finding = find_finding(compile_findings(make_recipe(flow)), "INVALID_CONSTRUCT")
        assert finding["problem"].endswith(fragment)

    @pytest.mark.parametrize("name", [None, "", "   "], ids=["null", "empty", "blank"])
    def test_a_function_step_without_a_function_name(self, name: Any) -> None:
        findings = compile_findings(make_recipe([{"function": name}]))
        assert find_finding(findings, "INVALID_CONSTRUCT") == {
            "step": "flow[0]",
            "code": "INVALID_CONSTRUCT",
            "severity": "error",
            "problem": "'function' step is malformed: a function name is required",
            "fix": None,
        }

    def test_elif_entry_without_a_then_list(self) -> None:
        flow = [{"if": {"when": "1 == 1", "then": [LOG_STEP], "elif": [{"when": "2 == 2"}]}}]
        self._malformed(flow, "each elif entry needs 'when' and a 'then' list")

    def test_switch_that_is_not_a_mapping(self) -> None:
        self._malformed(
            [{"switch": "everything"}],
            "'switch' construct is malformed: a 'cases' list is required",
        )

    def test_switch_without_a_cases_list(self) -> None:
        self._malformed(
            [{"switch": {}}], "'switch' construct is malformed: a 'cases' list is required"
        )

    def test_switch_whose_cases_are_not_a_list(self) -> None:
        self._malformed(
            [{"switch": {"cases": "everything"}}],
            "'switch' construct is malformed: a 'cases' list is required",
        )

    def test_switch_with_an_empty_cases_list(self) -> None:
        self._malformed(
            [{"switch": {"cases": []}}],
            "'switch' construct is malformed: at least one case is required",
        )

    def test_switch_case_that_is_not_a_mapping(self) -> None:
        self._malformed(
            [{"switch": {"cases": ["always"]}}],
            "'switch' construct is malformed: each case needs 'when' and a 'steps' list",
        )

    def test_switch_case_without_a_when(self) -> None:
        self._malformed(
            [{"switch": {"cases": [{"steps": [LOG_STEP]}]}}],
            "'switch' construct is malformed: each case needs 'when' and a 'steps' list",
        )

    def test_switch_case_without_a_steps_list(self) -> None:
        self._malformed(
            [{"switch": {"cases": [{"when": "1 == 1", "steps": "one"}]}}],
            "'switch' construct is malformed: each case needs 'when' and a 'steps' list",
        )

    def test_switch_case_with_a_non_boolean_break(self) -> None:
        flow = [{"switch": {"cases": [{"when": "1 == 1", "steps": [LOG_STEP], "break": "yes"}]}}]
        self._malformed(flow, "'switch' construct is malformed: 'break' must be true or false")

    def test_switch_with_a_default_that_is_not_a_list(self) -> None:
        flow = [{"switch": {"cases": [{"when": "1 == 1", "steps": [LOG_STEP]}], "default": "log"}}]
        self._malformed(flow, "'switch' construct is malformed: 'default' must be a list of steps")

    def test_try_without_a_steps_list(self) -> None:
        self._malformed([{"try": {"catch": [LOG_STEP]}}], "a 'steps' list is required")

    def test_assert_without_a_that_list(self) -> None:
        self._malformed([{"assert": {}}], "a non-empty 'that' list is required")

    def test_remote_without_a_body_list(self) -> None:
        self._malformed([{"remote": {"settings": {}}}], "a 'body' list of steps is required")

    def test_loop_without_a_body_list(self) -> None:
        self._malformed([{"for": {"count": 1}}], "a 'body' list of steps is required")

    def test_for_without_count_or_range(self) -> None:
        self._malformed([{"for": {"body": [LOG_STEP]}}], "either 'count' or 'range' is required")

    def test_for_each_without_a_collection(self) -> None:
        self._malformed([{"for_each": {"body": [LOG_STEP]}}], "a 'collection' is required")

    def test_while_without_conditions(self) -> None:
        self._malformed([{"while": {"body": [LOG_STEP]}}], "'conditions' is required")

    def test_wait_until_without_a_that_list(self) -> None:
        self._malformed([{"wait_until": {"timeout": 30000}}], "a non-empty 'that' list is required")

    def test_wait_until_with_an_empty_that_list(self) -> None:
        self._malformed(
            [{"wait_until": {"that": [], "timeout": 30000}}],
            "a non-empty 'that' list is required",
        )

    def test_wait_until_with_a_scalar_that(self) -> None:
        # `that` is Assert's vocabulary and Assert's is always a list.
        self._malformed(
            [{"wait_until": {"that": "ready", "timeout": 30000}}],
            "a non-empty 'that' list is required",
        )

    def test_wait_until_without_a_timeout(self) -> None:
        self._malformed([{"wait_until": {"that": ["1 == 1"]}}], "a 'timeout' is required")

    def test_wait_until_that_is_not_a_mapping(self) -> None:
        self._malformed([{"wait_until": "ready"}], "a non-empty 'that' list is required")

    def test_wait_until_with_a_retry_that_is_not_a_list(self) -> None:
        flow = [{"wait_until": {"that": ["1 == 1"], "timeout": 1, "retry": LOG_STEP}}]
        self._malformed(flow, "'retry' must be a list of steps")

    def test_set_without_a_mapping(self) -> None:
        self._malformed([{"set": []}], "a mapping of variable names to values is required")

    def test_non_dict_variable_declaration(self) -> None:
        findings = validate(make_recipe([LOG_STEP], variables={"bare": 5}))
        finding = find_finding(findings, "INVALID_VARIABLE_DECLARATION")
        assert finding["step"] == "variables.bare"


class TestVariableValueTyping:
    """A declared type must describe the literal it carries, exactly as a block
    setting's declared type must describe its value."""

    def test_integer_variable_holding_a_string(self) -> None:
        variables = {"attempts": {"type": "integer", "value": "definitely not a number"}}
        findings = validate(make_recipe([LOG_STEP], variables=variables))
        finding = find_finding(findings, "INVALID_VARIABLE_VALUE")
        assert finding["severity"] == "error"
        assert finding["step"] == "variables.attempts"
        assert finding["problem"] == "Variable 'attempts' expects integer, got string"
        assert finding["fix"] == "Provide an integer value, or change the declared type"

    def test_boolean_variable_holding_an_integer(self) -> None:
        variables = {"enabled": {"type": "boolean", "value": 1}}
        findings = validate(make_recipe([LOG_STEP], variables=variables))
        assert find_finding(findings, "INVALID_VARIABLE_VALUE")["step"] == "variables.enabled"

    def test_matching_types_are_clean(self) -> None:
        variables = {
            "name": {"type": "string", "value": "wave"},
            "attempts": {"type": "integer", "value": 3},
            "ratio": {"type": "float", "value": 0.5},
            "enabled": {"type": "boolean", "value": True},
            "items": {"type": "array", "value": [1, 2]},
            "lookup": {"type": "map", "value": {"k": "v"}},
            "rows": {"type": "table", "value": [{"host": "localhost"}]},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_a_table_in_its_stored_columns_rows_form_is_clean(self) -> None:
        """A readback carries a table in its stored form, columns typed (REQ-3.5.5.4)."""
        variables = {
            "grid": {
                "type": "table",
                "value": {
                    "columns": [
                        {"name": "id", "type": "integer"},
                        {"name": "price", "type": "float"},
                        {"name": "active", "type": "boolean"},
                    ],
                    "rows": [["7", "2.50", True], [None, "3", False]],
                },
            }
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    @pytest.mark.parametrize(
        "value",
        [
            {"columns": [{"name": "id", "type": "uuid"}], "rows": []},
            {"columns": [{"type": "integer"}], "rows": []},
            {"columns": [{"name": "id", "type": "integer"}], "rows": [["seven"]]},
            {"columns": 5, "rows": []},
            {"rows": []},
        ],
    )
    def test_a_map_that_is_not_a_table_is_refused_for_a_table(self, value: Any) -> None:
        variables = {"grid": {"type": "table", "value": value}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_VARIABLE_VALUE"
        )
        assert finding["problem"] == "Variable 'grid' expects table, got map"

    def test_text_is_refused_for_a_table(self) -> None:
        variables = {"grid": {"type": "table", "value": "id,name"}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_VARIABLE_VALUE"
        )
        assert finding["problem"] == "Variable 'grid' expects table, got string"

    def test_a_null_value_is_clean_for_every_type(self) -> None:
        """Null is a value of every type (REQ-3.1.3.20)."""
        variables = {
            f"v_{name}": {"type": name, "value": None}
            for name in ("string", "integer", "float", "boolean", "array", "map", "table")
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_a_null_element_is_clean_under_any_declared_element_type(self) -> None:
        variables = {
            "items": {
                "type": "array",
                "value": [None, 1],
                "element_types": ["boolean", "integer"],
            },
            "lookup": {"type": "map", "value": {"z": None}, "element_types": {"z": "float"}},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_an_integer_is_accepted_for_a_float(self) -> None:
        variables = {"ratio": {"type": "float", "value": 2}}
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_expression_variables_are_not_value_checked(self) -> None:
        """An expression's type is only known once it evaluates."""
        variables = {
            "base": {"type": "integer", "value": 1},
            "derived": {"type": "integer", "expr": "base + 1"},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_non_dict_profile_binding_entries_are_skipped(self) -> None:
        step = dict(LOG_STEP, profiles=[42])
        assert codes(validate(make_recipe([step]))) == []

    def test_numeric_expression_value_is_stringified(self) -> None:
        assert codes(validate(make_recipe([http_step(timeout={"expr": 5})]))) == []

    def test_numeric_setting_value_reports_its_recipe_type(self) -> None:
        findings = validate(make_recipe([http_step(url=2024)]))
        finding = find_finding(findings, "INVALID_SETTING_TYPE")
        assert "got integer" in finding["problem"]


class TestTypeHelpers:
    """Direct pins for the pure type helpers backing the settings checks."""

    def test_recipe_type_of_none_and_exotic_values(self) -> None:
        import datetime

        from wavecore.core.recipes.validator import _recipe_type_of

        assert _recipe_type_of(None) == "null"
        assert _recipe_type_of(datetime.date(2026, 1, 1)) == "date"

    def test_type_accepts_matrix(self) -> None:
        from wavecore.core.recipes.validator import _type_accepts

        assert _type_accepts("boolean", True) is True
        assert _type_accepts("boolean", 1) is False
        assert _type_accepts("array", [1]) is True
        assert _type_accepts("table", [1]) is True
        assert _type_accepts("table", "no") is False
        assert _type_accepts("map", {}) is True
        assert _type_accepts("map", []) is False
        assert _type_accepts("mystery-type", object()) is True

    def test_null_setting_value_is_skipped(self) -> None:
        findings = validate(
            make_recipe([{"block": "log", "settings": {"message": "hi", "level": None}}])
        )
        assert codes(findings) == []


class TestSecretDerivationWarning:
    """Masking protects a secret's exact bytes, not values derived from it. That
    is deliberate, so the author is warned rather than blocked."""

    def test_expression_consuming_a_secret_warns(self) -> None:
        variables = {
            "token": {"type": "string", "secret": True, "value": "hunter2"},
            "header": {"type": "string", "expr": "'Bearer ' + token"},
        }
        findings = validate(make_recipe([LOG_STEP], variables=variables))
        finding = find_finding(findings, "SECRET_DERIVED_VALUE")
        assert finding["severity"] == "warning"
        assert finding["step"] == "variables.header"
        assert finding["problem"] == (
            "Expression for 'header' reads secret 'token'; a derived value is not masked"
        )
        assert finding["fix"] == "Mark 'header' secret: true, or avoid logging it"

    def test_a_setting_expression_consuming_a_secret_warns(self) -> None:
        variables = {"token": {"type": "string", "secret": True, "value": "hunter2"}}
        step = {"block": "log", "settings": {"message": {"expr": "'tok ' + token"}}}
        findings = validate(make_recipe([step], variables=variables))
        finding = find_finding(findings, "SECRET_DERIVED_VALUE")
        assert finding["severity"] == "warning"
        assert finding["step"] == "flow[0].settings.message"

    def test_a_template_consuming_a_secret_warns(self) -> None:
        variables = {"token": {"type": "string", "secret": True, "value": "hunter2"}}
        step = {"block": "log", "settings": {"message": "tok {{ token }}"}}
        findings = validate(make_recipe([step], variables=variables))
        assert find_finding(findings, "SECRET_DERIVED_VALUE")["severity"] == "warning"

    def test_a_secret_derived_variable_marked_secret_is_clean(self) -> None:
        variables = {
            "token": {"type": "string", "secret": True, "value": "hunter2"},
            "header": {"type": "string", "secret": True, "expr": "'Bearer ' + token"},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    def test_an_expression_over_plain_variables_is_clean(self) -> None:
        variables = {
            "base": {"type": "string", "value": "http://x"},
            "url": {"type": "string", "expr": "base + '/api'"},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    @staticmethod
    def _bind_token(secret_input: bool) -> str:
        variables = {"token": {"type": "string", "secret": True, "value": "hunter2"}}
        functions = [
            {
                "name": "send",
                "inputs": [{"name": "tok", "type": "string", "secret": secret_input}],
                "outputs": [],
                "flow": [{"block": "log", "settings": {"message": {"expr": "tok"}}}],
            }
        ]
        flow = [{"function": "send", "settings": {"tok": {"expr": "token + '-x'"}}}]
        return make_recipe(flow, variables=variables, functions=functions)

    def test_a_secret_given_to_a_secret_input_is_clean(self) -> None:
        # Per SECUI-10: a secret input masks any value passed in.
        assert "SECRET_DERIVED_VALUE" not in codes(validate(self._bind_token(True)))

    def test_a_secret_given_to_a_plain_input_warns(self) -> None:
        finding = find_finding(validate(self._bind_token(False)), "SECRET_DERIVED_VALUE")
        assert finding["severity"] == "warning"
        assert finding["step"] == "flow[0].settings.tok"
        assert_message(
            r"^Expression in this setting reads secret 'token'; a derived value is not masked$",
            finding["problem"],
        )

    @pytest.mark.parametrize(
        "password",
        [{"expr": "token + '-x'"}, "pre-{{ token }}"],
        ids=["expression", "template"],
    )
    def test_a_secret_read_by_a_secret_block_setting_is_clean(self, password: Any) -> None:
        variables = {"token": {"type": "string", "secret": True, "value": "hunter2"}}
        step = http_step(
            auth_enabled=True, auth_mode="basic", auth_username="u", auth_password=password
        )
        findings = validate(make_recipe([step], variables=variables))
        assert "SECRET_DERIVED_VALUE" not in codes(findings)

    def test_a_secret_read_by_a_plain_block_setting_warns(self) -> None:
        variables = {"token": {"type": "string", "secret": True, "value": "hunter2"}}
        step = http_step(auth_enabled=True, auth_mode="basic", auth_username={"expr": "token"})
        finding = find_finding(
            validate(make_recipe([step], variables=variables)), "SECRET_DERIVED_VALUE"
        )
        assert finding["step"] == "flow[0].settings.auth_username"


class TestDeclaredMinimums:
    """A literal the runtime will always reject is caught at author time, using
    the block's own declared minimum rather than a rule hardcoded here."""

    def test_negative_delay_is_rejected(self) -> None:
        findings = validate(make_recipe([{"delay": -100}]))
        finding = find_finding(findings, "SETTING_BELOW_MINIMUM")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.duration"
        assert finding["problem"] == (
            "Setting 'duration' of block 'delay' must be at least 1, got -100"
        )
        assert finding["fix"] == "Provide a value of at least 1"

    def test_zero_delay_is_rejected(self) -> None:
        findings = validate(make_recipe([{"delay": 0}]))
        assert (
            find_finding(findings, "SETTING_BELOW_MINIMUM")["step"] == "flow[0].settings.duration"
        )

    def test_a_positive_delay_is_clean(self) -> None:
        assert validate(make_recipe([{"delay": 500}])) == []

    def test_an_expression_delay_is_not_range_checked(self) -> None:
        """Only a literal can be range-checked; an expression's value is unknown."""
        variables = {"wait": {"type": "integer", "value": 5}}
        recipe = make_recipe([{"delay": {"duration": {"expr": "wait * 10"}}}], variables=variables)
        assert validate(recipe) == []


class TestDeclaredOutputs:
    """A setting may declare extra outputs of its own: a script variable is captured
    like any other output once it is listed (SHRUN-6, REQ-3.4.1.1)."""

    def test_capturing_a_declared_script_variable_is_clean(self) -> None:
        step = shell_script_step(capture={"COUNT": "pod_count"}, script_variables=["COUNT"])
        assert validate(make_recipe([step])) == []

    def test_capturing_an_undeclared_script_variable_is_gated(self) -> None:
        step = shell_script_step(capture={"COUNT": "pod_count"})
        finding = find_finding(validate(make_recipe([step])), "UNKNOWN_CAPTURE_OUTPUT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].capture.COUNT"
        assert_message(
            r"^Block 'shell-script' has no output 'COUNT' to capture$", finding["problem"]
        )
        assert_message(
            r"^Valid outputs: error, exit_code, reason, stderr, stdout, success\. "
            r"Declare a new one in settings\.script_variables$",
            finding["fix"],
        )

    def test_a_declared_name_joins_the_valid_output_list(self) -> None:
        step = shell_script_step(capture={"NOPE": "target"}, script_variables=["COUNT"])
        finding = find_finding(validate(make_recipe([step])), "UNKNOWN_CAPTURE_OUTPUT")
        assert_message(
            r"^Valid outputs: COUNT, error, exit_code, reason, stderr, stdout, success\. "
            r"Declare a new one in settings\.script_variables$",
            finding["fix"],
        )

    def test_a_block_without_a_declaring_setting_keeps_the_plain_fix(self) -> None:
        step = shell_exec_step(capture={"COUNT": "pod_count"})
        finding = find_finding(validate(make_recipe([step])), "UNKNOWN_CAPTURE_OUTPUT")
        assert finding["step"] == "flow[0].capture.COUNT"
        assert_message(r"^Block 'shell-exec' has no output 'COUNT' to capture$", finding["problem"])
        assert_message(
            r"^Valid outputs: error, exit_code, reason, stderr, stdout, success$", finding["fix"]
        )

    def test_an_invalid_declared_name_is_gated(self) -> None:
        step = shell_script_step(script_variables=["1BAD"])
        finding = find_finding(validate(make_recipe([step])), "INVALID_DECLARED_OUTPUT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.script_variables[0]"
        assert_message(
            r"^Setting 'script_variables' of block 'shell-script' declares an invalid "
            r"output name: '1BAD' \(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
            finding["problem"],
        )
        assert finding["fix"] == "Rename it"

    def test_a_non_string_declared_item_is_gated(self) -> None:
        step = shell_script_step(script_variables=[3])
        finding = find_finding(validate(make_recipe([step])), "INVALID_DECLARED_OUTPUT")
        assert finding["step"] == "flow[0].settings.script_variables[0]"
        assert_message(
            r"^Setting 'script_variables' of block 'shell-script' declares an invalid "
            r"output name: '3' \(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
            finding["problem"],
        )

    def test_a_trailing_newline_fails_the_name_rule(self) -> None:
        """The name rule is a full match, so a newline is not the end of the name."""
        step = shell_script_step(script_variables=["X\n"])
        finding = find_finding(validate(make_recipe([step])), "INVALID_DECLARED_OUTPUT")
        assert finding["step"] == "flow[0].settings.script_variables[0]"
        assert_message(
            r"^Setting 'script_variables' of block 'shell-script' declares an invalid "
            r"output name: 'X\n' \(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
            finding["problem"],
        )

    def test_a_declared_name_that_is_already_an_output_is_gated(self) -> None:
        step = shell_script_step(script_variables=["stdout"])
        finding = find_finding(validate(make_recipe([step])), "DECLARED_OUTPUT_CLASH")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.script_variables[0]"
        assert_message(
            r"^Setting 'script_variables' of block 'shell-script' declares 'stdout', "
            r"which is already an output of the block$",
            finding["problem"],
        )
        assert_message(
            r"^Choose a name other than: error, exit_code, reason, stderr, stdout, success$",
            finding["fix"],
        )

    def test_a_repeated_declared_name_is_reported_on_the_repeat(self) -> None:
        step = shell_script_step(script_variables=["A", "A"])
        finding = find_finding(validate(make_recipe([step])), "DUPLICATE_DECLARED_OUTPUT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.script_variables[1]"
        assert_message(
            r"^Setting 'script_variables' of block 'shell-script' declares 'A' more than once$",
            finding["problem"],
        )
        assert finding["fix"] == "Remove the repeated name"

    def test_an_expression_setting_declares_nothing(self) -> None:
        step = shell_script_step(capture={"COUNT": "pod_count"}, script_variables={"expr": "names"})
        findings = validate(make_recipe([step]))
        assert "INVALID_DECLARED_OUTPUT" not in codes(findings)
        assert find_finding(findings, "UNKNOWN_CAPTURE_OUTPUT")["step"] == "flow[0].capture.COUNT"

    def test_a_command_setting_is_an_unknown_setting(self) -> None:
        step = shell_script_step(command="uname -a")
        finding = find_finding(validate(make_recipe([step])), "UNKNOWN_SETTING")
        assert finding["step"] == "flow[0].settings.command"
        assert_message(r"^Block 'shell-script' has no setting 'command'$", finding["problem"])

    def test_a_timeout_below_the_declared_minimum_is_gated(self) -> None:
        step = shell_script_step(timeout=0)
        finding = find_finding(validate(make_recipe([step])), "SETTING_BELOW_MINIMUM")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.timeout"
        assert_message(
            r"^Setting 'timeout' of block 'shell-script' must be at least 1, got 0$",
            finding["problem"],
        )


class TestNestedExpressions:
    """An expression inside a map entry or an argument row is a real expression,
    reported at its own path (SHRUN-4, REQ-3.4.1.1)."""

    def test_an_invalid_expression_in_a_map_entry(self) -> None:
        step = shell_script_step(input_vars={"X": {"expr": "1 +"}})
        finding = find_finding(validate(make_recipe([step])), "INVALID_EXPRESSION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.input_vars.X"
        assert finding["problem"].startswith("Expression is not valid: ")

    def test_an_invalid_expression_in_an_argument_row(self) -> None:
        step = shell_script_step(arguments=[{"value": "a"}, {"value": {"expr": "1 +"}}])
        finding = find_finding(validate(make_recipe([step])), "INVALID_EXPRESSION")
        assert finding["step"] == "flow[0].settings.arguments[1].value"
        assert finding["problem"].startswith("Expression is not valid: ")

    def test_an_invalid_expression_in_a_shell_exec_input_variable(self) -> None:
        step = shell_exec_step(env_vars={"X": {"expr": "1 +"}})
        finding = find_finding(validate(make_recipe([step])), "INVALID_EXPRESSION")
        assert finding["step"] == "flow[0].settings.env_vars.X"

    def test_a_valid_nested_expression_is_clean(self) -> None:
        variables = {"replicas": {"type": "integer", "value": 3}}
        step = shell_script_step(
            input_vars={"REPLICAS": {"expr": "replicas * 2"}},
            arguments=[{"value": {"expr": "replicas"}}],
        )
        assert validate(make_recipe([step], variables=variables)) == []

    def test_a_nested_expression_reading_a_secret_warns(self) -> None:
        variables = {"tok": {"type": "string", "secret": True, "value": "hunter2"}}
        step = shell_script_step(input_vars={"X": {"expr": "tok + '1'"}})
        findings = validate(make_recipe([step], variables=variables))
        finding = find_finding(findings, "SECRET_DERIVED_VALUE")
        assert finding["severity"] == "warning"
        assert finding["step"] == "flow[0].settings.input_vars.X"
        assert_message(
            r"^Expression in this setting reads secret 'tok'; a derived value is not masked$",
            finding["problem"],
        )


def sql_step(**settings: Any) -> dict[str, Any]:
    return {"block": "sql-client", "settings": settings}


NETWORK_CONNECTION: dict[str, Any] = {"host": "db", "database": "wave", "username": "wave"}


class TestSqlClientSteps:
    """A SQL step names only its own operation's rows; its conditional rows are never
    reported missing, and the generic type rules apply (REQ-3.4.1.6, SQL-1)."""

    @pytest.mark.parametrize(
        "settings",
        [
            pytest.param(
                {"operation": "run_sql", **NETWORK_CONNECTION, "sql": "SELECT 1"},
                id="run-sql-source",
            ),
            pytest.param(
                {
                    "operation": "run_sql",
                    "database_type": "mysql",
                    **NETWORK_CONNECTION,
                    "script_type": "file",
                    "sql_file": "/srv/sql/seed.sql",
                },
                id="run-sql-file",
            ),
            pytest.param(
                {"database_type": "sqlite", "file": "/data/app.db", "sql": "SELECT 1"},
                id="run-sql-sqlite-default-operation",
            ),
            pytest.param(
                {
                    "operation": "run_sql",
                    **NETWORK_CONNECTION,
                    "sql": {"expr": "'SELECT id FROM orders WHERE qty >= :min_qty'"},
                    "parameters": {"min_qty": 7},
                },
                id="run-sql-script-from-an-expression",
            ),
            pytest.param(
                {
                    "operation": "call_procedure",
                    "database_type": "oracle",
                    **NETWORK_CONNECTION,
                    "procedure": "app.p",
                    "arguments": {"a": 5},
                    "out_arguments": [{"value": "o"}],
                },
                id="call-procedure",
            ),
            pytest.param(
                {
                    "operation": "load_table",
                    "database_type": "sqlite",
                    "file": "/data/app.db",
                    "table": {"expr": "orders"},
                    "target_table": "orders",
                },
                id="load-table-sqlite-table-variable",
            ),
            pytest.param(
                {
                    "operation": "load_table",
                    "database_type": "mssql",
                    **NETWORK_CONNECTION,
                    "table": [{"id": 1, "qty": 2}],
                    "target_table": "orders",
                    "mode": "add_or_replace",
                    "key_columns": "id, region",
                },
                id="load-table-inline-rows-and-key-columns",
            ),
        ],
    )
    def test_a_step_with_only_its_own_rows_is_clean(self, settings: dict[str, Any]) -> None:
        assert validate(make_recipe([sql_step(**settings)])) == []

    def test_stop_on_error_as_text_is_a_type_mismatch(self) -> None:
        step = sql_step(**NETWORK_CONNECTION, sql="SELECT 1", stop_on_error="yes")
        finding = find_finding(validate(make_recipe([step])), "INVALID_SETTING_TYPE")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].settings.stop_on_error"
        assert finding["problem"] == (
            "Setting 'stop_on_error' of block 'sql-client' expects boolean, got string"
        )
        assert finding["fix"] == "Provide a boolean value"

    def test_key_columns_as_a_list_is_a_type_mismatch(self) -> None:
        step = sql_step(
            operation="load_table",
            **NETWORK_CONNECTION,
            table={"expr": "orders"},
            target_table="orders",
            key_columns=["id"],
        )
        finding = find_finding(validate(make_recipe([step])), "INVALID_SETTING_TYPE")
        assert finding["step"] == "flow[0].settings.key_columns"
        assert finding["problem"] == (
            "Setting 'key_columns' of block 'sql-client' expects string, got array"
        )

    def test_a_literal_table_file_is_accepted(self) -> None:
        # The Table may name a CSV or Excel file instead of holding rows (SQL-7).
        step = sql_step(
            operation="load_table",
            **NETWORK_CONNECTION,
            table="/data/orders.csv",
            target_table="orders",
        )
        assert validate(make_recipe([step])) == []

    def test_an_operation_outside_its_values(self) -> None:
        step = sql_step(operation="connect", **NETWORK_CONNECTION)
        finding = find_finding(validate(make_recipe([step])), "INVALID_ENUM_VALUE")
        assert finding["step"] == "flow[0].settings.operation"
        assert finding["problem"] == (
            "Setting 'operation' of block 'sql-client' must be one of: "
            "run_sql, call_procedure, load_table"
        )


def opensearch_step(**settings: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"url": "https://opensearch.internal:9200", "index": "app-logs-*"}
    values.update(settings)
    return {"block": "opensearch", "settings": values}


OPENSEARCH_SETTINGS_SORTED = (
    "api_key, bearer_token, ca_cert, client_cert, client_key, connect_timeout, fields, from, "
    "group_by_field, group_by_time, index, max_results, mode, on_error, order, password, query, "
    "query_language, sort_by, stats, time_field, timeout, to, top_values, url, username, "
    "verify_ssl"
)


class TestOpensearchSteps:
    """An OpenSearch step is an implemented block with list rows for Fields and Stats, and the
    generic type, choice and bound rules apply (REQ-3.4.1.15, OS-1, OS-6, OS-7)."""

    def test_a_step_with_only_its_required_rows_is_clean(self) -> None:
        assert validate(make_recipe([opensearch_step()])) == []

    def test_the_block_is_not_a_stub(self) -> None:
        findings = validate(make_recipe([opensearch_step()]))

        assert "STUB_BLOCK" not in codes(findings)

    @pytest.mark.parametrize(
        "settings",
        [
            pytest.param(
                {
                    "mode": "search",
                    "from": "now-1h",
                    "to": "now/d",
                    "query_language": "dql",
                    "query": 'log.level: "ERROR" or message: "Batch complete"',
                    "fields": [{"value": "@timestamp"}, {"value": {"expr": "'message'"}}],
                    "max_results": 0,
                    "sort_by": "latency_ms",
                    "order": "asc",
                },
                id="search-with-fields-rows",
            ),
            pytest.param(
                {
                    "mode": "aggregate",
                    "from": 1758880800000,
                    "query_language": "query_dsl",
                    "query": {"term": {"service": "checkout"}},
                    "group_by_time": "none",
                    "group_by_field": "host.name",
                    "top_values": 1,
                    "stats": [
                        {"value": {"stat": "count"}},
                        {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
                        {"value": {"stat": "custom", "json": '{"max": {"field": "b"}}'}},
                        {"value": {"expr": "{'stat': 'sum', 'field': 'bytes'}"}},
                    ],
                },
                id="aggregate-with-stats-rows",
            ),
            pytest.param(
                {
                    "username": "reader",
                    "password": "os-password",
                    "api_key": "",
                    "bearer_token": "",
                    "verify_ssl": False,
                    "ca_cert": "/etc/ssl/lab-ca.pem",
                    "client_cert": "/etc/ssl/client.pem",
                    "client_key": "/etc/ssl/client.key",
                    "time_field": "event.created",
                    "timeout": 1,
                    "connect_timeout": 1,
                    "on_error": "record",
                },
                id="connection-and-failure-rows",
            ),
        ],
    )
    def test_a_step_with_its_own_rows_is_clean(self, settings: dict[str, Any]) -> None:
        assert validate(make_recipe([opensearch_step(**settings)])) == []

    def test_the_required_rows_are_named_in_row_order(self) -> None:
        findings = validate(make_recipe([{"block": "opensearch", "settings": {}}]))

        missing = [
            (item["step"], item["problem"], item["fix"])
            for item in findings
            if item["code"] == "MISSING_REQUIRED_SETTING"
        ]
        assert missing == [
            (
                "flow[0].settings.url",
                "Required setting 'url' is missing for block 'opensearch'",
                "Add settings.url",
            ),
            (
                "flow[0].settings.index",
                "Required setting 'index' is missing for block 'opensearch'",
                "Add settings.index",
            ),
        ]

    def test_an_unknown_setting_lists_every_row(self) -> None:
        finding = find_finding(validate(make_recipe([opensearch_step(size=10)])), "UNKNOWN_SETTING")

        assert finding["step"] == "flow[0].settings.size"
        assert finding["problem"] == "Block 'opensearch' has no setting 'size'"
        assert finding["fix"] == f"Valid settings: {OPENSEARCH_SETTINGS_SORTED}"

    @pytest.mark.parametrize(
        ("name", "value", "listed"),
        [
            ("mode", "count", "search, aggregate"),
            ("query_language", "lucene", "dql, query_dsl"),
            ("order", "newest", "desc, asc"),
            ("group_by_time", "2m", "none, 10s, 30s, 1m, 5m, 15m, 1h"),
            ("on_error", "ignore", "fail, record"),
        ],
    )
    def test_a_choice_outside_its_values(self, name: str, value: str, listed: str) -> None:
        finding = find_finding(
            validate(make_recipe([opensearch_step(**{name: value})])), "INVALID_ENUM_VALUE"
        )

        assert finding["step"] == f"flow[0].settings.{name}"
        assert finding["problem"] == (
            f"Setting '{name}' of block 'opensearch' must be one of: {listed}"
        )

    def test_stats_as_a_single_map_is_a_type_mismatch(self) -> None:
        step = opensearch_step(mode="aggregate", stats={"stat": "count"})

        finding = find_finding(validate(make_recipe([step])), "INVALID_SETTING_TYPE")

        assert finding["step"] == "flow[0].settings.stats"
        assert finding["problem"] == "Setting 'stats' of block 'opensearch' expects array, got map"

    def test_a_from_that_is_neither_text_nor_a_number_is_a_type_mismatch(self) -> None:
        finding = find_finding(
            validate(make_recipe([opensearch_step(**{"from": ["now-1h"]})])),
            "INVALID_SETTING_TYPE",
        )

        assert finding["problem"] == (
            "Setting 'from' of block 'opensearch' expects string or integer, got array"
        )

    def test_an_invalid_expression_in_a_stats_row(self) -> None:
        step = opensearch_step(
            mode="aggregate", stats=[{"value": {"stat": "count"}}, {"value": {"expr": "1 +"}}]
        )

        finding = find_finding(validate(make_recipe([step])), "INVALID_EXPRESSION")

        assert finding["step"] == "flow[0].settings.stats[1].value"
        assert finding["problem"].startswith("Expression is not valid: ")

    @pytest.mark.parametrize(
        ("name", "value", "minimum"),
        [
            ("max_results", -1, 0),
            ("top_values", 0, 1),
            ("timeout", 0, 1),
            ("connect_timeout", 0, 1),
        ],
    )
    def test_a_number_below_its_floor_is_gated(self, name: str, value: int, minimum: int) -> None:
        finding = find_finding(
            validate(make_recipe([opensearch_step(**{name: value})])), "SETTING_BELOW_MINIMUM"
        )

        assert finding["step"] == f"flow[0].settings.{name}"
        assert finding["problem"] == (
            f"Setting '{name}' of block 'opensearch' must be at least {minimum}, got {value}"
        )


ELEMENT_TYPES_FIX = (
    "Declare each element as one of: array, boolean, float, integer, map, string, "
    "and write it as that type"
)
STEP_ELEMENT_TYPES_FIX = (
    "Declare element types only for a typed map or list the step writes literally"
)


class TestDeclaredElementTypes:
    """element_types on variables, typed block settings and set rows (REQ-3.1.3.19)."""

    def test_declared_and_native_elements_are_clean(self) -> None:
        variables = {
            "limits": {
                "type": "map",
                "value": {"n": "16", "f": 1.5, "zip": "02134", "tags": "[1]"},
                "element_types": {"n": "integer", "zip": "string", "tags": "array"},
            },
            "ports": {
                "type": "array",
                "value": [8080, "1.0"],
                "element_types": ["integer", "float"],
            },
            "built": {"type": "map"},
        }
        flow = [
            {"set": {"built": {"n": "16"}}, "element_types": {"built": {"n": "integer"}}},
            sql_step(
                **NETWORK_CONNECTION,
                sql="SELECT 1",
                driver_options={"timeout": "16", "app": {"expr": "'wave'"}},
            )
            | {"element_types": {"driver_options": {"timeout": "integer"}}},
        ]
        assert validate(make_recipe(flow, variables=variables)) == []

    def test_an_element_that_does_not_fit_its_declared_type(self) -> None:
        variables = {
            "limits": {"type": "map", "value": {"zip": 2134}, "element_types": {"zip": "string"}},
        }
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["step"] == "variables.limits.element_types"
        assert finding["problem"] == "Variable 'limits': key 'zip' expects string, got integer"
        assert finding["fix"] == ELEMENT_TYPES_FIX

    def test_an_unknown_element_type(self) -> None:
        variables = {"ports": {"type": "array", "value": [1], "element_types": ["number"]}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["problem"] == (
            "Variable 'ports': unknown element type 'number' for item 0 "
            "(must be one of: array, boolean, float, integer, map, string)"
        )

    def test_element_types_on_a_scalar(self) -> None:
        variables = {"n": {"type": "integer", "value": 1, "element_types": {"a": "integer"}}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["step"] == "variables.n"
        assert finding["problem"] == (
            "Variable 'n' declares element_types without a map or list value"
        )
        assert finding["fix"] == "Give the variable a map or list value, or remove element_types"

    def test_element_types_without_a_value(self) -> None:
        variables = {"m": {"type": "map", "element_types": {"a": "integer"}}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["problem"] == (
            "Variable 'm' declares element_types without a map or list value"
        )

    def test_a_declared_scalar_number_may_be_its_exact_text(self) -> None:
        variables = {
            "attempts": {"type": "integer", "value": "1234567890123456789"},
            "ratio": {"type": "float", "value": "1.0"},
        }
        assert validate(make_recipe([LOG_STEP], variables=variables)) == []

    @pytest.mark.parametrize(
        ("declared", "written", "problem", "fix"),
        [
            pytest.param(
                "integer",
                "12345678901234567890",
                "allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                id="integer-text",
            ),
            pytest.param(
                "integer",
                "-12345678901234567890",
                "allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                id="integer-number",
            ),
            pytest.param(
                "float",
                "'1.2345678901234567890123456789'",
                "allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                id="float-text",
            ),
            pytest.param(
                "float",
                "1.2345678901234567890123456789",
                "allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                id="float-number",
            ),
        ],
    )
    def test_a_declared_number_past_its_digit_cap_is_refused(
        self, declared: str, written: str, problem: str, fix: str
    ) -> None:
        variables = {"big": {"type": declared, "value": "__written__"}}
        recipe = make_recipe([LOG_STEP], variables=variables).replace("__written__", written)

        found = find_finding(validate(recipe), "INVALID_VARIABLE_VALUE")

        assert found["step"] == "variables.big"
        assert found["problem"] == f"Variable 'big' {problem}"
        assert found["fix"] == fix

    @pytest.mark.parametrize(
        "written", ["0x1F", "0o17", "1:30", "+5", "1_000", "1.0e+5", ".5", ".inf", ".nan"]
    )
    def test_a_number_form_that_is_not_plain_decimal_is_text(self, written: str) -> None:
        variables = {"n": {"type": "float", "value": "__written__"}}
        recipe = make_recipe([LOG_STEP], variables=variables).replace("__written__", written)

        found = find_finding(validate(recipe), "INVALID_VARIABLE_VALUE")

        assert found["problem"] == "Variable 'n' expects float, got string"

    def test_a_setting_that_takes_text_has_no_element_types(self) -> None:
        step = sql_step(**NETWORK_CONNECTION, sql="SELECT :a", parameters={"a": "1"}) | {
            "element_types": {"parameters": {"a": "integer"}}
        }
        finding = find_finding(validate(make_recipe([step])), "INVALID_ELEMENT_TYPES")
        assert finding["step"] == "flow[0].element_types.parameters"
        assert finding["problem"] == (
            "Setting 'parameters' has no typed map or list value to declare element types for"
        )
        assert finding["fix"] == STEP_ELEMENT_TYPES_FIX

    def test_a_typed_setting_entry_that_does_not_fit(self) -> None:
        step = sql_step(**NETWORK_CONNECTION, sql="SELECT 1", driver_options={"timeout": "x"}) | {
            "element_types": {"driver_options": {"timeout": "integer"}}
        }
        finding = find_finding(validate(make_recipe([step])), "INVALID_SETTING_TYPE")
        assert finding == error_at(
            "flow[0].settings.driver_options",
            "INVALID_SETTING_TYPE",
            "Setting 'driver_options' of block 'sql-client' at key 'timeout' "
            "is not a valid integer",
            "Provide an integer value",
        )

    def test_step_element_types_must_be_a_mapping(self) -> None:
        step = sql_step(**NETWORK_CONNECTION, sql="SELECT 1") | {"element_types": ["integer"]}
        finding = find_finding(validate(make_recipe([step])), "INVALID_ELEMENT_TYPES")
        assert finding["step"] == "flow[0].element_types"
        assert finding["problem"] == "'element_types' must map each name to its element types"

    def test_a_set_row_that_is_an_expression_has_no_element_types(self) -> None:
        flow = [
            {"set": {"built": {"expr": "{'n': 1}"}}, "element_types": {"built": {"n": "integer"}}},
        ]
        variables = {"built": {"type": "map"}}
        finding = find_finding(
            validate(make_recipe(flow, variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["problem"] == (
            "Variable 'built' has no typed map or list value to declare element types for"
        )

    def test_a_set_row_element_that_does_not_fit(self) -> None:
        flow = [{"set": {"built": ["x"]}, "element_types": {"built": ["integer"]}}]
        variables = {"built": {"type": "array"}}
        finding = find_finding(
            validate(make_recipe(flow, variables=variables)), "INVALID_ELEMENT_TYPES"
        )
        assert finding["problem"] == "Variable 'built': item 0 expects integer, got string"

    def test_a_non_finite_float_element_is_text_refused_only_where_a_float_is_declared(
        self,
    ) -> None:
        variables = {
            "m": {"type": "map", "value": {"x": float("nan")}, "element_types": {"x": "float"}},
            "a": {"type": "array", "value": [1.5, float("inf")]},
            "built": {"type": "map"},
        }
        flow = [
            {"set": {"built": {"y": float("-inf")}}},
            sql_step(
                **NETWORK_CONNECTION, sql="SELECT 1", driver_options={"timeout": float("nan")}
            ),
        ]
        found = [
            (item["step"], item["problem"])
            for item in validate(make_recipe(flow, variables=variables))
            if item["code"] == "INVALID_ELEMENT_TYPES"
        ]
        assert found == [
            ("variables.m.element_types", "Variable 'm': key 'x' expects float, got string")
        ]

    def test_element_types_belong_only_on_block_and_set_steps(self) -> None:
        step = {"delay": 5, "element_types": {"duration": "integer"}}
        finding = find_finding(validate(make_recipe([step])), "INVALID_ELEMENT_TYPES")
        assert finding["step"] == "flow[0].element_types"
        assert finding["problem"] == "'element_types' belongs only on a block step or a set step"


SECRET_INPUT_DEFAULT_FIX = "Remove the default; the Function Block gives the value"
INPUT_KIND_FIX = "Give the input a plain default and compute the value inside the Function"


def function_with(
    inputs: list[dict[str, Any]],
    outputs: list[dict[str, Any]] | None = None,
    *,
    variables: dict[str, Any] | None = None,
) -> str:
    entry: dict[str, Any] = {"name": "fetch", "inputs": inputs, "outputs": outputs or []}
    if variables is not None:
        entry["variables"] = variables
    entry["flow"] = [LOG_STEP]
    return make_recipe([LOG_STEP], functions=[entry])


class TestFunctionParameterDeclarations:
    """An input default is a plain value and a secret input takes none; an output may
    carry a kind and a secret output a default (REQ-3.1.2.8, REQ-3.1.2.9, REQ-3.1.2.10)."""

    @pytest.mark.parametrize(
        ("value_type", "default"), [("string", "abc"), ("integer", 0), ("boolean", False)]
    )
    def test_a_secret_input_with_a_default_is_refused(self, value_type: str, default: Any) -> None:
        recipe = function_with(
            [{"name": "tok", "type": value_type, "secret": True, "default": default}]
        )
        finding = find_finding(validate(recipe), "SECRET_INPUT_DEFAULT")
        assert finding["severity"] == "error"
        assert finding["step"] == "functions[fetch].inputs.tok"
        assert finding["problem"] == "Secret input 'tok' cannot have a default"
        assert finding["fix"] == SECRET_INPUT_DEFAULT_FIX

    def test_the_refusal_stops_the_compile(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        recipe = function_with([{"name": "tok", "type": "string", "secret": True, "default": "x"}])
        result = compile_recipe(recipe)
        assert find_finding(result["findings"], "SECRET_INPUT_DEFAULT")["severity"] == "error"
        assert result["test_data"] is None

    def test_a_secret_input_with_a_null_default_has_no_default(self) -> None:
        recipe = function_with([{"name": "tok", "type": "string", "secret": True, "default": None}])
        assert "SECRET_INPUT_DEFAULT" not in codes(validate(recipe))

    def test_a_secret_output_may_have_a_default(self) -> None:
        recipe = function_with(
            [], [{"name": "token", "type": "string", "secret": True, "default": "seed"}]
        )
        assert "SECRET_INPUT_DEFAULT" not in codes(validate(recipe))

    def test_a_required_input_with_a_default_is_valid(self) -> None:
        # The default serves only a run of the Function on its own (REQ-3.1.2.10).
        recipe = function_with(
            [{"name": "port", "type": "integer", "required": True, "default": 80}]
        )
        assert validate(recipe) == []

    def test_an_enum_input_with_a_default_in_its_list_is_valid(self) -> None:
        enum_input = {
            "name": "level",
            "type": "string",
            "required": True,
            "enumValues": ["low", "high"],
            "default": "low",
        }
        assert validate(function_with([enum_input])) == []

    def test_a_secret_required_input_with_a_default_is_refused_as_secret(self) -> None:
        recipe = function_with(
            [{"name": "tok", "type": "string", "secret": True, "required": True, "default": "x"}]
        )
        assert codes(validate(recipe)) == ["SECRET_INPUT_DEFAULT"]

    @pytest.mark.parametrize("default", [None, "absent"])
    def test_a_required_input_with_no_default_passes(self, default: Any) -> None:
        item: dict[str, Any] = {"name": "port", "type": "integer", "required": True}
        if default is None:
            item["default"] = None
        assert validate(function_with([item])) == []

    def test_an_optional_input_keeps_its_default(self) -> None:
        recipe = function_with([{"name": "port", "type": "integer", "default": 80}])
        assert validate(recipe) == []

    @pytest.mark.parametrize(("kind", "source"), [("expr", "1 + 1"), ("template", "id-{{ base }}")])
    def test_an_input_with_a_kind_is_refused(self, kind: str, source: str) -> None:
        recipe = function_with([{"name": "n", "type": "string", kind: source}])
        finding = find_finding(validate(recipe), "INPUT_KIND_NOT_ALLOWED")
        assert finding["severity"] == "error"
        assert finding["step"] == "functions[fetch].inputs.n"
        assert finding["problem"] == (
            "Input 'n' cannot use expr or template; an input default is a plain value"
        )
        assert finding["fix"] == INPUT_KIND_FIX

    @pytest.mark.parametrize(
        ("value_type", "default", "problem"),
        [
            pytest.param("integer", "abc", "expects integer, got string", id="integer-text"),
            pytest.param("integer", 1.5, "expects integer, got float", id="integer-float"),
            pytest.param("float", True, "expects float, got boolean", id="float-boolean"),
            pytest.param("string", 5, "expects string, got integer", id="string-integer"),
            pytest.param(
                "integer",
                "12345678901234567890",
                "allows at most 19 digits, got 20",
                id="integer-cap",
            ),
        ],
    )
    def test_an_input_default_of_another_type_is_refused(
        self, value_type: str, default: Any, problem: str
    ) -> None:
        recipe = function_with([{"name": "port", "type": value_type, "default": default}])

        finding = find_finding(validate(recipe), "INVALID_VARIABLE_VALUE")

        assert finding["severity"] == "error"
        assert finding["step"] == "functions[fetch].inputs.port"
        assert finding["problem"] == f"Input 'port' {problem}"

    @pytest.mark.parametrize(
        ("value_type", "default"),
        [("integer", "80"), ("float", "2.50"), ("float", 2), ("table", [{"a": 1}])],
    )
    def test_an_input_default_of_its_type_passes(self, value_type: str, default: Any) -> None:
        recipe = function_with([{"name": "port", "type": value_type, "default": default}])

        assert "INVALID_VARIABLE_VALUE" not in codes(validate(recipe))

    def test_an_input_of_an_unknown_type_is_judged_by_its_type_rule_only(self) -> None:
        recipe = function_with([{"name": "port", "type": "number", "default": "abc"}])

        assert "INVALID_VARIABLE_VALUE" not in codes(validate(recipe))

    def test_an_enum_input_default_is_judged_by_the_enum_rules_only(self) -> None:
        enum_input = {
            "name": "level",
            "type": "integer",
            "required": True,
            "enumValues": [1, 2],
            "default": "x",
        }
        found = codes(validate(function_with([enum_input])))

        assert "ENUM_DEFAULT_NOT_ALLOWED" in found
        assert "INVALID_VARIABLE_VALUE" not in found

    @pytest.mark.parametrize(
        ("kind", "source"), [("expr", "len(url)"), ("template", "id-{{ url }}")]
    )
    def test_an_output_may_carry_a_kind(self, kind: str, source: str) -> None:
        recipe = function_with(
            [{"name": "url", "type": "string", "required": True}],
            [{"name": "out", "type": "string", kind: source}],
        )
        assert "INPUT_KIND_NOT_ALLOWED" not in codes(validate(recipe))


ENUM_PATH = "functions[fetch].inputs.level"
_ABSENT = object()


def enum_input(**overrides: Any) -> dict[str, Any]:
    """A well-formed enum input; an override of _ABSENT leaves that key out."""
    item: dict[str, Any] = {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
    }
    item.update(overrides)
    return {key: value for key, value in item.items() if value is not _ABSENT}


def findings_at(recipe: str, step: str) -> list[dict[str, Any]]:
    return [item for item in validate(recipe) if item["step"] == step]


def error_at(step: str, code: str, problem: str, fix: str) -> dict[str, Any]:
    return {"step": step, "code": code, "severity": "error", "problem": problem, "fix": fix}


class TestEnumInputDeclarations:
    """An enum input is typed by its value type, always Required, never secret, and its
    default is one of its allowed values (REQ-3.1.2.11, REQ-3.1.2.4)."""

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param(enum_input(), id="string"),
            pytest.param(enum_input(type="integer", enumValues=[1, 2], default=2), id="integer"),
            pytest.param(enum_input(type="float", enumValues=[1, 2.5], default=1.0), id="float"),
        ],
    )
    def test_a_well_formed_enum_input_is_clean(self, item: dict[str, Any]) -> None:
        assert validate(function_with([item])) == []

    @pytest.mark.parametrize(
        "value_type",
        ["array", "boolean", "map", "table", _ABSENT],
        ids=["array", "boolean", "map", "table", "absent"],
    )
    def test_an_enum_input_of_another_type_is_refused(self, value_type: Any) -> None:
        recipe = function_with([enum_input(type=value_type)])
        assert findings_at(recipe, ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_INPUT_TYPE",
                "Enum input 'level' must be of type string, integer or float",
                "Declare the input with type string, integer or float",
            )
        ]

    def test_an_array_enum_gets_no_per_item_findings(self) -> None:
        item = enum_input(type="array", required=_ABSENT, enumValues=["low", 5], default="mid")
        found = codes(findings_at(function_with([item]), ENUM_PATH))
        assert sorted(found) == ["ENUM_INPUT_NOT_REQUIRED", "ENUM_INPUT_TYPE"]

    def test_a_wrong_type_still_reports_the_rules_that_do_not_need_it(self) -> None:
        item = enum_input(type="map", required=False, enumValues=[], default=_ABSENT, secret=True)
        found = codes(findings_at(function_with([item]), ENUM_PATH))
        assert sorted(found) == [
            "ENUM_INPUT_EMPTY",
            "ENUM_INPUT_NOT_REQUIRED",
            "ENUM_INPUT_NO_DEFAULT",
            "ENUM_INPUT_TYPE",
            "SECRET_ENUM_INPUT",
        ]

    @pytest.mark.parametrize("required", [_ABSENT, False], ids=["absent", "false"])
    def test_an_enum_input_must_be_required(self, required: Any) -> None:
        recipe = function_with([enum_input(required=required)])
        assert findings_at(recipe, ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_INPUT_NOT_REQUIRED",
                "Enum input 'level' must be required",
                "Add required: true",
            )
        ]

    @pytest.mark.parametrize("allowed", [[], None, "low"], ids=["empty", "null", "not-a-list"])
    def test_an_enum_input_needs_allowed_values(self, allowed: Any) -> None:
        recipe = function_with([enum_input(enumValues=allowed)])
        assert find_finding(findings_at(recipe, ENUM_PATH), "ENUM_INPUT_EMPTY") == error_at(
            ENUM_PATH,
            "ENUM_INPUT_EMPTY",
            "Enum input 'level' has no allowed values",
            "List the allowed values in enumValues",
        )

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default", "misfits"),
        [
            pytest.param("integer", [1, "abc", 2.5, 3], 1, ["abc", "2.5"], id="integer"),
            pytest.param("float", [1.5, "abc"], 1.5, ["abc"], id="float"),
            pytest.param("string", ["low", 5], "low", ["5"], id="string"),
            pytest.param("integer", [1, True], 1, ["True"], id="boolean-in-integer"),
            pytest.param("float", [False, 2.5], 2.5, ["False"], id="boolean-in-float"),
        ],
    )
    def test_each_allowed_value_must_fit_the_type(
        self, value_type: str, allowed: list[Any], default: Any, misfits: list[str]
    ) -> None:
        item = enum_input(type=value_type, enumValues=allowed, default=default)
        assert findings_at(function_with([item]), ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_VALUE_TYPE",
                f"Allowed value '{misfit}' of enum input 'level' is not a valid {value_type}",
                "Give every allowed value the input's type",
            )
            for misfit in misfits
        ]

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param(
                enum_input(type="integer", enumValues=["3", 4], default=4), id="integer-text"
            ),
            pytest.param(
                enum_input(type="float", enumValues=[3, "3.5"], default=3),
                id="float-integer-and-text",
            ),
        ],
    )
    def test_text_that_reads_as_the_type_fits(self, item: dict[str, Any]) -> None:
        # The rule a run uses to realize the input (REQ-3.1.3.14).
        assert validate(function_with([item])) == []

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("string", [None, "low"], "low", id="string"),
            pytest.param("integer", [1, None], 1, id="integer"),
            pytest.param("float", [None, 2.5], 2.5, id="float"),
        ],
    )
    def test_a_null_allowed_value_never_fits(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = enum_input(type=value_type, enumValues=allowed, default=default)
        assert findings_at(function_with([item]), ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_VALUE_TYPE",
                f"Allowed value 'null' of enum input 'level' is not a valid {value_type}",
                "Give every allowed value the input's type",
            )
        ]

    def test_an_empty_allowed_value_is_refused(self) -> None:
        recipe = function_with([enum_input(enumValues=["", "low"], default="low")])
        assert findings_at(recipe, ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_VALUE_EMPTY",
                "Enum input 'level' has an empty allowed value",
                "Remove the empty allowed value",
            )
        ]

    def test_a_repeated_allowed_value_is_refused(self) -> None:
        recipe = function_with([enum_input(enumValues=["low", "high", "low"], default="low")])
        assert findings_at(recipe, ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_VALUE_REPEATED",
                "Allowed value 'low' of enum input 'level' is listed more than once",
                "List each allowed value once",
            )
        ]

    @pytest.mark.parametrize("default", [_ABSENT, None], ids=["absent", "null"])
    def test_an_enum_input_needs_a_default(self, default: Any) -> None:
        recipe = function_with([enum_input(default=default)])
        assert findings_at(recipe, ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_INPUT_NO_DEFAULT",
                "Enum input 'level' needs a default from its allowed values",
                "Add a default that is one of enumValues",
            )
        ]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            ("string", ["low", "high"], "mid"),
            ("integer", [1, 2], 3),
            pytest.param("integer", ["1", "2"], "3", id="integer-text"),
            pytest.param("integer", [1, 2], "abc", id="integer-unreadable-text"),
        ],
    )
    def test_the_default_must_be_an_allowed_value(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = enum_input(type=value_type, enumValues=allowed, default=default)
        assert findings_at(function_with([item]), ENUM_PATH) == [
            error_at(
                ENUM_PATH,
                "ENUM_DEFAULT_NOT_ALLOWED",
                f"Default '{default}' of enum input 'level' is not one of its allowed values",
                "Pick the default from enumValues",
            )
        ]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("integer", [1, 3], "3", id="integer-text-default"),
            pytest.param("integer", ["1", "3"], 3, id="integer-text-allowed"),
            pytest.param("float", [1.5, "2.5"], "2.5", id="float-text"),
        ],
    )
    def test_the_default_is_compared_after_realizing_both_as_the_type(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = enum_input(type=value_type, enumValues=allowed, default=default)
        assert validate(function_with([item])) == []

    def test_a_secret_enum_input_is_refused(self) -> None:
        recipe = function_with([enum_input(secret=True)])
        assert find_finding(findings_at(recipe, ENUM_PATH), "SECRET_ENUM_INPUT") == error_at(
            ENUM_PATH,
            "SECRET_ENUM_INPUT",
            "Input 'level' cannot be both secret and an enum",
            "Remove secret or enumValues",
        )

    def test_every_failing_rule_of_one_input_is_reported_together(self) -> None:
        item = enum_input(type="integer", required=_ABSENT, enumValues=[1, "abc"], default=_ABSENT)
        found = codes(findings_at(function_with([item]), ENUM_PATH))
        assert sorted(found) == [
            "ENUM_INPUT_NOT_REQUIRED",
            "ENUM_INPUT_NO_DEFAULT",
            "ENUM_VALUE_TYPE",
        ]

    def test_the_refusal_stops_the_compile(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        result = compile_recipe(function_with([enum_input(default=_ABSENT)]))
        assert find_finding(result["findings"], "ENUM_INPUT_NO_DEFAULT")["severity"] == "error"
        assert result["test_data"] is None


FLAG_PATH = "functions[fetch].inputs.flag"


BOOLEAN_INPUT_NO_DEFAULT_FINDING = error_at(
    FLAG_PATH,
    "BOOLEAN_INPUT_NO_DEFAULT",
    "Boolean input 'flag' needs a default",
    "Add default: true or default: false",
)


def flag_input(**overrides: Any) -> dict[str, Any]:
    """A true/false input; an override of _ABSENT leaves that key out."""
    item: dict[str, Any] = {"name": "flag", "type": "boolean", **overrides}
    return {key: value for key, value in item.items() if value is not _ABSENT}


class TestBooleanInputDefault:
    """A true/false input starts on its default in every Function Block, so it declares one,
    Required or not; a secret input takes none (REQ-3.1.2.10)."""

    @pytest.mark.parametrize(
        "required", [True, False, _ABSENT], ids=["required", "optional", "unset"]
    )
    @pytest.mark.parametrize("default", [_ABSENT, None], ids=["no-default", "null-default"])
    def test_a_boolean_input_needs_a_default(self, required: Any, default: Any) -> None:
        recipe = function_with([flag_input(required=required, default=default)])
        assert findings_at(recipe, FLAG_PATH) == [BOOLEAN_INPUT_NO_DEFAULT_FINDING]

    @pytest.mark.parametrize("required", [True, False], ids=["required", "optional"])
    @pytest.mark.parametrize("default", [True, False])
    def test_a_boolean_input_with_a_default_is_clean(self, required: bool, default: bool) -> None:
        assert validate(function_with([flag_input(required=required, default=default)])) == []

    @pytest.mark.parametrize("required", [True, False], ids=["required", "optional"])
    @pytest.mark.parametrize("default", [_ABSENT, None], ids=["absent", "null"])
    def test_a_secret_boolean_input_needs_no_default(self, required: bool, default: Any) -> None:
        # A secret input has no default, so the boolean rule leaves it alone.
        recipe = function_with([flag_input(required=required, secret=True, default=default)])
        assert validate(recipe) == []

    def test_the_refusal_stops_the_compile(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        result = compile_recipe(function_with([flag_input()]))
        assert find_finding(result["findings"], "BOOLEAN_INPUT_NO_DEFAULT") == (
            BOOLEAN_INPUT_NO_DEFAULT_FINDING
        )
        assert result["test_data"] is None

    def test_a_secret_required_boolean_input_still_takes_no_default(self) -> None:
        item = {
            "name": "flag",
            "type": "boolean",
            "required": True,
            "secret": True,
            "default": True,
        }
        assert findings_at(function_with([item]), FLAG_PATH) == [
            error_at(
                FLAG_PATH,
                "SECRET_INPUT_DEFAULT",
                "Secret input 'flag' cannot have a default",
                SECRET_INPUT_DEFAULT_FIX,
            )
        ]


class TestDeclarationNameRules:
    """Recipe declarations follow the one declaration rule a saved Test or Function follows
    (REQ-3.1.3.1): the finding keeps its recipe shape, the rule and the text are shared."""

    @pytest.mark.parametrize(
        ("name", "code", "reason"),
        [
            pytest.param("class", "INVALID_VARIABLE", "a Python keyword", id="keyword"),
            pytest.param(
                "system",
                "RESERVED_VARIABLE_NAME",
                "reserved for namespace access; use system.field_name",
                id="namespace",
            ),
            pytest.param(
                "a" * 65, "INVALID_VARIABLE", "must be 64 characters or fewer", id="too-long"
            ),
        ],
    )
    def test_a_test_variable_name(self, name: str, code: str, reason: str) -> None:
        recipe = make_recipe([LOG_STEP], variables={name: {"type": "string", "value": "v"}})
        assert findings_at(recipe, f"variables.{name}") == [
            error_at(
                f"variables.{name}",
                code,
                f"Invalid variable name: '{name}' ({reason})",
                "Rename the variable",
            )
        ]

    def test_a_function_local_name(self) -> None:
        recipe = function_with([], variables={"system": {"type": "string", "value": "v"}})
        assert findings_at(recipe, "functions[fetch].variables.system") == [
            error_at(
                "functions[fetch].variables.system",
                "RESERVED_VARIABLE_NAME",
                "Invalid local variable name: 'system' "
                "(reserved for namespace access; use system.field_name)",
                "Rename the variable",
            )
        ]

    def test_an_input_name_starts_with_a_letter(self) -> None:
        recipe = function_with([{"name": "_hidden", "type": "string"}])
        assert findings_at(recipe, "functions[fetch].inputs._hidden") == [
            error_at(
                "functions[fetch].inputs._hidden",
                "INVALID_VARIABLE",
                "Invalid input name: '_hidden' (must match [a-zA-Z][a-zA-Z0-9_]*)",
                "Rename the input",
            )
        ]

    def test_an_output_type(self) -> None:
        recipe = function_with([], [{"name": "out", "type": "blob"}])
        assert findings_at(recipe, "functions[fetch].outputs.out") == [
            error_at(
                "functions[fetch].outputs.out",
                "INVALID_VARIABLE_TYPE",
                "Invalid output type: 'blob' "
                "(must be one of: array, boolean, float, integer, map, string, table)",
                "Use a valid type",
            )
        ]

    def test_a_capture_target_name(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "class"},
        }
        finding = find_finding(validate(make_recipe([step])), "INVALID_VARIABLE")
        assert finding["problem"] == "Invalid capture target name: 'class' (a Python keyword)"
        assert finding["fix"] == "Rename the capture target"


class TestParameterNameCollisions:
    """Inputs, outputs and local variables share one per-Function namespace
    (REQ-3.1.2.4, REQ-3.1.3.1)."""

    @pytest.mark.parametrize(
        ("inputs", "outputs", "variables", "problem"),
        [
            pytest.param(
                [{"name": "id", "type": "string"}],
                [{"name": "id", "type": "string"}],
                None,
                "Function declares 'id' as both an input and an output",
                id="input-output",
            ),
            pytest.param(
                [{"name": "id", "type": "string"}],
                [],
                {"id": {"type": "string"}},
                "Function declares 'id' as both an input and a local variable",
                id="input-local",
            ),
            pytest.param(
                [],
                [{"name": "id", "type": "string"}],
                {"id": {"type": "string"}},
                "Function declares 'id' as both an output and a local variable",
                id="output-local",
            ),
        ],
    )
    def test_a_shared_name_is_refused(
        self,
        inputs: list[dict[str, Any]],
        outputs: list[dict[str, Any]],
        variables: dict[str, Any] | None,
        problem: str,
    ) -> None:
        recipe = function_with(inputs, outputs, variables=variables)
        assert validate(recipe) == [
            error_at("functions[fetch]", "DUPLICATE_PARAMETER_NAME", problem, "Rename one of them")
        ]

    def test_a_name_in_all_three_lists_is_reported_once_per_pair(self) -> None:
        recipe = function_with(
            [{"name": "id", "type": "string"}],
            [{"name": "id", "type": "string"}],
            variables={"id": {"type": "string"}},
        )
        found = findings_at(recipe, "functions[fetch]")
        assert codes(found) == ["DUPLICATE_PARAMETER_NAME"] * 3
        assert sorted(item["problem"] for item in found) == [
            "Function declares 'id' as both an input and a local variable",
            "Function declares 'id' as both an input and an output",
            "Function declares 'id' as both an output and a local variable",
        ]

    def test_distinct_names_are_clean(self) -> None:
        recipe = function_with(
            [{"name": "a", "type": "string"}],
            [{"name": "b", "type": "string"}],
            variables={"c": {"type": "string"}},
        )
        assert validate(recipe) == []

    def test_a_test_variable_may_share_a_function_input_name(self) -> None:
        # Outer Test variables are not visible inside a Function.
        functions = [
            {"name": "fetch", "inputs": [{"name": "id", "type": "string"}], "flow": [LOG_STEP]}
        ]
        recipe = make_recipe(
            [LOG_STEP], variables={"id": {"type": "string", "value": "x"}}, functions=functions
        )
        assert validate(recipe) == []


class TestTemplateNeedsAString:
    """A template builds text, so only a string variable or output takes one
    (REQ-3.1.2.8, REQ-3.1.3.15)."""

    @pytest.mark.parametrize("declared", ["integer", "float", "boolean", "array", "map", "table"])
    def test_a_template_variable_of_another_type_is_refused(self, declared: str) -> None:
        variables = {"label": {"type": declared, "template": "id-{{ n }}"}}
        finding = find_finding(
            validate(make_recipe([LOG_STEP], variables=variables)), "TEMPLATE_NOT_STRING"
        )
        assert finding["severity"] == "error"
        assert finding["step"] == "variables.label"
        assert finding["problem"] == (
            f"Variable 'label' is {declared}; template: builds text, so it needs type string"
        )
        assert finding["fix"] == f"Use expr: for a computed {declared} value"

    def test_a_function_variable_of_another_type_is_refused_at_its_declaration(self) -> None:
        functions = [
            {
                "name": "fetch",
                "inputs": [],
                "outputs": [],
                "variables": {"size": {"type": "integer", "template": "{{ 1 }}"}},
                "flow": [LOG_STEP],
            }
        ]
        finding = find_finding(
            validate(make_recipe([LOG_STEP], functions=functions)), "TEMPLATE_NOT_STRING"
        )
        assert finding["step"] == "functions[fetch].variables.size"
        assert finding["problem"] == (
            "Variable 'size' is integer; template: builds text, so it needs type string"
        )

    def test_a_template_output_of_another_type_is_refused(self) -> None:
        recipe = function_with([], [{"name": "total", "type": "integer", "template": "{{ 1 }}"}])
        finding = find_finding(validate(recipe), "TEMPLATE_NOT_STRING")
        assert finding["severity"] == "error"
        assert finding["step"] == "functions[fetch].outputs.total"
        assert finding["problem"] == (
            "Output 'total' is integer; template: builds text, so it needs type string"
        )
        assert finding["fix"] == "Use expr: for a computed integer value"

    def test_the_refusal_stops_the_compile(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        variables = {"n": {"type": "integer", "template": "{{ 1 }}"}}
        result = compile_recipe(make_recipe([LOG_STEP], variables=variables))
        assert result["test_data"] is None

    def test_a_string_template_and_an_untyped_template_output_are_accepted(self) -> None:
        recipe = make_recipe(
            [LOG_STEP],
            variables={"label": {"type": "string", "template": "id-{{ n }}"}},
            functions=[
                {
                    "name": "fetch",
                    "inputs": [],
                    "outputs": [
                        {"name": "a", "type": "string", "template": "x"},
                        {"name": "b", "template": "y"},
                    ],
                    "flow": [LOG_STEP],
                }
            ],
        )
        assert "TEMPLATE_NOT_STRING" not in codes(validate(recipe))


SECRET_OUTPUTS_FUNCTION: dict[str, Any] = {
    "name": "issue",
    "inputs": [],
    "outputs": [{"name": "token", "type": "string", "secret": True}],
    "flow": [LOG_STEP],
}


class TestFunctionStepSecretOutputs:
    """A Function step may mark only outputs its Function has (SECUI-11, REQ-3.1.2.9)."""

    def test_marking_an_output_the_function_has_is_clean(self) -> None:
        flow = [{"function": "issue", "secret_outputs": ["token"]}]
        assert validate(make_recipe(flow, functions=[SECRET_OUTPUTS_FUNCTION])) == []

    def test_marking_an_output_the_function_does_not_have_is_refused(self) -> None:
        flow = [{"function": "issue", "secret_outputs": ["token", "nope"]}]
        finding = find_finding(
            validate(make_recipe(flow, functions=[SECRET_OUTPUTS_FUNCTION])),
            "UNKNOWN_SECRET_OUTPUT",
        )
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].secret_outputs"
        assert finding["problem"] == "Function 'issue' has no output 'nope' to mark secret"
        assert finding["fix"] == "Valid outputs: token"

    @pytest.mark.parametrize("marked", ["token", [1], {"token": True}])
    def test_a_value_that_is_not_a_list_of_names_is_malformed(self, marked: Any) -> None:
        flow = [{"function": "issue", "secret_outputs": marked}]
        finding = find_finding(
            validate(make_recipe(flow, functions=[SECRET_OUTPUTS_FUNCTION])), "INVALID_CONSTRUCT"
        )
        assert finding == {
            "step": "flow[0].secret_outputs",
            "code": "INVALID_CONSTRUCT",
            "severity": "error",
            "problem": (
                "'function' step is malformed: 'secret_outputs' must be a list of output names"
            ),
            "fix": None,
        }

    def test_the_key_is_part_of_the_function_step_form(self) -> None:
        from wavecore.core.recipes.parser import parse_recipe

        flow = [{"function": "issue", "secret_outputs": []}]
        _doc, findings = parse_recipe(make_recipe(flow, functions=[SECRET_OUTPUTS_FUNCTION]))
        assert findings == []


PROBE_FUNCTION: dict[str, Any] = {
    "name": "probe",
    "inputs": [
        {"name": "url", "type": "string", "required": True},
        {"name": "retries", "type": "integer", "default": 3},
        {
            "name": "level",
            "type": "string",
            "required": True,
            "enumValues": ["low", "high"],
            "default": "low",
        },
        {"name": "count", "type": "integer", "required": True, "enumValues": [1, 2], "default": 1},
        {"name": "strict", "type": "boolean", "required": True, "default": True},
        {"name": "tags", "type": "array", "default": []},
        {"name": "tok", "type": "string", "secret": True},
    ],
    "outputs": [{"name": "status", "type": "integer"}],
    "flow": [LOG_STEP],
}
PROBE_SETTINGS_SORTED = "count, level, retries, strict, tags, tok, url"


def probe_step(**settings: Any) -> dict[str, Any]:
    return {"function": "probe", "settings": {"url": "http://x", **settings}}


def probe_findings(*steps: dict[str, Any]) -> list[dict[str, Any]]:
    return validate(make_recipe(list(steps), functions=[PROBE_FUNCTION]))


def missing_settings(findings: list[dict[str, Any]]) -> list[tuple[str, str, str]]:
    return [
        (item["step"], item["problem"], item["fix"])
        for item in findings
        if item["code"] == "MISSING_REQUIRED_SETTING"
    ]


class TestFunctionStepSettings:
    """A Function step's settings are its inputs, checked by the one field check every
    Block's settings go through; the Function's name names the Block (REQ-5.2.7.5)."""

    def test_a_step_giving_every_input_is_clean(self) -> None:
        step = probe_step(retries=5, level="high", count=2, strict=False, tags=["a"], tok="t0k")
        assert probe_findings(step) == []

    def test_a_required_choice_or_true_false_input_left_out_is_not_missing(self) -> None:
        # The compile writes the Function's default into each of them.
        assert probe_findings(probe_step()) == []

    def test_an_input_the_function_does_not_declare_is_refused(self) -> None:
        finding = find_finding(probe_findings(probe_step(nope=1)), "UNKNOWN_SETTING")
        assert finding == error_at(
            "flow[0].settings.nope",
            "UNKNOWN_SETTING",
            "Block 'probe' has no setting 'nope'",
            f"Valid settings: {PROBE_SETTINGS_SORTED}",
        )

    def test_a_required_free_entry_input_left_out_is_missing(self) -> None:
        findings = probe_findings({"function": "probe", "settings": {}})
        assert missing_settings(findings) == [
            (
                "flow[0].settings.url",
                "Required setting 'url' is missing for block 'probe'",
                "Add settings.url",
            )
        ]

    def test_a_step_with_no_settings_key_is_checked_the_same(self) -> None:
        findings = probe_findings({"function": "probe"})
        assert [problem for _step, problem, _fix in missing_settings(findings)] == [
            "Required setting 'url' is missing for block 'probe'"
        ]

    def test_a_required_input_with_a_default_must_still_be_given(self) -> None:
        # A Function Block never fills a Required input from its default (REQ-3.1.2.10).
        function = {
            "name": "probe",
            "inputs": [{"name": "port", "type": "integer", "required": True, "default": 80}],
            "outputs": [],
            "flow": [LOG_STEP],
        }
        findings = validate(make_recipe([{"function": "probe"}], functions=[function]))
        assert missing_settings(findings) == [
            (
                "flow[0].settings.port",
                "Required setting 'port' is missing for block 'probe'",
                "Add settings.port",
            )
        ]

    def test_a_value_of_the_wrong_type_is_refused(self) -> None:
        finding = find_finding(probe_findings(probe_step(retries="abc")), "INVALID_SETTING_TYPE")
        assert finding == error_at(
            "flow[0].settings.retries",
            "INVALID_SETTING_TYPE",
            "Setting 'retries' of block 'probe' expects integer, got string",
            "Provide an integer value",
        )

    def test_text_for_a_true_false_input_is_refused(self) -> None:
        finding = find_finding(probe_findings(probe_step(strict="yes")), "INVALID_SETTING_TYPE")
        assert_message(
            r"^Setting 'strict' of block 'probe' expects boolean, got string$", finding["problem"]
        )

    def test_a_value_outside_the_allowed_values_is_refused(self) -> None:
        finding = find_finding(probe_findings(probe_step(level="medium")), "INVALID_ENUM_VALUE")
        assert finding == error_at(
            "flow[0].settings.level",
            "INVALID_ENUM_VALUE",
            "Setting 'level' of block 'probe' must be one of: low, high",
            "Use one of the listed values",
        )

    def test_a_typed_allowed_value_list_is_checked_by_value(self) -> None:
        finding = find_finding(probe_findings(probe_step(count=3)), "INVALID_ENUM_VALUE")
        assert finding["step"] == "flow[0].settings.count"
        assert_message(
            r"^Setting 'count' of block 'probe' must be one of: 1, 2$", finding["problem"]
        )

    def test_an_expression_input_bypasses_the_type_check(self) -> None:
        assert probe_findings(probe_step(retries={"expr": "1 + 1"}, level={"expr": "lvl"})) == []

    def test_an_expression_input_is_syntax_checked(self) -> None:
        finding = find_finding(
            probe_findings(probe_step(retries={"expr": "1 +"})), "INVALID_EXPRESSION"
        )
        assert finding["step"] == "flow[0].settings.retries"
        assert finding["problem"].startswith("Expression is not valid: ")

    def test_a_library_function_step_is_checked_against_its_pinned_version(self) -> None:
        create_library_function(
            "fetch_remote",
            version="1.2.0",
            inputs=[{"name": "host", "type": "string", "required": True, "default": None}],
        )
        steps = [
            {"function": "fetch_remote", "version": "1.2.0", "settings": {"host": "h", "x": 1}},
            {"function": "fetch_remote", "version": "1.2.0"},
        ]
        findings = validate(make_recipe(steps))
        assert find_finding(findings, "UNKNOWN_SETTING") == error_at(
            "flow[0].settings.x",
            "UNKNOWN_SETTING",
            "Block 'fetch_remote' has no setting 'x'",
            "Valid settings: host",
        )
        assert missing_settings(findings) == [
            (
                "flow[1].settings.host",
                "Required setting 'host' is missing for block 'fetch_remote'",
                "Add settings.host",
            )
        ]

    def test_a_function_step_reports_no_function_input_code(self) -> None:
        findings = probe_findings(probe_step(nope=1), {"function": "probe"})
        assert {"UNKNOWN_FUNCTION_INPUT", "MISSING_REQUIRED_FUNCTION_INPUT"}.isdisjoint(
            codes(findings)
        )


class TestFunctionStepElementTypes:
    """A Function step declares the element types of a list or map input it writes, as a
    block step does (REQ-3.1.3.19)."""

    def test_declared_elements_that_fit_are_clean(self) -> None:
        step = probe_step(tags=[8080, "1.0"]) | {"element_types": {"tags": ["integer", "float"]}}
        assert probe_findings(step) == []

    @pytest.mark.parametrize("written", ["x", "1e5"], ids=["text", "exponent-text"])
    def test_an_element_that_breaks_the_number_rule_is_refused_by_the_shared_check(
        self, written: str
    ) -> None:
        step = probe_step(tags=[8080, written]) | {
            "element_types": {"tags": ["integer", "integer"]}
        }
        assert probe_findings(step) == [
            error_at(
                "flow[0].settings.tags",
                "INVALID_SETTING_TYPE",
                "Setting 'tags' of block 'probe' at item 2 is not a valid integer",
                "Provide an integer value",
            )
        ]

    def test_a_written_integer_past_19_digits_is_refused_by_its_count(self) -> None:
        assert probe_findings(probe_step(tags=[8080, 12345678901234567890])) == [
            error_at(
                "flow[0].settings.tags",
                "SETTING_TOO_MANY_DIGITS",
                "Setting 'tags' of block 'probe' at item 2 allows at most 19 digits, got 20",
                "Provide at most 19 digits",
            )
        ]

    def test_an_expression_item_is_source_not_a_literal(self) -> None:
        step = probe_step(tags=[{"expr": "count + 1"}, "16"]) | {
            "element_types": {"tags": ["integer", "integer"]}
        }
        assert probe_findings(step) == []

    def test_an_element_of_another_declared_type_keeps_its_element_finding(self) -> None:
        step = probe_step(tags=[8080, 1]) | {"element_types": {"tags": ["integer", "map"]}}
        finding = find_finding(probe_findings(step), "INVALID_ELEMENT_TYPES")
        assert finding == error_at(
            "flow[0].element_types.tags",
            "INVALID_ELEMENT_TYPES",
            "Setting 'tags': item 1 expects map, got integer",
            ELEMENT_TYPES_FIX,
        )

    def test_a_scalar_input_has_no_element_types(self) -> None:
        step = probe_step(retries=5) | {"element_types": {"retries": ["integer"]}}
        finding = find_finding(probe_findings(step), "INVALID_ELEMENT_TYPES")
        assert finding["step"] == "flow[0].element_types.retries"
        assert finding["problem"] == (
            "Setting 'retries' has no typed map or list value to declare element types for"
        )

    def test_step_element_types_must_be_a_mapping(self) -> None:
        step = probe_step() | {"element_types": ["integer"]}
        finding = find_finding(probe_findings(step), "INVALID_ELEMENT_TYPES")
        assert finding["step"] == "flow[0].element_types"
        assert finding["problem"] == "'element_types' must map each name to its element types"


def k8s_get_step(**settings: Any) -> dict[str, Any]:
    return {"block": "k8s-get", "settings": {"session": {"expr": "kube"}, **settings}}


class TestConditionallyRequiredSettings:
    """Stage 1 takes the save check's required rule: a setting required by another setting's
    value counts, read from the step or the other setting's default; a choice list or
    true / false the step leaves out is never missing, since the compile writes it
    (REQ-5.2.7.5, REQ-3.4.2.3)."""

    def test_a_setting_required_by_a_default_it_depends_on_is_missing(self) -> None:
        # search_by defaults to name, which makes name required.
        assert missing_settings(validate(make_recipe([k8s_get_step(kind="Pod")]))) == [
            (
                "flow[0].settings.name",
                "Required setting 'name' is missing for block 'k8s-get'",
                "Add settings.name",
            )
        ]

    def test_a_setting_required_by_the_steps_own_value_is_missing(self) -> None:
        step = k8s_get_step(resource_type="custom", name="web")
        assert missing_settings(validate(make_recipe([step]))) == [
            (
                "flow[0].settings.kind_custom",
                "Required setting 'kind_custom' is missing for block 'k8s-get'",
                "Add settings.kind_custom",
            )
        ]

    def test_a_setting_whose_condition_does_not_hold_is_not_missing(self) -> None:
        step = k8s_get_step(kind="Pod", search_by="list")
        assert missing_settings(validate(make_recipe([step]))) == []

    def test_a_choice_list_the_step_leaves_out_is_not_missing(self) -> None:
        assert missing_settings(validate(make_recipe([k8s_get_step(name="web")]))) == []

    def test_a_required_choice_list_left_out_is_not_missing(self) -> None:
        step = {"block": "csv-parser", "settings": {"csv_content": "id\n1\n"}}
        assert validate(make_recipe([step])) == []


def ping_step(**settings: Any) -> dict[str, Any]:
    return {"block": "ping", "settings": {"host": "gateway.local", **settings}}


class TestSettingValueChecks:
    """Recipe values are checked with the run's type table and both bounds, the same check
    the Test and Function save run (REQ-5.2.7.2, REQ-3.4.2.2)."""

    def test_a_value_above_the_maximum_is_refused(self) -> None:
        finding = find_finding(
            validate(make_recipe([ping_step(count=1001)])), "SETTING_ABOVE_MAXIMUM"
        )
        assert finding == error_at(
            "flow[0].settings.count",
            "SETTING_ABOVE_MAXIMUM",
            "Setting 'count' of block 'ping' must be at most 1000, got 1001",
            "Provide a value of at most 1000",
        )

    def test_a_float_above_the_maximum_is_refused(self) -> None:
        finding = find_finding(
            validate(make_recipe([ping_step(min_rate=100.5)])), "SETTING_ABOVE_MAXIMUM"
        )
        assert finding["step"] == "flow[0].settings.min_rate"
        assert_message(
            r"^Setting 'min_rate' of block 'ping' must be at most 100, got 100\.5$",
            finding["problem"],
        )
        assert finding["fix"] == "Provide a value of at most 100"

    def test_a_value_at_the_maximum_is_clean(self) -> None:
        assert validate(make_recipe([ping_step(count=1000, min_rate=100)])) == []

    def test_an_expression_is_not_bound_checked(self) -> None:
        assert validate(make_recipe([ping_step(count={"expr": "5000"})])) == []

    def test_an_exact_decimal_float_is_accepted(self) -> None:
        from decimal import Decimal

        from wavecore.core.recipes.model import RecipeDoc
        from wavecore.core.recipes.validator import _Validator

        validator = _Validator(RecipeDoc(name="T"))
        entry = validator.catalog["ping"]
        validator._check_setting_value(
            entry, "interval", Decimal("1.5"), "flow[0].settings.interval"
        )
        assert validator.findings == []

    def test_a_picked_table_name_is_not_a_type_mismatch(self) -> None:
        # The field names a table variable, so its text is that variable's name.
        step = {"block": "csv-parser", "settings": {"operation": "serialize", "table": "rows"}}
        recipe = make_recipe([step], variables={"rows": {"type": "table"}})
        assert validate(recipe) == []

    def test_a_table_given_rows_is_clean(self) -> None:
        step = sql_step(
            operation="load_table",
            database_type="sqlite",
            file="/data/app.db",
            table=[{"id": 1}, {"id": 2}],
            target_table="orders",
        )
        assert validate(make_recipe([step])) == []

    def test_a_table_given_items_that_are_not_rows_is_refused(self) -> None:
        step = sql_step(
            operation="load_table",
            database_type="sqlite",
            file="/data/app.db",
            table=[1, 2],
            target_table="orders",
        )
        finding = find_finding(validate(make_recipe([step])), "INVALID_SETTING_TYPE")
        assert finding == error_at(
            "flow[0].settings.table",
            "INVALID_SETTING_TYPE",
            "Setting 'table' of block 'sql-client' expects table, got array",
            "Provide a table value",
        )


def k8s_connect_step(**extra: Any) -> dict[str, Any]:
    return {"block": "k8s-connect", "settings": {"api_url": "https://k8s.local"}, **extra}


class TestBlockSecretOutputs:
    """A block step may mark only outputs the block has, its declared ones included (SECUI-4)."""

    def test_marking_an_output_the_block_has_is_clean(self) -> None:
        flow = [k8s_connect_step(secret_outputs=["cluster_version"])]
        assert validate(make_recipe(flow)) == []

    def test_marking_an_output_the_block_does_not_have_is_refused(self) -> None:
        flow = [k8s_connect_step(secret_outputs=["session", "nope"])]
        finding = find_finding(validate(make_recipe(flow)), "UNKNOWN_SECRET_OUTPUT")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].secret_outputs"
        assert finding["problem"] == "Block 'k8s-connect' has no output 'nope' to mark secret"
        assert finding["fix"] == "Valid outputs: cluster_version, session"

    def test_an_output_a_setting_declares_may_be_marked(self) -> None:
        step = shell_script_step(script_variables=["TOKEN"])
        step["secret_outputs"] = ["TOKEN"]
        assert validate(make_recipe([step])) == []

    def test_an_undeclared_script_variable_is_refused_with_where_to_declare_it(self) -> None:
        step = shell_script_step(script_variables=["TOKEN"])
        step["secret_outputs"] = ["OTHER"]
        finding = find_finding(validate(make_recipe([step])), "UNKNOWN_SECRET_OUTPUT")
        assert finding["problem"] == "Block 'shell-script' has no output 'OTHER' to mark secret"
        assert finding["fix"].startswith("Valid outputs: ")
        assert "TOKEN" in finding["fix"]
        assert finding["fix"].endswith(". Declare a new one in settings.script_variables")

    @pytest.mark.parametrize("marked", ["session", [1], {"session": True}])
    def test_a_value_that_is_not_a_list_of_names_is_malformed(self, marked: Any) -> None:
        finding = find_finding(
            validate(make_recipe([k8s_connect_step(secret_outputs=marked)])), "INVALID_CONSTRUCT"
        )
        assert finding["step"] == "flow[0].secret_outputs"
        assert finding["problem"] == (
            "'block' step is malformed: 'secret_outputs' must be a list of output names"
        )

    def test_the_key_belongs_only_to_a_block_step(self) -> None:
        from wavecore.core.recipes.parser import parse_recipe

        step = {"set": {"x": 1}, "secret_outputs": []}
        doc, findings = parse_recipe(make_recipe([step]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Unknown key 'secret_outputs' on a 'set' step"
        assert finding["fix"] == (
            "Valid keys: capture, element_types, key, label, profiles, settings"
        )
