"""Recipe emission: nodes, edges, variables, step map, and layout.

The compiler owns ALL wiring and geometry: consecutive steps chain in
order, construct children anchor on their declared handles, completion
rejoins the parent flow, and positions come from the layout engine.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, NamedTuple

from wavecore.controls.assertion_evaluator import UNARY_OPERATORS
from wavecore.core.layout.dimensions import fit_node_width
from wavecore.core.layout.engine import ingress_counts, layout_workflow
from wavecore.core.number_rule import is_integer_value, wire_number
from wavecore.core.recipes.model import STEP_KEYWORDS, RecipeDoc, child_sections, finding
from wavecore.core.recipes.parser import parse_recipe
from wavecore.core.recipes.typed_elements import stored_elements
from wavecore.core.recipes.validator import (
    BlockEntry,
    FunctionContract,
    function_block_entry,
    is_choice_field,
    is_expr_value,
    is_template_value,
    load_block_catalog,
    remote_execution_entry,
    resolve_function_contract,
    validate_recipe_doc,
    written_word,
)
from wavecore.core.variables.decimal_value import decimal_to_str
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.sql_client import tls_on

_SUGAR_CONTROL_IDS = {
    "set": "variable-setter",
    "delay": "delay",
    "halt": "halt",
    "note": "note",
    "break": "break",
    "continue": "continue",
}

_TERMINATING_KEYWORDS = {"halt", "break", "continue"}

_PY_TO_VALUE_TYPE: list[tuple[type, str]] = [
    (bool, "boolean"),
    (int, "integer"),
    (float, "float"),
    (Decimal, "float"),
    (str, "string"),
    (list, "array"),
    (dict, "map"),
]

_Pending = list[tuple[str, str | None]]


def _infer_value_type(value: Any) -> str:
    return next(
        (
            value_type
            for python_type, value_type in _PY_TO_VALUE_TYPE
            if isinstance(value, python_type)
        ),
        "string",
    )


def _stored_numbers(value: Any) -> Any:
    """Every number a recipe wrote, at any depth, in its stored form (REQ-3.1.3.14); a map
    key written as a decimal number is its text."""
    if isinstance(value, Decimal) or is_integer_value(value):
        return wire_number(value)
    if isinstance(value, list):
        return [_stored_numbers(item) for item in value]
    if isinstance(value, dict):
        return {
            decimal_to_str(key) if isinstance(key, Decimal) else key: _stored_numbers(item)
            for key, item in value.items()
        }
    return value


def _split_map_entries(prefix: str, raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Stores each {expr} entry as bare text, tracked as '<prefix>.<key>'."""
    values: dict[str, Any] = {}
    fields: list[str] = []
    for key, entry in raw.items():
        if is_expr_value(entry):
            values[key] = entry["expr"]
            fields.append(f"{prefix}.{key}")
        else:
            values[key] = entry
    return values, fields


def _split_row_fields(name: str, raw: list[Any]) -> tuple[list[Any], list[str]]:
    """Each row is a map addressed as '<name>.<i>', so a field becomes '<name>.<i>.<field>'."""
    rows: list[Any] = []
    fields: list[str] = []
    for index, row in enumerate(raw):
        if isinstance(row, dict):
            row, nested = _split_map_entries(f"{name}.{index}", row)
            fields.extend(nested)
        rows.append(row)
    return rows, fields


