"""Stage-1 recipe validation against the live catalogs.

Gates unknown blocks and unknown setting names (the platform save pipeline
would silently drop or ignore them), checks setting types and enums, syntax-
checks every expression and template, verifies captures, profiles, function
references, construct shapes, and loop targets. Variable-reference analysis
stays with the platform (stage 2).
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, NamedTuple

from wavecore.api.services.block_node_checks import MAX_DESCRIPTION_LENGTH
from wavecore.api.services.block_schema import block_schema
from wavecore.controls.assertion_evaluator import (
    UNARY_OPERATORS,
    compare_to_type,
    compared_subject,
)
from wavecore.controls.flow import ParallelControl
from wavecore.controls.registry import list_latest_control_metadata
from wavecore.core.execution.field_checks import (
    FieldFinding,
    check_field_value,
    required_findings,
    unknown_field_findings,
)
from wavecore.core.execution.row_checks import (
    template_compare_text,
    template_entry_text,
    template_row_text,
)
from wavecore.core.expressions.template import _TEMPLATE_PATTERN
from wavecore.core.expressions.validator import validate_expression
from wavecore.core.functions.block_fields import function_block_fields, function_block_outputs
from wavecore.core.functions.declarations import (
    DECLARED_TYPES,
    VARIABLE_NAME_PATTERN,
    DeclarationKind,
    declaration_problems,
    input_problems,
    name_collisions,
    name_reason,
)
from wavecore.core.number_rule import (
    MAX_FLOAT_SIG_DIGITS,
    MAX_INTEGER_DIGITS,
    NumberProblem,
    NumberType,
    number_problem,
)
from wavecore.core.plugin_registry import list_plugins
from wavecore.core.recipes.model import (
    CONDITION_MARKERS,
    CONSTRUCT_KEYS,
    CONTROL_FIELDS,
    CONTROL_STEP_KEYWORDS,
    STEP_KEYWORDS,
    RecipeDoc,
    child_sections,
    finding,
    recipe_field_places,
)
from wavecore.core.recipes.typed_elements import (
    element_problems,
    number_cap_words,
    stored_elements,
)
from wavecore.core.table_values import realizes_as_table
from wavecore.plugins._file_paths import (
    has_wildcard,
    resolve_plugin_matches,
    resolve_plugin_path,
)
from wavecore.plugins._ssh_session import SESSION_ID_DESCRIPTION

_LIST_ALL = 10_000
_TESTDATA_SCHEME = "testdata://"
_TESTDATA_NOT_FOUND_FIX = "Upload the file to the test's Test Data or correct the reference"
# Of the controls, only these also take the `- block:` form.
BLOCK_FORM_CONTROLS = frozenset({"delay", "halt"})
REMOTE_STEP_KEYWORD = "remote"
_LOOP_KEYWORDS = frozenset({"for", "for_each", "while"})
_FORM_KEYS = frozenset({"expr", "template", "literal"})
_CONDITION_PROBLEM = "Condition must be an expression string, a comparison mapping or a group"
_CONDITION_FIX = 'Use "expr string", {variable, operator, value} or {group: [...]}'
_TEMPLATE_FORM_FIX = "Write the template as text, or use {expr: ...}"
_TOO_DEEP_FIX = (
    "Make the entry or the whole value {expr: ...}, or wrap plain data in {literal: ...}"
)


class _RowEntry(NamedTuple):
    """One entry of a map or list: its key, step path, recipe place and value."""

    key: Any
    path: str
    place: str
    value: Any


_NUMBER_TYPES: dict[str, NumberType] = {"integer": "integer", "float": "float"}
_CAP_FIXES: dict[NumberProblem, str] = {
    "integer-cap": f"Provide at most {MAX_INTEGER_DIGITS} digits",
    "float-cap": f"Provide at most {MAX_FLOAT_SIG_DIGITS} significant digits",
}

_PY_TO_RECIPE_TYPE: list[tuple[type, str]] = [
    (bool, "boolean"),
    (int, "integer"),
    (float, "float"),
    (Decimal, "float"),
    (str, "string"),
    (list, "array"),
    (dict, "map"),
]

REMOTE_EXECUTION_ENTRY: dict[str, Any] = {
    "id": "remote-execution",
    "name": "Remote Execution",
    "kind": "plugin",
    "version": "1.0.0",
    "parameters": {
        "session_id": {
            "name": "session_id",
            "type": "string",
            "required": True,
            "default": None,
            "description": SESSION_ID_DESCRIPTION,
        }
    },
    "outputs": {
        "remote_session_id": {
            "name": "remote_session_id",
            "type": "string",
            "description": (
                "Handle to the persistent remote worker opened on the SSH session host "
                "for this container"
            ),
        }
    },
    "stub": False,
}


@dataclass
class BlockEntry:
    """Normalized catalog entry shared by the validator and compiler."""

    id: str
    name: str
    kind: str
    version: str
    parameters: dict[str, dict[str, Any]]
    outputs: dict[str, str]
    stub: bool = False
    output_type_when: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    output_name_params: tuple[str, ...] = ()
    # Outputs the schema marks secret: the Secret boxes a new block opens with (K8SCON-4).
    secret_outputs: tuple[str, ...] = ()


def _as_dict(item: Any) -> dict[str, Any]:
    return item if isinstance(item, dict) else item.model_dump()


_DECLARATION_FIXES = {
    "ENUM_INPUT_TYPE": "Declare the input with type string, integer or float",
    "ENUM_INPUT_NOT_REQUIRED": "Add required: true",
    "ENUM_INPUT_EMPTY": "List the allowed values in enumValues",
    "ENUM_VALUE_TYPE": "Give every allowed value the input's type",
    "ENUM_VALUE_EMPTY": "Remove the empty allowed value",
    "ENUM_VALUE_REPEATED": "List each allowed value once",
    "ENUM_INPUT_NO_DEFAULT": "Add a default that is one of enumValues",
    "ENUM_DEFAULT_NOT_ALLOWED": "Pick the default from enumValues",
    "BOOLEAN_INPUT_NO_DEFAULT": "Add default: true or default: false",
    "SECRET_ENUM_INPUT": "Remove secret or enumValues",
    "DUPLICATE_PARAMETER_NAME": "Rename one of them",
}


_RENAME_FIXES: dict[str, str] = {
    "variable": "Rename the variable",
    "local": "Rename the variable",
    "input": "Rename the input",
    "output": "Rename the output",
}


def _shared_declaration_findings(
    name: str, declared_type: Any, kind: DeclarationKind, path: str
) -> list[dict[str, Any]]:
    """The name and type rules a saved Test or Function follows, as recipe findings."""
    fixes = {
        "INVALID_VARIABLE": _RENAME_FIXES[kind],
        "RESERVED_VARIABLE_NAME": _RENAME_FIXES[kind],
        "INVALID_VARIABLE_TYPE": "Use a valid type",
    }
    typed = declared_type if isinstance(declared_type, str) else None
    return [
        finding(path, code, message, fixes.get(code))
        for code, message in declaration_problems(name, typed, None, kind=kind)
    ]


def _input_declaration_findings(item: Mapping[str, Any], path: str) -> list[dict[str, Any]]:
    """Every declaration rule one input breaks; a secret input takes no default (SECUI-10)."""
    findings: list[dict[str, Any]] = []
    if item.get("secret") and item.get("default") is not None:
        findings.append(
            finding(
                path,
                "SECRET_INPUT_DEFAULT",
                f"Secret input '{item.get('name')}' cannot have a default",
                "Remove the default; the Function Block gives the value",
            )
        )
    findings.extend(
        finding(path, code, message, _DECLARATION_FIXES.get(code))
        for code, message in input_problems(item)
    )
    return findings


def _parameter_items(parameters: Any) -> list[dict[str, Any]]:
    """The mapping entries of a Function's `inputs` or `outputs` list."""
    return [item for item in parameters or [] if isinstance(item, dict)]


def _declaring_params(parameters: list[dict[str, Any]]) -> tuple[str, ...]:
    """Names of the parameters whose values declare extra block outputs."""
    return tuple(str(param["name"]) for param in parameters if param.get("declares_outputs"))


def _schema_secret_outputs(outputs: list[dict[str, Any]]) -> tuple[str, ...]:
    return tuple(str(out["name"]) for out in outputs if out.get("secret"))


def _schema_entry(
    block_id: str, name: str, kind: str, version: str, data: Mapping[str, Any]
) -> BlockEntry:
    """A catalog entry whose fields and outputs come from the one Block schema lookup."""
    schema = block_schema(data)
    parameters = [_as_dict(param) for param in schema.fields]
    outputs = [_as_dict(out) for out in schema.outputs]
    return BlockEntry(
        id=block_id,
        name=name,
        kind=kind,
        version=version,
        parameters={str(param["name"]): param for param in parameters},
        outputs={str(out["name"]): str(out.get("type") or "string") for out in outputs},
        stub=kind == "plugin" and not parameters and not outputs,
        output_type_when={
            str(o["name"]): list(o["type_when"]) for o in outputs if o.get("type_when")
        },
        output_name_params=_declaring_params(parameters),
        secret_outputs=_schema_secret_outputs(outputs),
    )


