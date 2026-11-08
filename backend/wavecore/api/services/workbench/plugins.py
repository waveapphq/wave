"""Plugin and control execution for workbench sessions."""

from collections.abc import Container, Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from wavecore.api.exceptions import NotFoundException
from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.workbench._common import _add_execution_log, _get_session
from wavecore.api.services.workbench.block_source import block_source
from wavecore.connectivity.url_credentials import mask_url_passwords_in
from wavecore.core.execution.plugin_executor import resolve_block_fields
from wavecore.core.secrets.masking import mask_io_payload, mask_values, secret_param_names
from wavecore.core.secrets.sealing import unseal_all
from wavecore.core.table import Table
from wavecore.core.variables.declared_types import declared_type
from wavecore.core.variables.element_types import realize_declared_value
from wavecore.core.variables.print_form import value_text
from wavecore.core.variables.value_checks import declared_value_problem
from wavecore.logging.session_logger import SessionLogger
from wavecore.models.plugins import get_param_attr

_IO_VALUE_LIMIT = 2048


@dataclass(frozen=True)
class SetterRows:
    """A Variable Setter's per-row records: expression and template rows, types, element types."""

    expression_keys: set[str] = dataclass_field(default_factory=set)
    template_keys: set[str] = dataclass_field(default_factory=set)
    types: dict[str, str] = dataclass_field(default_factory=dict)
    element_types: Mapping[str, Any] = dataclass_field(default_factory=dict)


def _get_session_registry(session_id: str) -> Any:
    """The run's SecretRegistry, or None when the session carries none."""
    return (_get_session(session_id) or {}).get("secret_registry")


def _setter_row_flags(keys: set[str]) -> set[str]:
    """A Variable Setter row's per-row flag as a per-entry flag of its ``variables`` map."""
    return {f"variables.{key}" for key in keys}


def _coerce_setter_variables(
    processed_params: dict[str, Any],
    variable_types: dict[str, str],
    variable_element_types: Mapping[str, Any] | None = None,
    variable_expression_keys: set[str] | None = None,
    variable_template_keys: set[str] | None = None,
) -> None:
    """Coerce Variable Setter rows to their declared types; a literal row follows the one
    number rule (REQ-3.1.3.14, REQ-3.1.3.19, REQ-3.5.5.4)."""
    from wavecore.controls.variable_setter import _coerce_value

    setter_vars = processed_params.get("variables")
    if not isinstance(setter_vars, dict):
        return
    element_types = variable_element_types or {}
    expression_keys = variable_expression_keys or set()
    sources = expression_keys | (variable_template_keys or set())
    for var_name, var_value in setter_vars.items():
        expected_type = variable_types.get(var_name)
        if not expected_type:
            continue
        if var_name not in sources:
            _refuse_setter_literal(var_name, var_value, expected_type, element_types)
        coerced = _coerce_value(var_value, expected_type, var_name)
        typed_literal = var_name in element_types and var_name not in expression_keys
        if typed_literal or expected_type == "table":
            coerced = realize_declared_value(coerced, expected_type, element_types.get(var_name))
        setter_vars[var_name] = coerced


def _refuse_setter_literal(
    var_name: str, var_value: Any, expected_type: str, element_types: Mapping[str, Any]
) -> None:
    """A literal Setter row that breaks the one number rule stops the Block (REQ-3.1.3.14)."""
    problem = declared_value_problem(var_value, expected_type, element_types.get(var_name))
    if problem is not None:
        raise TypeError(problem.describe(f"Value for variable '{var_name}'"))


