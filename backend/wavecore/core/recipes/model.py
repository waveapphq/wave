"""Recipe document model, finding shape, and the shared step-path grammar."""

from collections.abc import Callable, Mapping
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

# A recipe key (dotted for a key inside a mapping, as `range.start`) and the stored field it
# writes.
RecipeKeys = tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class ControlFields:
    """One control step's recipe keys, the stored field each writes, and the stored fields
    the recipe shape carries instead of a key."""

    control_id: str
    keys: RecipeKeys = ()
    structural: frozenset[str] = frozenset()
    # A control whose recipe shape picks its stored `mode`: the extra keys of each mode.
    mode_keys: Mapping[str, RecipeKeys] = field(default_factory=dict)

    def keys_of(self, mode: Any) -> RecipeKeys:
        """The recipe keys a stored Block of this mode holds."""
        if not self.mode_keys:
            return self.keys
        chosen = mode if mode in self.mode_keys else next(iter(self.mode_keys))
        return self.keys + self.mode_keys[chosen]


def _for_mode(value: Mapping[str, Any]) -> str:
    return "range" if "range" in value else "count"


def _wait_until_mode(value: Mapping[str, Any]) -> str:
    return "retry" if isinstance(value.get("retry"), list) else "watch"


# The stored `mode` a recipe shape writes, by step keyword (REQ-5.2.7.3).
_SHAPE_MODES: dict[str, Callable[[Mapping[str, Any]], str]] = {
    "for": _for_mode,
    "wait_until": _wait_until_mode,
}

# Each control step's fields, by step keyword (REQ-5.2.7.3, REQ-5.2.7.6).
CONTROL_FIELDS: dict[str, ControlFields] = {
    "if": ControlFields("if-else", structural=frozenset({"branches"})),
    "switch": ControlFields("switch-case", structural=frozenset({"branches"})),
    "for": ControlFields(
        "for",
        keys=(("timeout", "timeout"),),
        structural=frozenset({"mode"}),
        mode_keys={
            "count": (("count", "count"), ("step", "step")),
            "range": (("range.start", "start"), ("range.end", "end"), ("range.step", "step")),
        },
    ),
    "for_each": ControlFields(
        "for-each",
        keys=(
            ("collection", "collection"),
            ("collection_type", "collection_type"),
            ("timeout", "timeout"),
        ),
    ),
    "while": ControlFields(
        "while",
        keys=(("mode", "mode"), ("max_iterations", "max_iterations"), ("timeout", "timeout")),
        structural=frozenset({"conditions"}),
    ),
    "try": ControlFields(
        "try-catch-finally", structural=frozenset({"enable_catch", "enable_finally"})
    ),
    "parallel": ControlFields(
        "parallel",
        keys=(("join", "join"), ("time_limit", "time_limit")),
        structural=frozenset({"branches"}),
    ),
    "assert": ControlFields(
        "assert",
        keys=(("fail_current_scope", "fail_current_scope"), ("mode", "mode")),
        structural=frozenset({"assertions"}),
    ),
    "wait_until": ControlFields(
        "wait-until",
        keys=(
            ("timeout", "timeout"),
            ("interval", "check_interval"),
            ("message", "message"),
            ("fail_current_scope", "fail_current_scope"),
        ),
        structural=frozenset({"conditions", "mode"}),
    ),
    "set": ControlFields("variable-setter", structural=frozenset({"variables"})),
    "delay": ControlFields("delay", keys=(("duration", "duration"),)),
    "halt": ControlFields(
        "halt", keys=(("scope", "scope"), ("message", "message"), ("status", "status"))
    ),
    "break": ControlFields("break", structural=frozenset({"target_loop"})),
    "continue": ControlFields("continue", structural=frozenset({"target_loop"})),
    "note": ControlFields("note", keys=(("text", "text"), ("color", "color"))),
}

# The step keyword each control is written with, by catalog id.
CONTROL_STEP_KEYWORDS: dict[str, str] = {
    fields.control_id: keyword for keyword, fields in CONTROL_FIELDS.items()
}


def _read_key(value: Mapping[str, Any], key: str) -> tuple[bool, Any]:
    """Whether a recipe mapping holds a (dotted) key, and what it holds there."""
    holder: Any = value
    *heads, last = key.split(".")
    for head in heads:
        holder = holder.get(head) if isinstance(holder, Mapping) else None
    if not isinstance(holder, Mapping) or last not in holder:
        return False, None
    return True, holder[last]


def recipe_field_places(keyword: str, value: Mapping[str, Any]) -> list[tuple[str, str, Any]]:
    """(recipe key, stored field, written value) of each control field a recipe mapping holds."""
    fields = CONTROL_FIELDS[keyword]
    shape_mode = _SHAPE_MODES.get(keyword)
    keys = fields.keys_of(shape_mode(value) if shape_mode else None)
    places: list[tuple[str, str, Any]] = []
    for key, stored in keys:
        held, written = _read_key(value, key)
        if held:
            places.append((key, stored, written))
    return places


def recipe_fields(keyword: str, value: Mapping[str, Any]) -> dict[str, Any]:
    """The stored fields a control step's recipe mapping writes; a mode the shape carries is
    written too (compile, stage 1)."""
    stored = {
        field_name: written for _key, field_name, written in recipe_field_places(keyword, value)
    }
    shape_mode = _SHAPE_MODES.get(keyword)
    if shape_mode is not None:
        stored["mode"] = shape_mode(value)
    return stored


