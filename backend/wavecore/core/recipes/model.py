"""Recipe document model, finding shape, and the shared step-path grammar."""

from dataclasses import dataclass, field
from typing import Any

STEP_KEYWORDS = (
    "block",
    "function",
    "if",
    "switch",
    "for",
    "for_each",
    "while",
    "try",
    "parallel",
    "assert",
    "remote",
    "set",
    "delay",
    "wait_until",
    "halt",
    "break",
    "continue",
    "note",
)

STEP_SIBLING_KEYS = frozenset({"label", "settings", "capture", "profiles", "key", "element_types"})

# A block step also marks its Secret outputs beside its capture (SECUI-3/4).
BLOCK_STEP_KEYS = STEP_SIBLING_KEYS | {"secret_outputs"}

# A Function Block step is a block step that also pins a library Function's version.
FUNCTION_STEP_KEYS = BLOCK_STEP_KEYS | {"version"}

_STEP_KEYS = {"block": BLOCK_STEP_KEYS, "function": FUNCTION_STEP_KEYS}


def step_sibling_keys(keyword: str) -> frozenset[str]:
    """The keys a step of this keyword accepts beside its keyword."""
    return _STEP_KEYS.get(keyword, STEP_SIBLING_KEYS)


# Keys each construct's own mapping accepts. An unrecognized key is silently
# discarded at compile, so the format rejects it instead.
CONSTRUCT_KEYS: dict[str, frozenset[str]] = {
    "if": frozenset({"label", "when", "then", "elif", "else", "capture"}),
    "switch": frozenset({"label", "cases", "default"}),
    "for": frozenset({"label", "count", "range", "timeout", "body", "capture"}),
    "for_each": frozenset({"label", "collection", "timeout", "body", "capture"}),
    "while": frozenset(
        {"label", "conditions", "mode", "max_iterations", "timeout", "body", "capture"}
    ),
    "try": frozenset({"label", "steps", "catch", "finally", "capture"}),
    "parallel": frozenset({"label", "branches", "join", "time_limit"}),
    "assert": frozenset(
        {"label", "that", "fail_current_scope", "mode", "on_pass", "on_fail", "capture"}
    ),
    "remote": frozenset({"label", "settings", "body", "capture", "profiles"}),
    "wait_until": frozenset(
        {
            "label",
            "that",
            "timeout",
            "interval",
            "message",
            "fail_current_scope",
            "retry",
            "capture",
        }
    ),
}

# Keys of the entries nested inside a step; any other key is refused, never dropped.
ELIF_ENTRY_KEYS = frozenset({"when", "then"})
SWITCH_CASE_KEYS = frozenset({"when", "steps", "break"})
PARALLEL_BRANCH_KEYS = frozenset({"name", "steps", "time_limit"})
FOR_RANGE_KEYS = frozenset({"start", "end", "step"})
COMPARISON_KEYS = frozenset({"variable", "operator", "value", "value_type"})
PROFILE_BINDING_KEYS = frozenset({"profile", "alias", "fields"})

# Keys each declaration accepts; any other key is refused, never dropped.
RECIPE_KEYS = frozenset({"test", "variables", "functions", "flow"})
TEST_SECTION_KEYS = frozenset({"name", "description", "tags", "version"})
VARIABLE_KEYS = frozenset(
    {"type", "value", "expr", "template", "secret", "element_types", "value_from_file"}
)
FUNCTION_ENTRY_KEYS = frozenset({"name", "inputs", "outputs", "variables", "flow"})
INPUT_KEYS = frozenset(
    {"name", "type", "required", "default", "secret", "enumValues", "description", "element_types"}
)
# An input's expr / template is named by INPUT_KIND_NOT_ALLOWED, not as an unknown key.
INPUT_KIND_KEYS = frozenset({"expr", "template"})
OUTPUT_KEYS = frozenset(
    {"name", "type", "default", "secret", "description", "element_types", "expr", "template"}
)


@dataclass
class RecipeDoc:
    """Parsed recipe document; raw step/variable/function shapes, parser-checked."""

    name: str
    description: str | None = None
    tags: list[str] = field(default_factory=list)
    # Set by a readback; amendment refuses when it no longer matches the stored test.
    version: str | None = None
    variables: dict[str, Any] = field(default_factory=dict)
    functions: list[dict[str, Any]] = field(default_factory=list)
    flow: list[Any] = field(default_factory=list)


def finding(
    step: str,
    code: str,
    problem: str,
    fix: str | None,
    severity: str = "error",
) -> dict[str, Any]:
    """One recipe finding in the exact envelope shape the tools return."""
    return {"step": step, "code": code, "severity": severity, "problem": problem, "fix": fix}


def _indexed_sections(entries: Any, prefix: str, key: str) -> list[tuple[str, Any]]:
    if not isinstance(entries, list):
        return []
    return [
        (prefix.format(index=index), entry.get(key))
        for index, entry in enumerate(entries)
        if isinstance(entry, dict)
    ]


def _if_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [
        ("if.then", value.get("then")),
        *_indexed_sections(value.get("elif"), "if.elif[{index}].then", "then"),
        ("if.else", value.get("else")),
    ]


def _switch_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [
        *_indexed_sections(value.get("cases"), "switch.cases[{index}].steps", "steps"),
        ("switch.default", value.get("default")),
    ]


def _body_section(keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [(f"{keyword}.body", value.get("body"))]


def _try_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [
        ("try.steps", value.get("steps")),
        ("try.catch", value.get("catch")),
        ("try.finally", value.get("finally")),
    ]


def _parallel_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return _indexed_sections(value.get("branches"), "parallel.branches[{index}].steps", "steps")


def _assert_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [
        ("assert.on_pass", value.get("on_pass")),
        ("assert.on_fail", value.get("on_fail")),
    ]


def _wait_until_sections(_keyword: str, value: dict[str, Any]) -> list[tuple[str, Any]]:
    return [("wait_until.retry", value.get("retry"))]


_SECTION_BUILDERS = {
    "if": _if_sections,
    "switch": _switch_sections,
    "for": _body_section,
    "for_each": _body_section,
    "while": _body_section,
    "remote": _body_section,
    "try": _try_sections,
    "parallel": _parallel_sections,
    "assert": _assert_sections,
    "wait_until": _wait_until_sections,
}


def child_sections(keyword: str, value: Any) -> list[tuple[str, list[Any]]]:
    """Ordered (path_prefix, steps) child flows of a construct step.

    Only sections that are lists are yielded; shape errors are the
    validator's job. Path prefixes follow the step-path grammar, e.g.
    a step at flow[1] with prefix 'if.then' puts child j at
    'flow[1].if.then[j]'.
    """
    builder = _SECTION_BUILDERS.get(keyword)
    if builder is None or not isinstance(value, dict):
        return []
    return [(prefix, steps) for prefix, steps in builder(keyword, value) if isinstance(steps, list)]
