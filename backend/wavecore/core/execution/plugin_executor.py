"""Block settings resolution and the one plugin run every run path uses (REQ-3.4.2.8)."""

import ast
import copy
import json
import logging
import re
import time
from collections.abc import Callable, Collection, Iterable, Mapping, MutableMapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any, TypedDict, Unpack, cast

import yaml
from pydantic import BaseModel

from wavecore.core.expressions.errors import (
    BlockedExpressionError,
    ExpressionTypeError,
    InvalidExpressionError,
    NullValueError,
    null_failure_message,
)
from wavecore.core.expressions.security import (
    FIELD_BLOCKED_CONSTRUCTORS,
    MUTATING_METHOD_NAMES,
    SAFE_BUILTINS,
    blocked_constructor_message,
    blocked_pattern_message,
    format_null_error,
    is_blocked,
    mutating_method_message,
)
from wavecore.core.expressions.template import _TEMPLATE_PATTERN
from wavecore.core.expressions.template_escape import render_escaped
from wavecore.core.number_rule import (
    NumberType,
    is_integer_value,
    is_number_value,
    not_finite_name,
    parse_number,
)
from wavecore.core.profile_object import ProfileObject
from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import decimal_context
from wavecore.core.variables.element_types import (
    realize_declared_value,
    realize_typed_settings,
    to_platform_numbers,
)
from wavecore.core.variables.print_form import value_text
from wavecore.core.variables.value_checks import NUMBER_TYPES, number_value_problem
from wavecore.logging.filtering_logger import FilteringLogger
from wavecore.models.enums import LogLevel
from wavecore.models.plugins import get_param_attr

if TYPE_CHECKING:
    from wavecore.plugins.base import PluginBase


def is_table_rows(value: Any) -> bool:
    """A Table, or a list whose every item is a row map; no rows make an empty table."""
    if isinstance(value, Table):
        return True
    return isinstance(value, list) and all(isinstance(row, dict) for row in value)


VALUE_TYPE_CHECKS: dict[str, Callable[[Any], bool]] = {
    "string": lambda value: isinstance(value, str),
    "integer": is_integer_value,
    "float": is_number_value,
    "boolean": lambda value: isinstance(value, bool),
    "array": lambda value: isinstance(value, list),
    "map": lambda value: isinstance(value, dict),
    "table": is_table_rows,
}


def check_expression_type(param_name: str, result: Any, expected_type: str | list[str]) -> None:
    """Validate that expression result matches the declared parameter type.

    Args:
        param_name: Parameter name for error message
        result: The evaluated expression result
        expected_type: The declared type string (e.g. "integer", "string")
            or a list of type strings (e.g. ["array", "map", "table"])

    Raises:
        ExpressionTypeError: If result type doesn't match expected type
    """
    if result is None:
        return
    expected_types = expected_type if isinstance(expected_type, list) else [expected_type]
    checks = [VALUE_TYPE_CHECKS[name] for name in expected_types if name in VALUE_TYPE_CHECKS]
    if not checks or any(check(result) for check in checks):
        return
    label = "/".join(expected_types)
    raise ExpressionTypeError(
        f"Parameter '{param_name}' expects {label}, got {_result_type_word(result)}"
    )


def _result_type_word(result: Any) -> str:
    """The type a run type error names; a float that is not a number is named by its value."""
    if isinstance(result, float | Decimal) and not is_number_value(result):
        return not_finite_name(result)
    return type(result).__name__


@dataclass(frozen=True)
class NullPolicy:
    """How one block setting takes null and other types (REQ-3.4.2.2, REQ-3.4.2.3)."""

    accepts_null: bool = False
    null_piece_prints: bool = False
    accepts_any_type: bool = False


def null_policy_fields(
    parameters: Iterable[Mapping[str, Any] | BaseModel],
) -> dict[str, NullPolicy]:
    """Setting name -> its null policy, one per declared setting, from dict or model rows."""
    return {
        str(get_param_attr(param, "name")): NullPolicy(
            accepts_null=bool(get_param_attr(param, "accepts_null", False)),
            null_piece_prints=bool(get_param_attr(param, "null_piece_prints", False)),
            accepts_any_type=bool(get_param_attr(param, "accepts_any_type", False)),
        )
        for param in parameters
    }


def check_field_null(setting: str, result: Any, policy: NullPolicy) -> None:
    """A whole value that is null fails and names the setting, unless the setting accepts null."""
    if result is None and not policy.accepts_null:
        raise NullValueError(null_failure_message(setting))


def check_entry_nulls(setting: str, value: Any) -> None:
    """The refusal a Block calls for a null entry: a map value by its key, a row or a plain
    list item by its number counted from 1 (REQ-3.1.3.21)."""
    if isinstance(value, dict):
        for key, item in value.items():
            if item is None:
                raise NullValueError(null_failure_message(setting, key=str(key)))
    elif isinstance(value, list):
        for number, row in enumerate(value, start=1):
            if row is None or _is_null_row(row):
                raise NullValueError(null_failure_message(setting, row=number))