async def _execute_control(
    control_type: str,
    version: str,
    parameters: dict[str, Any],
    variables: dict[str, Any],
    session_id: str | None = None,
    block_id: str | None = None,
    block_label: str | None = None,
    expression_fields: set[str] | None = None,
    template_fields: set[str] | None = None,
    setter_rows: SetterRows | None = None,
    reveal_secrets: bool = False,
) -> Any:
    """Execute a control (e.g., Delay)."""
    from wavecore.controls.registry import get_control_implementation
    from wavecore.models.enums import ControlId, LogLevel

    try:
        control_id = ControlId(control_type)
    except ValueError:
        raise NotFoundException(f"Unknown control type: {control_type}") from None

    control_class = get_control_implementation(control_id, version)
    if not control_class:
        raise NotFoundException(f"Control {control_type} version {version} not found")

    control = control_class()
    control_metadata = control.metadata

    rows = setter_rows or SetterRows()
    resolved_params = resolve_block_fields(
        parameters,
        control_metadata.get("parameter_schema") or [],
        expression_fields=(expression_fields or set()) | _setter_row_flags(rows.expression_keys),
        template_fields=(template_fields or set()) | _setter_row_flags(rows.template_keys),
        element_types={},
        variables=variables,
        session_id=session_id,
        exact_numbers=False,
    )

    if rows.types and control_id == ControlId.VARIABLE_SETTER:
        _coerce_setter_variables(
            resolved_params,
            rows.types,
            rows.element_types,
            rows.expression_keys,
            rows.template_keys,
        )

    context: dict[str, Any] = {
        "parameters": resolved_params,
        "variables": variables,
    }

    if session_id:
        context["logger"] = SessionLogger(
            session_id=session_id,
            source=block_source(control_type, control_metadata, block_label),
            threshold=LogLevel.DEBUG,
            block_id=block_id,
            unmask=reveal_secrets,
        )

    await control.validate(resolved_params)
    return await control.execute(context)


def _inject_profile_variables(
    profile_bindings: list[dict[str, Any]],
    variables: dict[str, Any],
    environment_id: str = "",
    session_id: str | None = None,
    _block_name: str = "Unknown",
) -> None:
    """Inject profile field values as flat variables for expression evaluation.

    Credentials inject RAW (the connection needs real bytes); sealed-at-rest
    fields register with the run's SecretRegistry so every outbound surface
    masks them.
    """
    registry = _get_session_registry(session_id) if session_id else None
    for binding in profile_bindings:
        _inject_one_profile_binding(binding, variables, environment_id, session_id, registry)


def _inject_one_profile_binding(
    binding: dict[str, Any],
    variables: dict[str, Any],
    environment_id: str,
    session_id: str | None,
    registry: Any,
) -> None:
    """Inject one profile binding's fields, registering its sealed-at-rest ones."""
    from wavecore.api.services.profiles.service import (
        get_profile_config_for_execution,
        get_profile_secret_field_names,
    )
    from wavecore.core.profile_object import ProfileObject

    profile_id = binding.get("profileId", "")
    alias = binding.get("alias", "")
    if not profile_id or not alias:
        return

    config = get_profile_config_for_execution(profile_id, environment_id)
    if config is None:
        if session_id:
            _add_execution_log(
                session_id,
                "WARN",
                f"Profile '{binding.get('profileName', profile_id)}' "
                f"bound as '{alias}' not found - skipping",
                "SYSTEM",
            )
        return

    variables[alias] = ProfileObject(
        config,
        alias=alias,
        profile_name=binding.get("profileName", alias),
        profile_type=binding.get("profileType", ""),
    )

    secret_fields = (
        get_profile_secret_field_names(profile_id, environment_id)
        if registry is not None
        else set()
    )
    for field_name, field_value in config.items():
        variables[f"{alias}.{field_name}"] = field_value
        if field_name in secret_fields:
            registry.register(f"{alias}.{field_name}", field_value, "profile")


def _namespace_value(var_info: Any) -> Any:
    """A namespace variable's raw value realized as its declared type (REQ-3.1.3.19)."""
    if not isinstance(var_info, dict):
        return unseal_all(var_info)
    return realize_declared_value(
        unseal_all(var_info.get("value")),
        str(var_info.get("type") or ""),
        var_info.get("elementTypes"),
    )