def _typed_map_entries(
    raw: dict[str, Any], split: dict[str, Any], declared: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A typed map setting's literal entries in their stored form; {expr} entries stay source."""
    literal = {key: item for key, item in raw.items() if not is_expr_value(item)}
    stored, types = stored_elements(literal, declared)
    return {key: stored.get(key, split[key]) for key in split}, types


def _typed_list_items(name: str, raw: list[Any], declared: Any) -> tuple[list[Any], list[str], Any]:
    """A typed list's items in their stored form; an {expr} item is stored as '<name>.<i>'."""
    items: list[Any] = []
    fields: list[str] = []
    for index, item in enumerate(raw):
        if is_expr_value(item):
            items.append(item["expr"])
            fields.append(f"{name}.{index}")
        else:
            items.append(item)
    stored, types = stored_elements(items, declared)
    return stored, fields, types


def _compare_to_value(operator: Any, value: Any) -> Any:
    """An operator that takes no compare-to value stores none (REQ-3.1.3.25)."""
    return None if str(operator) in UNARY_OPERATORS else value


def _stored_condition_item(item: Any) -> Any:
    """One stored condition item, a group's rows included, under the compare-to rule."""
    if not isinstance(item, dict):
        return item
    if item.get("type") == "group":
        return {
            **item,
            "items": [_stored_condition_item(child) for child in item.get("items") or []],
        }
    if item.get("type") != "literal":
        return item
    return {
        **item,
        "reference_value": _compare_to_value(item.get("operator"), item.get("reference_value")),
    }


def _stored_filters(filters: Any) -> Any:
    """CSV / Excel filter blocks whose condition rows follow the check-row compare-to rule."""
    if not isinstance(filters, list):
        return filters
    return [
        (
            {**block, "conditions": [_stored_condition_item(item) for item in block["conditions"]]}
            if isinstance(block, dict) and isinstance(block.get("conditions"), list)
            else block
        )
        for block in filters
    ]


class _SplitSetting(NamedTuple):
    value: Any
    expression_fields: list[str]
    template: bool = False
    element_types: Any = None


def _split_settings(
    settings: dict[str, Any],
    parameters: Mapping[str, Mapping[str, Any]] | None = None,
    declared_element_types: Mapping[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str], list[str], dict[str, Any]]:
    """Step settings as stored values, expression fields, template fields and element types."""
    values: dict[str, Any] = {}
    expression_fields: list[str] = []
    template_fields: list[str] = []
    element_types: dict[str, Any] = {}
    declared = declared_element_types or {}
    for name, raw in settings.items():
        param = parameters.get(name, {}) if parameters else {}
        split = _split_setting(name, raw, param, declared.get(name))
        values[name] = split.value
        expression_fields.extend(split.expression_fields)
        if split.template:
            template_fields.append(name)
        if split.element_types is not None:
            element_types[name] = split.element_types
    return values, expression_fields, template_fields, element_types


@dataclass
class _BlockFields:
    """A Block step's settings in their stored form."""

    settings: dict[str, Any]
    values: dict[str, Any]
    expression_fields: list[str]
    template_fields: list[str]
    element_types: dict[str, Any]

    @classmethod
    def of(cls, step: Mapping[str, Any], entry: BlockEntry) -> "_BlockFields":
        raw = step.get("settings")
        settings: dict[str, Any] = raw if isinstance(raw, dict) else {}
        return cls(
            settings, *_split_settings(settings, entry.parameters, step.get("element_types"))
        )


def _split_setting(name: str, raw: Any, param: Mapping[str, Any], declared: Any) -> _SplitSetting:
    """One block setting in its stored form, its expression fields, template flag, element types."""
    param_type = param.get("type")
    if is_expr_value(raw):
        return _SplitSetting(raw["expr"], [name])
    if param_type == "map" and isinstance(raw, dict):
        split, nested = _split_map_entries(name, raw)
        if not param.get("typed_values"):
            return _SplitSetting(split, nested)
        stored, types = _typed_map_entries(raw, split, declared)
        return _SplitSetting(stored, nested, element_types=types)
    if param_type == "array" and isinstance(raw, list):
        if param.get("typed_values"):
            items, item_fields, types = _typed_list_items(name, raw, declared)
            return _SplitSetting(items, item_fields, element_types=types)
        rows, nested_rows = _split_row_fields(name, raw)
        return _SplitSetting(rows, nested_rows)
    return _SplitSetting(written_word(param, raw), [], template=is_template_value(raw))


_RECIPE_KIND_KEYS = {"expr": "isExpression", "template": "isTemplate"}
_RECIPE_FORM_KEYS = frozenset({"value", "default", "element_types", *_RECIPE_KIND_KEYS})


def _declared_variable(
    declaration: Mapping[str, Any], *, value_key: str = "value"
) -> dict[str, Any]:
    """A recipe variable in its stored form; a Function input or output holds it in `default`."""
    entry = {key: item for key, item in declaration.items() if key not in _RECIPE_FORM_KEYS}
    kind = next((key for key in _RECIPE_KIND_KEYS if key in declaration), None)
    if kind is not None:
        # An expression or template keeps its source where a literal value sits.
        entry[_RECIPE_KIND_KEYS[kind]] = True
        entry[value_key] = declaration[kind]
    elif value_key in declaration:
        value = declaration[value_key]
        entry[value_key] = value
        if declaration.get("type") in ("array", "map") and isinstance(value, list | dict):
            entry[value_key], entry["elementTypes"] = stored_elements(
                value, declaration.get("element_types")
            )
    # A type alone holds null; a declare-empty secret is flagged NO_VALUE at save.
    return entry


def _parameter_declarations(items: Any) -> list[dict[str, Any]]:
    return [_declared_variable(item, value_key="default") for item in items or []]


def creation_values(
    parameters: Mapping[str, Mapping[str, Any]],
    placement: Mapping[str, Any],
    *,
    values: Mapping[str, Any],
) -> dict[str, Any]:
    """A new Block's values: each choice-list and true / false default, the placement stamp
    on top, and every value the step sets winning over both (FIELD-8)."""
    created: dict[str, Any] = {
        name: param["default"]
        for name, param in parameters.items()
        if is_choice_field(param) and param.get("default") is not None
    }
    created.update(placement)
    result = dict(values)
    for name, value in created.items():
        result.setdefault(name, value)
    result.update(_dialect_tls(parameters, result))
    return result


def _dialect_tls(
    parameters: Mapping[str, Mapping[str, Any]], values: Mapping[str, Any]
) -> dict[str, Any]:
    """SQL `tls` has no fixed default: a new Block holds its database type's own."""
    database_types = (parameters.get("database_type") or {}).get("enum_values") or ()
    database_type = values.get("database_type")
    if "tls" not in parameters or "tls" in values or database_type not in database_types:
        return {}
    return {"tls": tls_on({}, str(database_type))}


def _function_creation_parameters(
    contract: FunctionContract, entry: BlockEntry
) -> dict[str, dict[str, Any]]:
    """Each input holding its declared default, which a Required choice starts on too."""
    declared = {str(item.get("name")): item for item in contract.inputs}
    return {
        name: {**field, "default": declared[name].get("default")}
        for name, field in entry.parameters.items()
    }


def _marked_secret_outputs(outputs: list[dict[str, Any]], given: Any) -> list[str]:
    """A step's Secret outputs in declaration order; unlisted, every output declared secret."""
    if isinstance(given, list):
        marked = {str(name) for name in given}
    else:
        marked = {str(item.get("name") or "") for item in outputs if item.get("secret")}
    names = [str(item.get("name") or "") for item in outputs]
    return [name for name in names if name in marked]


def _block_output_rows(entry: BlockEntry, settings: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A block's outputs in table order: its schema outputs, then those its settings declare."""
    rows: list[dict[str, Any]] = [
        {"name": name, "secret": name in entry.secret_outputs} for name in entry.outputs
    ]
    for param in entry.output_name_params:
        declared = settings.get(param)
        if isinstance(declared, list):
            rows.extend({"name": name} for name in declared if isinstance(name, str))
    return rows


class _SecretMarks(NamedTuple):
    """The outputs a step marks Secret, and the step that marks them."""

    names: list[str]
    step_path: str


def _made_secret_finding(step_path: str, output: str, variable: str) -> dict[str, Any]:
    """A marked capture promotes a declared plain variable, as a block Save does (SECUI-12)."""
    return finding(
        f"{step_path}.capture.{output}",
        "VARIABLE_MADE_SECRET",
        f"Secret output '{output}' makes the plain variable '{variable}' a secret. "
        "Its value is masked from then on. Making it plain again clears its value",
        f"Declare '{variable}' with secret: true, or give secret_outputs without '{output}' "
        "to keep it plain",
        severity="warning",
    )


@dataclass
class _Workflow:
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _Scope:
    """One flow scope: its workflow collector, capture auto-declaration sink and name types."""

    workflow: _Workflow
    # Declares a capture target; True when a marked capture promotes a declared plain variable.
    declare_capture: Callable[[str, str, bool], bool]
    variable_type: Callable[[str], str | None]
    loop_stack: list[tuple[str, str | None]] = field(default_factory=list)


class _FunctionLocals:
    """A Function flow's locals: the ones it declares and the ones its captures declare."""

    def __init__(
        self, entries: list[dict[str, Any]], contract_names: set[str], name_types: dict[str, str]
    ) -> None:
        self._entries = entries
        self._declared = {entry["name"]: entry for entry in entries}
        self._captured: dict[str, dict[str, Any]] = {}
        self._contract_names = contract_names
        self._name_types = name_types

    def declare_capture(self, variable_name: str, output_type: str, secret: bool = False) -> bool:
        # Captures into declared inputs/outputs bind the contract, not a local var.
        if variable_name in self._contract_names:
            return False
        declared = self._declared.get(variable_name)
        if declared is not None:
            if not secret or declared.get("secret"):
                return False
            declared["secret"] = True
            return True
        entry = self._captured.get(variable_name)
        if entry is None:
            entry = {"id": f"var-{variable_name}", "name": variable_name, "type": output_type}
            self._captured[variable_name] = entry
            self._entries.append(entry)
            self._name_types[variable_name] = output_type
        if secret:
            entry["secret"] = True
        return False


class _Emitter:
    def __init__(
        self,
        doc: RecipeDoc,
        placement_defaults: Mapping[str, Mapping[str, Any]] | None = None,
    ) -> None:
        self.doc = doc
        self.placement_defaults = placement_defaults or {}
        self.catalog = load_block_catalog()
        self.remote_entry = remote_execution_entry()
        self.local_functions = {str(fn.get("name") or ""): fn for fn in doc.functions}
        self.step_map: dict[str, str] = {}
        self.counter = 0
        self.condition_counter = 0
        self.variables: dict[str, dict[str, Any]] = {}
        self.findings: list[dict[str, Any]] = []
        self.promoted: set[str] = set()
        self._profiles_by_name: dict[str, dict[str, Any]] | None = None
        self._pending_key: str | None = None
        # Implicit if fall-through handles; pruned when nothing attaches to them.
        self._implicit_else: list[tuple[str, str]] = []

    # ------------------------------------------------------------------
    # Small helpers
    # ------------------------------------------------------------------

    def _next_node_id(self) -> str:
        self.counter += 1
        return f"node-{self.counter}"

    def _next_condition_id(self) -> str:
        self.condition_counter += 1
        return f"cond-{self.condition_counter}"

    def _profile(self, name: str) -> dict[str, Any]:
        if self._profiles_by_name is None:
            from wavecore.api.services.profiles import service as profile_service

            rows = profile_service.list_profiles(per_page=10_000)["profiles"]
            self._profiles_by_name = {str(row.get("name") or ""): row for row in rows}
        return self._profiles_by_name[name]

    def _condition_item(self, condition: Any, scope: _Scope) -> dict[str, Any]:
        if isinstance(condition, str):
            return {
                "id": self._next_condition_id(),
                "type": "expression",
                "expression": condition,
            }
        operator = condition.get("operator")
        variable = condition.get("variable")
        value = _compare_to_value(operator, condition.get("value"))
        # A valueless check (is_null, is_empty) takes the checked name's declared type.
        value_type = condition.get("value_type") or (
            _infer_value_type(value) if value is not None else scope.variable_type(str(variable))
        )
        item: dict[str, Any] = {
            "id": self._next_condition_id(),
            "type": "literal",
            "variable": variable,
            "operator": operator,
        }
        if value_type:
            item["value_type"] = value_type
        item["reference_value"] = value
        return item

    def _condition_items(self, conditions: list[Any], scope: _Scope) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for condition in conditions:
            if items:
                items.append({"type": "operator", "value": "and"})
            items.append(self._condition_item(condition, scope))
        return items

    def _declare_top_capture(self, name: str, output_type: str, secret: bool = False) -> bool:
        if name in self.doc.variables:
            if not secret or self.doc.variables[name].get("secret") or name in self.promoted:
                return False
            self.promoted.add(name)
            return True
        # A capture target holds null until its block writes it (REQ-3.1.3.20).
        declared = self.variables.setdefault(name, {"type": output_type})
        if secret:
            declared["secret"] = True
        return False

    def _variable_type(self, name: str) -> str | None:
        declaration = self.doc.variables.get(name) or self.variables.get(name)
        if isinstance(declaration, dict) and isinstance(declaration.get("type"), str):
            return str(declaration["type"])
        return None

    # ------------------------------------------------------------------
    # Node/edge fabric
    # ------------------------------------------------------------------

    def _attach(self, node_id: str, pending: _Pending, workflow: _Workflow) -> None:
        for index, (source, handle) in enumerate(pending):
            edge: dict[str, Any] = {
                "id": f"edge-{source}-{node_id}",
                "source": source,
                "target": node_id,
            }
            if handle is not None:
                edge["sourceHandle"] = handle
            if index:
                edge["targetHandle"] = f"ingress_{index}"
            workflow.edges.append(edge)

    def _emit_node(
        self,
        scope: _Scope,
        pending: _Pending,
        step_path: str,
        *,
        element_type: str,
        node_type: str,
        version: str,
        label: str,
        values: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None,
        output_bindings: dict[str, Any] | None = None,
        profile_bindings: list[dict[str, Any]] | None = None,
        data_extras: dict[str, Any] | None = None,
    ) -> str:
        node_id = self._next_node_id()
        recipe_key = self._pending_key or step_path
        self._pending_key = None
        data: dict[str, Any] = {
            "label": label,
            "recipeKey": recipe_key,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": (
                config
                if config is not None
                else {
                    "values": values or {},
                    "outputBindings": output_bindings or {},
                    "profileBindings": profile_bindings or [],
                }
            ),
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        }
        if data_extras:
            data.update(data_extras)
        node = {
            "id": node_id,
            "type": "noteNode" if element_type == "note" else "workflowNode",
            "data": data,
        }
        scope.workflow.nodes.append(node)
        self.step_map[node_id] = step_path
        self._attach(node_id, pending, scope.workflow)
        return node_id

    # ------------------------------------------------------------------
    # Flows
    # ------------------------------------------------------------------

    def emit_flow(
        self, steps: list[Any], path_prefix: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        for index, step in enumerate(steps):
            step_path = f"{path_prefix}[{index}]"
            keyword = next(key for key in step if key in _KEYWORDS)
            pending = self._emit_step(keyword, step, step_path, pending, scope)
        return pending

    def _emit_step(
        self,
        keyword: str,
        step: dict[str, Any],
        step_path: str,
        pending: _Pending,
        scope: _Scope,
    ) -> _Pending:
        value = step[keyword]
        # Carry an explicit `key:` sibling to this step's own node (stable identity).
        self._pending_key = step.get("key") if isinstance(step, dict) else None
        if keyword == "block":
            return self._emit_block(step, step_path, pending, scope)
        if keyword == "function":
            return self._emit_function_block(step, step_path, pending, scope)
        if keyword == "if":
            return self._emit_if(value, step_path, pending, scope)
        if keyword == "switch":
            return self._emit_switch(value, step_path, pending, scope)
        if keyword in ("for", "for_each", "while"):
            return self._emit_loop(keyword, value, step_path, pending, scope)
        if keyword == "wait_until":
            return self._emit_wait_until(value, step_path, pending, scope)
        if keyword == "try":
            return self._emit_try(value, step_path, pending, scope)
        if keyword == "parallel":
            return self._emit_parallel(value, step_path, pending, scope)
        if keyword == "assert":
            return self._emit_assert(value, step_path, pending, scope)
        if keyword == "remote":
            return self._emit_remote(value, step_path, pending, scope)
        return self._emit_sugar(keyword, step, value, step_path, pending, scope)

    # ------------------------------------------------------------------
    # Leaf steps
    # ------------------------------------------------------------------

    def _profile_bindings(self, bindings: Any) -> list[dict[str, Any]]:
        resolved: list[dict[str, Any]] = []
        if not isinstance(bindings, list):
            return resolved
        for binding in bindings:
            profile = self._profile(str(binding.get("profile") or ""))
            entry: dict[str, Any] = {
                "profileId": profile["id"],
                "profileName": profile["name"],
                "profileType": profile["type"],
            }
            if binding.get("alias") is not None:
                entry["alias"] = binding["alias"]
            if binding.get("fields") is not None:
                entry["fields"] = list(binding["fields"])
            resolved.append(entry)
        return resolved

    def _capture_bindings(
        self,
        capture: Any,
        outputs: dict[str, str],
        scope: _Scope,
        marks: _SecretMarks | None = None,
    ) -> dict[str, Any]:
        if not isinstance(capture, dict):
            return {}
        marked = set(marks.names) if marks is not None else set()
        bindings: dict[str, Any] = {}
        for output_name, variable_name in capture.items():
            output, variable = str(output_name), str(variable_name)
            bindings[output] = variable_name
            promoted = scope.declare_capture(
                variable, outputs.get(output, "string"), output in marked
            )
            if promoted and marks is not None:
                self.findings.append(_made_secret_finding(marks.step_path, output, variable))
        return bindings

    def _created(self, entry: BlockEntry, values: Mapping[str, Any]) -> dict[str, Any]:
        """The values a new Block of this catalog entry holds."""
        return creation_values(
            entry.parameters, self.placement_defaults.get(entry.id, {}), values=values
        )

    def _emit_block(
        self, step: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        entry = self.catalog[str(step["block"])]
        fields = _BlockFields.of(step, entry)
        if "filters" in fields.values:
            fields.values["filters"] = _stored_filters(fields.values["filters"])
        fields.values = self._created(entry, fields.values)
        node_id = self._emit_field_block(step, step_path, pending, scope, entry, fields)
        return [(node_id, None)]

    def _emit_function_block(
        self, step: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        contract = resolve_function_contract(step, self.local_functions, step_path)
        entry = function_block_entry(contract)
        fields = _BlockFields.of(step, entry)
        fields.values = creation_values(
            _function_creation_parameters(contract, entry), {}, values=fields.values
        )
        extras: dict[str, Any] = {"functionLifecycle": contract.lifecycle}
        if contract.lifecycle == "shared":
            extras["functionId"] = contract.function_id
            extras["functionVersion"] = contract.version
        node_id = self._emit_field_block(
            step, step_path, pending, scope, entry, fields, element_type="function", extras=extras
        )
        if contract.lifecycle == "local":
            # Compiled after the Function Block's node so ids stay pre-order.
            node = scope.workflow.nodes[-1]
            node["data"]["localDefinition"] = self._compile_local_definition(contract.name)
        return [(node_id, None)]

    def _emit_field_block(
        self,
        step: dict[str, Any],
        step_path: str,
        pending: _Pending,
        scope: _Scope,
        entry: BlockEntry,
        fields: _BlockFields,
        *,
        element_type: str | None = None,
        extras: Mapping[str, Any] | None = None,
    ) -> str:
        """One Block node from a step's settings: values, flags, capture, Secret outputs."""
        values = fields.values
        capture_types = {
            name: resolve_output_type(
                declared, entry.output_type_when.get(name), values, entry.parameters
            )
            for name, declared in entry.outputs.items()
        }
        # Without secret_outputs the Block keeps its schema's Secret boxes at run time.
        given = step.get("secret_outputs")
        marks = _SecretMarks(
            _marked_secret_outputs(_block_output_rows(entry, fields.settings), given), step_path
        )
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type=element_type or entry.id,
            node_type=entry.kind,
            version=entry.version,
            label=str(step.get("label") or entry.name),
            values=values,
            output_bindings=self._capture_bindings(
                step.get("capture"), capture_types, scope, marks
            ),
            profile_bindings=self._profile_bindings(step.get("profiles")),
            data_extras={
                **(extras or {}),
                "expressionFields": fields.expression_fields,
                "templateFields": fields.template_fields,
                **({"elementTypes": fields.element_types} if fields.element_types else {}),
            },
        )
        if isinstance(given, list):
            scope.workflow.nodes[-1]["data"]["config"]["outputSecretFields"] = marks.names
        return node_id

    def _set_payload(
        self, value: dict[str, Any], scope: _Scope, declared_element_types: Any
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        assignments: dict[str, Any] = {}
        expression_keys: list[str] = []
        variable_types: dict[str, str] = {}
        element_types: dict[str, Any] = {}
        declared = declared_element_types if isinstance(declared_element_types, dict) else {}
        for name, assigned in value.items():
            key = str(name)
            if is_expr_value(assigned):
                assignments[key] = assigned["expr"]
                expression_keys.append(key)
                row_type = scope.variable_type(key) or None
            else:
                assignments[key] = assigned
                row_type = scope.variable_type(key) or _infer_value_type(assigned)
                if row_type in ("array", "map") and isinstance(assigned, list | dict):
                    assignments[key], element_types[key] = stored_elements(
                        assigned, declared.get(key)
                    )
            if row_type is not None:
                variable_types[key] = row_type
        extras: dict[str, Any] = {
            "variableExpressionKeys": expression_keys,
            "variableTypes": variable_types,
        }
        if element_types:
            extras["variableElementTypes"] = element_types
        return {"variables": assignments}, extras

    def _sugar_payload(
        self, keyword: str, value: Any, scope: _Scope, element_types: Any = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if keyword == "set":
            return self._set_payload(value, scope, element_types)
        if keyword == "delay" and not isinstance(value, dict):
            return {"duration": value}, {}
        if keyword in ("break", "continue"):
            return {"target_loop": self._resolve_loop_target(value, scope)}, {}
        settings = value if isinstance(value, dict) else {}
        values, expression_fields, template_fields, _types = _split_settings(settings)
        return values, {
            "expressionFields": expression_fields,
            "templateFields": template_fields,
        }

    def _emit_sugar(
        self,
        keyword: str,
        step: dict[str, Any],
        value: Any,
        step_path: str,
        pending: _Pending,
        scope: _Scope,
    ) -> _Pending:
        entry = self.catalog[_SUGAR_CONTROL_IDS[keyword]]
        label = str(step.get("label") or entry.name)
        if keyword == "note":
            settings = value if isinstance(value, dict) else {"text": value}
            # A note is a free-floating annotation: nothing wires into or out
            # of it, and the chain passes it by untouched.
            self._emit_node(
                scope,
                [],
                step_path,
                element_type=entry.id,
                node_type=entry.kind,
                version=entry.version,
                label=label,
                config=self._created(entry, settings),
            )
            return pending
        values, data_extras = self._sugar_payload(keyword, value, scope, step.get("element_types"))
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type=entry.id,
            node_type=entry.kind,
            version=entry.version,
            label=label,
            values=self._created(entry, values),
            data_extras=data_extras,
        )
        if keyword in _TERMINATING_KEYWORDS:
            return []
        return [(node_id, None)]

    def _resolve_loop_target(self, value: Any, scope: _Scope) -> str:
        label = value.get("loop") if isinstance(value, dict) else None
        if label is None:
            return scope.loop_stack[-1][0]
        return next(
            node_id
            for node_id, loop_label in reversed(scope.loop_stack)
            if loop_label == str(label)
        )

    # ------------------------------------------------------------------
    # Local Function definitions
    # ------------------------------------------------------------------

    def _compile_local_definition(self, name: str) -> dict[str, Any]:
        declaration = self.local_functions[name]
        workflow = _Workflow()
        local_variables: list[dict[str, Any]] = [
            {"id": f"var-{variable_name}", "name": str(variable_name), **_declared_variable(item)}
            for variable_name, item in (declaration.get("variables") or {}).items()
        ]
        parameters = [*(declaration.get("inputs") or []), *(declaration.get("outputs") or [])]
        contract_names = {str(item.get("name") or "") for item in parameters}
        name_types = {
            str(item.get("name") or ""): str(item.get("type") or "") for item in parameters
        }
        name_types.update({entry["name"]: entry["type"] for entry in local_variables})
        locals_ = _FunctionLocals(local_variables, contract_names, name_types)
        inner_scope = _Scope(
            workflow=workflow, declare_capture=locals_.declare_capture, variable_type=name_types.get
        )
        self.emit_flow(
            declaration.get("flow") or [],
            f"functions[{name}].flow",
            [("start-node", None)],
            inner_scope,
        )
        _apply_layout(workflow)
        return {
            "name": name,
            "workflow": {"nodes": workflow.nodes, "edges": workflow.edges},
            "inputs": _parameter_declarations(declaration.get("inputs")),
            "outputs": _parameter_declarations(declaration.get("outputs")),
            "variables": local_variables,
        }

    # ------------------------------------------------------------------
    # Constructs
    # ------------------------------------------------------------------

    def _child_flows(
        self,
        keyword: str,
        value: Any,
        step_path: str,
        node_id: str,
        handles: list[str],
        scope: _Scope,
    ) -> list[_Pending]:
        """Emit each child section anchored on its handle; returns the pending tails."""
        sections = child_sections(keyword, value)
        tails: list[_Pending] = []
        for (prefix, steps), handle in zip(sections, handles, strict=True):
            tails.append(self.emit_flow(steps, f"{step_path}.{prefix}", [(node_id, handle)], scope))
        return tails

    def _emit_if(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        branches: list[dict[str, Any]] = []
        sections: list[tuple[str, list[Any]]] = [("if.then", value["then"])]
        branches.append(
            {
                "id": "branch_0",
                "type": "if",
                "label": "",
                "conditions": [self._condition_item(value.get("when"), scope)],
            }
        )
        for index, entry in enumerate(value.get("elif") or []):
            sections.append((f"if.elif[{index}].then", entry["then"]))
            branches.append(
                {
                    "id": f"branch_{len(branches)}",
                    "type": "else_if",
                    "label": "",
                    "conditions": [self._condition_item(entry.get("when"), scope)],
                }
            )
        if isinstance(value.get("else"), list):
            sections.append(("if.else", value["else"]))
            branches.append({"id": f"branch_{len(branches)}", "type": "else", "label": ""})
        has_explicit_else = isinstance(value.get("else"), list)
        entry_meta = self.catalog["if-else"]
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="if-else",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(entry_meta, {"branches": branches}),
        )
        tails: list[_Pending] = []
        for (prefix, steps), branch in zip(sections, branches, strict=True):
            tails.append(
                self.emit_flow(
                    steps, f"{step_path}.{prefix}", [(node_id, str(branch["id"]))], scope
                )
            )
        if not has_explicit_else:
            # No else authored: the false path falls through to whatever comes
            # next, so it needs a real else lane wired onward (pruned if unused).
            implicit = {"id": f"branch_{len(branches)}", "type": "else", "label": ""}
            branches.append(implicit)
            self._implicit_else.append((node_id, str(implicit["id"])))
            tails.append([(node_id, str(implicit["id"]))])
        return [source for tail in tails for source in tail]

    def _emit_switch(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        cases = value.get("cases") or []
        entry_meta = self.catalog["switch-case"]
        branches: list[dict[str, Any]] = [
            {
                "id": f"branch_{index}",
                "type": "case",
                "label": "",
                "conditions": [self._condition_item(case.get("when"), scope)],
                "break": bool(case.get("break", True)),
            }
            for index, case in enumerate(cases)
        ]
        if isinstance(value.get("default"), list):
            branches.append({"id": f"branch_{len(branches)}", "type": "default", "label": ""})
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="switch-case",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(entry_meta, {"branches": branches}),
        )
        handles = [str(branch["id"]) for branch in branches]
        self._child_flows("switch", value, step_path, node_id, handles, scope)
        # Case and default chains dead-end; the flow resumes on the 'then' egress.
        return [(node_id, "then")]

    @staticmethod
    def _for_values(value: dict[str, Any]) -> dict[str, Any]:
        settings: dict[str, Any] = {}
        if "count" in value:
            settings["mode"] = "count"
            settings["count"] = value["count"]
        else:
            loop_range = value.get("range") or {}
            settings["mode"] = "range"
            settings.update(
                {key: loop_range[key] for key in ("start", "end", "step") if key in loop_range}
            )
        if "timeout" in value:
            settings["timeout"] = value["timeout"]
        return settings

    @staticmethod
    def _for_each_values(value: dict[str, Any]) -> dict[str, Any]:
        settings: dict[str, Any] = {"collection": value.get("collection")}
        if "timeout" in value:
            settings["timeout"] = value["timeout"]
        return settings

    def _while_values(self, value: dict[str, Any], scope: _Scope) -> dict[str, Any]:
        conditions = value.get("conditions")
        condition_list = conditions if isinstance(conditions, list) else [conditions]
        settings: dict[str, Any] = {
            key: value[key] for key in ("mode", "max_iterations", "timeout") if key in value
        }
        settings["conditions"] = self._condition_items(condition_list, scope)
        return settings

    def _loop_values(self, keyword: str, value: dict[str, Any], scope: _Scope) -> dict[str, Any]:
        if keyword == "for":
            return self._for_values(value)
        if keyword == "for_each":
            return self._for_each_values(value)
        return self._while_values(value, scope)

    def _emit_loop(
        self,
        keyword: str,
        value: dict[str, Any],
        step_path: str,
        pending: _Pending,
        scope: _Scope,
    ) -> _Pending:
        control_id = {"for": "for", "for_each": "for-each", "while": "while"}[keyword]
        entry_meta = self.catalog[control_id]
        raw_values = self._loop_values(keyword, value, scope)
        values, expression_fields, template_fields, _types = _split_settings(raw_values)
        values = self._created(entry_meta, values)
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type=control_id,
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=values,
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
            data_extras={
                "expressionFields": expression_fields,
                "templateFields": template_fields,
            },
        )
        scope.loop_stack.append(
            (node_id, str(value["label"]) if value.get("label") is not None else None)
        )
        self.emit_flow(
            value.get("body") or [], f"{step_path}.{keyword}.body", [(node_id, "body")], scope
        )
        scope.loop_stack.pop()
        return [(node_id, "then")]

    def _wait_until_values(self, value: dict[str, Any], scope: _Scope) -> dict[str, Any]:
        values: dict[str, Any] = {
            "conditions": self._condition_items(value.get("that") or [], scope),
            "timeout": value.get("timeout"),
            "mode": "retry" if isinstance(value.get("retry"), list) else "watch",
        }
        if "interval" in value:
            values["check_interval"] = value["interval"]
        for key in ("message", "fail_current_scope"):
            if key in value:
                values[key] = value[key]
        return values

    def _emit_wait_until(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        entry_meta = self.catalog["wait-until"]
        raw_values = self._wait_until_values(value, scope)
        values, expression_fields, template_fields, _types = _split_settings(raw_values)
        values = self._created(entry_meta, values)
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="wait-until",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=values,
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
            data_extras={
                "expressionFields": expression_fields,
                "templateFields": template_fields,
            },
        )
        if values["mode"] == "watch":
            return [(node_id, None)]
        self.emit_flow(
            value.get("retry") or [],
            f"{step_path}.wait_until.retry",
            [(node_id, "retry")],
            scope,
        )
        return [(node_id, "then")]

    def _emit_try(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        entry_meta = self.catalog["try-catch-finally"]
        has_catch = isinstance(value.get("catch"), list)
        has_finally = isinstance(value.get("finally"), list)
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="try-catch-finally",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(
                entry_meta, {"enable_catch": has_catch, "enable_finally": has_finally}
            ),
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
        )
        handles = ["try"]
        if has_catch:
            handles.append("catch")
        if has_finally:
            handles.append("finally")
        self._child_flows("try", value, step_path, node_id, handles, scope)
        return [(node_id, "then")]

    def _emit_parallel(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        branches = value.get("branches") or []
        entry_meta = self.catalog["parallel"]
        values: dict[str, Any] = {
            "branches": [
                _parallel_branch_record(branch, index) for index, branch in enumerate(branches)
            ],
        }
        if "join" in value:
            values["join"] = value["join"]
        if "time_limit" in value:
            values["time_limit"] = value["time_limit"]
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="parallel",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(entry_meta, values),
            output_bindings={},
        )
        handles = [f"branch_{index + 1}" for index in range(len(branches))]
        # Branch bodies dead-end: the flow leaves the section only through 'then'.
        self._child_flows("parallel", value, step_path, node_id, handles, scope)
        return [(node_id, "then")]

    def _emit_assert(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        split = "on_pass" in value or "on_fail" in value
        entry_meta = self.catalog["assert"]
        values: dict[str, Any] = {
            "assertions": self._condition_items(value.get("that") or [], scope),
            "mode": "split" if split else "single",
        }
        if "fail_current_scope" in value:
            values["fail_current_scope"] = value["fail_current_scope"]
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="assert",
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(entry_meta, values),
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
        )
        if not split:
            return [(node_id, None)]
        handles: list[str] = []
        if isinstance(value.get("on_pass"), list):
            handles.append("pass")
        if isinstance(value.get("on_fail"), list):
            handles.append("fail")
        tails = self._child_flows("assert", value, step_path, node_id, handles, scope)
        return [source for tail in tails for source in tail]

    def _emit_remote(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        raw_settings = value.get("settings")
        settings: dict[str, Any] = raw_settings if isinstance(raw_settings, dict) else {}
        values, expression_fields, template_fields, _types = _split_settings(settings)
        node_id = self._emit_node(
            scope,
            pending,
            step_path,
            element_type="remote-execution",
            node_type="plugin",
            version=self.remote_entry.version,
            label=str(value.get("label") or self.remote_entry.name),
            values=values,
            output_bindings=self._capture_bindings(
                value.get("capture"), self.remote_entry.outputs, scope
            ),
            data_extras={
                "expressionFields": expression_fields,
                "templateFields": template_fields,
            },
        )
        self.emit_flow(
            value.get("body") or [], f"{step_path}.remote.body", [(node_id, "body")], scope
        )
        return [(node_id, "then")]

    # ------------------------------------------------------------------
    # Document assembly
    # ------------------------------------------------------------------

    def _emit_declared_variables(self) -> dict[str, dict[str, Any]]:
        return {
            str(name): _declared_variable(declaration)
            for name, declaration in self.doc.variables.items()
        }

    def _prune_unused_implicit_else(self, workflow: _Workflow) -> None:
        used = {(edge["source"], edge.get("sourceHandle")) for edge in workflow.edges}
        for node_id, handle in self._implicit_else:
            if (node_id, handle) in used:
                continue
            node = next(entry for entry in workflow.nodes if entry["id"] == node_id)
            values = node["data"]["config"]["values"]
            values["branches"] = [
                branch for branch in values["branches"] if branch.get("id") != handle
            ]

    def emit(self) -> dict[str, Any]:
        workflow = _Workflow()
        scope = _Scope(
            workflow=workflow,
            declare_capture=self._declare_top_capture,
            variable_type=self._variable_type,
        )
        self.emit_flow(self.doc.flow, "flow", [("start-node", None)], scope)
        self._prune_unused_implicit_else(workflow)
        _apply_layout(workflow)
        variables = self._emit_declared_variables()
        for name in self.promoted:
            variables[name]["secret"] = True
        variables.update(self.variables)
        return {
            "name": self.doc.name,
            "description": self.doc.description or "",
            "workflow": _stored_numbers({"nodes": workflow.nodes, "edges": workflow.edges}),
            "variables": _stored_numbers(variables),
            "metadata": {"tags": list(self.doc.tags)},
        }


def _parallel_branch_record(branch: Any, index: int) -> dict[str, Any]:
    """One branch lane as the canvas stores it."""
    source = branch if isinstance(branch, dict) else {}
    record: dict[str, Any] = {
        "id": f"branch_{index + 1}",
        "name": str(source.get("name") or ""),
    }
    if "time_limit" in source:
        record["time_limit"] = source["time_limit"]
    return record


_KEYWORDS = frozenset(STEP_KEYWORDS)


def _apply_layout(workflow: _Workflow) -> None:
    # Element nodes are stored at the width the canvas draws; notes have no title row.
    ingress = ingress_counts(workflow.edges)
    for node in workflow.nodes:
        if node["type"] == "workflowNode":
            node["width"] = fit_node_width(node, ingress.get(node["id"], 0))
    positions = layout_workflow(workflow.nodes, workflow.edges)
    for node in workflow.nodes:
        node["position"] = positions[node["id"]]


def _unreachable_flow_nodes(workflow: dict[str, Any]) -> list[str]:
    """Flow-node ids no edge path from start-node reaches (notes float free)."""
    adjacency: dict[str, list[str]] = {}
    for edge in workflow["edges"]:
        adjacency.setdefault(edge["source"], []).append(edge["target"])
    seen: set[str] = set()
    stack = ["start-node"]
    while stack:
        for target in adjacency.get(stack.pop(), []):
            if target not in seen:
                seen.add(target)
                stack.append(target)
    return [
        node["id"]
        for node in workflow["nodes"]
        if node["id"] not in seen and node["type"] != "noteNode"
    ]


def compile_recipe(
    text: str,
    *,
    testdata_dirs: list[str] | None = None,
    placement_defaults: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Parse + validate + emit; test_data is None whenever any error exists."""
    doc, parse_findings = parse_recipe(text)
    if doc is None:
        return {"test_data": None, "step_map": {}, "findings": parse_findings}
    findings = validate_recipe_doc(doc, testdata_dirs)
    if any(item["severity"] == "error" for item in findings):
        return {"test_data": None, "step_map": {}, "findings": findings}
    emitter = _Emitter(doc, placement_defaults)
    test_data = emitter.emit()
    findings.extend(emitter.findings)
    # Wiring self-check: an emitted graph must reach every flow node, or the
    # compiler has produced a block that can never execute.
    orphans = _unreachable_flow_nodes(test_data["workflow"])
    if orphans:
        for node_id in orphans:
            findings.append(
                finding(
                    emitter.step_map.get(node_id, "test"),
                    "UNREACHABLE_BLOCK",
                    "Compiled block is unreachable from the start of the flow",
                    None,
                )
            )
        return {"test_data": None, "step_map": emitter.step_map, "findings": findings}
    return {"test_data": test_data, "step_map": emitter.step_map, "findings": findings}