def _is_null_row(row: Any) -> bool:
    """A row is a record with a value; a record with no value key is not a null row."""
    return isinstance(row, dict) and "value" in row and row["value"] is None


def _check_call_mutation(node: ast.Call) -> str | None:
    """Check if a single AST Call node represents a mutating operation.

    Args:
        node: An ast.Call node to inspect

    Returns:
        Error message if mutation detected, None if clean
    """
    if isinstance(node.func, ast.Attribute) and node.func.attr in MUTATING_METHOD_NAMES:
        return mutating_method_message(node.func.attr)
    if isinstance(node.func, ast.Name) and node.func.id in FIELD_BLOCKED_CONSTRUCTORS:
        return blocked_constructor_message(node.func.id)
    return None


def _check_field_mutations(expression: str) -> str | None:
    """Check if an expression contains mutating operations.

    Used by resolve_parameters to enforce read-only field expression policy.

    Args:
        expression: The expression string to check

    Returns:
        Error message if mutation detected, None if clean
    """
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return None  # Syntax errors are caught elsewhere

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            error = _check_call_mutation(node)
            if error:
                return error
    return None


def read_only_violation(expression: str) -> str | None:
    """The plain-language reason an expression would change data, or None.

    The reporting half of the read-only rule, for gates that collect errors
    instead of raising (the save-time validator).
    """
    return _check_field_mutations(expression)


def enforce_read_only(expression: str) -> None:
    """Refuse an expression that would change data.

    Raises:
        BlockedExpressionError: If the expression contains a mutating call
    """
    violation = read_only_violation(expression)
    if violation:
        raise BlockedExpressionError(violation, expression)


def evaluate_expression(expression: str, variables: MutableMapping[str, Any]) -> Any:
    """Evaluate a pure Python expression with variables in scope.

    The single gate for every author-written expression: config fields,
    template markers, expression and template variables, assertions and
    conditions, and Function Block fields. All of them are read-only.

    Args:
        expression: Python expression string
        variables: Variable context dict

    Returns:
        Evaluated result

    Raises:
        BlockedExpressionError: If expression changes data or is otherwise blocked
        InvalidExpressionError: If expression references undefined variables or has invalid syntax
    """
    enforce_read_only(expression)
    return _evaluate_expression(expression, variables)


def _evaluate_template(
    template: str,
    variables: dict[str, Any],
    *,
    setting: str,
    null_piece_prints: bool = False,
) -> str:
    """Evaluate {{expr}} markers in a template string using the same
    expression evaluator as regular expression fields.

    Single braces {} are left untouched (safe for JSON, YAML, XML). A piece
    whose result is null fails and names the piece and the setting, unless the
    setting prints null pieces; such a setting writes every piece in WAVE's
    print form (REQ-3.1.3.22, REQ-3.1.3.23).

    Args:
        template: String with optional {{expr}} markers
        variables: Variable context dict
        setting: The name the null failure gives the filled text
        null_piece_prints: Write every piece in the print form, null as ``null``

    Returns:
        Template with all {{expr}} markers replaced by their evaluated values

    Raises:
        NullValueError: If a piece is null and the setting does not print null pieces
    """

    def replacer(match: re.Match[str]) -> str:
        expression = match.group(1).strip()
        if not expression:
            return match.group(0)  # Empty {{}} left as-is
        result = evaluate_expression(expression, variables)
        if null_piece_prints:
            return value_text(result)
        if result is None:
            raise NullValueError(null_failure_message(setting, expression=expression), expression)
        return str(result)

    return _TEMPLATE_PATTERN.sub(replacer, template)


def template_read_only_violation(template: str) -> str | None:
    """The reason a ``{{ }}`` string would change data, or None.

    Reports the first offending marker; the reporting half of the rule that
    ``_evaluate_template`` enforces at run time.
    """
    for match in _TEMPLATE_PATTERN.finditer(template):
        expression = match.group(1).strip()
        if expression:
            violation = read_only_violation(expression)
            if violation:
                return violation
    return None


def _resolve_expression_field(
    name: str,
    value: str,
    variables: dict[str, Any],
    parameter_types: dict[str, str | list[str]],
    policy: NullPolicy | None = None,
) -> Any:
    """Resolve a single expression field parameter.

    Evaluates the expression string, checks for mutations, and validates the
    result type against the declared parameter type. With a null policy, the
    result then passes the field null gate.

    Args:
        name: Parameter name
        value: Expression string to evaluate
        variables: Variable context for expression evaluation
        parameter_types: Map of param name to declared type for type checking
        policy: The setting's null policy; None leaves the result ungated

    Returns:
        Evaluated expression result, or None for empty expressions

    Raises:
        BlockedExpressionError: If expression contains mutating operations
        ExpressionTypeError: If result doesn't match declared type
        InvalidExpressionError: If expression has invalid syntax or undefined variables
        NullValueError: If the result is null where the policy refuses it
    """
    if not value.strip():
        return None
    result = evaluate_expression(value, variables)
    any_type = policy is not None and policy.accepts_any_type
    expected_type = parameter_types.get(name)
    if expected_type and not any_type:
        check_expression_type(name, result, expected_type)
    if policy is not None:
        check_field_null(name, result, policy)
    return result


