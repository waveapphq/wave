"""Recipe YAML text -> RecipeDoc, with parse and shape findings.

The parser owns document shape and step-keyword recognition; catalog,
construct-shape, and expression checks belong to the validator.
"""

from collections.abc import Mapping
from typing import Any

import yaml

from wavecore.core.recipes.model import (
    COMPARISON_KEYS,
    CONSTRUCT_KEYS,
    ELIF_ENTRY_KEYS,
    FOR_RANGE_KEYS,
    FUNCTION_ENTRY_KEYS,
    FUNCTION_STEP_KEYS,
    INPUT_KEYS,
    INPUT_KIND_KEYS,
    OUTPUT_KEYS,
    PARALLEL_BRANCH_KEYS,
    PROFILE_BINDING_KEYS,
    RECIPE_KEYS,
    STEP_KEYWORDS,
    SWITCH_CASE_KEYS,
    TEST_SECTION_KEYS,
    VARIABLE_KEYS,
    RecipeDoc,
    child_sections,
    finding,
    step_sibling_keys,
)
from wavecore.core.utf8_text import load_exact_yaml, unencodable_place

_VALID_KEYWORDS_FIX = "Valid keywords: " + ", ".join(STEP_KEYWORDS)

_PROFILE_BINDING = "a profile binding"
# An entry list a construct holds: its key, the keys one entry accepts, what one is called.
_NESTED_ENTRIES: dict[str, tuple[str, frozenset[str], str]] = {
    "if": ("elif", ELIF_ENTRY_KEYS, "an 'elif' entry"),
    "switch": ("cases", SWITCH_CASE_KEYS, "a 'switch' case"),
    "parallel": ("branches", PARALLEL_BRANCH_KEYS, "a 'parallel' branch"),
    "remote": ("profiles", PROFILE_BINDING_KEYS, _PROFILE_BINDING),
}
_CONDITION_LISTS = {"while": "conditions", "assert": "that", "wait_until": "that"}


def _walk_steps(steps: list[Any], path_prefix: str, findings: list[dict[str, Any]]) -> None:
    for index, step in enumerate(steps):
        path = f"{path_prefix}[{index}]"
        if not isinstance(step, dict):
            findings.append(
                finding(
                    path,
                    "INVALID_STEP",
                    "Step must be a mapping with exactly one step keyword",
                    "Use '- block: <id>' or a construct keyword",
                )
            )
            continue
        keywords = [key for key in step if key in STEP_KEYWORDS]
        if len(keywords) != 1:
            known = set(STEP_KEYWORDS) | FUNCTION_STEP_KEYS
            unknown = [key for key in step if key not in known]
            if not keywords and unknown:
                findings.append(
                    finding(
                        path,
                        "UNKNOWN_STEP_KEYWORD",
                        f"Unknown step keyword '{unknown[0]}'",
                        _VALID_KEYWORDS_FIX,
                    )
                )
            else:
                findings.append(
                    finding(
                        path,
                        "INVALID_STEP",
                        "Step must be a mapping with exactly one step keyword",
                        "Use '- block: <id>' or a construct keyword",
                    )
                )
            continue
        keyword = keywords[0]
        if keyword == "switch" and isinstance(step[keyword], dict) and True in step[keyword]:
            # YAML 1.1 parses a bare 'on:' key as boolean True.
            step[keyword].setdefault("on", step[keyword].pop(True))
        _check_unknown_keys(keyword, step, path, findings)
        for prefix, child_steps in child_sections(keyword, step[keyword]):
            _walk_steps(child_steps, f"{path}.{prefix}", findings)


def _article(word: str) -> str:
    return "an" if word[0] in "aeiou" else "a"


def _report_unknown_key(
    key: str,
    allowed: frozenset[str],
    subject: str,
    path: str,
    findings: list[dict[str, Any]],
    code: str = "UNKNOWN_STEP_KEY",
) -> None:
    findings.append(
        finding(
            path,
            code,
            f"Unknown key '{key}' on {subject}",
            "Valid keys: " + ", ".join(sorted(allowed)),
        )
    )


