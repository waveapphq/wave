"""Recipe parser contract: YAML parse, document shape, step keywords, step paths.

REQ-5.2.7.3. All finding messages are the exact catalog strings.
"""

from typing import Any

import pytest

from tests.core.recipes.conftest import (
    LOG_STEP,
    codes,
    dump_recipe,
    find_finding,
    make_recipe,
)

FINDING_KEYS = {"step", "code", "severity", "problem", "fix"}

VALID_KEYWORDS_FIX = (
    "Valid keywords: block, function, if, switch, for, for_each, while, try, "
    "parallel, assert, remote, set, delay, wait_until, halt, break, continue, note"
)
FUNCTION_STEP_KEYS_FIX = (
    "Valid keys: capture, element_types, key, label, profiles, secret_outputs, settings, version"
)


def parse(text: str) -> tuple[Any, list[dict[str, Any]]]:
    from wavecore.core.recipes.parser import parse_recipe

    return parse_recipe(text)


class TestParseErrors:
    def test_invalid_yaml_returns_parse_error_finding(self) -> None:
        doc, findings = parse("test: [unclosed\nflow:\n")
        assert doc is None
        finding = find_finding(findings, "RECIPE_PARSE_ERROR")
        assert set(finding.keys()) == FINDING_KEYS
        assert finding["severity"] == "error"
        assert finding["step"] == "recipe"
        assert finding["problem"].startswith("Recipe is not valid YAML: ")
        assert len(finding["problem"]) > len("Recipe is not valid YAML: ")
        assert finding["fix"] is None

    def test_yaml_list_document_is_not_a_recipe(self) -> None:
        doc, findings = parse("- one\n- two\n")
        assert doc is None
        finding = find_finding(findings, "RECIPE_NOT_MAPPING")
        assert finding["severity"] == "error"
        assert finding["step"] == "recipe"
        assert finding["problem"] == (
            "Recipe must be a YAML mapping with 'test' and 'flow' sections"
        )
        assert finding["fix"] == "Start from a worked example returned by get_recipe_guide"

    def test_yaml_scalar_document_is_not_a_recipe(self) -> None:
        doc, findings = parse("just a string")
        assert doc is None
        assert codes(findings) == ["RECIPE_NOT_MAPPING"]

    def test_empty_document_is_not_a_recipe(self) -> None:
        doc, findings = parse("")
        assert doc is None
        assert codes(findings) == ["RECIPE_NOT_MAPPING"]


class TestDocumentShape:
    def test_missing_test_section_reports_missing_name(self) -> None:
        doc, findings = parse(dump_recipe({"flow": [LOG_STEP]}))
        assert doc is None
        finding = find_finding(findings, "MISSING_TEST_NAME")
        assert finding["severity"] == "error"
        assert finding["step"] == "test.name"
        assert finding["problem"] == "test.name is required and must be a non-empty string"
        assert finding["fix"] == "Add test.name"

    def test_empty_test_name_reports_missing_name(self) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": ""}, "flow": [LOG_STEP]}))
        assert doc is None
        assert codes(findings) == ["MISSING_TEST_NAME"]

    def test_non_string_test_name_reports_missing_name(self) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": 42}, "flow": [LOG_STEP]}))
        assert doc is None
        assert codes(findings) == ["MISSING_TEST_NAME"]

    def test_empty_flow_list_is_rejected(self) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": "T"}, "flow": []}))
        assert doc is None
        finding = find_finding(findings, "EMPTY_FLOW")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow"
        assert finding["problem"] == "flow must be a non-empty list of steps"
        assert finding["fix"] == "Add at least one step to flow"

    def test_missing_flow_section_is_rejected(self) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": "T"}}))
        assert doc is None
        assert codes(findings) == ["EMPTY_FLOW"]

    def test_non_list_flow_is_rejected(self) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": "T"}, "flow": "nope"}))
        assert doc is None
        assert codes(findings) == ["EMPTY_FLOW"]