def _down_coerce_float_param(value: Any, declared_type: str | list[str] | None) -> Any:
    """Reduce a float-typed Decimal to a plain float at the plugin call edge (REQ-3.1.3.14).

    Plugins run in platform double precision; the variable's own stored value
    stays exact.
    """
    if declared_type == "float" and isinstance(value, Decimal):
        return float(value)
    return value


def _resolve_single_parameter(
    name: str,
    value: Any,
    expression_fields: set[str],
    template_fields: set[str],
    variables: dict[str, Any],
    parameter_types: dict[str, str | list[str]],
    trim_fields: set[str] | None = None,
    render_escaped_template: Callable[[str], str] | None = None,
    policy: NullPolicy | None = None,
    exact_numbers: bool = False,
) -> Any:
    """Resolve a single parameter value based on its field classification.

    Args:
        name: Parameter name
        value: Raw parameter value
        expression_fields: Set of parameter names that are expressions
        template_fields: Set of parameter names that use {{expr}} template syntax
        variables: Variable context for expression evaluation
        parameter_types: Map of param name to declared type for type checking
        trim_fields: Set of parameter names whose resolved string value is stripped
        render_escaped_template: Fills a template parameter's markers escaped for where they land
        policy: The setting's null policy; None leaves an expression result ungated
        exact_numbers: Keep an exact float as it is instead of reducing it for a plugin

    Returns:
        Resolved parameter value
    """
    if name in expression_fields and isinstance(value, str):
        resolved = _resolve_expression_field(name, value, variables, parameter_types, policy)
    elif name in template_fields and isinstance(value, str):
        if render_escaped_template is None:
            resolved = _evaluate_template(
                value,
                variables,
                setting=name,
                null_piece_prints=policy is not None and policy.null_piece_prints,
            )
        else:
            resolved = render_escaped_template(value)
    else:
        resolved = value
    if not exact_numbers:
        resolved = _down_coerce_float_param(resolved, parameter_types.get(name))
    if trim_fields and name in trim_fields and isinstance(resolved, str):
        resolved = resolved.strip()
    return resolved


def _resolve_map_expression_entry(entry_value: str, variables: dict[str, Any]) -> Any:
    """Resolve a single expression entry within a map or list parameter.

    A null result reaches the Block as null; each Block decides what it means (REQ-3.1.3.21).

    Args:
        entry_value: Expression string to evaluate
        variables: Variable context for expression evaluation

    Returns:
        Evaluated expression result, or None for empty expressions

    Raises:
        BlockedExpressionError: If expression contains mutating operations
    """
    if not entry_value.strip():
        return None
    return evaluate_expression(entry_value, variables)


def _resolve_map_expression_keys(
    resolved: dict[str, Any],
    map_expression_keys: dict[str, set[str]],
    variables: dict[str, Any],
) -> None:
    """Resolve expression keys within map parameters (second pass).

    Modifies resolved dict in place by evaluating expression entries
    within map-type parameters. Array parameters resolve index-addressed
    keys of the form ``<index>.<field>`` (a record row) or ``<index>`` (a plain item).

    Args:
        resolved: Already-resolved parameter dict (modified in place)
        map_expression_keys: Map of parameter name to set of keys whose
            values should be evaluated as expressions
        variables: Variable context for expression evaluation
    """
    for param_name, expr_keys in map_expression_keys.items():
        if param_name not in resolved:
            continue
        map_value = resolved[param_name]
        if isinstance(map_value, list):
            _resolve_indexed_expression_keys(resolved, param_name, expr_keys, variables)
            continue
        if not isinstance(map_value, dict):
            continue
        # Shallow-copy the map so we don't mutate the original parameters
        # dict. Without this, loop iterations would see previously-resolved
        # values (e.g. int 8) instead of the original expression strings,
        # because resolved[param_name] shares the same object reference as
        # the caller's parameters[param_name].
        map_copy = dict(map_value)
        resolved[param_name] = map_copy
        for key in map_copy.keys():
            if key not in expr_keys:
                continue
            entry_value = map_copy[key]
            if not isinstance(entry_value, str):
                continue
            map_copy[key] = _resolve_map_expression_entry(entry_value, variables)


def _resolve_indexed_expression_keys(
    resolved: dict[str, Any],
    param_name: str,
    expr_keys: set[str],
    variables: dict[str, Any],
) -> None:
    """Resolve ``<index>.<field>`` and ``<index>`` expression keys within an array parameter.

    Copies the list and each touched item so the caller's original
    parameters are never mutated.
    """
    items_copy = list(resolved[param_name])
    resolved[param_name] = items_copy
    for key in expr_keys:
        index_text, _, field_name = key.partition(".")
        if not index_text.isdigit() or int(index_text) >= len(items_copy):
            continue
        index = int(index_text)
        item = items_copy[index]
        if not field_name:
            if isinstance(item, str):
                items_copy[index] = _resolve_map_expression_entry(item, variables)
            continue
        if not isinstance(item, dict) or not isinstance(item.get(field_name), str):
            continue
        item_copy = dict(item)
        item_copy[field_name] = _resolve_map_expression_entry(item_copy[field_name], variables)
        items_copy[index] = item_copy