def _inject_namespace_variables(
    variables: dict[str, Any],
    test_id: str = "",
    suite_id: str | None = None,
    regression_id: str | None = None,
    registry: Any = None,
) -> None:
    """Inject namespace objects (system, suite, regression) into the variable context.

    Namespace variables inject their RAW values (the engine must never
    receive the mask placeholder); secret-flagged values register with the
    run's SecretRegistry instead so every outbound surface masks them.
    When ``suite_id`` is provided (sequential suite/regression execution)
    only that suite's variables are resolved; otherwise the values from
    every suite containing the test are merged (last-wins) for the
    Workbench editing context. Similarly for ``regression_id``.
    """
    from wavecore.api.services.variable_service import get_system_variables_raw
    from wavecore.core.system_object import SystemObject

    system_result = get_system_variables_raw()
    system_vars = system_result.get("variables", {})

    # Build plain-value dict for the SystemObject
    system_data: dict[str, object] = {}
    for name, var_info in system_vars.items():
        value = _namespace_value(var_info)
        system_data[name] = value
        if registry is not None and isinstance(var_info, dict) and var_info.get("secret"):
            registry.register(f"system.{name}", value, "system")

    variables["system"] = SystemObject(system_data)

    for name, value in system_data.items():
        variables[f"system.{name}"] = value

    # Inject suite and regression variables when the test belongs to suites/regressions
    if test_id:
        _inject_suite_variables(variables, test_id, suite_id=suite_id, registry=registry)
        _inject_regression_variables(
            variables, test_id, regression_id=regression_id, registry=registry
        )


def _resolve_suite_list(test_id: str, suite_id: str | None) -> list[dict[str, Any]]:
    """Return the list of suites whose variables should be merged.

    Scoped (suite_id set) returns at most one; workbench editing
    (suite_id None) returns all suites containing the test.
    """
    from wavecore.api.services.relations import service as relation_service
    from wavecore.api.services.suites import service as suite_service

    if suite_id is not None:
        suite = suite_service.get_suite(suite_id)
        if suite is None:
            return []
        return [{"id": suite_id, "name": suite.get("name", "")}]
    return relation_service.get_suites_for_test(test_id)


