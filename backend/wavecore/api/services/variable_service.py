"""Variable service layer for business logic (REQ-5.2.4.7).

This module provides the service layer for variable management operations.
It acts as an intermediary between API routes and the storage layer,
providing scope discovery, variable manipulation, expression evaluation,
and runtime variable watching.

Variables follow the WAVE hierarchy (Regression → Suite → Test → Block)
with inheritance and override capabilities at each level, supporting typed
values, computed expressions, and secret masking.
"""

import ast
import json
import uuid
from collections.abc import Mapping
from decimal import Decimal
from typing import Any

import yaml

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services.shared import (
    apply_secrets_mode_to_variables,
    check_foreign_envelopes,
    determine_import_item_status,
    parse_file,
    parse_zip_file,
    restore_masked_secrets,
    settle_imported_secret_variables,
    stored_variable_values,
    variable_value_errors,
)
from wavecore.api.services.storage_paths import get_system_variables_file_path
from wavecore.core.execution.plugin_executor import evaluate_expression as run_evaluate_expression
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.functions.declarations import declaration_problems, value_problems
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.masking import masked_declaration
from wavecore.core.secrets.sealing import seal_variables, unseal_all
from wavecore.core.variables.declared_values import declared_start
from wavecore.core.variables.element_types import realize_declared_value
from wavecore.core.variables.usage import cycle_message, cycle_path, sources_graph
from wavecore.core.variables.wire_form import wire_scalar

# Valid scopes in order from broadest to narrowest
VALID_SCOPES = ["system", "regression", "suite", "test"]


# Fixed entity ID for system variables (no entity_id in URL)
SYSTEM_ENTITY_ID = "00000000-0000-0000-0000-000000000000"

# In-memory storage for variables (keyed by scope -> entity_id -> variables).
# Suite, regression, and test scopes are cached here but persisted via
# their entity yaml files (suite.yaml, regression.yaml, test.yaml). System
# variables have no entity file to piggy-back on, so this module owns
# their on-disk source of truth at storage_paths.get_system_variables_file_path().
_variable_storage: dict[str, dict[str, dict[str, Any]]] = {}

# True once system-scope storage has been hydrated from disk in this process.
_system_cache_loaded: bool = False


def _load_system_from_disk() -> None:
    """Hydrate _variable_storage["system"] from the persisted yaml file.

    Safe to call more than once; the cache-loaded guard avoids re-reading
    on every access. On missing / unreadable file the in-memory scope
    stays empty so get_system_variables() returns an empty collection
    (the documented auto-initializing behavior).
    """
    global _system_cache_loaded
    if _system_cache_loaded:
        return
    _system_cache_loaded = True

    path = get_system_variables_file_path()
    if not path.exists():
        return
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except (yaml.YAMLError, OSError):
        return
    if not isinstance(data, dict):
        return
    variables = data.get("variables")
    if not isinstance(variables, dict):
        return

    _variable_storage.setdefault("system", {})
    _variable_storage["system"][SYSTEM_ENTITY_ID] = {
        name: dict(var_info) if isinstance(var_info, dict) else {"value": var_info}
        for name, var_info in variables.items()
    }


def _save_system_to_disk() -> None:
    """Persist the current system-scope state to its yaml file.

    Writes an empty `{"variables": {}}` document when the scope has been
    cleared so startup reads don't revert to an older snapshot.
    """
    scope_storage = _variable_storage.get("system", {})
    variables = scope_storage.get(SYSTEM_ENTITY_ID, {})

    path = get_system_variables_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump({"variables": variables}, f, default_flow_style=False, sort_keys=False)


# In-memory storage for watches (keyed by watch_id)
_watch_storage: dict[str, dict[str, Any]] = {}


def _validate_scope(scope: str) -> None:
    """Validate scope identifier.

    Args:
        scope: Scope to validate

    Raises:
        ValueError: If scope is invalid
    """
    if scope not in VALID_SCOPES:
        raise ValidationException(
            f"Invalid scope '{scope}': valid scopes are {', '.join(VALID_SCOPES)}"
        )


def _validate_expression_syntax(expression: str) -> None:
    """Validate expression syntax using Python AST.

    Args:
        expression: Expression to validate

    Raises:
        ValueError: If syntax is invalid
    """
    try:
        ast.parse(expression, mode="eval")
    except SyntaxError as e:
        raise ValidationException(f"Invalid expression syntax: {e}") from e