def _resolve_map_template_entry(
    entry_value: str, variables: dict[str, Any], *, setting: str
) -> str:
    """Render one template entry's {{ }} markers (per-key template clone)."""
    return _evaluate_template(entry_value, variables, setting=setting)


def _resolve_map_template_keys(
    resolved: dict[str, Any],
    map_template_keys: dict[str, set[str]],
    variables: dict[str, Any],
) -> None:
    """Render template keys within map parameters (eager per-key pass).

    Mirrors _resolve_map_expression_keys: each flagged entry is rendered via
    _evaluate_template (an empty entry renders to "", not None). Modifies the
    resolved dict in place.
    """
    for param_name, tmpl_keys in map_template_keys.items():
        if param_name not in resolved:
            continue
        map_value = resolved[param_name]
        if not isinstance(map_value, dict):
            continue
        map_copy = dict(map_value)
        resolved[param_name] = map_copy
        for key in map_copy.keys():
            if key not in tmpl_keys:
                continue
            entry_value = map_copy[key]
            if not isinstance(entry_value, str):
                continue
            map_copy[key] = _resolve_map_template_entry(entry_value, variables, setting=param_name)


_YAML_TIMESTAMP_TAG = "tag:yaml.org,2002:timestamp"


class _WireFormatLoader(yaml.SafeLoader):
    """SafeLoader that reads dates and timestamps as text, the way kubectl reads a manifest."""

    yaml_implicit_resolvers = {
        first: [entry for entry in entries if entry[0] != _YAML_TIMESTAMP_TAG]
        for first, entries in yaml.SafeLoader.yaml_implicit_resolvers.items()
    }


def _canonical_json_text(name: str, value: Any) -> Any:
    """YAML-or-JSON text becomes canonical JSON text; blanks pass through, null documents drop."""
    if not isinstance(value, str) or not value.strip():
        return value
    try:
        loaded = yaml.load_all(value, Loader=_WireFormatLoader)
        documents = [document for document in loaded if document is not None]
    except yaml.YAMLError as exc:
        raise ValueError(f"Parameter '{name}' is not valid YAML or JSON: {exc}") from exc
    return json.dumps(documents[0] if len(documents) == 1 else documents)


FieldRows = Sequence[Mapping[str, Any] | BaseModel]


def _field_name(field: Mapping[str, Any] | BaseModel) -> str:
    return str(get_param_attr(field, "name"))


def _fields_marked(fields: FieldRows, attr: str, value: Any = None) -> set[str]:
    """The fields whose ``attr`` is set (or equals ``value`` when one is given)."""
    return {
        _field_name(field)
        for field in fields
        if (
            get_param_attr(field, attr) == value
            if value is not None
            else get_param_attr(field, attr)
        )
    }


def derive_parameter_metadata(
    fields: FieldRows,
) -> tuple[dict[str, str | list[str]], set[str], set[str], set[str]]:
    """Derive (parameter_types, trim_fields, reference_fields, wire_format_fields) of fields.

    reference_fields are variable_ref params whose value names a variable to
    resolve at execution (resolve_parameters treats them like expressions).
    wire_format_fields are the params whose descriptor asks for JSON on the wire.
    """
    parameter_types: dict[str, str | list[str]] = {
        _field_name(field): get_param_attr(field, "type") for field in fields
    }
    trim_fields = _fields_marked(fields, "trim")
    reference_fields = _fields_marked(fields, "variable_ref")
    wire_format_fields = _fields_marked(fields, "wire_format", "json")
    return parameter_types, trim_fields, reference_fields, wire_format_fields


def template_escape_fields(fields: FieldRows) -> dict[str, dict[str, Any]]:
    """Field name -> its template_escape spec (REQ-3.3.2.6)."""
    return {
        _field_name(field): spec
        for field in fields
        if (spec := get_param_attr(field, "template_escape"))
    }


def _escaped_renderer(
    spec: Mapping[str, Any] | None,
    setting: str,
    variables: dict[str, Any],
    resolved: Mapping[str, Any],
    registry: Any,
) -> Callable[[str], str] | None:
    """Fill markers escaped for where each lands, by the rule the spec selects (OS-5)."""
    if spec is None:
        return None

    def escaped(template: str) -> str:
        rule = spec["rules"][resolved.get(spec["by"]) or spec["default"]]
        secrets = registry.scan_values() if registry is not None else ()
        filled, pairs = render_escaped(
            template,
            rule,
            lambda expression: evaluate_expression(expression, variables),
            _TEMPLATE_PATTERN,
            setting=setting,
            parts=secrets,
        )
        _register_escaped_secrets(pairs, secrets, registry)
        return filled

    return escaped


def _register_escaped_secrets(
    pairs: list[tuple[str, str]], secrets: Collection[str], registry: Any
) -> None:
    """A secret filled escaped, whole or inside a larger value, is scrubbed in that form too."""
    for raw, escaped in pairs:
        if raw in secrets:
            registry.register_value(escaped, source="template escape")