class TestStepShape:
    def test_non_mapping_step_is_invalid(self) -> None:
        doc, findings = parse(make_recipe(["just-a-string"]))
        assert doc is None
        finding = find_finding(findings, "INVALID_STEP")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Step must be a mapping with exactly one step keyword"
        assert finding["fix"] == "Use '- block: <id>' or a construct keyword"

    def test_step_with_two_keywords_is_invalid(self) -> None:
        step = {"block": "log", "if": {"when": "x == 1", "then": [LOG_STEP]}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        assert codes(findings) == ["INVALID_STEP"]

    def test_step_with_only_sibling_keys_is_invalid(self) -> None:
        doc, findings = parse(make_recipe([{"label": "orphan"}]))
        assert doc is None
        assert codes(findings) == ["INVALID_STEP"]

    def test_unknown_step_keyword_is_reported_with_the_keyword(self) -> None:
        doc, findings = parse(make_recipe([{"invalid_keyword": "log"}]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEYWORD")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Unknown step keyword 'invalid_keyword'"
        assert finding["fix"] == VALID_KEYWORDS_FIX

    def test_block_step_sibling_keys_are_accepted(self) -> None:
        step = {
            "block": "http-client",
            "label": "Fetch",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "code"},
            "profiles": [{"profile": "creds", "alias": "cred", "fields": ["username"]}],
        }
        doc, findings = parse(make_recipe([step]))
        assert findings == []
        assert doc is not None

    def test_unknown_sibling_key_beside_a_valid_keyword(self) -> None:
        """A typo'd sibling silently loses the binding the author wrote."""
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "captur": {"status_code": "code"},
        }
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Unknown key 'captur' on a 'block' step"
        assert (
            finding["fix"]
            == "Valid keys: capture, element_types, key, label, profiles, secret_outputs, settings"
        )

    def test_unknown_key_inside_a_construct(self) -> None:
        step = {"if": {"when": "x == 1", "then": [LOG_STEP], "bogus_key": 5}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["step"] == "flow[0].if"
        assert finding["problem"] == "Unknown key 'bogus_key' on an 'if' construct"


FUNCTION_STEP: dict[str, Any] = {
    "function": "fetch_status",
    "version": "1.2.0",
    "label": "Check health",
    "settings": {"url": {"expr": "base_url + '/health'"}, "level": "low"},
    "element_types": {"tags": ["string", "integer"]},
    "capture": {"status": "health_status"},
    "secret_outputs": ["token"],
}


class TestFunctionStepForm:
    """A Function Block step has the same form as a block step, plus its version (REQ-5.2.7.3)."""

    def test_every_function_step_key_is_accepted(self) -> None:
        doc, findings = parse(make_recipe([FUNCTION_STEP]))
        assert findings == []
        assert doc is not None
        assert doc.flow == [FUNCTION_STEP]

    def test_a_bare_function_step_parses_clean(self) -> None:
        doc, findings = parse(make_recipe([{"function": "fetch_status"}]))
        assert findings == []
        assert doc is not None

    def test_a_function_step_parses_inside_a_construct_and_a_function_flow(self) -> None:
        step = {"function": "inner", "settings": {"n": 1}}
        functions = [{"name": "outer", "inputs": [], "outputs": [], "flow": [step]}]
        flow = [{"if": {"when": "x == 1", "then": [step]}}]
        doc, findings = parse(make_recipe(flow, functions=functions))
        assert findings == []
        assert doc is not None

    def test_an_unknown_key_beside_a_function_step_is_refused(self) -> None:
        step = {"function": "fetch_status", "invalid_key": {"url": "http://x"}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        assert findings == [
            {
                "step": "flow[0]",
                "code": "UNKNOWN_STEP_KEY",
                "severity": "error",
                "problem": "Unknown key 'invalid_key' on a 'function' step",
                "fix": FUNCTION_STEP_KEYS_FIX,
            }
        ]

    def test_the_inputs_key_is_refused(self) -> None:
        step = {"function": "fetch_status", "inputs": {"url": "http://x"}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Unknown key 'inputs' on a 'function' step"
        assert finding["fix"] == FUNCTION_STEP_KEYS_FIX

    def test_the_call_keyword_is_an_unknown_step_keyword(self) -> None:
        step = {"call": {"function": "fetch_status", "inputs": {"url": "http://x"}}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        assert findings == [
            {
                "step": "flow[0]",
                "code": "UNKNOWN_STEP_KEYWORD",
                "severity": "error",
                "problem": "Unknown step keyword 'call'",
                "fix": VALID_KEYWORDS_FIX,
            }
        ]

    def test_version_stays_off_a_block_step(self) -> None:
        step = {"block": "log", "version": "1.0.0", "settings": {"message": "hi"}}
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["problem"] == "Unknown key 'version' on a 'block' step"


SWITCH_KEYS_FIX = "Valid keys: cases, default, label"

BARE_ON_SWITCH_RECIPE = """\
test: {name: T}
flow:
  - switch:
      on: health
      cases:
        - when: "health == 200"
          steps:
            - block: log
              settings: {message: hello}
"""


def _switch_step(**extra: Any) -> dict[str, Any]:
    construct: dict[str, Any] = {"cases": [{"when": "x == 1", "steps": [LOG_STEP]}]}
    construct.update(extra)
    return {"switch": construct}


class TestSwitchConstructKeys:
    """Switch takes condition-guarded cases; the value-matching keys are gone."""

    def test_condition_guarded_switch_parses_clean(self) -> None:
        doc, findings = parse(make_recipe([_switch_step(default=[LOG_STEP])]))
        assert findings == []
        assert doc is not None

    def test_a_case_may_carry_a_break_flag(self) -> None:
        step = {
            "switch": {
                "cases": [
                    {"when": "x == 1", "break": False, "steps": [LOG_STEP]},
                    {"when": "x == 2", "steps": [LOG_STEP]},
                ]
            }
        }
        doc, findings = parse(make_recipe([step]))
        assert findings == []
        assert doc is not None

    def test_on_key_is_rejected(self) -> None:
        doc, findings = parse(make_recipe([_switch_step(on="health")]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].switch"
        assert finding["problem"] == "Unknown key 'on' on a 'switch' construct"
        assert finding["fix"] == SWITCH_KEYS_FIX

    def test_capture_key_is_rejected(self) -> None:
        doc, findings = parse(make_recipe([_switch_step(capture={"status_code": "code"})]))
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].switch"
        assert finding["problem"] == "Unknown key 'capture' on a 'switch' construct"
        assert finding["fix"] == SWITCH_KEYS_FIX

    def test_bare_on_key_is_reported_under_its_real_name(self) -> None:
        """YAML 1.1 reads a bare 'on:' as boolean True; the report must still say 'on'."""
        doc, findings = parse(BARE_ON_SWITCH_RECIPE)
        assert doc is None
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["step"] == "flow[0].switch"
        assert finding["problem"] == "Unknown key 'on' on a 'switch' construct"
        assert finding["fix"] == SWITCH_KEYS_FIX


COMPARISON_KEYS_FIX = "Valid keys: operator, value, value_type, variable"
PROFILE_BINDING_KEYS_FIX = "Valid keys: alias, fields, profile"
HTTP_SETTINGS: dict[str, Any] = {"url": "http://x", "method": "GET"}


def _comparison(**extra: Any) -> dict[str, Any]:
    return {"variable": "x", "operator": "equals", "value": 1, **extra}


NESTED_KEY_CASES = [
    pytest.param(
        {
            "if": {
                "when": "x == 1",
                "then": [LOG_STEP],
                "elif": [{"when": "x == 2", "then": [LOG_STEP], "invalid_key": []}],
            }
        },
        "flow[0].if.elif[0]",
        "Unknown key 'invalid_key' on an 'elif' entry",
        "Valid keys: then, when",
        id="elif-entry",
    ),
    pytest.param(
        {"switch": {"cases": [{"when": "x == 1", "steps": [LOG_STEP], "brake": False}]}},
        "flow[0].switch.cases[0]",
        "Unknown key 'brake' on a 'switch' case",
        "Valid keys: break, steps, when",
        id="switch-case",
    ),
    pytest.param(
        {
            "parallel": {
                "branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP], "invalid_key": 5}]
            }
        },
        "flow[0].parallel.branches[1]",
        "Unknown key 'invalid_key' on a 'parallel' branch",
        "Valid keys: name, steps, time_limit",
        id="parallel-branch",
    ),
    pytest.param(
        {"for": {"range": {"start": 0, "end": 3, "stpe": 1}, "body": [LOG_STEP]}},
        "flow[0].for.range",
        "Unknown key 'stpe' on a 'for' range",
        "Valid keys: end, start, step",
        id="for-range",
    ),
    pytest.param(
        {"if": {"when": _comparison(invalid_key="integer"), "then": [LOG_STEP]}},
        "flow[0].if.when",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="if-when",
    ),
    pytest.param(
        {
            "if": {
                "when": "x == 1",
                "then": [LOG_STEP],
                "elif": [{"when": _comparison(invalid_key=2), "then": [LOG_STEP]}],
            }
        },
        "flow[0].if.elif[0].when",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="elif-when",
    ),
    pytest.param(
        {"switch": {"cases": [{"when": _comparison(invalid_key="equals"), "steps": [LOG_STEP]}]}},
        "flow[0].switch.cases[0].when",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="case-when",
    ),
    pytest.param(
        {"while": {"conditions": _comparison(invalid_key="y"), "body": [LOG_STEP]}},
        "flow[0].while.conditions",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="while-one-condition",
    ),
    pytest.param(
        {"while": {"conditions": ["x == 1", _comparison(negate=True)], "body": [LOG_STEP]}},
        "flow[0].while.conditions[1]",
        "Unknown key 'negate' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="while-condition-list",
    ),
    pytest.param(
        {"assert": {"that": [_comparison(invalid_key=1)]}},
        "flow[0].assert.that[0]",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="assert-that",
    ),
    pytest.param(
        {"wait_until": {"that": ["x == 1", _comparison(invalid_key=1)], "timeout": 1000}},
        "flow[0].wait_until.that[1]",
        "Unknown key 'invalid_key' on a comparison condition",
        COMPARISON_KEYS_FIX,
        id="wait-until-that",
    ),
    pytest.param(
        {
            "block": "http-client",
            "settings": HTTP_SETTINGS,
            "profiles": [{"profile": "creds", "alias": "cred", "invalid_key": ["username"]}],
        },
        "flow[0].profiles[0]",
        "Unknown key 'invalid_key' on a profile binding",
        PROFILE_BINDING_KEYS_FIX,
        id="block-profile-binding",
    ),
    pytest.param(
        {
            "remote": {
                "settings": {"session_id": {"expr": "sid"}},
                "body": [LOG_STEP],
                "profiles": [{"profile": "creds", "invalid_key": "c"}],
            }
        },
        "flow[0].remote.profiles[0]",
        "Unknown key 'invalid_key' on a profile binding",
        PROFILE_BINDING_KEYS_FIX,
        id="remote-profile-binding",
    ),
]


class TestNestedEntryKeys:
    """An entry nested inside a step refuses a key the format does not define, never drops it
    (REQ-5.2.7.3)."""

    @pytest.mark.parametrize(("step", "path", "problem", "fix"), NESTED_KEY_CASES)
    def test_an_unknown_key_is_refused(
        self, step: dict[str, Any], path: str, problem: str, fix: str
    ) -> None:
        doc, findings = parse(make_recipe([step]))
        assert doc is None
        assert findings == [
            {
                "step": path,
                "code": "UNKNOWN_STEP_KEY",
                "severity": "error",
                "problem": problem,
                "fix": fix,
            }
        ]

    def test_every_defined_nested_key_parses_clean(self) -> None:
        flow = [
            {
                "if": {
                    "when": _comparison(value_type="integer"),
                    "then": [LOG_STEP],
                    "elif": [{"when": "x == 2", "then": [LOG_STEP]}],
                }
            },
            {"switch": {"cases": [{"when": _comparison(), "steps": [LOG_STEP], "break": False}]}},
            {
                "parallel": {
                    "branches": [
                        {"name": "a", "steps": [LOG_STEP], "time_limit": 5},
                        {"steps": [LOG_STEP]},
                    ]
                }
            },
            {"for": {"range": {"start": 0, "end": 3, "step": 1}, "body": [LOG_STEP]}},
            {"while": {"conditions": [_comparison(), "x == 1"], "body": [LOG_STEP]}},
            {"assert": {"that": [_comparison()]}},
            {
                "block": "http-client",
                "settings": HTTP_SETTINGS,
                "profiles": [{"profile": "creds", "alias": "cred", "fields": ["username"]}],
            },
        ]
        doc, findings = parse(make_recipe(flow))
        assert findings == []
        assert doc is not None

    def test_a_condition_list_given_as_text_is_left_to_the_validator(self) -> None:
        doc, findings = parse(make_recipe([{"assert": {"that": "x == 1"}}]))
        assert findings == []
        assert doc is not None


KEYWORD_STEPS: list[tuple[str, dict[str, Any]]] = [
    ("block", {"block": "http-client"}),
    ("function", {"function": "helper"}),
    ("if", {"if": {"when": "x == 1", "then": [LOG_STEP]}}),
    ("switch", {"switch": {"cases": [{"when": "x == 1", "steps": [LOG_STEP]}]}}),
    ("for", {"for": {"count": 1, "body": [LOG_STEP]}}),
    ("for_each", {"for_each": {"collection": {"expr": "items"}, "body": [LOG_STEP]}}),
    ("while", {"while": {"conditions": "x == 1", "body": [LOG_STEP]}}),
    ("try", {"try": {"steps": [LOG_STEP]}}),
    ("parallel", {"parallel": {"branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}]}}),
    ("assert", {"assert": {"that": ["x == 1"]}}),
    (
        "remote",
        {"remote": {"settings": {"session_id": {"expr": "sid"}}, "body": [LOG_STEP]}},
    ),
    ("set", {"set": {"counter": 1}}),
    ("delay", {"delay": 500}),
    ("wait_until", {"wait_until": {"that": ["x == 1"], "timeout": 1000, "retry": [LOG_STEP]}}),
    ("halt", {"halt": {}}),
    ("break", {"break": {}}),
    ("continue", {"continue": {}}),
    ("note", {"note": {"text": "hi"}}),
]


class TestStepKeywordRecognition:
    @pytest.mark.parametrize(("keyword", "step"), KEYWORD_STEPS, ids=[k for k, _ in KEYWORD_STEPS])
    def test_keyword_parses_without_findings(self, keyword: str, step: dict[str, Any]) -> None:
        doc, findings = parse(make_recipe([step]))
        assert findings == []
        assert doc is not None


def _if_with(then: list[Any] | None = None, **sections: Any) -> dict[str, Any]:
    construct: dict[str, Any] = {"when": "x == 1", "then": then if then is not None else [LOG_STEP]}
    construct.update(sections)
    return {"if": construct}


BROKEN = 42

STEP_PATH_CASES: list[tuple[str, list[Any], str]] = [
    ("top-level", [LOG_STEP, BROKEN], "flow[1]"),
    ("if-then", [_if_with(then=[LOG_STEP, BROKEN])], "flow[0].if.then[1]"),
    (
        "if-elif-then",
        [_if_with(**{"elif": [{"when": "y == 2", "then": [BROKEN]}]})],
        "flow[0].if.elif[0].then[0]",
    ),
    ("if-else", [_if_with(**{"else": [BROKEN]})], "flow[0].if.else[0]"),
    (
        "switch-case-steps",
        [
            {
                "switch": {
                    "cases": [
                        {"when": "x == 1", "steps": [LOG_STEP]},
                        {"when": "x == 2", "steps": [BROKEN]},
                    ],
                }
            }
        ],
        "flow[0].switch.cases[1].steps[0]",
    ),
    (
        "switch-default",
        [
            {
                "switch": {
                    "cases": [{"when": "x == 1", "steps": [LOG_STEP]}],
                    "default": [BROKEN],
                }
            }
        ],
        "flow[0].switch.default[0]",
    ),
    ("for-body", [{"for": {"count": 1, "body": [BROKEN]}}], "flow[0].for.body[0]"),
    (
        "for-each-body",
        [{"for_each": {"collection": {"expr": "items"}, "body": [LOG_STEP, BROKEN]}}],
        "flow[0].for_each.body[1]",
    ),
    (
        "while-body",
        [{"while": {"conditions": "x == 1", "body": [BROKEN]}}],
        "flow[0].while.body[0]",
    ),
    (
        "wait-until-retry",
        [{"wait_until": {"that": ["x == 1"], "timeout": 1, "retry": [LOG_STEP, BROKEN]}}],
        "flow[0].wait_until.retry[1]",
    ),
    ("try-steps", [{"try": {"steps": [BROKEN]}}], "flow[0].try.steps[0]"),
    (
        "try-catch",
        [{"try": {"steps": [LOG_STEP], "catch": [BROKEN]}}],
        "flow[0].try.catch[0]",
    ),
    (
        "try-finally",
        [{"try": {"steps": [LOG_STEP], "finally": [LOG_STEP, BROKEN]}}],
        "flow[0].try.finally[1]",
    ),
    (
        "parallel-branch-steps",
        [{"parallel": {"branches": [{"steps": [LOG_STEP]}, {"steps": [BROKEN]}]}}],
        "flow[0].parallel.branches[1].steps[0]",
    ),
    (
        "assert-on-pass",
        [{"assert": {"that": ["x == 1"], "on_pass": [BROKEN], "on_fail": [LOG_STEP]}}],
        "flow[0].assert.on_pass[0]",
    ),
    (
        "assert-on-fail",
        [{"assert": {"that": ["x == 1"], "on_pass": [LOG_STEP], "on_fail": [BROKEN]}}],
        "flow[0].assert.on_fail[0]",
    ),
    (
        "remote-body",
        [{"remote": {"settings": {"session_id": {"expr": "sid"}}, "body": [BROKEN]}}],
        "flow[0].remote.body[0]",
    ),
]


class TestStepPathGrammar:
    @pytest.mark.parametrize(
        ("label", "flow", "expected_step"),
        STEP_PATH_CASES,
        ids=[case[0] for case in STEP_PATH_CASES],
    )
    def test_nested_finding_carries_the_recipe_path(
        self, label: str, flow: list[Any], expected_step: str
    ) -> None:
        doc, findings = parse(make_recipe(flow))
        assert doc is None
        finding = find_finding(findings, "INVALID_STEP")
        assert finding["step"] == expected_step

    def test_local_function_flow_path(self) -> None:
        functions = [{"name": "fetch", "inputs": [], "outputs": [], "flow": [BROKEN]}]
        doc, findings = parse(make_recipe([LOG_STEP], functions=functions))
        assert doc is None
        finding = find_finding(findings, "INVALID_STEP")
        assert finding["step"] == "functions[fetch].flow[0]"

    def test_nested_path_inside_local_function(self) -> None:
        functions = [
            {
                "name": "fetch",
                "inputs": [],
                "outputs": [],
                "flow": [{"for": {"count": 1, "body": [BROKEN]}}],
            }
        ]
        doc, findings = parse(make_recipe([LOG_STEP], functions=functions))
        assert doc is None
        finding = find_finding(findings, "INVALID_STEP")
        assert finding["step"] == "functions[fetch].flow[0].for.body[0]"


class TestParserResultContract:
    def test_clean_recipe_parses_with_no_findings(self) -> None:
        text = make_recipe(
            [LOG_STEP],
            variables={"base_url": {"type": "string", "value": "http://shop.local"}},
        )
        doc, findings = parse(text)
        assert findings == []
        assert doc is not None

    def test_doc_is_none_whenever_findings_exist(self) -> None:
        doc, findings = parse(make_recipe([BROKEN]))
        assert findings != []
        assert doc is None

    def test_all_parser_findings_are_error_severity(self) -> None:
        _doc, findings = parse(make_recipe(["broken", {"invalid_keyword": "x"}]))
        assert findings != []
        assert all(finding["severity"] == "error" for finding in findings)


class TestMalformedSections:
    """Non-list functions, malformed function entries, non-mapping variables."""

    def test_functions_section_must_be_a_list(self) -> None:
        doc, findings = parse("test: {name: T}\nfunctions: {oops: true}\nflow:\n  - block: log\n")
        assert doc is None
        finding = find_finding(findings, "INVALID_CONSTRUCT")
        assert finding["step"] == "functions"
        assert finding["problem"] == (
            "'functions' construct is malformed: must be a list of function definitions"
        )

    def test_function_entry_needs_a_name_and_a_flow(self) -> None:
        doc, findings = parse(
            "test: {name: T}\nfunctions:\n  - name: incomplete\nflow:\n  - block: log\n"
        )
        assert doc is None
        finding = find_finding(findings, "INVALID_CONSTRUCT")
        assert finding["step"] == "functions"
        assert finding["problem"] == (
            "'functions' construct is malformed: each entry needs a name and a flow list"
        )

    def test_variables_section_must_be_a_mapping(self) -> None:
        doc, findings = parse(
            "test: {name: T}\nvariables:\n  - not-a-mapping\nflow:\n  - block: log\n"
        )
        assert doc is None
        finding = find_finding(findings, "INVALID_CONSTRUCT")
        assert finding["step"] == "variables"
        assert finding["problem"] == (
            "'variables' construct is malformed: must be a mapping of name -> declaration"
        )

    def test_a_local_function_variables_section_must_be_a_mapping(self) -> None:
        doc, findings = parse(
            "test: {name: T}\nfunctions:\n  - name: helper\n    variables: [1, 2]\n"
            "    flow:\n      - block: log\nflow:\n  - block: log\n"
        )
        assert doc is None
        assert find_finding(findings, "INVALID_CONSTRUCT") == {
            "step": "functions[helper].variables",
            "code": "INVALID_CONSTRUCT",
            "severity": "error",
            "problem": (
                "'variables' construct is malformed: must be a mapping of name -> declaration"
            ),
            "fix": None,
        }


VARIABLE_KEYS_FIX = (
    "Valid keys: element_types, expr, secret, template, type, value, value_from_file"
)
INPUT_KEYS_FIX = (
    "Valid keys: default, description, element_types, enumValues, name, required, secret, type"
)
OUTPUT_KEYS_FIX = (
    "Valid keys: default, description, element_types, expr, name, secret, template, type"
)
FUNCTION_KEYS_FIX = "Valid keys: flow, inputs, name, outputs, variables"

OLD_ARRAY_ENUM_INPUT: dict[str, Any] = {
    "name": "level",
    "type": "array",
    "required": True,
    "enumValueType": "string",
    "enumValues": ["low", "high"],
}


def _function(**entry: Any) -> dict[str, Any]:
    return {"name": "f", "flow": [LOG_STEP], **entry}


def _unknown_key(step: str, problem: str, fix: str) -> dict[str, Any]:
    return {
        "step": step,
        "code": "UNKNOWN_KEY",
        "severity": "error",
        "problem": problem,
        "fix": fix,
    }


DECLARATION_KEY_CASES = [
    pytest.param(
        dump_recipe({"test": {"name": "T"}, "flow": [LOG_STEP], "invalid_key": "x"}),
        "recipe",
        "Unknown key 'invalid_key' on the recipe",
        "Valid keys: flow, functions, test, variables",
        id="top-level",
    ),
    pytest.param(
        dump_recipe({"test": {"name": "T", "tag": ["smoke"]}, "flow": [LOG_STEP]}),
        "test",
        "Unknown key 'tag' on the test section",
        "Valid keys: description, name, tags, version",
        id="test-section",
    ),
    pytest.param(
        make_recipe([LOG_STEP], variables={"x": {"type": "string", "invalid_key": "x"}}),
        "variables.x",
        "Unknown key 'invalid_key' on variable 'x'",
        VARIABLE_KEYS_FIX,
        id="test-variable",
    ),
    pytest.param(
        make_recipe([LOG_STEP], functions=[_function(invalid_key="x")]),
        "functions[f]",
        "Unknown key 'invalid_key' on function 'f'",
        FUNCTION_KEYS_FIX,
        id="function-entry",
    ),
    pytest.param(
        make_recipe(
            [LOG_STEP],
            functions=[_function(variables={"v": {"type": "integer", "invalid_key": 1}})],
        ),
        "functions[f].variables.v",
        "Unknown key 'invalid_key' on variable 'v'",
        VARIABLE_KEYS_FIX,
        id="function-variable",
    ),
    pytest.param(
        make_recipe([LOG_STEP], functions=[_function(inputs=[OLD_ARRAY_ENUM_INPUT])]),
        "functions[f].inputs.level",
        "Unknown key 'enumValueType' on input 'level'",
        INPUT_KEYS_FIX,
        id="input-old-enum-value-type",
    ),
    pytest.param(
        make_recipe(
            [LOG_STEP],
            functions=[
                _function(inputs=[{"name": "port", "type": "integer", "invalid_key": True}])
            ],
        ),
        "functions[f].inputs.port",
        "Unknown key 'invalid_key' on input 'port'",
        INPUT_KEYS_FIX,
        id="input-unknown-key",
    ),
    pytest.param(
        make_recipe(
            [LOG_STEP],
            functions=[_function(outputs=[{"name": "r", "type": "string", "enumValues": ["a"]}])],
        ),
        "functions[f].outputs.r",
        "Unknown key 'enumValues' on output 'r'",
        OUTPUT_KEYS_FIX,
        id="output",
    ),
]


class TestDeclarationKeys:
    """A key the format does not define is refused on every declaration, never dropped
    (REQ-5.2.7.3)."""

    @pytest.mark.parametrize(("recipe", "step", "problem", "fix"), DECLARATION_KEY_CASES)
    def test_an_unknown_key_is_refused(
        self, recipe: str, step: str, problem: str, fix: str
    ) -> None:
        doc, findings = parse(recipe)
        assert doc is None
        assert findings == [_unknown_key(step, problem, fix)]

    def test_every_unknown_key_of_one_declaration_is_reported(self) -> None:
        variables = {"x": {"type": "string", "invalid_key_b": "a", "invalid_key_a": True}}
        doc, findings = parse(make_recipe([LOG_STEP], variables=variables))
        assert doc is None
        assert sorted(findings, key=lambda item: item["problem"]) == [
            _unknown_key(
                "variables.x", "Unknown key 'invalid_key_a' on variable 'x'", VARIABLE_KEYS_FIX
            ),
            _unknown_key(
                "variables.x", "Unknown key 'invalid_key_b' on variable 'x'", VARIABLE_KEYS_FIX
            ),
        ]

    def test_every_defined_key_is_accepted(self) -> None:
        text = dump_recipe(
            {
                "test": {"name": "T", "description": "d", "tags": ["smoke"], "version": "1.0.0"},
                "variables": {
                    "ids": {"type": "array", "value": [1], "element_types": ["integer"]},
                    "doubled": {"type": "integer", "expr": "2 * 2"},
                    "label": {"type": "string", "template": "id-{{ doubled }}"},
                    "token": {"type": "string", "secret": True, "value_from_file": "token.txt"},
                },
                "functions": [
                    {
                        "name": "f",
                        "inputs": [
                            {
                                "name": "level",
                                "type": "string",
                                "required": True,
                                "enumValues": ["low", "high"],
                                "default": "low",
                                "description": "How loud",
                            },
                            {"name": "tok", "type": "string", "secret": True},
                            {"name": "nums", "type": "array", "default": [1], "element_types": []},
                        ],
                        "outputs": [
                            {
                                "name": "out",
                                "type": "string",
                                "default": "x",
                                "secret": True,
                                "description": "Result",
                            },
                            {"name": "more", "type": "array", "default": [1], "element_types": []},
                            {"name": "size", "type": "integer", "expr": "1 + 1"},
                            {"name": "tag", "type": "string", "template": "t-{{ level }}"},
                        ],
                        "variables": {
                            "count": {"type": "integer", "value": 0},
                            "seen": {"type": "array", "value": [], "element_types": []},
                            "twice": {"type": "integer", "expr": "count * 2"},
                            "note": {"type": "string", "template": "n-{{ count }}"},
                            "key": {"type": "string", "secret": True, "value_from_file": "k.txt"},
                        },
                        "flow": [LOG_STEP],
                    }
                ],
                "flow": [LOG_STEP],
            }
        )
        doc, findings = parse(text)
        assert findings == []
        assert doc is not None

    @pytest.mark.parametrize(("kind", "source"), [("expr", "1 + 1"), ("template", "id-{{ x }}")])
    def test_an_input_kind_is_left_to_the_validator(self, kind: str, source: str) -> None:
        # INPUT_KIND_NOT_ALLOWED names these; an unknown-key finding would hide it.
        inputs = [{"name": "n", "type": "string", kind: source}]
        doc, findings = parse(make_recipe([LOG_STEP], functions=[_function(inputs=inputs)]))
        assert findings == []
        assert doc is not None

    def test_a_non_mapping_declaration_is_left_to_the_validator(self) -> None:
        doc, findings = parse(make_recipe([LOG_STEP], variables={"bare": 5}))
        assert findings == []
        assert doc is not None

    def test_a_non_mapping_parameter_item_has_no_keys_to_refuse(self) -> None:
        function = _function(inputs=["port"], outputs=[5])
        doc, findings = parse(make_recipe([LOG_STEP], functions=[function]))
        assert findings == []
        assert doc is not None

    @pytest.mark.parametrize("in_function", [False, True], ids=["test-flow", "function-flow"])
    def test_a_step_keeps_its_own_code(self, in_function: bool) -> None:
        step = {"block": "log", "settings": {"message": "hi"}, "captur": {"x": "y"}}
        if in_function:
            recipe = make_recipe([LOG_STEP], functions=[{"name": "f", "flow": [step]}])
        else:
            recipe = make_recipe([step])
        doc, findings = parse(recipe)
        assert doc is None
        assert codes(findings) == ["UNKNOWN_STEP_KEY"]


RECIPE_WITH_A_PAIR = (
    'test:\n  name: "Ok \\uD83D\\uDE00"\nflow:\n- block: log\n  settings:\n    message: hello\n'
)


def _unencodable(where: str) -> str:
    return (
        f"Recipe has a character at {where} that cannot be encoded as UTF-8: remove or replace it"
    )


class TestTextUtf8CannotWrite:
    """A recipe holding such text is a parse error finding with no document (REQ-4.6.9)."""

    @pytest.mark.parametrize(
        ("recipe", "where"),
        [
            pytest.param(make_recipe([LOG_STEP], name="Cafe\udce9"), "test.name", id="test-name"),
            pytest.param(
                make_recipe([{"block": "log", "settings": {"message": "cafe\ud83d"}}]),
                "flow[0].settings.message",
                id="step-setting",
            ),
            pytest.param(
                make_recipe([LOG_STEP], variables={"ab\udce9c": {"type": "string"}}),
                "variables.ab?c",
                id="variable-name",
            ),
            pytest.param(
                'test:\n  name: "Cafe\\U0000DCE9"\nflow: []\n', "test.name", id="eight-digit"
            ),
            pytest.param('"cafe\\uDCE9"', "the recipe", id="the-whole-recipe"),
        ],
    )
    def test_the_finding_names_the_place(self, recipe: str, where: str) -> None:
        doc, findings = parse(recipe)

        assert doc is None
        assert findings == [
            {
                "step": "recipe",
                "code": "RECIPE_PARSE_ERROR",
                "severity": "error",
                "problem": _unencodable(where),
                "fix": None,
            }
        ]

    def test_a_character_written_as_two_escapes_is_that_character(self) -> None:
        doc, findings = parse(RECIPE_WITH_A_PAIR)

        assert findings == []
        assert doc.name == "Ok 😀"

    def test_the_same_characters_outside_double_quotes_are_plain_text(self) -> None:
        recipe = (
            "test:\n  name: C:\\uDCE9 kept\nflow:\n- block: log\n  settings:\n    message: hello\n"
        )

        doc, findings = parse(recipe)

        assert findings == []
        assert doc.name == r"C:\uDCE9 kept"