def _apply_secret_masking(variables: dict[str, Any]) -> dict[str, Any]:
    """Apply secret masking to variables.

    When the system ``shared_variables`` reveal flag is on (the global / regression /
    suite variable editors), secret values are unsealed to plaintext for display
    instead of masked. The stored value stays sealed - encryption at rest is unaffected.

    Args:
        variables: Variables dictionary

    Returns:
        Variables with secrets masked (or revealed as plaintext)
    """
    reveal = masking_settings.is_shared_variables_revealed()
    result = {}
    for name, var_info in variables.items():
        var_copy = dict(var_info)
        if var_copy.get("secret"):
            if reveal:
                var_copy["value"] = unseal_all(var_copy.get("value"))
            else:
                var_copy = masked_declaration(var_copy, flag_masked=True)
        result[name] = var_copy
    return result


def _check_computed_contains_secret(expression: str, variables: dict[str, Any]) -> bool:
    """Check if a computed expression references any secret variables.

    Args:
        expression: Expression to check
        variables: Available variables

    Returns:
        True if expression references secrets
    """
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in variables:
            if variables[node.id].get("secret"):
                return True
    return False


def _mark_computed_secrets(variables: dict[str, Any]) -> dict[str, Any]:
    """Mark computed variables that contain secrets.

    Args:
        variables: Variables dictionary

    Returns:
        Variables with computed secret flags
    """
    result = {}
    for name, var_info in variables.items():
        var_copy = dict(var_info)
        if var_copy.get("computed") and var_copy.get("expression"):
            if _check_computed_contains_secret(var_copy["expression"], variables):
                var_copy["contains_secret"] = True
        result[name] = var_copy
    return result


def list_scopes() -> dict[str, list[str]]:
    """List available variable scopes.

    Returns ordered list of scopes from broadest to narrowest.

    Returns:
        Dictionary with 'scopes' key containing ordered scope list
    """
    return {"scopes": VALID_SCOPES.copy()}


def get_entity_variables(scope: str, entity_id: str) -> dict[str, Any] | None:
    """Get variables for an entity.

    Args:
        scope: Variable scope
        entity_id: Entity identifier

    Returns:
        Variables dictionary or None if entity not found
    """
    _validate_scope(scope)

    if scope == "system":
        _load_system_from_disk()

    scope_storage = _variable_storage.get(scope, {})
    if entity_id not in scope_storage:
        return None

    variables = scope_storage[entity_id]
    # Apply masking and computed secret detection
    masked_vars = _apply_secret_masking(variables)
    masked_vars = _mark_computed_secrets(masked_vars)

    return {"variables": masked_vars}


def _validate_variable_definitions(variables: dict[str, Any], *, bare_names: bool) -> None:
    """Refuse the first declaration rule a variable breaks, then a computed expression's syntax."""
    for name, var_info in variables.items():
        declared = var_info if isinstance(var_info, dict) else {}
        _refuse_declaration_problems(name, declared, bare_names=bare_names)
        if declared.get("computed") and declared.get("expression"):
            try:
                _validate_expression_syntax(declared["expression"])
            except ValidationException as e:
                raise ValidationException(
                    f"Invalid expression syntax for variable '{name}': {e.message}"
                ) from e


def refuse_value_problems(variables: Mapping[str, Any]) -> None:
    """Refuse the first variable whose value breaks the one number rule (REQ-3.1.3.14)."""
    errors = variable_value_errors(dict(variables))
    if errors:
        raise ValidationException(errors[0]["message"])


def _refuse_declaration_problems(name: str, declared: dict[str, Any], *, bare_names: bool) -> None:
    """Refuse the first declaration rule one variable breaks."""
    for code, message in [
        *declaration_problems(
            name, declared.get("type"), declared.get("elementTypes"), kind="variable"
        ),
        *value_problems(declared, name, kind="variable"),
    ]:
        # A namespaced variable is read as <scope>.<name>, so a namespace name shadows nothing.
        if bare_names or code != "RESERVED_VARIABLE_NAME":
            raise ValidationException(message)


def _validate_no_cycles_for_payload(variables: dict[str, Any]) -> None:
    """Reject a loop among computed variables, in the ``computed`` form or the Test form."""
    expressions: dict[str, str] = {}
    templates: dict[str, str] = {}
    for name, var_info in variables.items():
        if not isinstance(var_info, dict):
            continue
        if var_info.get("computed") and var_info.get("expression"):
            expressions[name] = var_info["expression"]
            continue
        try:
            start = declared_start(var_info)
        except ValueError as exc:
            raise ValidationException(str(exc)) from exc
        if start.kind == "expression":
            expressions[name] = start.value
        elif start.kind == "template":
            templates[name] = start.value
    loop = cycle_path(sources_graph(expressions, templates))
    if loop is not None:
        raise ValidationException(cycle_message(loop))