def typed_value_fields(fields: FieldRows) -> set[str]:
    """The fields whose entries carry declared element types (REQ-3.1.3.19)."""
    return _fields_marked(fields, "typed_values")


def build_map_expression_keys(expression_fields: set[str] | None) -> dict[str, set[str]] | None:
    """Build map_expression_keys for per-entry expression resolution within map params."""
    map_expr_keys: dict[str, set[str]] | None = None
    if not expression_fields:
        return map_expr_keys
    for field in expression_fields:
        if "." not in field:
            continue
        param_name, key = field.split(".", 1)
        if map_expr_keys is None:
            map_expr_keys = {}
        map_expr_keys.setdefault(param_name, set()).add(key)
    return map_expr_keys


class ResolveSettings(TypedDict, total=False):
    """The template parameters of one resolve, their template_escape specs, null policies,
    declared credential settings and whether exact numbers stay exact."""

    template_fields: set[str] | None
    template_escapes: Mapping[str, Mapping[str, Any]] | None
    null_policies: Mapping[str, NullPolicy] | None
    credential_fields: Collection[str] | None
    exact_numbers: bool


def _check_credential_nulls(parameters: Mapping[str, Any], credentials: Collection[str]) -> None:
    """A credential setting holding a literal null fails before the block runs (REQ-3.1.3.18)."""
    for name in sorted(credentials):
        if name in parameters and parameters[name] is None:
            raise NullValueError(null_failure_message(name))


def resolve_parameters(
    parameters: dict[str, Any],
    expression_fields: set[str],
    variables: dict[str, Any],
    parameter_types: dict[str, str | list[str]],
    map_expression_keys: dict[str, set[str]] | None = None,
    map_template_keys: dict[str, set[str]] | None = None,
    trim_fields: set[str] | None = None,
    secret_fields: set[str] | None = None,
    registry: Any = None,
    reference_fields: set[str] | None = None,
    wire_format_fields: set[str] | None = None,
    typed_value_fields: set[str] | None = None,
    **settings: Unpack[ResolveSettings],
) -> dict[str, Any]:
    """Resolve parameter values, evaluating expressions and templates where flagged.

    Reference parameters (those whose name appears in reference_fields, e.g. a
    plugin's variable_ref inputs) resolve like expressions: their string value
    names a variable and is evaluated to that variable's value.

    Literal parameters pass through unchanged. Expression parameters
    (those whose name appears in expression_fields) are evaluated as
    Python expressions via eval() with safe builtins. Results are
    type-checked against the declared parameter type. Template parameters
    (those whose name appears in template_fields) have their {{expr}}
    markers evaluated and replaced inline.

    Args:
        parameters: Raw parameter name-value dict
        expression_fields: Set of parameter names that are expressions
        variables: Variable context for expression evaluation
        parameter_types: Map of param name to declared type for type checking
        map_expression_keys: Map of parameter name to set of keys within that map
            whose values should be evaluated as expressions
        map_template_keys: Map of parameter name to set of keys within that map
            whose values should be rendered as {{ }} templates (eager, second pass)
        trim_fields: Set of parameter names whose resolved string value is stripped
            of surrounding whitespace (strict single-line + enum params)
        secret_fields: Set of secret-declared parameter names whose RESOLVED
            values register with the run registry before execution
        registry: Per-run SecretRegistry receiving the secret-field values
        reference_fields: Set of variable_ref parameter names, resolved like expressions
        wire_format_fields: Set of parameter names whose resolved YAML-or-JSON text
            is converted to canonical JSON text before the plugin sees it
        typed_value_fields: Set of typed-values parameter names whose exact decimals,
            however written, reach the plugin as platform floats
        **settings: template_fields, the set of parameter names that use {{expr}}
            template syntax; template_escapes, the map of template parameter name
            to its template_escape spec; null_policies, each setting's NullPolicy
            (without it, expression and reference results are not gated);
            credential_fields, the declared credential settings, whose literal null
            is refused (without it, a literal null is nothing given); exact_numbers,
            True to keep exact floats exact (a Function Block, REQ-3.1.3.14)

    Returns:
        Dict with expression/template parameters evaluated and type-checked

    Raises:
        ExpressionTypeError: If expression result doesn't match declared type
        BlockedExpressionError: If expression contains blocked patterns
        InvalidExpressionError: If expression references undefined variables or has invalid syntax
        NullValueError: If a setting or ``{{ }}`` piece is null where it may not be
        ValueError: If a wire-format parameter holds text that is neither YAML nor JSON
    """
    template_fields = settings.get("template_fields")
    effective_template_fields = template_fields if template_fields is not None else set()
    effective_expression_fields = expression_fields | (reference_fields or set())

    escapes = settings.get("template_escapes") or {}
    policies = settings.get("null_policies") or {}
    exact_numbers = bool(settings.get("exact_numbers"))
    _check_credential_nulls(parameters, settings.get("credential_fields") or ())
    resolved: dict[str, Any] = {}
    # Escaped templates go last, so each reads its selector row resolved.
    for name, value in sorted(parameters.items(), key=lambda item: item[0] in escapes):
        resolved[name] = _resolve_single_parameter(
            name,
            value,
            effective_expression_fields,
            effective_template_fields,
            variables,
            parameter_types,
            trim_fields,
            _escaped_renderer(escapes.get(name), name, variables, resolved, registry),
            policies.get(name),
            exact_numbers,
        )
    resolved = {name: resolved[name] for name in parameters}

    if map_expression_keys:
        _resolve_map_expression_keys(resolved, map_expression_keys, variables)

    if map_template_keys:
        _resolve_map_template_keys(resolved, map_template_keys, variables)

    _apply_wire_format(resolved, wire_format_fields)
    if not exact_numbers:
        _reduce_typed_values(resolved, typed_value_fields)
    _register_secret_params(resolved, secret_fields, registry)

    return resolved