def _merge_suite_vars(suites: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    from wavecore.api.services.suites import service as suite_service

    merged: dict[str, Any] = {}
    names: list[str] = []
    for suite_info in suites:
        names.append(suite_info["name"])
        suite_vars = suite_service.get_suite_variables_raw(suite_info["id"])
        if not suite_vars:
            continue
        merged.update(suite_vars)
    return merged, names


def _inject_suite_variables(
    variables: dict[str, Any],
    test_id: str,
    suite_id: str | None = None,
    registry: Any = None,
) -> None:
    """Inject SuiteObject from suites containing this test.

    ``suite_id`` (when set) narrows the resolution to that single suite -
    this is what a sequential suite/regression execution passes so each
    test run sees the variables of the suite it's running IN, not a
    merge of every suite that happens to contain the test.
    Secret-flagged entries inject RAW and register with the run registry.
    """
    from wavecore.core.suite_object import SuiteObject

    suites = _resolve_suite_list(test_id, suite_id)
    if not suites:
        return

    merged, suite_names = _merge_suite_vars(suites)
    if not merged:
        return

    suite_data: dict[str, object] = {}
    for name, var_info in merged.items():
        value = _namespace_value(var_info)
        suite_data[name] = value
        if registry is not None and isinstance(var_info, dict) and var_info.get("secret"):
            registry.register(f"suite.{name}", value, "suite")

    combined_name = ", ".join(suite_names)
    variables["suite"] = SuiteObject(suite_data, suite_name=combined_name)

    for name, value in suite_data.items():
        variables[f"suite.{name}"] = value


def _resolve_regression_list(test_id: str, regression_id: str | None) -> list[dict[str, Any]]:
    """Return the regressions whose variables should be merged.

    Scoped returns a single regression (or nothing when missing);
    workbench editing returns every regression that references any suite
    containing the test.
    """
    from wavecore.api.services.regressions._storage import (
        _list_all_regressions,
        _load_regression,
    )
    from wavecore.api.services.relations import service as relation_service

    if regression_id is not None:
        reg = _load_regression(regression_id)
        return [reg] if reg is not None else []

    suites = relation_service.get_suites_for_test(test_id)
    if not suites:
        return []
    suite_ids = {s["id"] for s in suites}
    return [reg for reg in _list_all_regressions() if set(reg.get("suites", [])) & suite_ids]


def _merge_regression_vars(
    regressions: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    merged: dict[str, Any] = {}
    names: list[str] = []
    for reg in regressions:
        names.append(reg.get("name", ""))
        reg_vars = reg.get("variables", {})
        if not isinstance(reg_vars, dict):
            continue
        merged.update(reg_vars)
    return merged, names


def _inject_regression_variables(
    variables: dict[str, Any],
    test_id: str,
    regression_id: str | None = None,
    registry: Any = None,
) -> None:
    """Inject RegressionObject from regressions containing this test's suites.

    ``regression_id`` (when set) narrows the resolution to that single
    regression - a sequential regression execution passes the parent's
    id so tests read variables from the regression they're running IN,
    not a merge across every regression that happens to reference any
    containing suite.
    Secret-flagged entries inject RAW and register with the run registry.
    """
    from wavecore.core.regression_object import RegressionObject

    regressions = _resolve_regression_list(test_id, regression_id)
    if not regressions:
        return

    merged, regression_names = _merge_regression_vars(regressions)
    if not merged:
        return

    regression_data: dict[str, object] = {}
    for name, var_info in merged.items():
        value = _namespace_value(var_info)
        regression_data[name] = value
        if registry is not None and isinstance(var_info, dict) and var_info.get("secret"):
            registry.register(f"regression.{name}", value, "regression")

    combined_name = ", ".join(regression_names)
    variables["regression"] = RegressionObject(regression_data, regression_name=combined_name)

    for name, value in regression_data.items():
        variables[f"regression.{name}"] = value


def _surface_synthetic_outputs(
    plugin_type: str, result: Any, resolved_params: dict[str, Any]
) -> Any:
    """Surface a plugin's synthetic outputs for binding: the Log writes its side
    effect and returns None, so its rendered ``line`` is exposed here for output
    binding (the standalone executor gathers it the same way)."""
    from wavecore.core.functions.executor import _gather_log_outputs

    return _gather_log_outputs(plugin_type, resolved_params) or result


def _secret_output_names_from_metadata(plugin_metadata: Mapping[str, Any]) -> set[str]:
    """Names of secret-declared output fields in a plugin's output schema."""
    names: set[str] = set()
    for field in plugin_metadata.get("output_schema") or []:
        if hasattr(field, "name"):
            if getattr(field, "secret", False):
                names.add(field.name)
        elif isinstance(field, dict) and field.get("secret"):
            names.add(field["name"])
    return names


def _format_io_value(value: Any) -> Any:
    """Truncate a long string value for the harness I/O display; other types pass through."""
    if isinstance(value, str) and len(value) > _IO_VALUE_LIMIT:
        return value[:_IO_VALUE_LIMIT] + f"... ({len(value)} chars total)"
    return value


def _io_text(value: Any) -> str:
    """An I/O line's value in the print form; a table shows its summary, never its rows."""
    return value_text(_summarized_tables(value))


def _summarized_tables(value: Any) -> Any:
    if isinstance(value, Table):
        return repr(value)
    if isinstance(value, dict):
        return {key: _summarized_tables(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_summarized_tables(item) for item in value]
    return value


def _io_display_dict(
    payload: dict[str, Any],
    secret_keys: set[str],
    catalog: set[str],
    reveal_all: bool,
    scan_values: tuple[str, ...] = (),
    reveal_keys: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Build the masked, truncated display map for an Inputs/Outputs line.

    Registered secret VALUES are scrubbed from each field BEFORE truncation, so a
    value the name/catalog mask misses - including one whose special chars a dict
    repr would escape, or one long enough to be truncated - cannot survive. A key
    in ``reveal_keys`` is shown raw by the name mask (a per-field reveal); the
    value-scrub skips it so it never overrides that intentional reveal."""
    if reveal_all:
        return {key: _format_io_value(value) for key, value in payload.items()}
    masked = mask_io_payload(payload, secret_keys, catalog)
    return {
        key: _format_io_value(value if key in reveal_keys else _scrubbed(value, scan_values))
        for key, value in masked.items()
    }


def _scrubbed(value: Any, scan_values: tuple[str, ...]) -> Any:
    """Registered secret values and every URL password masked (REQ-3.1.3.5)."""
    return mask_url_passwords_in(mask_values(value, scan_values))


def _mask_catalog_for(
    plugin_metadata: Mapping[str, Any], unmasked_secret_fields: list[str] | None
) -> set[str]:
    """The plugin's credential-field catalog minus the block's per-field reveal set."""
    catalog = {name.lower() for name in plugin_metadata.get("secret_mask_fields") or []}
    reveal = {name.lower() for name in (unmasked_secret_fields or [])}
    return catalog - reveal


def _log_masked_inputs(
    session_logger: SessionLogger,
    resolved_parameters: dict[str, Any],
    plugin_metadata: Mapping[str, Any],
    catalog_for_mask: set[str],
    reveal_secrets: bool,
    unmasked_secret_fields: list[str] | None = None,
    registry: Any = None,
    block_id: str | None = None,
) -> None:
    """Emit the masked ``Inputs:`` line before execute (skipped when params empty).

    The per-field reveal set un-masks a declared SCALAR secret param by name
    (case-insensitive) - the scalar counterpart of the sub-key catalog reveal."""
    if not resolved_parameters:
        return
    reveal_keys = _revealed_secret_params(plugin_metadata, unmasked_secret_fields)
    secret_keys = secret_param_names(plugin_metadata) - reveal_keys
    scan_values = registry.scan_values(exclude_for_block=block_id) if registry is not None else ()
    display = _io_display_dict(
        resolved_parameters,
        secret_keys,
        catalog_for_mask,
        reveal_secrets,
        scan_values,
        reveal_keys,
    )
    session_logger.debug(f"Inputs: {_io_text(display)}")


def _revealed_secret_params(
    plugin_metadata: Mapping[str, Any], unmasked_secret_fields: list[str] | None
) -> frozenset[str]:
    """Declared secret params the block reveals by name (the per-field reveal)."""
    reveal = {name.lower() for name in (unmasked_secret_fields or [])}
    return frozenset(name for name in secret_param_names(plugin_metadata) if name.lower() in reveal)


def _register_revealed_param_exemptions(
    resolved_parameters: dict[str, Any],
    plugin_metadata: Mapping[str, Any],
    unmasked_secret_fields: list[str] | None,
    registry: Any,
    block_id: str | None,
) -> None:
    """Exempt a revealed declared param's value in this block's own lines only;
    every other surface still scrubs it (the per-field reveal contract)."""
    if registry is None or block_id is None:
        return
    reveal = {name.lower() for name in (unmasked_secret_fields or [])}
    for name in secret_param_names(plugin_metadata):
        if name.lower() in reveal and name in resolved_parameters:
            registry.register_value(
                resolved_parameters[name], f"param:{name}", exempt_block=block_id
            )


def _effective_secret_output_names(
    plugin_metadata: Mapping[str, Any], output_secret_fields: list[str] | None
) -> set[str]:
    """The stored outputs-table choice is the authority: an absent stored list
    falls back to the schema-declared seed; a present list is the complete truth."""
    if output_secret_fields is None:
        return _secret_output_names_from_metadata(plugin_metadata)
    return set(output_secret_fields)


def _register_secret_output_values(
    surfaced: Any,
    plugin_metadata: Mapping[str, Any],
    output_secret_fields: list[str] | None,
    registry: Any,
) -> None:
    """Register the byte-forms of the effective secret output values so
    every persisted surface can scrub them (the display already masks them)."""
    if registry is None or not isinstance(surfaced, dict):
        return
    for name in _effective_secret_output_names(plugin_metadata, output_secret_fields):
        if name in surfaced:
            registry.register_value(surfaced[name], f"output:{name}")


def _log_masked_outputs(
    session_logger: SessionLogger,
    surfaced: Any,
    plugin_metadata: Mapping[str, Any],
    output_secret_fields: list[str] | None,
    catalog_for_mask: set[str],
    reveal_secrets: bool,
    registry: Any = None,
    block_id: str | None = None,
) -> None:
    """Emit the masked ``Outputs:`` (dict) / ``Output:`` (scalar) line after execute."""
    scan_values = registry.scan_values(exclude_for_block=block_id) if registry is not None else ()
    if isinstance(surfaced, dict):
        secret_output_names = _effective_secret_output_names(plugin_metadata, output_secret_fields)
        # Dunder keys are engine signals, not outputs, so they never show as one.
        outputs = {key: value for key, value in surfaced.items() if not key.startswith("__")}
        display = _io_display_dict(
            outputs, secret_output_names, catalog_for_mask, reveal_secrets, scan_values
        )
        session_logger.debug(f"Outputs: {_io_text(display)}")
    elif surfaced is not None:
        value = surfaced if reveal_secrets else _scrubbed(surfaced, scan_values)
        session_logger.debug(f"Output: {_io_text(_format_io_value(value))}")


def _echoed(name: str, value: Any, revealed: Container[str]) -> Any:
    """A template line's value: its URL passwords masked unless the field is revealed."""
    return value if name in revealed else mask_url_passwords_in(value)


def _log_template_sources(
    session_logger: Any,
    parameters: dict[str, Any],
    tpl_fields: set[str],
    revealed: Container[str],
) -> None:
    """Emit the ``Template 'name': ...`` source line for each template field."""
    for tpl_name in tpl_fields:
        tpl_value = parameters.get(tpl_name)
        if isinstance(tpl_value, str) and tpl_value:
            shown = _echoed(tpl_name, tpl_value, revealed)
            session_logger.debug(f"Template '{tpl_name}': {shown}")


def _log_rendered_templates(
    session_logger: Any,
    parameters: dict[str, Any],
    resolved: dict[str, Any],
    tpl_fields: set[str],
    revealed: Container[str],
) -> None:
    """Emit the ``Rendered 'name': ...`` line for each template that changed."""
    for tpl_name in tpl_fields:
        raw_value = parameters.get(tpl_name)
        resolved_value = resolved.get(tpl_name)
        if isinstance(raw_value, str) and raw_value != resolved_value:
            shown = _echoed(tpl_name, resolved_value, revealed)
            session_logger.debug(f"Rendered '{tpl_name}': {shown}")


def _build_plugin_context(
    resolved_parameters: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    block_id: str | None,
    plugin_type: str,
    registry: Any,
    reveal_secrets: bool,
    unmasked_secret_fields: list[str] | None,
    output_bindings: dict[str, str] | None,
    effective_secret_outputs: list[str],
    stop_outputs: dict[str, Any] | None,
) -> dict[str, Any]:
    """Assemble the plugin execution context, including the secret-register hook.

    A revealed field registers its value with an exempt-block marker so the
    reveal exempts only this block's own display lines, never any other block.
    """

    def _register_secret(value: Any, revealed: bool = False) -> None:
        if registry is not None:
            registry.register_value(
                value,
                f"plugin:{plugin_type}",
                exempt_block=block_id if revealed else None,
            )

    session = _get_session(session_id) or {}
    bindings = output_bindings or {}
    context: dict[str, Any] = {
        "parameters": resolved_parameters,
        "variables": variables,
        "register_secret": _register_secret,
        "unmask_secrets": reveal_secrets,
        "unmasked_secret_fields": unmasked_secret_fields or [],
        "output_secret_fields": effective_secret_outputs,
        "ssh_session_registry": session.get("ssh_session_registry"),
        "output_bindings": bindings,
        "output_types": {
            name: declared
            for name, target in bindings.items()
            if (declared := declared_type(target)) is not None
        },
        "testdata_dirs": list(session.get("testdata_dirs") or []),
    }
    artifacts_dir = session.get("artifacts_dir")
    if artifacts_dir is not None:
        context["artifacts_dir"] = artifacts_dir
    context.update(variables)
    # After the variables, so a variable of the same name never stands in for the holder.
    context["stop_outputs"] = stop_outputs
    return context


async def _execute_plugin_with_session(
    plugin: Any,
    plugin_type: str,
    parameters: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    block_id: str | None,
    block_label: str | None,
    expression_fields: set[str] | None,
    template_fields: set[str] | None,
    reveal_secrets: bool = False,
    unmasked_secret_fields: list[str] | None = None,
    output_secret_fields: list[str] | None = None,
    output_bindings: dict[str, str] | None = None,
    stop_outputs: dict[str, Any] | None = None,
) -> Any:
    """Execute a plugin with session logging, parameter resolution, and masked I/O lines."""
    from wavecore.core.execution.plugin_executor import build_parameter_sources
    from wavecore.models.enums import LogLevel

    plugin_metadata = plugin.metadata
    session_logger = SessionLogger(
        session_id=session_id,
        source=block_source(plugin_type, plugin_metadata, block_label),
        threshold=LogLevel.DEBUG,
        block_id=block_id,
        unmask=reveal_secrets,
    )

    _tpl_fields = template_fields or set()

    # Under the block's run-output reveal every field is shown raw.
    revealed = (
        set(parameters)
        if reveal_secrets
        else _revealed_secret_params(plugin_metadata, unmasked_secret_fields)
    )
    _log_template_sources(session_logger, parameters, _tpl_fields, revealed)

    registry = _get_session_registry(session_id)

    resolved_parameters = resolve_block_fields(
        parameters,
        plugin_metadata.get("parameters") or [],
        expression_fields=expression_fields or set(),
        template_fields=_tpl_fields,
        element_types={},
        variables=variables,
        session_id=session_id,
        exact_numbers=False,
        unmasked_secret_fields=unmasked_secret_fields or (),
    )

    _log_rendered_templates(session_logger, parameters, resolved_parameters, _tpl_fields, revealed)

    context = _build_plugin_context(
        resolved_parameters,
        variables,
        session_id,
        block_id,
        plugin_type,
        registry,
        reveal_secrets,
        unmasked_secret_fields,
        output_bindings,
        sorted(_effective_secret_output_names(plugin_metadata, output_secret_fields)),
        stop_outputs,
    )
    context["logger"] = session_logger
    map_param_names = {
        p["name"]
        for p in plugin_metadata.get("parameters", [])
        if isinstance(p, dict) and p.get("type") == "map"
    }
    context["parameter_sources"] = build_parameter_sources(
        parameters, expression_fields or set(), variables, map_param_names
    )

    _register_revealed_param_exemptions(
        resolved_parameters, plugin_metadata, unmasked_secret_fields, registry, block_id
    )

    catalog_for_mask = _mask_catalog_for(plugin_metadata, unmasked_secret_fields)
    _log_masked_inputs(
        session_logger,
        resolved_parameters,
        plugin_metadata,
        catalog_for_mask,
        reveal_secrets,
        unmasked_secret_fields,
        registry=registry,
        block_id=block_id,
    )

    try:
        await plugin.validate(resolved_parameters)
        await plugin.initialize(context)
        result = await plugin.execute(context)
    finally:
        await plugin.cleanup()

    surfaced = _surface_synthetic_outputs(plugin_type, result, resolved_parameters)
    # Register secret output VALUES before logging the Outputs line, so the
    # persisted (always-masked) disk copy scrubs them even when the reveal-aware
    # live display shows them raw.
    _register_secret_output_values(surfaced, plugin_metadata, output_secret_fields, registry)
    _log_masked_outputs(
        session_logger,
        surfaced,
        plugin_metadata,
        output_secret_fields,
        catalog_for_mask,
        reveal_secrets,
        registry=registry,
        block_id=block_id,
    )
    return surfaced


async def _execute_plugin_fallback(
    plugin: Any,
    parameters: dict[str, Any],
    variables: dict[str, Any],
) -> Any:
    """Fallback plugin execution without session logging."""
    from wavecore.core.execution.plugin_executor import execute_plugin

    result = await execute_plugin(plugin, parameters, variables=variables)
    if result["status"] == "error":
        raise RuntimeError(result.get("error", "Plugin execution failed"))
    return result.get("return_value")


async def _execute_plugin(
    plugin_type: str,
    version: str,
    parameters: dict[str, Any],
    variables: dict[str, Any],
    session_id: str | None = None,
    block_id: str | None = None,
    block_label: str | None = None,
    expression_fields: set[str] | None = None,
    template_fields: set[str] | None = None,
    reveal_secrets: bool = False,
    unmasked_secret_fields: list[str] | None = None,
    output_secret_fields: list[str] | None = None,
    output_bindings: dict[str, str] | None = None,
    stop_outputs: dict[str, Any] | None = None,
) -> Any:
    """Execute a plugin (e.g., Log); a stop leaves its outputs so far in ``stop_outputs``."""
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(plugin_type, version)
    if not plugin:
        raise NotFoundException(f"Plugin {plugin_type} version {version} not found")

    if session_id:
        return await _execute_plugin_with_session(
            plugin,
            plugin_type,
            parameters,
            variables,
            session_id,
            block_id,
            block_label,
            expression_fields,
            template_fields,
            reveal_secrets=reveal_secrets,
            unmasked_secret_fields=unmasked_secret_fields,
            output_secret_fields=output_secret_fields,
            output_bindings=output_bindings,
            stop_outputs=stop_outputs,
        )
    return await _execute_plugin_fallback(plugin, parameters, variables)


def _schema_secret_output_names(node_fields: Mapping[str, Any]) -> set[str]:
    """The secret outputs the Block's schema declares: the seed for an absent stored list."""
    data = {
        **(node_fields.get("node_data") or {}),
        "elementType": node_fields["element_type"],
        "version": node_fields["version"],
    }
    outputs = block_schema(data).outputs
    return {
        str(get_param_attr(output, "name"))
        for output in outputs
        if get_param_attr(output, "secret", False)
    }


def _register_secret_outputs(node_fields: dict[str, Any], result: Any, session_id: str) -> None:
    """Register the effective secret plugin outputs: bound outputs flag the
    receiving variable AND scrub the value, marked-but-unbound scrub value only."""
    if not isinstance(result, dict):
        return
    registry = _get_session_registry(session_id)
    if registry is None:
        return
    bindings: dict[str, str] = node_fields.get("output_bindings") or {}
    marked: list[str] | None = node_fields.get("output_secret_fields")
    effective = _schema_secret_output_names(node_fields) if marked is None else set(marked)
    source = f"output:{node_fields['element_type']}"
    for output_name in effective:
        if output_name not in result:
            continue
        var_name = bindings.get(output_name)
        if var_name:
            registry.register(var_name, result[output_name], source)
        else:
            registry.register_value(result[output_name], source)