def set_entity_variables(scope: str, entity_id: str, variables: dict[str, Any]) -> dict[str, Any]:
    """Set variables for an entity (replace entire collection).

    Args:
        scope: Variable scope
        entity_id: Entity identifier
        variables: Variables to set

    Returns:
        Set variables with metadata

    Raises:
        ValueError: If validation fails
    """
    _validate_scope(scope)

    # A cold write-only client (e.g. MCP) never read system vars, so hydrate the
    # on-disk baseline before restore or a masked secret seals over the real value.
    if scope == "system":
        _load_system_from_disk()

    # A masked secret must resolve to the stored (sealed) value, never seal the mask.
    variables = restore_masked_secrets(
        variables, _variable_storage.get(scope, {}).get(entity_id, {})
    )

    _validate_variable_definitions(variables, bare_names=scope == "test")
    _validate_no_cycles_for_payload(variables)

    # Initialize scope storage if needed
    if scope not in _variable_storage:
        _variable_storage[scope] = {}

    # Store variables (deep copy to avoid mutation); secret values seal at this boundary
    _variable_storage[scope][entity_id] = seal_variables(
        stored_variable_values(
            {
                name: dict(var_info) if isinstance(var_info, dict) else {"value": var_info}
                for name, var_info in variables.items()
            }
        )
    )

    if scope == "system":
        _save_system_to_disk()

    # Return masked response
    masked_vars = _apply_secret_masking(_variable_storage[scope][entity_id])
    masked_vars = _mark_computed_secrets(masked_vars)

    return {"variables": masked_vars}


def _check_type_consistency(variables: dict[str, Any], existing: dict[str, Any]) -> None:
    """Raise ValueError if any variable type conflicts with its existing type."""
    for name, var_info in variables.items():
        if not isinstance(var_info, dict):
            continue
        var_type = var_info.get("type")
        if not var_type or name not in existing:
            continue
        existing_type = existing[name].get("type")
        if existing_type and existing_type != var_type:
            raise ValidationException(
                f"Type mismatch for variable '{name}': "
                f"expected '{existing_type}', got '{var_type}'"
            )


def update_entity_variables(
    scope: str, entity_id: str, variables: dict[str, Any]
) -> dict[str, Any] | None:
    """Update variables for an entity (merge semantics).

    Args:
        scope: Variable scope
        entity_id: Entity identifier
        variables: Variables to update/add

    Returns:
        Updated variables dictionary or None if entity not found

    Raises:
        ValueError: If validation fails (e.g., type mismatch)
    """
    _validate_scope(scope)

    # A cold write-only client (e.g. MCP) never read system vars, so hydrate the
    # on-disk baseline before the existence check + restore.
    if scope == "system":
        _load_system_from_disk()

    scope_storage = _variable_storage.get(scope, {})
    if entity_id not in scope_storage:
        return None

    existing = scope_storage[entity_id]

    # A masked secret must resolve to the stored (sealed) value, never seal the mask.
    variables = restore_masked_secrets(variables, existing)

    _validate_variable_definitions(variables, bare_names=scope == "test")
    _check_type_consistency(variables, existing)

    # Cycle validation runs against the post-merge state, not just the patch,
    # so a cycle introduced by patching one half of an a/b pair is caught.
    merged_preview = {
        **existing,
        **{
            name: dict(var_info) if isinstance(var_info, dict) else {"value": var_info}
            for name, var_info in variables.items()
        },
    }
    _validate_no_cycles_for_payload(merged_preview)

    # Merge variables; secret values seal at this boundary
    for name, var_info in variables.items():
        existing[name] = dict(var_info) if isinstance(var_info, dict) else {"value": var_info}
    existing = scope_storage[entity_id] = seal_variables(stored_variable_values(existing))

    if scope == "system":
        _save_system_to_disk()

    # Return masked response
    masked_vars = _apply_secret_masking(existing)
    masked_vars = _mark_computed_secrets(masked_vars)

    return {"variables": masked_vars}