def _reduce_typed_values(resolved: dict[str, Any], typed_value_fields: set[str] | None) -> None:
    # REQ-3.1.3.14 plugin boundary: literal, per-entry expression and bound-profile values alike.
    for name in typed_value_fields or ():
        if name in resolved:
            resolved[name] = to_platform_numbers(resolved[name])


def _apply_wire_format(resolved: dict[str, Any], wire_format_fields: set[str] | None) -> None:
    for name in wire_format_fields or ():
        if name in resolved:
            resolved[name] = _canonical_json_text(name, resolved[name])


def _register_secret_params(
    resolved: dict[str, Any], secret_fields: set[str] | None, registry: Any
) -> None:
    if registry is None or not secret_fields:
        return
    for name in secret_fields:
        if name in resolved:
            registry.register_value(resolved[name], f"param:{name}")


def _base_name(key: str) -> str:
    """The field a whole or per-entry (``<field>.<entry>``) flag belongs to."""
    return key.split(".", 1)[0]


def _realized_default(field: Mapping[str, Any] | BaseModel) -> Any:
    declared_type = get_param_attr(field, "type")
    return realize_declared_value(
        copy.deepcopy(get_param_attr(field, "default")),
        declared_type if isinstance(declared_type, str) else "",
        copy.deepcopy(get_param_attr(field, "default_element_types")),
    )


def _filled(
    stored: Mapping[str, Any], fields: FieldRows, expression_fields: Collection[str]
) -> tuple[dict[str, Any], set[str]]:
    """The stored values with every field left out or left a blank expression filled, and the
    names that took their default."""
    filled = dict(stored)
    defaulted: set[str] = set()
    for field in fields:
        name = _field_name(field)
        value = filled.get(name)
        blank = name in expression_fields and isinstance(value, str) and not value.strip()
        # A stored null is nothing given, unless the field takes null (REQ-3.1.3.21).
        nothing = value is None and not get_param_attr(field, "accepts_null", False)
        if name in filled and not blank and not nothing:
            continue
        if get_param_attr(field, "default") is not None:
            filled[name] = _realized_default(field)
            defaulted.add(name)
        elif get_param_attr(field, "required", False):
            raise NullValueError(null_failure_message(name))
    return filled, defaulted


def fill_field_defaults(
    stored: Mapping[str, Any],
    fields: FieldRows,
    *,
    expression_fields: set[str],
) -> dict[str, Any]:
    """Every field the Block leaves out, leaves a blank expression or holds a null it does not
    take, filled from its current default realized by its type and item types (REQ-3.1.1.5,
    REQ-3.4.2.3).

    A Required field with no value and no default fails and names it; a field with no
    default otherwise stays left out. The stored mapping is never changed.

    Raises:
        NullValueError: If a Required field has nothing and no default
    """
    return _filled(stored, fields, expression_fields)[0]


def _session_registry(session_id: str | None) -> Any:
    """The run's SecretRegistry, or None when there is no session or it carries none."""
    if session_id is None:
        return None
    from wavecore.api.services.workbench._common import _get_session

    return (_get_session(session_id) or {}).get("secret_registry")


def _check_allowed_values(resolved: Mapping[str, Any], fields: FieldRows) -> None:
    """A value outside its field's allowed values stops the Block (REQ-3.4.2.3, REQ-3.1.2.11)."""
    # Imported here: the plugins package imports this module when it loads.
    from wavecore.plugins._executor_base import validate_enum_param

    for field in fields:
        name = _field_name(field)
        allowed = get_param_attr(field, "enum_values")
        if not allowed or resolved.get(name) is None:
            continue
        declared_type = get_param_attr(field, "type")
        as_type = declared_type if isinstance(declared_type, str) else ""
        value = resolved[name]
        typed = [realize_declared_value(item, as_type) for item in allowed]
        if realize_declared_value(value, as_type) not in typed:
            validate_enum_param(name, value, list(allowed))


def _number_literals(
    values: dict[str, Any], fields: FieldRows, skipped: Collection[str]
) -> dict[str, Any]:
    """Each number field's literal text as its exact number; blank text is nothing given."""
    realized = dict(values)
    for field in fields:
        name = _field_name(field)
        declared = get_param_attr(field, "type")
        value = realized.get(name)
        if (
            declared not in NUMBER_TYPES
            or not isinstance(value, str)
            or name in skipped
            or get_param_attr(field, "accepts_any_type", False)
        ):
            continue
        if not value.strip():
            del realized[name]
            continue
        problem = number_value_problem(value, declared)
        if problem is not None:
            raise ValueError(problem.describe(f"Setting '{name}'"))
        realized[name] = parse_number(value, cast(NumberType, declared))
    return realized