def readback_keys(keyword: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """The recipe keys a control's stored fields read back as; the fields the shape carries
    are left to the shape (readback)."""
    keys = CONTROL_FIELDS[keyword].keys_of(values.get("mode"))
    result: dict[str, Any] = {}
    for key, stored in keys:
        *heads, last = key.split(".")
        holder = result
        for head in heads:
            holder = holder.setdefault(head, {})
        if stored in values:
            holder[last] = values[stored]
    return result


def _value_keys(keyword: str) -> frozenset[str]:
    """The top-level recipe keys of a control step's fields, every mode included."""
    fields = CONTROL_FIELDS.get(keyword)
    if fields is None:
        return frozenset()
    every = list(fields.keys) + [pair for keys in fields.mode_keys.values() for pair in keys]
    return frozenset(key.split(".")[0] for key, _stored in every)


# Beside its keyword a step takes its identity keys; a construct takes only `key`, its own
# keys going inside its mapping.
_STEP_IDENTITY_KEYS = frozenset({"label", "description", "disabled", "key"})
# A block step also marks its Secret outputs beside its capture (SECUI-3/4).
_BLOCK_STEP_KEYS = _STEP_IDENTITY_KEYS | {
    "settings",
    "capture",
    "profiles",
    "element_types",
    "secret_outputs",
}
_CONSTRUCT_STEP_KEYS = frozenset({"key"})

# The keys each step keyword accepts beside the keyword; a Function Block step also pins a
# library Function's version.
STEP_SIBLING_KEYS: dict[str, frozenset[str]] = {
    "block": _BLOCK_STEP_KEYS,
    "function": _BLOCK_STEP_KEYS | {"version"},
    "set": _STEP_IDENTITY_KEYS | {"element_types", "secret_rows"},
    "delay": _STEP_IDENTITY_KEYS,
    "halt": _STEP_IDENTITY_KEYS,
    "break": _STEP_IDENTITY_KEYS,
    "continue": _STEP_IDENTITY_KEYS,
    "note": frozenset({"label", "key"}),
}

# Every key some step accepts beside its keyword.
ALL_STEP_SIBLING_KEYS = frozenset().union(*STEP_SIBLING_KEYS.values())


def step_sibling_keys(keyword: str) -> frozenset[str]:
    """The keys a step of this keyword accepts beside its keyword."""
    return STEP_SIBLING_KEYS.get(keyword, _CONSTRUCT_STEP_KEYS)


_CONSTRUCT_IDENTITY_KEYS = frozenset({"label", "description", "disabled"})
# The keys of each construct's mapping that are not control fields.
_CONSTRUCT_SHAPE_KEYS: dict[str, frozenset[str]] = {
    "if": frozenset({"when", "then", "elif", "else", "if_label", "else_label"}),
    "switch": frozenset({"cases", "default", "default_label"}),
    "for": frozenset({"body", "capture"}),
    "for_each": frozenset({"body", "capture"}),
    "while": frozenset({"conditions", "body", "capture"}),
    "try": frozenset({"steps", "catch", "finally", "capture"}),
    "parallel": frozenset({"branches"}),
    "assert": frozenset({"that", "on_pass", "on_fail", "capture"}),
    "remote": frozenset({"settings", "body", "capture", "profiles"}),
    "wait_until": frozenset({"that", "retry", "capture"}),
}

# Keys each construct's own mapping accepts. An unrecognized key is silently
# discarded at compile, so the format rejects it instead.
CONSTRUCT_KEYS: dict[str, frozenset[str]] = {
    keyword: _CONSTRUCT_IDENTITY_KEYS | shape | _value_keys(keyword)
    for keyword, shape in _CONSTRUCT_SHAPE_KEYS.items()
}

# Keys of the entries nested inside a step; any other key is refused, never dropped.
ELIF_ENTRY_KEYS = frozenset({"label", "when", "then"})
SWITCH_CASE_KEYS = frozenset({"label", "when", "steps", "break"})
PARALLEL_BRANCH_KEYS = frozenset({"name", "steps", "time_limit"})
FOR_RANGE_KEYS = frozenset({"start", "end", "step"})
COMPARISON_KEYS = frozenset({"variable", "operator", "value", "value_type"})
GROUP_KEYS = frozenset({"group"})
# The words that join two conditions of a condition list.
CONDITION_MARKERS = frozenset({"and", "or"})
PROFILE_BINDING_KEYS = frozenset({"profile", "alias", "fields"})

# Keys each declaration accepts; any other key is refused, never dropped.
RECIPE_KEYS = frozenset({"test", "variables", "functions", "flow", "notes"})
TEST_SECTION_KEYS = frozenset({"name", "description", "tags", "version"})
VARIABLE_KEYS = frozenset(
    {"type", "value", "expr", "template", "secret", "element_types", "value_from_file"}
)
FUNCTION_ENTRY_KEYS = frozenset({"name", "inputs", "outputs", "variables", "flow", "notes"})
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
    # The note steps of the Notes beside the flow, with no connection in or out.
    notes: list[Any] = field(default_factory=list)


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