def load_block_catalog() -> dict[str, BlockEntry]:
    """id -> entry for every plugin and control in the live registries."""
    catalog: dict[str, BlockEntry] = {}
    for plugin in list_plugins():
        metadata = plugin.metadata
        plugin_id = str(metadata["id"])
        version = str(metadata.get("version") or "")
        catalog[plugin_id] = _schema_entry(
            plugin_id,
            str(metadata.get("name") or plugin_id),
            "plugin",
            version,
            {"elementType": plugin_id, "nodeType": "plugin", "version": version},
        )
    for metadata in list_latest_control_metadata():
        control_id = str(metadata["id"].value)
        version = str(metadata.get("version") or "")
        catalog[control_id] = _schema_entry(
            control_id,
            str(metadata.get("name") or control_id),
            "control",
            version,
            {"elementType": control_id, "nodeType": "control", "version": version},
        )
    return catalog


def remote_execution_entry() -> BlockEntry:
    """Synthetic catalog entry for the engine-dispatched remote container."""
    entry = REMOTE_EXECUTION_ENTRY
    return BlockEntry(
        id=entry["id"],
        name=entry["name"],
        kind=entry["kind"],
        version=entry["version"],
        parameters=dict(entry["parameters"]),
        outputs={name: str(out["type"]) for name, out in entry["outputs"].items()},
    )


@dataclass
class FunctionContract:
    """The Function a Function step runs: a local recipe Function or a library version."""

    name: str
    lifecycle: str
    inputs: list[dict[str, Any]]
    outputs: list[dict[str, Any]]
    function_id: str | None = None
    version: str | None = None


class FunctionContractError(LookupError):
    """A Function step names no Function it can run; carries the recipe finding."""

    def __init__(self, problem: dict[str, Any]) -> None:
        super().__init__(problem["problem"])
        self.finding = problem


def _list_library_functions() -> dict[str, dict[str, Any]]:
    from wavecore.api.services.functions import service as function_service

    rows = function_service.list_functions(per_page=_LIST_ALL)["data"]
    return {str(row["name"]): row for row in rows}


def resolve_function_contract(
    step: Mapping[str, Any], local_functions: Mapping[str, dict[str, Any]], step_path: str
) -> FunctionContract:
    """The Function a Function step names; raises FunctionContractError when there is none."""
    from wavecore.api.services.functions import service as function_service

    name = str(step.get("function") or "")
    local = local_functions.get(name)
    if local is not None:
        return FunctionContract(
            name=name,
            lifecycle="local",
            inputs=[dict(item) for item in _parameter_items(local.get("inputs"))],
            outputs=[dict(item) for item in _parameter_items(local.get("outputs"))],
        )
    row = _list_library_functions().get(name)
    if row is None:
        raise FunctionContractError(
            finding(
                step_path,
                "UNKNOWN_FUNCTION",
                f"Function '{name}' is not defined in this recipe and was not found in the library",
                "Define it under functions: or use list_functions to find the published name",
            )
        )
    version = step.get("version")
    if not isinstance(version, str) or not version.strip():
        raise FunctionContractError(
            finding(
                step_path,
                "MISSING_FUNCTION_VERSION",
                f"Published Function '{name}' requires an exact version",
                "Add version (see list_functions for available versions)",
            )
        )
    contract = function_service.resolve_version_contract(str(row["id"]), version)
    if contract is None:
        raise FunctionContractError(
            finding(
                step_path,
                "UNKNOWN_FUNCTION_VERSION",
                f"Function '{name}' has no published version {version}",
                "Use an available version (see list_functions)",
            )
        )
    return FunctionContract(
        name=name,
        lifecycle="shared",
        inputs=contract["inputs"],
        outputs=contract["outputs"],
        function_id=str(row["id"]),
        version=version,
    )


def function_block_entry(contract: FunctionContract) -> BlockEntry:
    """The Function Block's fields and outputs, from its Function's declarations."""
    definition = {"inputs": contract.inputs, "outputs": contract.outputs}
    outputs = function_block_outputs(definition)
    return BlockEntry(
        id=contract.name,
        name=contract.name,
        kind="function",
        version=contract.version or "1.0.0",
        parameters={str(field["name"]): field for field in function_block_fields(definition)},
        outputs={str(out["name"]): str(out["type"] or "string") for out in outputs},
        secret_outputs=_schema_secret_outputs(outputs),
    )


def is_choice_field(param: Mapping[str, Any]) -> bool:
    """A choice list or a true / false field, which holds a value from the moment it is made."""
    return bool(param.get("enum_values")) or param.get("type") == "boolean"


def _recipe_type_of(value: Any) -> str:
    if value is None:
        return "null"
    for python_type, recipe_type in _PY_TO_RECIPE_TYPE:
        if isinstance(value, python_type):
            return recipe_type
    return type(value).__name__


_YAML_WORDS = {True: frozenset({"yes", "true", "on"}), False: frozenset({"no", "false", "off"})}


def written_word(param: Mapping[str, Any], value: Any) -> Any:
    """A YAML true / false as the one allowed word of the setting that YAML reads that way."""
    if not isinstance(value, bool):
        return value
    words = [
        item for item in param.get("enum_values") or [] if str(item).lower() in _YAML_WORDS[value]
    ]
    return words[0] if len(words) == 1 else value


def _type_accepts(expected: str, value: Any) -> bool:
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "string":
        return isinstance(value, str)
    if expected in ("array", "table"):
        return isinstance(value, list)
    if expected == "map":
        return isinstance(value, dict)
    return True


def value_form(value: Any) -> tuple[str, Any]:
    """A written value's form and what it holds: `expr`, `template` or `literal` for the
    one-key mapping of that name, else `plain` and the value itself. A plain string holding
    {{ }} is `plain` here; where a template is allowed it reads as one (REQ-5.2.7.3)."""
    if isinstance(value, dict) and len(value) == 1:
        ((key, inner),) = value.items()
        if key in _FORM_KEYS:
            return str(key), inner
    return "plain", value


def is_expr_value(value: Any) -> bool:
    """True for the {expr: ...} setting/input form."""
    return value_form(value)[0] == "expr"


def _template_place_form(value: Any) -> tuple[str, Any]:
    """A value's form where a template is allowed: a string holding {{ }} is a template."""
    kind, inner = value_form(value)
    if kind == "plain" and is_template_value(inner):
        return "template", inner
    return kind, inner


def _written_view(value: Any) -> Any:
    """A whole value as the type check reads it: a {template} as its text, a {literal} as what
    it holds; an {expr} stays as written."""
    kind, inner = value_form(value)
    return inner if kind in ("template", "literal") else value


def _entry_item(item: Any, *, template_place: bool) -> Any:
    """One entry as the type check reads it: a value mode as null, a {literal} as it holds."""
    kind, inner = _template_place_form(item) if template_place else value_form(item)
    return None if kind in ("expr", "template") else inner


def _literal_elements(
    value: dict[str, Any] | list[Any], *, template_place: bool = False
) -> dict[str, Any] | list[Any]:
    """A written map without its {expr} entries and a list with each value mode read as null;
    a {literal} entry as what it holds."""
    if isinstance(value, dict):
        return {
            key: _entry_item(item, template_place=template_place)
            for key, item in value.items()
            if not is_expr_value(item)
        }
    return [_entry_item(item, template_place=template_place) for item in value]


def _typed_view(value: Any) -> Any:
    """A Block setting's list with each {expr} item read as null, which fits any element type."""
    value = _written_view(value)
    if isinstance(value, list):
        return [_entry_item(item, template_place=False) for item in value]
    return value


def _entry_view(value: Any) -> Any:
    """A Block setting's list or map with each {expr} entry read as null."""
    if isinstance(value, dict):
        return {key: _entry_item(item, template_place=False) for key, item in value.items()}
    return _typed_view(value)


def _recipe_place(field_place: str) -> str:
    """A stored dotted place in step-path form: `branches.1.time_limit` as
    `branches[1].time_limit`."""
    return re.sub(r"\.(\d+)(?=\.|$)", r"[\1]", field_place)


def _scope_types(declarations: Any) -> dict[str, str]:
    """The declared type of each name of a declaration mapping."""
    if not isinstance(declarations, dict):
        return {}
    return {
        str(name): declaration["type"]
        for name, declaration in declarations.items()
        if isinstance(declaration, dict) and isinstance(declaration.get("type"), str)
    }


def _function_scope_types(entry: Mapping[str, Any]) -> dict[str, str]:
    """The declared types a local Function's flow reads: its inputs, outputs and variables."""
    types: dict[str, str] = {}
    for section in ("inputs", "outputs"):
        for item in _parameter_items(entry.get(section)):
            if isinstance(item.get("name"), str) and isinstance(item.get("type"), str):
                types[item["name"]] = item["type"]
    types.update(_scope_types(entry.get("variables")))
    return types