def resolve_block_fields(
    stored: Mapping[str, Any],
    fields: FieldRows,
    *,
    expression_fields: set[str],
    template_fields: set[str],
    element_types: Mapping[str, Any],
    variables: Mapping[str, Any],
    session_id: str | None,
    exact_numbers: bool,
    unmasked_secret_fields: Collection[str] = (),
) -> dict[str, Any]:
    """The one run entry for a Block's stored fields (REQ-3.4.2.3, REQ-3.1.1.5).

    Drops names the field list does not declare, fills what the Block leaves out from the
    current defaults, resolves expressions and templates with the field list's metadata,
    then checks allowed values. Plugins and controls get platform floats; a Function Block
    passes ``exact_numbers`` to keep every number exact (REQ-3.1.3.14). A per-field reveal
    (``unmasked_secret_fields``) keeps a secret field out of the run-wide scrub.

    Raises:
        NullValueError: If a Required field has nothing, or a value is null where refused
        ExpressionTypeError: If an expression gives a value of the wrong type
        ValueError: If a value is outside its field's allowed values
    """
    declared = {_field_name(field) for field in fields}
    expressions = {key for key in expression_fields if _base_name(key) in declared}
    templates = {key for key in template_fields if _base_name(key) in declared}
    parameter_types, trim_fields, reference_fields, wire_format_fields = derive_parameter_metadata(
        fields
    )
    kept = realize_typed_settings(
        {name: value for name, value in stored.items() if name in declared},
        element_types,
        expressions,
    )
    kept = _number_literals(kept, fields, expressions | templates | reference_fields)
    filled, defaulted = _filled(kept, fields, expressions)
    expressions = {key for key in expressions if _base_name(key) not in defaulted}
    templates = {key for key in templates if _base_name(key) not in defaulted}
    secrets = _fields_marked(fields, "secret")
    revealed = {name.lower() for name in unmasked_secret_fields}
    resolved = resolve_parameters(
        filled,
        expressions,
        cast(dict[str, Any], variables),
        parameter_types,
        map_expression_keys=build_map_expression_keys(expressions),
        map_template_keys=build_map_expression_keys(templates),
        trim_fields=trim_fields,
        secret_fields={name for name in secrets if name.lower() not in revealed},
        registry=_session_registry(session_id),
        reference_fields=reference_fields,
        wire_format_fields=wire_format_fields,
        typed_value_fields=typed_value_fields(fields),
        template_fields={key for key in templates if "." not in key},
        template_escapes=template_escape_fields(fields),
        null_policies=null_policy_fields(fields),
        credential_fields=secrets,
        exact_numbers=exact_numbers,
    )
    _check_allowed_values(resolved, fields)
    return resolved


_PROFILE_FIELD_REF = re.compile(r"^[a-zA-Z_]\w*\.[a-zA-Z_]\w*$")


def build_parameter_sources(
    parameters: dict[str, Any],
    expression_fields: set[str],
    variables: Mapping[str, Any],
    map_parameter_names: set[str],
) -> dict[str, str]:
    """Rendered source labels for map params, consumed by execution-time key policies.

    A literal map is labeled by its parameter name, a param-level expression
    map as "the <name> expression", and a bare profile-field reference as
    'profile "<name>"'.
    """
    sources: dict[str, str] = {}
    for name in map_parameter_names:
        if name not in parameters:
            continue
        value = parameters[name]
        if name in expression_fields and isinstance(value, str):
            sources[name] = _profile_source_label(value, variables) or f"the {name} expression"
        else:
            sources[name] = name
    return sources


def _profile_source_label(expression: str, variables: Mapping[str, Any]) -> str | None:
    """'profile "<name>"' when the expression is a bare profile-field reference."""
    reference = expression.strip()
    if not _PROFILE_FIELD_REF.match(reference):
        return None
    holder = variables.get(reference.split(".", 1)[0])
    if isinstance(holder, ProfileObject):
        profile_name = getattr(holder, "_profile_name", "") or getattr(holder, "_alias", "")
        return f'profile "{profile_name}"'
    return None


def _extract_variable_value(var_entry: Any) -> Any:
    """
    Extract a variable value from its storage format or reconstruct Tables.

    Unwraps dicts that have a "value" key (WAVE variable storage format:
    {"value": ..., "type": ..., "scope": ...}). The workbench expression
    evaluator does not use it (it passes variables through as-is).

    Args:
        var_entry: Variable entry, either:
            - Raw value (int, str, list, dict, etc.)
            - Storage-format entry: {"value": ..., "type": ..., "scope": ...}

    Returns:
        The variable value, with Table objects reconstructed if needed; None for a
        declaration with no value (REQ-3.1.3.20).
    """
    if not isinstance(var_entry, dict) or "value" not in var_entry:
        if isinstance(var_entry, dict) and isinstance(var_entry.get("type"), str):
            return None
        return var_entry

    value = var_entry["value"]
    if isinstance(value, Table):
        return value
    return realize_declared_value(
        value, str(var_entry.get("type") or ""), var_entry.get("elementTypes")
    )