def _check_unknown_keys(
    keyword: str, step: dict[str, Any], path: str, findings: list[dict[str, Any]]
) -> None:
    """Reject keys the format does not define, on the step and inside the construct."""
    siblings = step_sibling_keys(keyword)
    for key in step:
        if key != keyword and key not in siblings:
            _report_unknown_key(
                key, siblings, f"{_article(keyword)} '{keyword}' step", path, findings
            )
    _check_entries(
        step.get("profiles"), PROFILE_BINDING_KEYS, _PROFILE_BINDING, f"{path}.profiles", findings
    )
    allowed = CONSTRUCT_KEYS.get(keyword)
    value = step[keyword]
    if allowed is None or not isinstance(value, dict):
        return
    _check_step_keys(
        value, allowed, f"{_article(keyword)} '{keyword}' construct", f"{path}.{keyword}", findings
    )
    _check_nested_keys(keyword, value, f"{path}.{keyword}", findings)


def _check_step_keys(
    entry: Mapping[Any, Any],
    allowed: frozenset[str],
    subject: str,
    path: str,
    findings: list[dict[str, Any]],
) -> None:
    _check_keys(entry, allowed, subject, path, findings, code="UNKNOWN_STEP_KEY")


def _dict_entries(entries: Any) -> list[tuple[int, dict[Any, Any]]]:
    if not isinstance(entries, list):
        return []
    return [(index, entry) for index, entry in enumerate(entries) if isinstance(entry, dict)]


def _check_entries(
    entries: Any,
    allowed: frozenset[str],
    subject: str,
    path: str,
    findings: list[dict[str, Any]],
) -> None:
    for index, entry in _dict_entries(entries):
        _check_step_keys(entry, allowed, subject, f"{path}[{index}]", findings)