def delete_variable(scope: str, entity_id: str, name: str) -> bool:
    """Delete a variable from an entity.

    Args:
        scope: Variable scope
        entity_id: Entity identifier
        name: Variable name to delete

    Returns:
        True if deleted, False if variable not found

    Raises:
        ValueError: If entity not found
    """
    _validate_scope(scope)

    scope_storage = _variable_storage.get(scope, {})
    if entity_id not in scope_storage:
        raise NotFoundException(f"Entity with ID '{entity_id}' not found in scope '{scope}'")

    variables = scope_storage[entity_id]
    if name not in variables:
        return False

    del variables[name]
    if scope == "system":
        _save_system_to_disk()
    return True


def get_system_variables() -> dict[str, Any]:
    """Get system variables, auto-initializing to empty if none exist.

    Returns:
        Variables dictionary (always succeeds, never None)
    """
    result = get_entity_variables("system", SYSTEM_ENTITY_ID)
    if result is None:
        return {"variables": {}}
    return result


def get_system_variables_raw() -> dict[str, Any]:
    """System variables without masking, for engine injection only.

    The masked getter stays the API-facing read; the engine must receive
    real values so secret-flagged ones can register with the run registry.
    """
    _load_system_from_disk()
    scope_storage = _variable_storage.get("system", {})
    variables = scope_storage.get(SYSTEM_ENTITY_ID)
    if not variables:
        return {"variables": {}}
    return {
        "variables": {
            name: dict(var_info) if isinstance(var_info, dict) else var_info
            for name, var_info in variables.items()
        }
    }


def set_system_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """Set system variables (replace entire collection).

    Args:
        variables: Variables to set

    Returns:
        Set variables with metadata

    Raises:
        ValueError: If validation fails
    """
    return set_entity_variables("system", SYSTEM_ENTITY_ID, variables)


def delete_all_system_variables() -> None:
    """Delete all system variables."""
    _load_system_from_disk()
    scope_storage = _variable_storage.get("system", {})
    if SYSTEM_ENTITY_ID in scope_storage:
        del scope_storage[SYSTEM_ENTITY_ID]
    _save_system_to_disk()


def delete_system_variable(name: str) -> bool:
    """Delete a single system variable.

    Args:
        name: Variable name to delete

    Returns:
        True if deleted, False if variable not found
    """
    _load_system_from_disk()
    scope_storage = _variable_storage.get("system", {})
    if SYSTEM_ENTITY_ID not in scope_storage:
        return False
    variables = scope_storage[SYSTEM_ENTITY_ID]
    if name not in variables:
        return False
    del variables[name]
    _save_system_to_disk()
    return True


# =============================================================================
# System variable import/export
# =============================================================================


def _raw_system_variables() -> dict[str, Any]:
    """Return the stored system variables collection (module-internal view)."""
    _load_system_from_disk()
    return _variable_storage.get("system", {}).get(SYSTEM_ENTITY_ID, {})