def _failed_in(expression: str) -> str:
    return f"Expression evaluation failed for '{expression}': "


def _names_its_expression(error: Exception) -> bool:
    """True when an evaluation failure already says which expression it failed in."""
    return isinstance(error, InvalidExpressionError) and str(error).startswith(
        _failed_in(error.expression)
    )


def _evaluate_expression(expr_content: str, variables: MutableMapping[str, Any]) -> Any:
    """
    Evaluate a full expression like len(varname) or abs(num).

    Resolves variable references and evaluates using safe builtins.

    Args:
        expr_content: Expression like "len(username)" or "abs(count)"
        variables: Variable context dict

    Returns:
        Result of expression evaluation

    Raises:
        InvalidExpressionError: If evaluation fails; a failure on a null value says so
    """
    # Security: Block dangerous patterns (blacklist - defense in depth)
    blocked = is_blocked(expr_content)
    if blocked:
        raise BlockedExpressionError(blocked_pattern_message(blocked), expr_content)

    # Check for statement patterns that are not valid in expressions
    # Walrus operator := (assignment expression)
    if ":=" in expr_content:
        raise InvalidExpressionError(
            "Assignment expressions (:=) are not allowed - use the Variable Setter control instead",
            expr_content,
        )

    # Assignment = at the start of expression (top-level assignment)
    # This catches: x = 1, foo = "bar", but allows keyword args like key=lambda x: x
    if re.match(r"^[a-zA-Z_]\w*\s*=(?!=)", expr_content.strip()):
        raise InvalidExpressionError(
            "Assignment statements not allowed - use Variable Setter",
            expr_content,
        )

    # Pass `variables` itself as the eval locals so name lookups go
    # through its __getitem__ - the workbench wraps variables in a
    # LazyVariables MutableMapping that realizes expression variables on
    # first read. Calling ``dict(variables)`` here would snapshot only
    # the already-realized entries and a name like an unevaluated
    # expression variable would surface as a NameError.
    # Evaluate with safe builtins (whitelist - primary security boundary).
    # The 28-digit context keeps WaveDecimal arithmetic exact (REQ-3.1.3.14).
    try:
        with decimal_context():
            result = eval(expr_content, {"__builtins__": SAFE_BUILTINS}, variables)
        return result
    except NameError as e:
        # Format NameError with clearer message
        from wavecore.core.expressions.security import format_name_error

        raise InvalidExpressionError(
            format_name_error(e, expr_content),
            expr_content,
        ) from e
    except (BlockedExpressionError, NullValueError):
        # A nested lazy read was refused: its sentence already says what is
        # wrong, so it must not be wrapped again.
        raise
    except Exception as e:
        if _names_its_expression(e):
            raise
        raise InvalidExpressionError(
            format_null_error(e) or f"{_failed_in(expr_content)}{e}",
            expr_content,
        ) from e


async def execute_plugin(
    plugin: "PluginBase",
    parameters: dict[str, Any],
    log_level: LogLevel = LogLevel.DEBUG,
    variables: dict[str, Any] | None = None,
    extra_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run a plugin once through its lifecycle with resolved settings."""
    if variables is None:
        variables = {}

    # Create logger for plugin
    base_logger = logging.getLogger(f"plugin.{plugin.metadata['id']}")
    filtered_logger = FilteringLogger(base_logger, log_level)

    start_time = time.time()
    result: dict[str, Any] = {
        "status": "success",
        "return_value": None,
        "duration": 0.0,
        "error": None,
    }

    try:
        # Build execution context
        # REQ-3.2.2.10: Variables are accessible both via context["variables"] dict
        # and at top level for convenience (context["varname"])
        context: dict[str, Any] = {
            "parameters": parameters,
            "logger": filtered_logger,
            "variables": variables,
        }
        # Also expose variables at top level for convenient access
        context.update(variables)
        context.update(extra_context or {})

        # Track initial context keys to detect variables set by plugin
        initial_keys = set(context.keys())

        # Validate parameters
        await plugin.validate(parameters)

        # Initialize plugin
        await plugin.initialize(context)

        # Execute plugin
        return_value = await plugin.execute(context)
        result["return_value"] = return_value

        # REQ-3.2.2.10: Capture variables set by plugin at top level of context
        # Plugins may set variables like context["var_name"] = value
        # Move these to context["variables"] for persistence across plugin executions
        new_keys = set(context.keys()) - initial_keys
        for key in new_keys:
            if key not in ["parameters", "logger", "variables"]:
                # Plugin set a new variable at top level - move to variables dict
                variables[key] = context[key]

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    finally:
        # Always cleanup
        try:
            await plugin.cleanup()
        except Exception as cleanup_error:
            # Log cleanup errors but don't override execution errors
            if result["status"] == "success":
                result["status"] = "error"
                result["error"] = f"Cleanup failed: {cleanup_error}"

        # Record duration
        result["duration"] = time.time() - start_time

    return result