def _article(word: str) -> str:
    return "an" if word[:1] in ("a", "e", "i", "o", "u") else "a"


def _entries(value: dict[Any, Any] | list[Any], path: str, place: str) -> list[_RowEntry]:
    """Each entry of a map or list at its step path and place; a list entry's key is its
    index."""
    if isinstance(value, dict):
        return [
            _RowEntry(key, f"{path}.{key}", f"{place}.{key}", item) for key, item in value.items()
        ]
    return [
        _RowEntry(index, f"{path}[{index}]", f"{place}.{index}", item)
        for index, item in enumerate(value)
    ]


def _entry_type(entry_types: Any, key: Any) -> Any:
    """The element type a step declares for one entry of a row, or None."""
    if isinstance(entry_types, dict):
        return entry_types.get(key)
    if isinstance(entry_types, list) and isinstance(key, int) and key < len(entry_types):
        return entry_types[key]
    return None


def _text_or_none(value: Any) -> str | None:
    """A written word, or None when it is not text (a list or a map is no word)."""
    return value if isinstance(value, str) else None


def _is_marker(item: Any) -> bool:
    return isinstance(item, str) and item in CONDITION_MARKERS


def _misplaced_marker(items: list[Any]) -> bool:
    """True when an `and` / `or` does not stand between two conditions."""
    last = len(items) - 1
    return any(
        _is_marker(item)
        and (index in (0, last) or _is_marker(items[index - 1]) or _is_marker(items[index + 1]))
        for index, item in enumerate(items)
    )


def _setting_element_types(param: Mapping[str, Any], view: Any, declared: Any) -> Any:
    """The element types a typed map / list setting is stored with: declared, else written."""
    if not param.get("typed_values") or not isinstance(view, dict | list):
        return None
    return stored_elements(view, declared)[1]


def is_template_value(value: Any) -> bool:
    """True for plain strings carrying at least one {{ }} marker."""
    return isinstance(value, str) and _TEMPLATE_PATTERN.search(value) is not None