def _parse_import_files(content: bytes, filename: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse an upload into (filename, document) pairs, expanding ZIP archives."""
    if filename.lower().endswith(".zip"):
        return parse_zip_file(content)
    return [(filename, parse_file(content, filename))]


def export_system_variables(fmt: str = "yaml", secrets: str = "mask") -> tuple[bytes, str, str]:
    """Serialize the system variables collection for download.

    Reads the raw stored collection and applies the requested secrets mode.

    Args:
        fmt: Output format, 'yaml' or 'json'.
        secrets: Secret values handling ('mask', 'encrypted', or 'plaintext').

    Returns:
        Tuple of (payload, filename, content_type).
    """
    data = {"variables": apply_secrets_mode_to_variables(_raw_system_variables(), secrets)}
    if fmt == "json":
        return (
            json.dumps(data, indent=2).encode(),
            "system-variables.json",
            "application/json",
        )
    return (
        yaml.dump(data, default_flow_style=False, sort_keys=False).encode(),
        "system-variables.yaml",
        "application/x-yaml",
    )


def validate_system_variables_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate an uploaded file for system variable import without persisting.

    Args:
        content: Raw file content bytes.
        filename: Uploaded filename (drives format detection).

    Returns:
        Validation result with per-variable items and summary counts.
    """
    existing_names = {name: name for name in _raw_system_variables()}
    items: list[dict[str, Any]] = []

    for fname, document in _parse_import_files(content, filename):
        variables = document.get("variables")
        if not isinstance(variables, dict):
            items.append(
                {
                    "name": fname,
                    "status": "fatal",
                    "fatal_errors": [
                        {"code": "NO_VARIABLES", "message": "No variables found in file"}
                    ],
                    "fixable_errors": [],
                    "warnings": [],
                    "existing_id": None,
                }
            )
            continue
        for name, var_info in variables.items():
            fatal_errors: list[dict[str, str]] = []
            if not isinstance(var_info, dict) or not var_info.get("type"):
                fatal_errors.append({"code": "MISSING_TYPE", "message": "Missing type"})
            else:
                fatal_errors.extend(
                    {"code": code, "message": message}
                    for code, message in value_problems(var_info, name, kind="variable")
                )
            item_status, existing_id = determine_import_item_status(
                name, bool(fatal_errors), [], existing_names
            )
            items.append(
                {
                    "name": name,
                    "status": item_status,
                    "fatal_errors": fatal_errors,
                    "fixable_errors": [],
                    "warnings": check_foreign_envelopes({name: var_info}),
                    "existing_id": existing_id,
                }
            )

    blocked = sum(1 for item in items if item["status"] == "fatal")
    return {
        "items": items,
        "total": len(items),
        "importable": len(items) - blocked,
        "blocked": blocked,
    }


def _merge_import_variables(
    variables: dict[str, Any],
    existing: dict[str, Any],
    resolutions: dict[str, str],
    merged: dict[str, Any],
    imported: list[dict[str, str]],
    skipped: list[dict[str, str]],
) -> None:
    """Classify one file's variables into merged/imported/skipped."""
    for name, var_info in variables.items():
        if not isinstance(var_info, dict) or not var_info.get("type"):
            skipped.append({"name": name, "reason": "Missing type"})
            continue
        if name in existing:
            if resolutions.get(name) == "skip":
                skipped.append({"name": name, "reason": "skipped by user"})
                continue
            action = "overwritten"
        else:
            action = "created"
        merged[name] = settle_imported_secret_variables({name: var_info}, existing)[name]
        imported.append({"name": name, "id": name, "action": action})


def import_system_variables(
    content: bytes,
    filename: str,
    conflict_resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import system variables, merging into the existing collection.

    Conflicts resolve per ``conflict_resolutions`` ('overwrite' or 'skip',
    default overwrite); variables without a type are skipped. Persists
    through the standard system-variables set path.

    Args:
        content: Raw file content bytes.
        filename: Uploaded filename (drives format detection).
        conflict_resolutions: Map of variable name to resolution.

    Returns:
        Import result with imported/skipped details and summary counts.
    """
    resolutions = conflict_resolutions or {}
    existing = _raw_system_variables()
    merged = {name: dict(var_info) for name, var_info in existing.items()}
    imported: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    for _fname, document in _parse_import_files(content, filename):
        variables = document.get("variables")
        if not isinstance(variables, dict):
            continue
        _merge_import_variables(variables, existing, resolutions, merged, imported, skipped)

    if imported:
        set_system_variables(merged)

    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": [],
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }


def _resolve_context_variables(context: dict[str, Any]) -> dict[str, Any]:
    """Merge explicit variables with entity-scoped variables from context."""
    variables: dict[str, Any] = context.get("variables", {})
    entity_scope = context.get("scope")
    entity_id = context.get("entity_id")

    if entity_scope and entity_id:
        entity_vars = get_entity_variables(entity_scope, entity_id)
        if entity_vars:
            for name, var_info in entity_vars["variables"].items():
                if name not in variables:
                    variables[name] = var_info

    return variables


def _build_eval_namespace(variables: dict[str, Any]) -> dict[str, Any]:
    """Plain values realized as their declared types for the eval namespace.

    Floats become exact ``WaveDecimal`` (REQ-3.1.3.14); array / map elements take
    their declared element types (REQ-3.1.3.19).
    """
    namespace: dict[str, Any] = {}
    for name, val in variables.items():
        if isinstance(val, dict):
            namespace[name] = realize_declared_value(
                val.get("value"), str(val.get("type") or ""), val.get("elementTypes")
            )
        else:
            namespace[name] = val
    return namespace


def _check_secret_references(expression: str, variables: dict[str, Any]) -> bool:
    """Return True if the expression references any secret variables."""
    tree = ast.parse(expression, mode="eval")
    referenced = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    return any(
        isinstance(variables.get(name), dict) and variables[name].get("secret")
        for name in referenced
    )


def _determine_result_type(result: Any) -> tuple[Any, str]:
    """Classify an evaluation result and coerce non-string fallbacks to str.

    A number takes its wire form (REQ-3.1.3.14); null stays null (REQ-3.1.3.20).
    """
    if result is None:
        return None, "null"
    if isinstance(result, bool):
        return result, "boolean"
    if isinstance(result, Decimal | float):
        return wire_scalar(result), "float"
    if isinstance(result, int):
        return wire_scalar(result), "integer"
    if not isinstance(result, str):
        return str(result), "string"
    return result, "string"


def evaluate_expression(expression: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Evaluate a variable expression with the run's evaluator.

    Variable values from context are available in the evaluation namespace.

    Args:
        expression: Python expression to evaluate
        context: Optional evaluation context with 'variables', 'scope', 'entity_id'

    Returns:
        Evaluation result with type and secret indicator

    Raises:
        ValidationException: If the syntax is invalid or the evaluation fails, with the run's text
    """
    _validate_expression_syntax(expression)

    context = context or {}
    variables = _resolve_context_variables(context)
    # Evaluation computes on real values; sealed secret references decrypt here only
    eval_vars = _build_eval_namespace(unseal_all(variables))

    contains_secret = _check_secret_references(expression, variables)

    try:
        result = run_evaluate_expression(expression, eval_vars)
    except ExpressionEvaluationError as error:
        raise ValidationException(str(error)) from error

    result, result_type = _determine_result_type(result)

    response: dict[str, Any] = {"result": result, "type": result_type}
    if contains_secret:
        response["contains_secret"] = True

    return response


def validate_expression(
    expression: str,
    context: dict[str, Any] | None = None,
    *,
    is_field_expression: bool = False,
) -> dict[str, Any]:
    """Validate expression syntax using Python AST.

    Uses proper Python parsing to handle:
    - List/dict/set comprehensions (loop variables are local)
    - Generator expressions
    - Lambda expressions
    - Proper scoping rules

    Args:
        expression: Raw Python expression to validate
        context: Optional context with 'variables' dict for undefined reference checking
        is_field_expression: If True, block mutating methods and constructors (read-only context)

    Returns:
        Validation result with:
        - valid: bool - True if no errors (warnings are OK)
        - issues: list - Detailed issues with type, code, message, line, column
    """
    from wavecore.core.expressions.validator import (
        validate_expression as _validate_expression,
    )

    # Extract available variable names from context
    available_variables: set[str] | None = None
    if context:
        variables = context.get("variables", {})
        available_variables = set(variables.keys())

    result = _validate_expression(
        expression, available_variables, is_field_expression=is_field_expression
    )
    return result.to_dict()


def register_watch(variables: list[str], execution_id: str | None = None) -> dict[str, str]:
    """Register variable watch.

    Args:
        variables: Variable paths to watch
        execution_id: Optional execution context

    Returns:
        Watch registration with watch_id

    Raises:
        ValueError: If variables list is empty
    """
    if not variables:
        raise ValidationException("At least one variable path is required")

    watch_id = str(uuid.uuid4())
    _watch_storage[watch_id] = {
        "variables": variables,
        "execution_id": execution_id,
    }

    return {"watch_id": watch_id}


def get_watched_values(watch_id: str) -> dict[str, Any] | None:
    """Get current values for watched variables.

    Args:
        watch_id: Watch identifier

    Returns:
        Current values or None if watch not found
    """
    if watch_id not in _watch_storage:
        return None

    watch = _watch_storage[watch_id]
    values: dict[str, Any] = {}

    for var_path in watch["variables"]:
        # Parse qualified path: scope.entity_id.var_name
        parts = var_path.split(".")
        if len(parts) >= 3:
            scope = parts[0]
            entity_id = parts[1]
            var_name = ".".join(parts[2:])

            entity_vars = get_entity_variables(scope, entity_id)
            if entity_vars and var_name in entity_vars["variables"]:
                var_info = entity_vars["variables"][var_name]
                values[var_path] = {
                    "value": var_info.get("value"),
                    "type": var_info.get("type"),
                }
        else:
            # Unqualified path - just record that we're watching it
            values[var_path] = {"value": None, "type": None}

    return {"values": values}


def unregister_watch(watch_id: str) -> bool:
    """Unregister a variable watch.

    Args:
        watch_id: Watch identifier

    Returns:
        True if unregistered, False if not found
    """
    if watch_id not in _watch_storage:
        return False

    del _watch_storage[watch_id]
    return True