def _conditions(keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    """Each condition a construct holds, by its path under the construct."""
    if keyword == "if":
        return [("when", value.get("when"))] + [
            (f"elif[{index}].when", entry.get("when"))
            for index, entry in _dict_entries(value.get("elif"))
        ]
    if keyword == "switch":
        return [
            (f"cases[{index}].when", entry.get("when"))
            for index, entry in _dict_entries(value.get("cases"))
        ]
    listed = _CONDITION_LISTS.get(keyword)
    if listed is None:
        return []
    held = value.get(listed)
    if not isinstance(held, list):
        return [(listed, held)]
    return [(f"{listed}[{index}]", condition) for index, condition in enumerate(held)]


def _check_nested_keys(
    keyword: str, value: dict[str, Any], path: str, findings: list[dict[str, Any]]
) -> None:
    nested = _NESTED_ENTRIES.get(keyword)
    if nested is not None:
        list_key, allowed, subject = nested
        _check_entries(value.get(list_key), allowed, subject, f"{path}.{list_key}", findings)
    loop_range = value.get("range") if keyword == "for" else None
    if isinstance(loop_range, dict):
        _check_step_keys(loop_range, FOR_RANGE_KEYS, "a 'for' range", f"{path}.range", findings)
    for place, condition in _conditions(keyword, value):
        if isinstance(condition, dict):
            _check_step_keys(
                condition, COMPARISON_KEYS, "a comparison condition", f"{path}.{place}", findings
            )


def _check_keys(
    entry: Mapping[Any, Any],
    allowed: frozenset[str],
    subject: str,
    path: str,
    findings: list[dict[str, Any]],
    *,
    skip: frozenset[str] = frozenset(),
    code: str = "UNKNOWN_KEY",
) -> None:
    """Reject keys the format does not define (REQ-5.2.7.3)."""
    for key in entry:
        if key not in allowed and key not in skip:
            _report_unknown_key(str(key), allowed, subject, path, findings, code)


def _check_variable_keys(
    variables: dict[str, Any], prefix: str, findings: list[dict[str, Any]]
) -> None:
    for name, declaration in variables.items():
        if isinstance(declaration, dict):
            _check_keys(
                declaration, VARIABLE_KEYS, f"variable '{name}'", f"{prefix}.{name}", findings
            )


def _check_parameter_keys(
    entry: dict[str, Any], prefix: str, findings: list[dict[str, Any]]
) -> None:
    for section, noun, allowed, skip in (
        ("inputs", "input", INPUT_KEYS, INPUT_KIND_KEYS),
        ("outputs", "output", OUTPUT_KEYS, frozenset[str]()),
    ):
        items = entry.get(section)
        for item in items if isinstance(items, list) else []:
            if isinstance(item, dict):
                name = item.get("name")
                _check_keys(
                    item,
                    allowed,
                    f"{noun} '{name}'",
                    f"{prefix}.{section}.{name}",
                    findings,
                    skip=skip,
                )


def _check_test_section(raw: dict[str, Any], findings: list[dict[str, Any]]) -> str:
    test = raw.get("test")
    name = None
    if isinstance(test, dict):
        _check_keys(test, TEST_SECTION_KEYS, "the test section", "test", findings)
        name = test.get("name")
    if not isinstance(name, str) or not name.strip():
        findings.append(
            finding(
                "test.name",
                "MISSING_TEST_NAME",
                "test.name is required and must be a non-empty string",
                "Add test.name",
            )
        )
        return ""
    return name


def _check_flow_section(raw: dict[str, Any], findings: list[dict[str, Any]]) -> list[Any]:
    flow = raw.get("flow")
    if not isinstance(flow, list) or not flow:
        findings.append(
            finding(
                "flow",
                "EMPTY_FLOW",
                "flow must be a non-empty list of steps",
                "Add at least one step to flow",
            )
        )
        return []
    return flow


def _check_functions_section(
    raw: dict[str, Any], findings: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    functions = raw.get("functions")
    if functions is None:
        return []
    if not isinstance(functions, list):
        findings.append(
            finding(
                "functions",
                "INVALID_CONSTRUCT",
                "'functions' construct is malformed: must be a list of function definitions",
                None,
            )
        )
        return []
    entries: list[dict[str, Any]] = []
    for entry in functions:
        name = entry.get("name") if isinstance(entry, dict) else None
        flow = entry.get("flow") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.strip() or not isinstance(flow, list):
            findings.append(
                finding(
                    "functions",
                    "INVALID_CONSTRUCT",
                    "'functions' construct is malformed: each entry needs a name and a flow list",
                    None,
                )
            )
            continue
        entries.append(entry)
        _check_keys(
            entry, FUNCTION_ENTRY_KEYS, f"function '{name}'", f"functions[{name}]", findings
        )
        _check_parameter_keys(entry, f"functions[{name}]", findings)
        _check_variables_section(entry, findings, f"functions[{name}].variables")
        _walk_steps(flow, f"functions[{name}].flow", findings)
    return entries


def _check_variables_section(
    raw: dict[str, Any], findings: list[dict[str, Any]], path: str = "variables"
) -> dict[str, Any]:
    variables = raw.get("variables")
    if variables is None:
        return {}
    if not isinstance(variables, dict):
        findings.append(
            finding(
                path,
                "INVALID_CONSTRUCT",
                "'variables' construct is malformed: must be a mapping of name -> declaration",
                None,
            )
        )
        return {}
    _check_variable_keys(variables, path, findings)
    return variables


def parse_recipe(text: str) -> tuple[RecipeDoc | None, list[dict[str, Any]]]:
    """Parse recipe YAML text; on any finding the document is None."""
    findings: list[dict[str, Any]] = []
    try:
        raw = load_exact_yaml(text)
    except yaml.YAMLError as exc:
        reason = " ".join(str(exc).split())
        findings.append(
            finding("recipe", "RECIPE_PARSE_ERROR", f"Recipe is not valid YAML: {reason}", None)
        )
        return None, findings
    where = unencodable_place(text, raw, "the recipe")
    if where is not None:
        problem = (
            f"Recipe has a character at {where} that cannot be encoded as UTF-8: "
            "remove or replace it"
        )
        return None, [finding("recipe", "RECIPE_PARSE_ERROR", problem, None)]

    if not isinstance(raw, dict):
        findings.append(
            finding(
                "recipe",
                "RECIPE_NOT_MAPPING",
                "Recipe must be a YAML mapping with 'test' and 'flow' sections",
                "Start from a worked example returned by get_recipe_guide",
            )
        )
        return None, findings

    _check_keys(raw, RECIPE_KEYS, "the recipe", "recipe", findings)
    name = _check_test_section(raw, findings)
    flow = _check_flow_section(raw, findings)
    variables = _check_variables_section(raw, findings)
    functions = _check_functions_section(raw, findings)
    _walk_steps(flow, "flow", findings)

    if findings:
        return None, findings

    test = raw["test"]
    description = test.get("description")
    tags = test.get("tags")
    version = test.get("version")
    return (
        RecipeDoc(
            name=name,
            description=str(description) if description is not None else None,
            tags=[str(tag) for tag in tags] if isinstance(tags, list) else [],
            version=str(version) if version is not None else None,
            variables=variables,
            functions=functions,
            flow=flow,
        ),
        [],
    )