class _Validator:
    def __init__(self, doc: RecipeDoc, testdata_dirs: list[str] | None = None) -> None:
        self.doc = doc
        self.testdata_dirs = list(testdata_dirs or [])
        self.findings: list[dict[str, Any]] = []
        self.catalog = load_block_catalog()
        self.remote_entry = remote_execution_entry()
        self.local_functions: dict[str, dict[str, Any]] = {}
        self._profile_names: dict[str, set[str]] | None = None
        # The declared types of the flow being walked: the Test's, or a local Function's.
        self._declared_types: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    def _secret_names(self) -> set[str]:
        return {
            str(name)
            for name, declaration in self.doc.variables.items()
            if isinstance(declaration, dict) and declaration.get("secret")
        }

    def _warn_secret_derivation(
        self, expression: str, step_path: str, target: str | None = None
    ) -> None:
        """Masking covers a secret's exact bytes, not values built from it, so the
        author is told rather than blocked (the derivation may well be intended)."""
        if target is not None and self.doc.variables.get(target, {}).get("secret"):
            return
        from wavecore.core.variables.computed import extract_expression_names

        consumed = sorted(extract_expression_names(expression) & self._secret_names())
        for secret in consumed:
            owner = f"for '{target}'" if target else "in this setting"
            self.findings.append(
                finding(
                    step_path,
                    "SECRET_DERIVED_VALUE",
                    f"Expression {owner} reads secret '{secret}'; " "a derived value is not masked",
                    (
                        f"Mark '{target}' secret: true, or avoid logging it"
                        if target
                        else "Avoid emitting a value built from a secret"
                    ),
                    severity="warning",
                )
            )

    def _check_expression(
        self, expression: Any, step_path: str, target: str | None = None, masked: bool = False
    ) -> None:
        """Syntax and safety; a `target` names the variable the expression fills."""
        if not isinstance(expression, str):
            expression = str(expression)
        result = validate_expression(expression)
        errors = [issue for issue in result.issues if issue.type == "error"]
        if not errors and not masked:
            self._warn_secret_derivation(expression, step_path, target=target)
        if errors:
            self.findings.append(
                finding(
                    step_path,
                    "INVALID_EXPRESSION",
                    f"Expression is not valid: {errors[0].message}",
                    None,
                )
            )

    def _check_template(
        self, template: Any, step_path: str, target: str | None = None, masked: bool = False
    ) -> None:
        for match in _TEMPLATE_PATTERN.finditer(str(template)):
            inner = match.group(1).strip()
            if inner:
                self._check_expression(inner, step_path, target=target, masked=masked)

    def _check_condition_list(self, conditions: Any, step_path: str) -> None:
        """One condition or a list of them: conditions, `and` / `or` between two of them, and
        groups holding the same grammar (REQ-3.5.1.5)."""
        items = conditions if isinstance(conditions, list) else [conditions]
        if _misplaced_marker(items):
            self.findings.append(
                finding(
                    step_path,
                    "INVALID_CONDITION",
                    "'and' and 'or' go between two conditions",
                    "Remove it, or add the condition it joins",
                )
            )
        for item in items:
            if not _is_marker(item):
                self._check_condition_item(item, step_path)

    def _check_condition_item(self, item: Any, step_path: str) -> None:
        if isinstance(item, str):
            self._check_expression(item, step_path)
            return
        if isinstance(item, dict) and "group" in item:
            if isinstance(item["group"], list):
                self._check_condition_list(item["group"], step_path)
                return
            self.findings.append(
                finding(
                    step_path,
                    "INVALID_CONDITION",
                    "A group holds a list of conditions",
                    "Write {group: [ ... ]}",
                )
            )
            return
        if isinstance(item, dict) and "variable" in item and "operator" in item:
            self._check_compare_to(item, step_path)
            return
        self.findings.append(
            finding(step_path, "INVALID_CONDITION", _CONDITION_PROBLEM, _CONDITION_FIX)
        )

    def _check_compare_to(self, condition: dict[str, Any], step_path: str) -> None:
        """A compare-to value takes the value forms; a template only on a text compare-to.
        An operator that takes no value drops it, so it is never checked."""
        operator = condition.get("operator")
        if "value" not in condition or (isinstance(operator, str) and operator in UNARY_OPERATORS):
            return
        kind, inner = _template_place_form(condition["value"])
        if kind == "expr":
            self._check_expression(inner, step_path)
        elif kind == "template" and self._check_template_text(inner, step_path):
            value_type = condition.get("value_type") or self._declared_types.get(
                str(condition.get("variable"))
            )
            row = {
                "variable": condition.get("variable"),
                "operator": _text_or_none(operator),
                "value_type": _text_or_none(value_type),
            }
            compared = compare_to_type(row)
            if compared is not None and compared != "string":
                self.findings.append(
                    finding(
                        step_path,
                        "TEMPLATE_NOT_STRING",
                        template_compare_text(compared_subject(row), compared),
                        f"Use {{expr: ...}} for a computed {compared} value",
                    )
                )

    def _check_template_text(
        self, template: Any, path: str, target: str | None = None, masked: bool = False
    ) -> bool:
        """A template value holds text whose pieces are valid; False when it is not text."""
        if not isinstance(template, str):
            self.findings.append(
                finding(
                    path,
                    "INVALID_TEMPLATE_FORM",
                    f"A {{template: ...}} value holds text, got {_recipe_type_of(template)}",
                    _TEMPLATE_FORM_FIX,
                )
            )
            return False
        self._check_template(template, path, target=target, masked=masked)
        return True

    def _too_deep(self, place: str, path: str) -> None:
        self.findings.append(
            finding(
                path,
                "VALUE_FORM_TOO_DEEP",
                f"'{place}' is too deep for {{expr: ...}} or a template; "
                "value modes stop at the entries of a setting or a Setter row",
                _TOO_DEEP_FIX,
            )
        )

    def _check_too_deep(self, value: Any, path: str, place: str) -> None:
        """Plain data below the entries of a setting or a Setter row holds no value mode."""
        if not isinstance(value, dict | list):
            return
        for child in _entries(value, path, place):
            kind, _inner = value_form(child.value)
            if kind in ("expr", "template"):
                self._too_deep(child.place, child.path)
            elif kind == "plain":
                self._check_too_deep(child.value, child.path, child.place)

    def _malformed(self, keyword: str, reason: str, step_path: str) -> None:
        self.findings.append(
            finding(
                step_path,
                "INVALID_CONSTRUCT",
                f"'{keyword}' construct is malformed: {reason}",
                None,
            )
        )

    def _malformed_step(self, keyword: str, reason: str, step_path: str) -> None:
        self.findings.append(
            finding(
                step_path, "INVALID_CONSTRUCT", f"'{keyword}' step is malformed: {reason}", None
            )
        )

    def _profile_fields(self) -> dict[str, set[str]]:
        """Each profile's fields a run can resolve, keyed by profile name."""
        if self._profile_names is None:
            from wavecore.api.services.profiles import service as profile_service

            rows = profile_service.list_profiles(per_page=_LIST_ALL)["profiles"]
            self._profile_names = {
                str(row.get("name") or ""): set(map(str, profile_service.profile_field_names(row)))
                for row in rows
            }
        return self._profile_names

    def _profile_exists(self, name: str) -> bool:
        return name in self._profile_fields()

    # ------------------------------------------------------------------
    # Settings against a catalog entry
    # ------------------------------------------------------------------

    def _relay(self, found: FieldFinding, step_path: str) -> None:
        """One shared field-check finding at the setting it names."""
        self.findings.append(
            finding(f"{step_path}.settings.{found.field}", found.code, found.message, found.fix)
        )

    def _check_setting_value(
        self,
        entry: BlockEntry,
        name: str,
        value: Any,
        path: str,
        *,
        element_types: Any = None,
        shown: str | None = None,
    ) -> None:
        """One setting's value forms and literal; `shown` is the recipe key a message names."""
        param = entry.parameters[name]
        shown = shown or name
        # A secret setting masks the whole value it resolves to, derived ones included.
        masked = bool(param.get("secret"))
        kind, inner = _template_place_form(value)
        if kind == "expr":
            self._check_expression(inner, path, masked=masked)
            return
        if kind == "template":
            self._check_template_text(inner, path, masked=masked)
            return
        value = written_word(param, inner)
        view = value if kind == "literal" else _entry_view(value)
        problems = check_field_value(
            param,
            shown,
            view,
            block_id=entry.id,
            element_types=_setting_element_types(param, view, element_types),
        )
        self.findings.extend(finding(path, item.code, item.message, item.fix) for item in problems)
        if (
            any(item.code == "INVALID_SETTING_TYPE" for item in problems)
            or value is None
            or kind == "literal"
        ):
            return
        self._check_nested_expressions(value, path, shown, masked=masked)
        if isinstance(value, str) and value.startswith(_TESTDATA_SCHEME) and "{{" not in value:
            self._check_testdata_reference(value, path)

    def _check_nested_expressions(
        self, value: Any, path: str, place: str, *, masked: bool = False
    ) -> None:
        """The entries of a setting (a map entry, a list item, a list row's field) take
        {expr}; a template there is plain text, and no value mode goes deeper (REQ-5.2.7.3)."""
        if isinstance(value, dict):
            entries = [(f"{path}.{key}", f"{place}.{key}", item) for key, item in value.items()]
        elif isinstance(value, list):
            entries = []
            for index, row in enumerate(value):
                if isinstance(row, dict) and value_form(row)[0] == "plain":
                    entries.extend(
                        (f"{path}[{index}].{key}", f"{place}.{index}.{key}", cell)
                        for key, cell in row.items()
                    )
                else:
                    entries.append((f"{path}[{index}]", f"{place}.{index}", row))
        else:
            return
        for entry_path, entry_place, item in entries:
            self._check_setting_entry(item, entry_path, entry_place, masked=masked)

    def _check_setting_entry(self, item: Any, path: str, place: str, *, masked: bool) -> None:
        kind, inner = value_form(item)
        if kind == "expr":
            self._check_expression(inner, path, masked=masked)
        elif kind == "template":
            self.findings.append(
                finding(
                    path,
                    "TEMPLATE_NOT_ALLOWED",
                    f"'{place}' takes no template; templates apply to a whole text setting, "
                    "a Variable Setter row or entry, and a text compare-to value",
                    "Use {expr: ...} for a computed value",
                )
            )
        elif kind == "plain":
            self._check_too_deep(inner, path, place)

    def _testdata_found(self, value: str) -> bool:
        """A wildcard reference counts as found when it matches at least one file."""
        try:
            if has_wildcard(value):
                return bool(resolve_plugin_matches(value, None, self.testdata_dirs))
            resolve_plugin_path(value, None, self.testdata_dirs, read_only_ok=True)
        except (FileNotFoundError, ValueError):
            return False
        return True

    def _check_testdata_reference(self, value: str, path: str) -> None:
        if not self._testdata_found(value):
            self.findings.append(
                finding(
                    path,
                    "TESTDATA_NOT_FOUND",
                    f"testdata file not found: {value}",
                    _TESTDATA_NOT_FOUND_FIX,
                    severity="warning",
                )
            )

    def _check_settings(
        self,
        entry: BlockEntry,
        settings: dict[str, Any],
        step_path: str,
        *,
        check_required: bool = True,
        element_types: Any = None,
    ) -> None:
        fields = list(entry.parameters.values())
        for unknown in unknown_field_findings(fields, settings, block_id=entry.id):
            self._relay(unknown, step_path)
        declared = element_types if isinstance(element_types, dict) else {}
        for name, value in settings.items():
            if str(name) in entry.parameters:
                self._check_setting_value(
                    entry,
                    str(name),
                    value,
                    f"{step_path}.settings.{name}",
                    element_types=declared.get(name),
                )
        if check_required:
            self._check_required_settings(entry, settings, step_path)

    def _check_required_settings(
        self, entry: BlockEntry, settings: dict[str, Any], step_path: str
    ) -> None:
        """The save check's required rule; a choice left out is written at compile."""
        values: dict[str, Any] = {}
        expression_fields: set[str] = set()
        for name, value in settings.items():
            param = entry.parameters.get(str(name), {})
            kind, inner = value_form(value)
            if kind == "expr":
                values[str(name)] = inner
                expression_fields.add(str(name))
            else:
                values[str(name)] = written_word(param, inner)
        fields = list(entry.parameters.values())
        for item in required_findings(fields, values, expression_fields=expression_fields):
            if item.code != "REQUIRED_PARAM_MISSING" or is_choice_field(
                entry.parameters[item.field]
            ):
                continue
            self.findings.append(
                finding(
                    f"{step_path}.settings.{item.field}",
                    "MISSING_REQUIRED_SETTING",
                    f"Required setting '{item.field}' is missing for block '{entry.id}'",
                    f"Add settings.{item.field}",
                )
            )

    def _check_declared_outputs(
        self,
        step_path: str,
        block_id: str,
        param: str,
        names: list[Any],
        fixed_outputs: set[str],
    ) -> None:
        seen: set[str] = set()
        for index, item in enumerate(names):
            path = f"{step_path}.settings.{param}[{index}]"
            if not isinstance(item, str) or re.fullmatch(VARIABLE_NAME_PATTERN, item) is None:
                self.findings.append(
                    finding(
                        path,
                        "INVALID_DECLARED_OUTPUT",
                        f"Setting '{param}' of block '{block_id}' declares an invalid "
                        f"output name: '{item}' (must match {VARIABLE_NAME_PATTERN})",
                        "Rename it",
                    )
                )
                continue
            if item in fixed_outputs:
                self.findings.append(
                    finding(
                        path,
                        "DECLARED_OUTPUT_CLASH",
                        f"Setting '{param}' of block '{block_id}' declares '{item}', "
                        "which is already an output of the block",
                        f"Choose a name other than: {', '.join(sorted(fixed_outputs))}",
                    )
                )
            elif item in seen:
                self.findings.append(
                    finding(
                        path,
                        "DUPLICATE_DECLARED_OUTPUT",
                        f"Setting '{param}' of block '{block_id}' declares '{item}' "
                        "more than once",
                        "Remove the repeated name",
                    )
                )
            seen.add(item)

    def _check_capture(
        self,
        entry_outputs: dict[str, str],
        owner_label: str,
        capture: Any,
        step_path: str,
        declaring_param: str | None = None,
    ) -> None:
        if not isinstance(capture, dict):
            return
        for output_name, target in capture.items():
            if str(output_name) not in entry_outputs:
                fix = f"Valid outputs: {', '.join(sorted(entry_outputs))}"
                if declaring_param:
                    fix += f". Declare a new one in settings.{declaring_param}"
                self.findings.append(
                    finding(
                        f"{step_path}.capture.{output_name}",
                        "UNKNOWN_CAPTURE_OUTPUT",
                        f"Block '{owner_label}' has no output '{output_name}' to capture",
                        fix,
                    )
                )
            # The target becomes a variable, so it obeys the variable name rule.
            refused = name_reason(str(target))
            if refused is not None:
                code, reason = refused
                self.findings.append(
                    finding(
                        f"{step_path}.capture.{output_name}",
                        code,
                        f"Invalid capture target name: '{target}' ({reason})",
                        "Rename the capture target",
                    )
                )

    def _check_profiles(self, bindings: Any, step_path: str) -> None:
        if not isinstance(bindings, list):
            return
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            name = str(binding.get("profile") or "")
            if not name:
                continue
            if not self._profile_exists(name):
                self.findings.append(
                    finding(
                        step_path,
                        "UNKNOWN_PROFILE",
                        f"Profile '{name}' was not found",
                        "Use the list_profiles tool for available profiles",
                    )
                )
                continue
            self._check_profile_fields(name, binding.get("fields"), step_path)

    def _check_profile_fields(self, name: str, fields: Any, step_path: str) -> None:
        """A bound field the profile does not define resolves to nothing at run time."""
        if not isinstance(fields, list):
            return
        declared = self._profile_fields()[name]
        valid = ", ".join(sorted(declared))
        for bound in fields:
            if str(bound) not in declared:
                self.findings.append(
                    finding(
                        step_path,
                        "UNKNOWN_PROFILE_FIELD",
                        f"Profile '{name}' has no field '{bound}'",
                        f"Valid fields: {valid}",
                    )
                )

    # ------------------------------------------------------------------
    # Variables
    # ------------------------------------------------------------------

    def _check_variables(self) -> None:
        self._check_declarations(self.doc.variables, "variables", "variable")
        for entry in self.doc.functions:
            declarations = entry.get("variables")
            if isinstance(declarations, dict):
                prefix = f"functions[{entry.get('name')}].variables"
                self._check_declarations(declarations, prefix, "local")

    def _check_declarations(
        self, declarations: Mapping[str, Any], prefix: str, kind: DeclarationKind
    ) -> None:
        for name, declaration in declarations.items():
            path = f"{prefix}.{name}"
            declared_type = declaration.get("type") if isinstance(declaration, dict) else None
            self.findings.extend(_shared_declaration_findings(str(name), declared_type, kind, path))
            # A type alone is a complete declaration: the variable holds null
            # until a value is authored or a Block writes it at run time.
            if not isinstance(declared_type, str) or not declared_type:
                self._invalid_declaration(name, path)
            elif declared_type in DECLARED_TYPES:
                self._check_typed_declaration(str(name), declaration, prefix)

    def _check_typed_declaration(self, name: str, declaration: dict[str, Any], prefix: str) -> None:
        path = f"{prefix}.{name}"
        declared_type = str(declaration["type"])
        if "expr" in declaration:
            self._check_expression(declaration["expr"], path, target=name)
        elif "template" in declaration:
            self._check_template(declaration["template"], path, target=name)
            self._check_template_type("Variable", name, declared_type, path)
        elif "value" in declaration:
            self._check_declared_value(name, declared_type, declaration["value"], path)
        if "element_types" in declaration:
            self._check_variable_element_types(name, declaration, path)
        elif declared_type in ("array", "map"):
            self._check_undeclared_elements(
                "Variable", {name: declaration.get("value")}, [name], None, prefix
            )

    def _check_template_type(self, noun: str, name: Any, declared: Any, path: str) -> None:
        """A template builds text, so only a string variable or output takes one."""
        if declared == "string":
            return
        self.findings.append(
            finding(
                path,
                "TEMPLATE_NOT_STRING",
                f"{noun} '{name}' is {declared}; template: builds text, so it needs type string",
                f"Use expr: for a computed {declared} value",
            )
        )

    def _check_declared_value(
        self, name: str, declared: str, value: Any, path: str, noun: str = "Variable"
    ) -> None:
        """A literal must match the type it is declared with; null fits every type
        (REQ-3.1.3.20). An expression's type is only known once it evaluates, so it
        is not checked here. A declared number follows the one number rule, its exact
        text included."""
        if value is None or (declared == "table" and realizes_as_table(value)):
            return
        number_type = _NUMBER_TYPES.get(declared)
        if number_type is not None:
            problem = number_problem(value, number_type)
            if problem is None:
                return
            if problem != "type":
                message = f"{noun} '{name}' {number_cap_words(problem, value)}"
                self.findings.append(
                    finding(path, "INVALID_VARIABLE_VALUE", message, _CAP_FIXES[problem])
                )
                return
        elif _type_accepts(declared, value):
            return
        self.findings.append(
            finding(
                path,
                "INVALID_VARIABLE_VALUE",
                f"{noun} '{name}' expects {declared}, got {_recipe_type_of(value)}",
                f"Provide {'an' if declared[0] in 'aeiou' else 'a'} {declared} value, "
                "or change the declared type",
            )
        )

    def _element_type_findings(
        self, subject: str, value: Any, element_types: Any, path: str, *, numbers: bool = True
    ) -> None:
        """One finding per problem of a written map / list against its element_types."""
        for problem in element_problems(value, element_types, numbers=numbers):
            self.findings.append(
                finding(
                    path,
                    "INVALID_ELEMENT_TYPES",
                    f"{subject}: {problem}",
                    "Declare each element as one of: array, boolean, float, integer, map, string, "
                    "and write it as that type",
                )
            )

    def _check_variable_element_types(
        self, name: str, declaration: dict[str, Any], path: str
    ) -> None:
        value = declaration.get("value")
        if not isinstance(value, dict | list) or "value" not in declaration:
            self.findings.append(
                finding(
                    path,
                    "INVALID_ELEMENT_TYPES",
                    f"Variable '{name}' declares element_types without a map or list value",
                    "Give the variable a map or list value, or remove element_types",
                )
            )
            return
        self._element_type_findings(
            f"Variable '{name}'", value, declaration["element_types"], f"{path}.element_types"
        )

    def _check_step_element_types(
        self,
        step: dict[str, Any],
        written: dict[str, Any],
        typed: set[str],
        noun: str,
        step_path: str,
        *,
        numbers: bool = True,
        template_place: bool = False,
    ) -> None:
        """A step's element_types: one entry per typed map / list it writes literally."""
        element_types = step.get("element_types")
        path = f"{step_path}.element_types"
        if not isinstance(element_types, dict):
            self._malformed_element_types(
                "'element_types' must map each name to its element types", path
            )
            return
        for name, types in element_types.items():
            value = written.get(name)
            if name not in typed or not isinstance(value, dict | list):
                self._malformed_element_types(
                    f"{noun} '{name}' has no typed map or list value to declare element types for",
                    f"{path}.{name}",
                )
                continue
            self._element_type_findings(
                f"{noun} '{name}'",
                _literal_elements(value, template_place=template_place),
                types,
                f"{path}.{name}",
                numbers=numbers,
            )

    def _check_undeclared_elements(
        self,
        noun: str,
        written: dict[str, Any],
        names: Iterable[str],
        element_types: Any,
        path: str,
        *,
        numbers: bool = True,
        template_place: bool = False,
    ) -> None:
        """Written maps / lists with no element_types entry: each element takes its YAML type."""
        declared = element_types if isinstance(element_types, dict) else {}
        for name in names:
            value = written.get(name)
            if name in declared or is_expr_value(value) or not isinstance(value, dict | list):
                continue
            self._element_type_findings(
                f"{noun} '{name}'",
                _literal_elements(value, template_place=template_place),
                None,
                f"{path}.{name}",
                numbers=numbers,
            )

    def _malformed_element_types(self, problem: str, path: str) -> None:
        self.findings.append(
            finding(
                path,
                "INVALID_ELEMENT_TYPES",
                problem,
                "Declare element types only for a typed map or list the step writes literally",
            )
        )

    def _invalid_declaration(self, name: str, path: str) -> None:
        self.findings.append(
            finding(
                path,
                "INVALID_VARIABLE_DECLARATION",
                f"Variable '{name}' must declare a type",
                "Add a type",
            )
        )

    # ------------------------------------------------------------------
    # Steps
    # ------------------------------------------------------------------

    def _use_step_keyword(self, block_id: str, keyword: str, step_path: str) -> None:
        self.findings.append(
            finding(
                step_path,
                "USE_STEP_KEYWORD",
                f"Block '{block_id}' is written with its own '{keyword}' step, not '- block:'",
                f"Write it as '- {keyword}: ...'",
            )
        )

    def _check_block_step(self, step: dict[str, Any], step_path: str) -> None:
        block_id = str(step.get("block") or "")
        if block_id == REMOTE_EXECUTION_ENTRY["id"]:
            self._use_step_keyword(block_id, REMOTE_STEP_KEYWORD, step_path)
            return
        entry = self.catalog.get(block_id)
        if entry is None:
            self.findings.append(
                finding(
                    step_path,
                    "UNKNOWN_BLOCK",
                    f"Unknown block '{block_id}'",
                    "Use the list_blocks tool for the catalog of available blocks",
                )
            )
            return
        if entry.kind == "control" and block_id not in BLOCK_FORM_CONTROLS:
            self._use_step_keyword(block_id, CONTROL_STEP_KEYWORDS[block_id], step_path)
            return
        if entry.stub:
            self.findings.append(
                finding(
                    step_path,
                    "STUB_BLOCK",
                    f"Block '{block_id}' is not implemented yet and will fail at runtime",
                    "Choose an implemented block or accept the runtime failure",
                    severity="warning",
                )
            )
        self._check_entry_step("block", step, entry, f"Block '{entry.id}'", step_path)

    def _check_function_step(self, step: dict[str, Any], step_path: str) -> None:
        name = step.get("function")
        if not isinstance(name, str) or not name.strip():
            self._malformed_step("function", "a function name is required", step_path)
            return
        try:
            contract = resolve_function_contract(step, self.local_functions, step_path)
        except FunctionContractError as exc:
            self.findings.append(exc.finding)
            return
        entry = function_block_entry(contract)
        self._check_entry_step("function", step, entry, f"Function '{contract.name}'", step_path)

    def _check_entry_step(
        self, keyword: str, step: dict[str, Any], entry: BlockEntry, owner: str, step_path: str
    ) -> None:
        """A Block step's settings, outputs, profiles and element types against its entry."""
        raw_settings = step.get("settings")
        settings = raw_settings if isinstance(raw_settings, dict) else {}
        self._check_settings(entry, settings, step_path, element_types=step.get("element_types"))
        outputs = dict(entry.outputs)
        declaring_param: str | None = None
        for param in entry.output_name_params:
            declaring_param = param
            names = _written_view(settings.get(param))
            if isinstance(names, list):
                self._check_declared_outputs(step_path, entry.id, param, names, set(entry.outputs))
                outputs.update({name: "string" for name in names if isinstance(name, str)})
        self._check_capture(outputs, entry.id, step.get("capture"), step_path, declaring_param)
        if "secret_outputs" in step and not self._check_secret_outputs(
            step["secret_outputs"], outputs, owner, step_path, declaring_param
        ):
            self._malformed_step(
                keyword,
                "'secret_outputs' must be a list of output names",
                f"{step_path}.secret_outputs",
            )
        self._check_profiles(step.get("profiles"), step_path)
        typed = {name for name, param in entry.parameters.items() if param.get("typed_values")}
        written = {name: _typed_view(value) for name, value in settings.items()}
        # Number entries of a setting are the shared field check's.
        self._check_undeclared_elements(
            "Setting",
            written,
            sorted(typed),
            step.get("element_types"),
            f"{step_path}.settings",
            numbers=False,
        )
        if "element_types" in step:
            self._check_step_element_types(
                step, written, typed, "Setting", step_path, numbers=False
            )

    def _check_secret_outputs(
        self,
        marked: Any,
        outputs: Mapping[str, str],
        owner: str,
        step_path: str,
        declaring_param: str | None = None,
    ) -> bool:
        """Each output a step marks Secret must exist (SECUI-4, SECUI-11); False if malformed."""
        if not isinstance(marked, list) or not all(isinstance(name, str) for name in marked):
            return False
        for name in marked:
            if name not in outputs:
                fix = f"Valid outputs: {', '.join(sorted(outputs))}"
                if declaring_param:
                    fix += f". Declare a new one in settings.{declaring_param}"
                self.findings.append(
                    finding(
                        f"{step_path}.secret_outputs",
                        "UNKNOWN_SECRET_OUTPUT",
                        f"{owner} has no output '{name}' to mark secret",
                        fix,
                    )
                )
        return True

    def _check_when(self, when: Any, reason: str, keyword: str, step_path: str) -> None:
        """A `when` / `conditions` holds one condition or a non-empty list of them."""
        if isinstance(when, list) and not when:
            self._malformed(keyword, reason, step_path)
            return
        self._check_condition_list(when, step_path)

    def _check_label(
        self, holder: Mapping[str, Any], key: str, subject: str, keyword: str, step_path: str
    ) -> bool:
        """A branch label is plain text; False when it is not."""
        if key in holder and not isinstance(holder[key], str):
            self._malformed(keyword, f"{subject} must be a string", step_path)
            return False
        return True

    def _check_branch_label(
        self, value: Mapping[str, Any], key: str, section: str, keyword: str, step_path: str
    ) -> None:
        """An else or default label is text and needs its branch (REQ-3.5.1.1, REQ-3.5.1.20)."""
        if not self._check_label(value, key, f"'{key}'", keyword, step_path):
            return
        if key in value and not isinstance(value.get(section), list):
            self._malformed(
                keyword, f"'{key}' needs {_article(section)} '{section}' list of steps", step_path
            )

    def _shape_if(self, value: Any, step_path: str) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("then"), list):
            self._malformed("if", "a 'then' list of steps is required", step_path)
            return False
        self._check_when(value.get("when"), "'when' needs at least one condition", "if", step_path)
        self._check_label(value, "if_label", "'if_label'", "if", step_path)
        self._check_branch_label(value, "else_label", "else", "if", step_path)
        return self._shape_elif_entries(value.get("elif"), step_path)

    def _shape_elif_entries(self, entries: Any, step_path: str) -> bool:
        if not isinstance(entries, list):
            return True
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("then"), list):
                self._malformed("if", "each elif entry needs 'when' and a 'then' list", step_path)
                return False
            self._check_when(
                entry.get("when"), "each elif 'when' needs at least one condition", "if", step_path
            )
            self._check_label(entry, "label", "each elif 'label'", "if", step_path)
        return True

    def _shape_switch(self, value: Any, step_path: str) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("cases"), list):
            self._malformed("switch", "a 'cases' list is required", step_path)
            return False
        if not value["cases"]:
            self._malformed("switch", "at least one case is required", step_path)
            return False
        for case in value["cases"]:
            if not self._shape_switch_case(case, step_path):
                return False
        if "default" in value and not isinstance(value["default"], list):
            self._malformed("switch", "'default' must be a list of steps", step_path)
            return False
        self._check_branch_label(value, "default_label", "default", "switch", step_path)
        return True

    def _shape_switch_case(self, case: Any, step_path: str) -> bool:
        if (
            not isinstance(case, dict)
            or "when" not in case
            or not isinstance(case.get("steps"), list)
        ):
            self._malformed("switch", "each case needs 'when' and a 'steps' list", step_path)
            return False
        if "break" in case and not isinstance(case["break"], bool):
            self._malformed("switch", "'break' must be true or false", step_path)
            return False
        self._check_when(
            case.get("when"), "each case 'when' needs at least one condition", "switch", step_path
        )
        self._check_label(case, "label", "each case 'label'", "switch", step_path)
        return True

    def _shape_try(self, value: Any, step_path: str) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("steps"), list):
            self._malformed("try", "a 'steps' list is required", step_path)
            return False
        self._check_construct_capture("try", value, step_path)
        return True

    def _shape_parallel(self, value: Any, step_path: str) -> bool:
        holder: dict[str, Any] = value if isinstance(value, dict) else {}
        branches = holder.get("branches")
        lanes = branches if isinstance(branches, list) else []
        for branch in lanes:
            if not self._shape_parallel_branch(branch, step_path):
                return False
        self._check_parallel_structure(holder, step_path)
        for index, branch in enumerate(lanes):
            # A lane limit is a field of a lane row, so it takes the value forms a row field takes.
            self._check_setting_entry(
                branch.get("time_limit"),
                f"{step_path}.parallel.branches[{index}].time_limit",
                f"branches.{index}.time_limit",
                masked=False,
            )
        self._check_construct_fields("parallel", holder, step_path)
        return True

    def _shape_parallel_branch(self, branch: Any, step_path: str) -> bool:
        if not isinstance(branch, dict) or not isinstance(branch.get("steps"), list):
            self._malformed("parallel", "each branch needs a 'steps' list", step_path)
            return False
        if "name" in branch and not isinstance(branch["name"], str):
            self._malformed("parallel", "branch 'name' must be a string", step_path)
            return False
        return True

    def _check_parallel_structure(self, value: dict[str, Any], step_path: str) -> None:
        """The two-lane and lane-limit rules of the Parallel Block itself (REQ-3.1.1.3)."""
        values: dict[str, Any] = {}
        sources: set[str] = set()
        for _key, stored, written in recipe_field_places("parallel", value):
            kind, inner = value_form(written)
            values[stored] = inner
            if kind == "expr":
                sources.add(stored)
        branches = value.get("branches")
        if isinstance(branches, list):
            lanes: list[dict[str, Any]] = []
            for index, branch in enumerate(branches):
                lane: dict[str, Any] = {}
                kind, inner = value_form(branch.get("time_limit"))
                # A template there is refused on its own, so it holds no number to check.
                if "time_limit" in branch and kind != "template":
                    lane["time_limit"] = inner
                if kind == "expr":
                    sources.add(f"branches.{index}.time_limit")
                lanes.append(lane)
            values["branches"] = lanes
        else:
            values["branches"] = branches
        for problem in ParallelControl().structure_problems(values, sources):
            self.findings.append(
                finding(
                    f"{step_path}.parallel.{_recipe_place(problem.field)}",
                    problem.code,
                    problem.message,
                    problem.fix,
                )
            )

    def _check_construct_fields(
        self, keyword: str, value: Mapping[str, Any], step_path: str
    ) -> None:
        """A construct's settings through the shared field check, named by their recipe key
        and reported at it (REQ-5.2.7.3)."""
        entry = self.catalog[CONTROL_FIELDS[keyword].control_id]
        for key, stored, written in recipe_field_places(keyword, value):
            self._check_setting_value(
                entry, stored, written, f"{step_path}.{keyword}.{key}", shown=key
            )

    def _check_construct_capture(
        self, keyword: str, value: Mapping[str, Any], step_path: str
    ) -> None:
        entry = self.catalog[CONTROL_FIELDS[keyword].control_id]
        self._check_capture(entry.outputs, entry.id, value.get("capture"), step_path)

    def _shape_assert(self, value: Any, step_path: str) -> bool:
        that = value.get("that") if isinstance(value, dict) else None
        if not isinstance(that, list) or not that:
            self._malformed("assert", "a non-empty 'that' list is required", step_path)
            return False
        self._check_condition_list(that, step_path)
        has_section = "on_pass" in value or "on_fail" in value
        if has_section and "mode" in value and value["mode"] != "split":
            self._malformed("assert", "'on_pass' and 'on_fail' need mode 'split'", step_path)
        self._check_construct_fields("assert", value, step_path)
        self._check_construct_capture("assert", value, step_path)
        return True

    def _shape_wait_until(self, value: Any, step_path: str) -> bool:
        that = value.get("that") if isinstance(value, dict) else None
        if not isinstance(that, list) or not that:
            self._malformed("wait_until", "a non-empty 'that' list is required", step_path)
            return False
        if "timeout" not in value:
            self._malformed("wait_until", "a 'timeout' is required", step_path)
            return False
        if "retry" in value and not isinstance(value["retry"], list):
            self._malformed("wait_until", "'retry' must be a list of steps", step_path)
            return False
        self._check_condition_list(that, step_path)
        self._check_construct_fields("wait_until", value, step_path)
        self._check_construct_capture("wait_until", value, step_path)
        return True

    def _shape_remote(self, value: Any, step_path: str) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("body"), list):
            self._malformed("remote", "a 'body' list of steps is required", step_path)
            return False
        settings = value.get("settings")
        self._check_settings(
            self.remote_entry,
            settings if isinstance(settings, dict) else {},
            step_path,
        )
        self._check_capture(
            self.remote_entry.outputs, self.remote_entry.id, value.get("capture"), step_path
        )
        self._check_profiles(value.get("profiles"), step_path)
        return True

    def _check_construct_step(self, keyword: str, value: Any, step_path: str) -> bool:
        """Construct-specific shape checks; returns False when malformed."""
        if keyword in _LOOP_KEYWORDS:
            return self._check_loop_shape(keyword, value, step_path)
        checks = {
            "if": self._shape_if,
            "switch": self._shape_switch,
            "try": self._shape_try,
            "parallel": self._shape_parallel,
            "assert": self._shape_assert,
            "remote": self._shape_remote,
            "wait_until": self._shape_wait_until,
        }
        return checks[keyword](value, step_path)

    def _shape_for(self, value: dict[str, Any], step_path: str) -> bool:
        if "count" not in value and not isinstance(value.get("range"), dict):
            self._malformed("for", "either 'count' or 'range' is required", step_path)
            return False
        if "count" in value and "range" in value:
            self._malformed("for", "'count' and 'range' cannot be used together", step_path)
        elif "range" in value and "step" in value:
            self._malformed("for", "'step' goes inside 'range' in range mode", step_path)
        return True

    def _shape_for_each(self, value: dict[str, Any], step_path: str) -> bool:
        if "collection" not in value:
            self._malformed("for_each", "a 'collection' is required", step_path)
            return False
        return True

    def _shape_while(self, value: dict[str, Any], step_path: str) -> bool:
        conditions = value.get("conditions")
        if conditions is None:
            self._malformed("while", "'conditions' is required", step_path)
            return False
        self._check_when(
            conditions, "'conditions' needs at least one condition", "while", step_path
        )
        return True

    def _check_loop_shape(self, keyword: str, value: Any, step_path: str) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("body"), list):
            self._malformed(keyword, "a 'body' list of steps is required", step_path)
            return False
        if keyword == "for":
            shaped = self._shape_for(value, step_path)
        elif keyword == "for_each":
            shaped = self._shape_for_each(value, step_path)
        else:
            shaped = self._shape_while(value, step_path)
        if not shaped:
            return False
        self._check_construct_fields(keyword, value, step_path)
        self._check_construct_capture(keyword, value, step_path)
        return True

    def _secret_rows(
        self, step: dict[str, Any], rows: Mapping[Any, Any], step_path: str
    ) -> set[str]:
        """The rows `secret_rows` marks Secret; each must be a row the step sets."""
        if "secret_rows" not in step:
            return set()
        marked = step["secret_rows"]
        path = f"{step_path}.secret_rows"
        if not isinstance(marked, list) or not all(isinstance(name, str) for name in marked):
            self._malformed_step("set", "'secret_rows' must be a list of variable names", path)
            return set()
        names = [str(name) for name in rows]
        for name in marked:
            if name not in names:
                self.findings.append(
                    finding(
                        path,
                        "UNKNOWN_SECRET_ROW",
                        f"Variable Setter has no row '{name}' to mark secret",
                        "Valid rows: " + ", ".join(sorted(names)),
                    )
                )
        return {name for name in marked if name in names}

    def _check_set_step(self, step: dict[str, Any], value: Any, step_path: str) -> None:
        if not isinstance(value, dict) or not value:
            self._malformed("set", "a mapping of variable names to values is required", step_path)
            return
        secret = self._secret_rows(step, value, step_path)
        element_types = step.get("element_types")
        declared = element_types if isinstance(element_types, dict) else {}
        for name, assigned in value.items():
            row = str(name)
            self._check_set_row(
                row, assigned, f"{step_path}.set.{row}", row in secret, declared.get(name)
            )
        written = {name: _written_view(item) for name, item in value.items()}
        self._check_undeclared_elements(
            "Variable", written, list(value), element_types, f"{step_path}.set", template_place=True
        )
        if "element_types" in step:
            literal = {
                name: written[name]
                for name, item in value.items()
                if _template_place_form(item)[0] not in ("expr", "template")
            }
            self._check_step_element_types(
                step, literal, set(literal), "Variable", step_path, template_place=True
            )

    def _check_set_row(
        self, row: str, assigned: Any, path: str, secret: bool, entry_types: Any
    ) -> None:
        """One Variable Setter row: a value form per row and per first-level entry
        (REQ-3.4.1.14)."""
        kind, inner = _template_place_form(assigned)
        if kind == "expr":
            self._check_expression(inner, path, target=row, masked=secret)
            return
        if kind == "template":
            if self._check_template_text(inner, path, target=row, masked=secret):
                self._check_template_row_type(row, path)
            return
        if kind == "literal" or not isinstance(inner, dict | list):
            return
        entries = _entries(inner, path, row)
        if secret and any(
            _template_place_form(entry.value)[0] in ("expr", "template") for entry in entries
        ):
            self.findings.append(
                finding(
                    path,
                    "INVALID_SECRET_ROW",
                    f"Secret row '{row}' is sealed whole; "
                    "its entries cannot be {expr: ...} or templates",
                    "Make the whole row {expr: ...}, or write its entries as plain values",
                )
            )
            return
        for entry in entries:
            self._check_row_entry(row, entry, _entry_type(entry_types, entry.key))

    def _check_template_row_type(self, row: str, path: str) -> None:
        """A template builds text, so a template row needs a string variable."""
        declared = self._declared_types.get(row)
        if declared is None or declared == "string":
            return
        self.findings.append(
            finding(
                path,
                "TEMPLATE_NOT_STRING",
                template_row_text(row, declared),
                f"Use {{expr: ...}} for a computed {declared} value",
            )
        )

    def _check_row_entry(self, row: str, entry: _RowEntry, entry_type: Any) -> None:
        """One entry of a Setter row: {expr}, a template on a text entry, or plain data."""
        kind, inner = _template_place_form(entry.value)
        if kind == "expr":
            self._check_expression(inner, entry.path, target=row)
        elif (
            kind == "template"
            and self._check_template_text(inner, entry.path, target=row)
            and isinstance(entry_type, str)
            and entry_type != "string"
        ):
            self.findings.append(
                finding(
                    entry.path,
                    "TEMPLATE_NOT_STRING",
                    template_entry_text(entry.key, row, entry_type),
                    f"Use {{expr: ...}} for a computed {entry_type} value",
                )
            )
        elif kind == "plain":
            self._check_too_deep(inner, entry.path, entry.place)

    def _check_plain_settings(
        self, entry: BlockEntry, settings: dict[str, Any], step_path: str
    ) -> None:
        """Store-only settings: plain values, never read as a template (REQ-3.5.0.3)."""
        fields = list(entry.parameters.values())
        for unknown in unknown_field_findings(fields, settings, block_id=entry.id):
            self._relay(unknown, step_path)
        known = {name: value for name, value in settings.items() if name in entry.parameters}
        for name, value in known.items():
            for item in check_field_value(entry.parameters[name], name, value, block_id=entry.id):
                self.findings.append(
                    finding(f"{step_path}.settings.{name}", item.code, item.message, item.fix)
                )

    def _check_note_step(self, value: Any, step_path: str) -> None:
        settings = value if isinstance(value, dict) else {"text": value}
        if value_form(value)[0] != "plain" or any(
            value_form(item)[0] != "plain" for item in settings.values()
        ):
            self._malformed_step(
                "note", "a note holds plain text and takes no expression", step_path
            )
            return
        self._check_plain_settings(self.catalog["note"], settings, step_path)

    def _check_sugar_step(
        self, keyword: str, step: dict[str, Any], value: Any, step_path: str
    ) -> None:
        if keyword == "set":
            self._check_set_step(step, value, step_path)
        elif keyword == "delay":
            settings = value if isinstance(value, dict) else {"duration": value}
            self._check_settings(self.catalog["delay"], settings, step_path)
        elif keyword == "halt":
            settings = value if isinstance(value, dict) else {}
            self._check_settings(self.catalog["halt"], settings, step_path, check_required=False)
        else:
            self._check_note_step(value, step_path)

    def _check_break_step(self, value: Any, step_path: str, loop_stack: list[str]) -> None:
        if not loop_stack:
            self.findings.append(
                finding(
                    step_path,
                    "BREAK_OUTSIDE_LOOP",
                    "break/continue is only valid inside a loop body",
                    None,
                )
            )
            return
        label = value.get("loop") if isinstance(value, dict) else None
        if label is not None and str(label) not in loop_stack:
            self.findings.append(
                finding(
                    step_path,
                    "UNKNOWN_LOOP_LABEL",
                    f"No enclosing loop is labeled '{label}'",
                    "Label the target loop and reference that label",
                )
            )

    def _check_identity(self, keyword: str, holder: Any, step_path: str) -> None:
        """A step's `description` (text of at most 64 characters) and `disabled` (true or
        false), the save's own rules (REQ-3.1.2.4)."""
        if not isinstance(holder, Mapping):
            return
        if "description" in holder:
            description = holder["description"]
            if not isinstance(description, str):
                self.findings.append(
                    finding(
                        step_path,
                        "INVALID_DESCRIPTION",
                        "Description must be text",
                        "Write the description as text",
                    )
                )
            elif len(description) > MAX_DESCRIPTION_LENGTH:
                self.findings.append(
                    finding(
                        step_path,
                        "DESCRIPTION_TOO_LONG",
                        f"Block description must be at most {MAX_DESCRIPTION_LENGTH} characters",
                        f"Trim description to {MAX_DESCRIPTION_LENGTH} characters",
                    )
                )
        if "disabled" in holder and not isinstance(holder["disabled"], bool):
            malformed = self._malformed if keyword in CONSTRUCT_KEYS else self._malformed_step
            malformed(keyword, "'disabled' must be true or false", step_path)

    def _check_step(
        self,
        keyword: str,
        step: dict[str, Any],
        value: Any,
        step_path: str,
        loop_stack: list[str],
    ) -> bool:
        """One step's own checks; returns False when a malformed construct must not descend."""
        self._check_identity(keyword, value if keyword in CONSTRUCT_KEYS else step, step_path)
        if keyword == "block":
            self._check_block_step(step, step_path)
        elif keyword == "function":
            self._check_function_step(step, step_path)
        elif keyword in ("break", "continue"):
            self._check_break_step(value, step_path, loop_stack)
        elif keyword in ("set", "delay", "halt", "note"):
            self._check_sugar_step(keyword, step, value, step_path)
        else:
            return self._check_construct_step(keyword, value, step_path)
        return True

    def _loop_label(self, keyword: str, value: Any) -> str:
        """The name a break or continue reaches a loop by: its label, else its block name."""
        label = value.get("label") if isinstance(value, dict) else None
        if label is not None:
            return str(label)
        return self.catalog[CONTROL_FIELDS[keyword].control_id].name

    def _walk_children(
        self, keyword: str, value: Any, step_path: str, loop_stack: list[str]
    ) -> None:
        is_loop = keyword in _LOOP_KEYWORDS
        if is_loop:
            loop_stack.append(self._loop_label(keyword, value))
        for prefix, child_steps in child_sections(keyword, value):
            self._walk_flow(child_steps, f"{step_path}.{prefix}", loop_stack)
        if is_loop:
            loop_stack.pop()

    def _walk_flow(self, steps: list[Any], path_prefix: str, loop_stack: list[str]) -> None:
        for index, step in enumerate(steps):
            step_path = f"{path_prefix}[{index}]"
            keyword = next(key for key in step if key in _STEP_KEYWORD_SET)
            value = step[keyword]
            if not self._check_step(keyword, step, value, step_path, loop_stack):
                continue
            self._walk_children(keyword, value, step_path, loop_stack)

    def _check_functions(self) -> None:
        seen: set[str] = set()
        reported: set[str] = set()
        for entry in self.doc.functions:
            name = str(entry.get("name") or "")
            if name in seen and name not in reported:
                reported.add(name)
                self.findings.append(
                    finding(
                        f"functions[{name}]",
                        "DUPLICATE_FUNCTION",
                        f"Local function '{name}' is defined more than once",
                        "Rename one of the definitions",
                    )
                )
            seen.add(name)
            self._check_function_parameters(entry, f"functions[{name}]")
        self.local_functions = {str(entry.get("name") or ""): entry for entry in self.doc.functions}

    def _check_function_parameters(self, entry: Mapping[str, Any], prefix: str) -> None:
        """Inputs follow the declaration rules; outputs may take a kind (REQ-3.1.2.8)."""
        inputs = _parameter_items(entry.get("inputs"))
        outputs = _parameter_items(entry.get("outputs"))
        parameter_lists: tuple[tuple[DeclarationKind, list[dict[str, Any]]], ...] = (
            ("input", inputs),
            ("output", outputs),
        )
        for kind, items in parameter_lists:
            for item in items:
                if isinstance(name := item.get("name"), str) and name:
                    path = f"{prefix}.{kind}s.{name}"
                    self.findings.extend(
                        _shared_declaration_findings(name, item.get("type"), kind, path)
                    )
        for item in inputs:
            self._check_input_item(item, f"{prefix}.inputs.{item.get('name')}")
        for item in outputs:
            self._check_output_kind(item, f"{prefix}.outputs.{item.get('name')}")
        variables = entry.get("variables")
        local_names = [str(name) for name in variables] if isinstance(variables, dict) else []
        self.findings.extend(
            finding(prefix, code, message, _DECLARATION_FIXES.get(code))
            for code, message in name_collisions(inputs, outputs, local_names)
        )

    def _check_input_item(self, item: Mapping[str, Any], path: str) -> None:
        """An input follows the input declaration rules and takes a plain default only, of
        its type; a choice list's default and a secret's are judged by their own rules."""
        name = item.get("name")
        self.findings.extend(_input_declaration_findings(item, path))
        if "expr" in item or "template" in item:
            self.findings.append(
                finding(
                    path,
                    "INPUT_KIND_NOT_ALLOWED",
                    f"Input '{name}' cannot use expr or template; "
                    "an input default is a plain value",
                    "Give the input a plain default and compute the value inside the Function",
                )
            )
            return
        declared = item.get("type")
        if "enumValues" in item or item.get("secret") or declared not in DECLARED_TYPES:
            return
        self._check_declared_value(str(name), str(declared), item.get("default"), path, "Input")

    def _check_output_kind(self, item: Mapping[str, Any], path: str) -> None:
        """An expression or template output is checked like a variable of that kind."""
        if "expr" in item:
            self._check_expression(item["expr"], path)
        elif "template" in item:
            self._check_template(item["template"], path)
            declared = item.get("type") or "string"
            self._check_template_type("Output", item.get("name"), declared, path)

    def run(self) -> list[dict[str, Any]]:
        self._check_variables()
        self._check_functions()
        for entry in self.doc.functions:
            name = str(entry.get("name") or "")
            self._declared_types = _function_scope_types(entry)
            self._walk_flow(entry.get("flow") or [], f"functions[{name}].flow", [])
            self._walk_flow(entry.get("notes") or [], f"functions[{name}].notes", [])
        self._declared_types = _scope_types(self.doc.variables)
        self._walk_flow(self.doc.flow, "flow", [])
        self._walk_flow(self.doc.notes, "notes", [])
        return self.findings


_STEP_KEYWORD_SET = frozenset(STEP_KEYWORDS)


def validate_recipe_doc(
    doc: RecipeDoc, testdata_dirs: list[str] | None = None
) -> list[dict[str, Any]]:
    """All stage-1 findings for a parsed recipe document."""
    return _Validator(doc, testdata_dirs).run()
