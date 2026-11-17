"""Recipe emission: nodes, edges, variables, step map, and layout.

The compiler owns ALL wiring and geometry: consecutive steps chain in
order, construct children anchor on their declared handles, completion
rejoins the parent flow, and positions come from the layout engine.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, NamedTuple

from wavecore.controls.assertion_evaluator import UNARY_OPERATORS, drop_unused_compare_to
from wavecore.core.layout.dimensions import fit_node_width
from wavecore.core.layout.engine import ingress_counts, layout_workflow
from wavecore.core.number_rule import is_integer_value, wire_number
from wavecore.core.recipes.model import (
    CONDITION_MARKERS,
    CONTROL_FIELDS,
    STEP_KEYWORDS,
    RecipeDoc,
    child_sections,
    finding,
    recipe_fields,
)
from wavecore.core.recipes.parser import parse_recipe
from wavecore.core.recipes.typed_elements import stored_elements
from wavecore.core.recipes.validator import (
    BLOCK_FORM_CONTROLS,
    BlockEntry,
    FunctionContract,
    function_block_entry,
    is_choice_field,
    is_template_value,
    load_block_catalog,
    remote_execution_entry,
    resolve_function_contract,
    validate_recipe_doc,
    value_form,
    written_word,
)
from wavecore.core.variables.decimal_value import decimal_to_str
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.sql_client import tls_on

_TERMINATING_KEYWORDS = {"halt", "break", "continue"}

_SETTER_PLACE = "variables"

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


def _form(raw: Any, *, template_place: bool) -> tuple[str, Any]:
    """A written value's form and inner value; a `{{ }}` string is a template only where a
    template is allowed, plain text elsewhere."""
    kind, inner = value_form(raw)
    if kind == "plain" and template_place and is_template_value(inner):
        return "template", inner
    return kind, inner


def _as_written(value: Any) -> Any:
    """Plain data with each `{literal: ...}` inside it unwrapped; value modes never reach this
    deep, so only the literal form is read."""
    kind, inner = value_form(value)
    if kind == "literal":
        return inner
    if isinstance(value, dict):
        return {key: _as_written(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_as_written(item) for item in value]
    return value


class _SplitEntry(NamedTuple):
    """One entry of a setting or a Setter row: its stored value and the mode it holds."""

    value: Any
    kind: str


def _split_entry(raw: Any, *, template_place: bool) -> _SplitEntry:
    kind, inner = _form(raw, template_place=template_place)
    if kind in ("expr", "template"):
        return _SplitEntry(inner, kind)
    return _SplitEntry(_as_written(inner), "plain")


def _split_map_entries(prefix: str, raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Stores each {expr} entry as bare text, tracked as '<prefix>.<key>'."""
    values: dict[str, Any] = {}
    fields: list[str] = []
    for key, entry in raw.items():
        split = _split_entry(entry, template_place=False)
        values[key] = split.value
        if split.kind == "expr":
            fields.append(f"{prefix}.{key}")
    return values, fields


def _split_row_fields(name: str, raw: list[Any]) -> tuple[list[Any], list[str]]:
    """Each row is a map addressed as '<name>.<i>', so a field becomes '<name>.<i>.<field>'."""
    rows: list[Any] = []
    fields: list[str] = []
    for index, row in enumerate(raw):
        if isinstance(row, dict) and value_form(row)[0] == "plain":
            row, nested = _split_map_entries(f"{name}.{index}", row)
            fields.extend(nested)
            rows.append(row)
            continue
        split = _split_entry(row, template_place=False)
        rows.append(split.value)
        if split.kind == "expr":
            fields.append(f"{name}.{index}")
    return rows, fields


def _typed_map_entries(
    split: dict[str, Any], expression_keys: set[str], declared: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A typed map's literal entries in their stored form; {expr} entries stay source text."""
    literal = {key: item for key, item in split.items() if key not in expression_keys}
    stored, types = stored_elements(literal, declared)
    return {key: stored.get(key, split[key]) for key in split}, types


def _typed_list_items(name: str, raw: list[Any], declared: Any) -> tuple[list[Any], list[str], Any]:
    """A typed list's items in their stored form; an {expr} item is stored as '<name>.<i>'."""
    items: list[Any] = []
    fields: list[str] = []
    for index, item in enumerate(raw):
        split = _split_entry(item, template_place=False)
        items.append(split.value)
        if split.kind == "expr":
            fields.append(f"{name}.{index}")
    stored, types = stored_elements(items, declared)
    return stored, fields, types


def _stored_condition_item(item: Any) -> Any:
    """One stored condition item, a group's rows included, under the compare-to rule."""
    if not isinstance(item, dict):
        return item
    if item.get("type") == "group":
        return {
            **item,
            "items": [_stored_condition_item(child) for child in item.get("items") or []],
        }
    stored = dict(item)
    drop_unused_compare_to(stored)
    return stored


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
    kind, inner = _form(raw, template_place=True)
    if kind == "expr":
        return _SplitSetting(inner, [name])
    if kind == "template":
        return _SplitSetting(inner, [], template=True)
    typed = bool(param.get("typed_values")) and isinstance(inner, list | dict)
    if kind == "literal":
        if not typed:
            return _SplitSetting(inner, [])
        stored, types = stored_elements(inner, declared)
        return _SplitSetting(stored, [], element_types=types)
    if param_type == "map" and isinstance(raw, dict):
        split, nested = _split_map_entries(name, raw)
        if not typed:
            return _SplitSetting(split, nested)
        expression_keys = {field.removeprefix(f"{name}.") for field in nested}
        stored, types = _typed_map_entries(split, expression_keys, declared)
        return _SplitSetting(stored, nested, element_types=types)
    if param_type == "array" and isinstance(raw, list):
        if typed:
            items, item_fields, types = _typed_list_items(name, raw, declared)
            return _SplitSetting(items, item_fields, element_types=types)
        rows, nested_rows = _split_row_fields(name, raw)
        return _SplitSetting(rows, nested_rows)
    return _SplitSetting(written_word(param, _as_written(raw)), [])


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


def wire_id(source: str, source_handle: str | None, target: str, target_handle: str | None) -> str:
    """A compiled wire's id; it names both handles, so wires between the same two Blocks
    stay apart."""
    parts = [source, source_handle, target, target_handle]
    return "-".join(["edge", *(part for part in parts if part is not None)])


@dataclass
class _SetterRows:
    """A Setter's rows as stored, with the shared flags and entry types they hold."""

    values: dict[str, Any] = field(default_factory=dict)
    expression_fields: list[str] = field(default_factory=list)
    template_fields: list[str] = field(default_factory=list)
    element_types: dict[str, Any] = field(default_factory=dict)

    def flag(self, kind: str, place: str) -> None:
        target = self.expression_fields if kind == "expr" else self.template_fields
        target.append(place)

    def store_whole(
        self, name: str, place: str, kind: str, inner: Any, row_type: str, declared_types: Any
    ) -> None:
        """A row stored as one value: a literal as given, plain data as written."""
        value = _as_written(inner) if kind == "plain" else inner
        self.values[name] = value
        if row_type in ("array", "map") and isinstance(value, list | dict):
            self.values[name], self.element_types[place] = stored_elements(value, declared_types)

    def store_entries(
        self, name: str, place: str, inner: Any, row_type: str, declared_types: Any
    ) -> None:
        """A plain list or map row, each first-level entry in the mode it is written in."""
        entries = list(inner.items()) if isinstance(inner, dict) else list(enumerate(inner))
        split = {key: _split_entry(entry, template_place=True) for key, entry in entries}
        for key, entry in split.items():
            if entry.kind != "plain":
                self.flag(entry.kind, f"{place}.{key}")
        if isinstance(inner, dict):
            stored = {key: entry.value for key, entry in split.items()}
            expression_keys = {key for key, entry in split.items() if entry.kind == "expr"}
            if row_type == "map":
                stored, self.element_types[place] = _typed_map_entries(
                    stored, expression_keys, declared_types
                )
            self.values[name] = stored
            return
        items = [entry.value for entry in split.values()]
        if row_type == "array":
            items, self.element_types[place] = stored_elements(items, declared_types)
        self.values[name] = items


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
    # Each enclosing loop's node id and its label, else its block name.
    loop_stack: list[tuple[str, str]] = field(default_factory=list)


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
        # The Notes a `notes:` list places beside a flow: never wired, never reached.
        self.side_notes: set[str] = set()
        self.local_workflows: list[dict[str, Any]] = []

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

    def _comparison_item(self, condition: dict[str, Any], scope: _Scope) -> dict[str, Any]:
        operator = condition.get("operator")
        variable = condition.get("variable")
        kind, value = "plain", None
        # An operator that takes no value stores none and no mode, whatever was written.
        compared = "value" in condition and str(operator) not in UNARY_OPERATORS
        if compared:
            kind, value = _form(condition["value"], template_place=True)
            if kind == "plain":
                value = _as_written(value)
        value_type = self._comparison_value_type(condition, kind, value, scope)
        item: dict[str, Any] = {
            "id": self._next_condition_id(),
            "type": "literal",
            "variable": variable,
            "operator": operator,
        }
        if value_type:
            item["value_type"] = value_type
        if compared:
            item["reference_value"] = value
        if kind == "expr":
            item["reference_is_expression"] = True
        elif kind == "template":
            item["reference_is_template"] = True
        return item

    @staticmethod
    def _comparison_value_type(
        condition: dict[str, Any], kind: str, value: Any, scope: _Scope
    ) -> Any:
        value_type = condition.get("value_type")
        if value_type:
            return value_type
        if value is None or kind == "expr":
            return scope.variable_type(str(condition.get("variable")))
        return "string" if kind == "template" else _infer_value_type(value)

    def _condition_item(self, condition: Any, scope: _Scope) -> dict[str, Any]:
        if isinstance(condition, str):
            return {
                "id": self._next_condition_id(),
                "type": "expression",
                "expression": condition,
            }
        if "group" in condition:
            # The group takes its id before its items, so ids run in reading order.
            group_id = self._next_condition_id()
            return {
                "id": group_id,
                "type": "group",
                "items": self._condition_items(condition["group"], scope),
            }
        return self._comparison_item(condition, scope)

    def _condition_items(self, conditions: Any, scope: _Scope) -> list[dict[str, Any]]:
        """A recipe condition list as stored items: side by side is `and` (REQ-3.5.1.5)."""
        written = conditions if isinstance(conditions, list) else [conditions]
        items: list[dict[str, Any]] = []
        joined = True
        for condition in written:
            if isinstance(condition, str) and condition in CONDITION_MARKERS:
                items.append({"type": "operator", "value": condition})
                joined = True
                continue
            if not joined:
                items.append({"type": "operator", "value": "and"})
            items.append(self._condition_item(condition, scope))
            joined = False
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
            target_handle = f"ingress_{index}" if index else None
            edge: dict[str, Any] = {
                "id": wire_id(source, handle, node_id, target_handle),
                "source": source,
                "target": node_id,
            }
            if handle is not None:
                edge["sourceHandle"] = handle
            if target_handle is not None:
                edge["targetHandle"] = target_handle
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
        identity: Mapping[str, Any],
        values: dict[str, Any] | None = None,
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
            "config": {
                "values": values or {},
                "outputBindings": output_bindings or {},
                "profileBindings": profile_bindings or [],
            },
            "expressionFields": [],
            "templateFields": [],
        }
        if data_extras:
            data.update(data_extras)
        data.update(_identity(identity))
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

    def emit_notes(self, steps: list[Any], path_prefix: str, scope: _Scope) -> None:
        """The Notes beside a flow, with no connection in or out."""
        for index, step in enumerate(steps):
            self._pending_key = step.get("key")
            self._emit_sugar("note", step, step["note"], f"{path_prefix}[{index}]", [], scope)
            self.side_notes.add(scope.workflow.nodes[-1]["id"])

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
        block_id = str(step["block"])
        if block_id in BLOCK_FORM_CONTROLS:
            settings = step.get("settings")
            value = settings if isinstance(settings, dict) else {}
            return self._emit_sugar(block_id, step, value, step_path, pending, scope)
        entry = self.catalog[block_id]
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
            identity=step,
        )
        if isinstance(given, list):
            scope.workflow.nodes[-1]["data"]["config"]["outputSecretFields"] = marks.names
        return node_id

    def _set_row(
        self, name: str, raw: Any, scope: _Scope, declared_types: Any, rows: _SetterRows
    ) -> None:
        """One Setter row on the shared stored shape: `variables.<row>` flags, entry flags one
        level down, entry types at the row's place; the row's own type is its variable's."""
        place = f"{_SETTER_PLACE}.{name}"
        kind, inner = _form(raw, template_place=True)
        if kind in ("expr", "template"):
            rows.values[name] = inner
            rows.flag(kind, place)
            return
        row_type = scope.variable_type(name) or _infer_value_type(inner)
        if kind == "literal" or not isinstance(inner, list | dict):
            rows.store_whole(name, place, kind, inner, row_type, declared_types)
        else:
            rows.store_entries(name, place, inner, row_type, declared_types)

    def _set_payload(
        self, value: dict[str, Any], scope: _Scope, declared_element_types: Any
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        declared = declared_element_types if isinstance(declared_element_types, dict) else {}
        rows = _SetterRows()
        for name, assigned in value.items():
            key = str(name)
            self._set_row(key, assigned, scope, declared.get(key), rows)
        extras: dict[str, Any] = {
            "expressionFields": rows.expression_fields,
            "templateFields": rows.template_fields,
        }
        if rows.element_types:
            extras["elementTypes"] = rows.element_types
        return {_SETTER_PLACE: rows.values}, extras

    def _sugar_payload(
        self, keyword: str, value: Any, scope: _Scope, element_types: Any = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if keyword == "set":
            return self._set_payload(value, scope, element_types)
        if keyword == "delay" and not isinstance(value, dict):
            value = {"duration": value}
        if keyword == "note":
            # A note's text is stored as written, never read as a template.
            return (value if isinstance(value, dict) else {"text": value}), {}
        if keyword in ("break", "continue"):
            return {"target_loop": self._resolve_loop_target(value, scope)}, {}
        settings = value if isinstance(value, dict) else {}
        entry = self.catalog[CONTROL_FIELDS[keyword].control_id]
        values, expression_fields, template_fields, _types = _split_settings(
            settings, entry.parameters
        )
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
        entry = self.catalog[CONTROL_FIELDS[keyword].control_id]
        label = str(step.get("label") or entry.name)
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
            identity=step,
        )
        if keyword == "set":
            self._mark_secret_rows(scope, step.get("secret_rows"), values[_SETTER_PLACE])
        if keyword in _TERMINATING_KEYWORDS:
            return []
        return [(node_id, None)]

    @staticmethod
    def _mark_secret_rows(scope: _Scope, given: Any, rows: Mapping[str, Any]) -> None:
        """A Setter's Secret rows in row order, marked the way Secret outputs are (REQ-3.4.1.14)."""
        if not isinstance(given, list):
            return
        marked = {str(name) for name in given}
        config = scope.workflow.nodes[-1]["data"]["config"]
        config["secretFields"] = [f"{_SETTER_PLACE}.{name}" for name in rows if name in marked]

    @staticmethod
    def _resolve_loop_target(value: Any, scope: _Scope) -> str:
        """The innermost loop, or the nearest enclosing one whose label (else block name) is
        the one given."""
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
        self.emit_notes(declaration.get("notes") or [], f"functions[{name}].notes", inner_scope)
        _apply_layout(workflow)
        self.local_workflows.append({"nodes": workflow.nodes, "edges": workflow.edges})
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

    def _construct_fields(
        self, keyword: str, value: Mapping[str, Any], entry: BlockEntry
    ) -> tuple[dict[str, Any], list[str], list[str]]:
        """A construct's settings, through its control field list, as stored values and flags."""
        raw = recipe_fields(keyword, value)
        values, expression_fields, template_fields, _types = _split_settings(raw, entry.parameters)
        return values, expression_fields, template_fields

    def _emit_control(
        self,
        scope: _Scope,
        pending: _Pending,
        step_path: str,
        value: Mapping[str, Any],
        control_id: str,
        *,
        values: dict[str, Any],
        flags: tuple[list[str], list[str]] = ([], []),
        output_bindings: dict[str, Any] | None = None,
    ) -> str:
        """One control node of a construct: its values, flags, label and identity."""
        entry_meta = self.catalog[control_id]
        expression_fields, template_fields = flags
        return self._emit_node(
            scope,
            pending,
            step_path,
            element_type=control_id,
            node_type="control",
            version=entry_meta.version,
            label=str(value.get("label") or entry_meta.name),
            values=self._created(entry_meta, values),
            output_bindings=output_bindings,
            data_extras={
                "expressionFields": expression_fields,
                "templateFields": template_fields,
            },
            identity=value,
        )

    def _emit_if(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        branches: list[dict[str, Any]] = []
        sections: list[tuple[str, list[Any]]] = [("if.then", value["then"])]
        branches.append(
            {
                "id": "branch_0",
                "type": "if",
                "label": str(value.get("if_label") or ""),
                "conditions": self._condition_items(value.get("when"), scope),
            }
        )
        for index, entry in enumerate(value.get("elif") or []):
            sections.append((f"if.elif[{index}].then", entry["then"]))
            branches.append(
                {
                    "id": f"branch_{len(branches)}",
                    "type": "else_if",
                    "label": str(entry.get("label") or ""),
                    "conditions": self._condition_items(entry.get("when"), scope),
                }
            )
        has_explicit_else = isinstance(value.get("else"), list)
        if has_explicit_else:
            sections.append(("if.else", value["else"]))
            branches.append(
                {
                    "id": f"branch_{len(branches)}",
                    "type": "else",
                    "label": str(value.get("else_label") or ""),
                }
            )
        node_id = self._emit_control(
            scope, pending, step_path, value, "if-else", values={"branches": branches}
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
        branches: list[dict[str, Any]] = [
            {
                "id": f"branch_{index}",
                "type": "case",
                "label": str(case.get("label") or ""),
                "conditions": self._condition_items(case.get("when"), scope),
                "break": bool(case.get("break", True)),
            }
            for index, case in enumerate(cases)
        ]
        if isinstance(value.get("default"), list):
            branches.append(
                {
                    "id": f"branch_{len(branches)}",
                    "type": "default",
                    "label": str(value.get("default_label") or ""),
                }
            )
        node_id = self._emit_control(
            scope, pending, step_path, value, "switch-case", values={"branches": branches}
        )
        handles = [str(branch["id"]) for branch in branches]
        self._child_flows("switch", value, step_path, node_id, handles, scope)
        # Case and default chains dead-end; the flow resumes on the 'then' egress.
        return [(node_id, "then")]

    def _for_each_type(self, value: Mapping[str, Any], scope: _Scope) -> str | None:
        """A For Each left without `collection_type` takes the type of the variable a literal
        `collection` names, as its window does; an expression collection gets none."""
        kind, collection = value_form(value.get("collection"))
        if kind != "plain" or not isinstance(collection, str):
            return None
        declared = scope.variable_type(collection)
        return declared if declared in ("array", "map", "table") else None

    def _emit_loop(
        self,
        keyword: str,
        value: dict[str, Any],
        step_path: str,
        pending: _Pending,
        scope: _Scope,
    ) -> _Pending:
        control_id = CONTROL_FIELDS[keyword].control_id
        entry_meta = self.catalog[control_id]
        values, expression_fields, template_fields = self._construct_fields(
            keyword, value, entry_meta
        )
        if keyword == "for_each" and "collection_type" not in values:
            derived = self._for_each_type(value, scope)
            if derived is not None:
                values["collection_type"] = derived
        elif keyword == "while":
            values["conditions"] = self._condition_items(value.get("conditions"), scope)
        node_id = self._emit_control(
            scope,
            pending,
            step_path,
            value,
            control_id,
            values=values,
            flags=(expression_fields, template_fields),
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
        )
        label = value.get("label")
        scope.loop_stack.append((node_id, str(label) if label else entry_meta.name))
        self.emit_flow(
            value.get("body") or [], f"{step_path}.{keyword}.body", [(node_id, "body")], scope
        )
        scope.loop_stack.pop()
        return [(node_id, "then")]

    def _emit_wait_until(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        entry_meta = self.catalog["wait-until"]
        values, expression_fields, template_fields = self._construct_fields(
            "wait_until", value, entry_meta
        )
        values["conditions"] = self._condition_items(value.get("that") or [], scope)
        node_id = self._emit_control(
            scope,
            pending,
            step_path,
            value,
            "wait-until",
            values=values,
            flags=(expression_fields, template_fields),
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
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
        node_id = self._emit_control(
            scope,
            pending,
            step_path,
            value,
            "try-catch-finally",
            values={"enable_catch": has_catch, "enable_finally": has_finally},
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
        values, expression_fields, template_fields = self._construct_fields(
            "parallel", value, entry_meta
        )
        records: list[dict[str, Any]] = []
        for index, branch in enumerate(branches):
            record, lane_fields = _parallel_branch_record(branch, index)
            records.append(record)
            expression_fields.extend(lane_fields)
        values["branches"] = records
        node_id = self._emit_control(
            scope,
            pending,
            step_path,
            value,
            "parallel",
            values=values,
            flags=(expression_fields, template_fields),
            output_bindings={},
        )
        handles = [f"branch_{index + 1}" for index in range(len(branches))]
        # Branch bodies dead-end: the flow leaves the section only through 'then'.
        self._child_flows("parallel", value, step_path, node_id, handles, scope)
        return [(node_id, "then")]

    def _emit_assert(
        self, value: dict[str, Any], step_path: str, pending: _Pending, scope: _Scope
    ) -> _Pending:
        entry_meta = self.catalog["assert"]
        values, expression_fields, template_fields = self._construct_fields(
            "assert", value, entry_meta
        )
        sections = "on_pass" in value or "on_fail" in value
        # A written mode is honored; left out, the sections pick it.
        values.setdefault("mode", "split" if sections else "single")
        values["assertions"] = self._condition_items(value.get("that") or [], scope)
        node_id = self._emit_control(
            scope,
            pending,
            step_path,
            value,
            "assert",
            values=values,
            flags=(expression_fields, template_fields),
            output_bindings=self._capture_bindings(value.get("capture"), entry_meta.outputs, scope),
        )
        if values["mode"] != "split":
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
        values, expression_fields, template_fields, _types = _split_settings(
            settings, self.remote_entry.parameters
        )
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
            profile_bindings=self._profile_bindings(value.get("profiles")),
            data_extras={
                "expressionFields": expression_fields,
                "templateFields": template_fields,
            },
            identity=value,
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
        self.emit_notes(self.doc.notes, "notes", scope)
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


def _identity(holder: Mapping[str, Any]) -> dict[str, Any]:
    """The description and disabled mark a step gives its Block, when it gives them."""
    identity: dict[str, Any] = {}
    if holder.get("description"):
        identity["description"] = holder["description"]
    if holder.get("disabled") is True:
        identity["disabled"] = True
    return identity


def _parallel_branch_record(branch: Any, index: int) -> tuple[dict[str, Any], list[str]]:
    """One branch lane as the canvas stores it, and its lane-limit expression flag."""
    source = branch if isinstance(branch, dict) else {}
    record: dict[str, Any] = {
        "id": f"branch_{index + 1}",
        "name": str(source.get("name") or ""),
    }
    if "time_limit" not in source:
        return record, []
    split = _split_entry(source["time_limit"], template_place=False)
    record["time_limit"] = split.value
    return record, [f"branches.{index}.time_limit"] if split.kind == "expr" else []


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


def _unreachable_flow_nodes(workflow: dict[str, Any], beside: set[str]) -> list[str]:
    """Flow-node ids no edge path from start-node reaches, the Notes beside the flow aside."""
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
        if node["id"] not in seen and node["id"] not in beside
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
    # One finding per step: a local Function used twice compiles twice.
    orphans = dict.fromkeys(
        emitter.step_map.get(node_id, "test")
        for workflow in (*emitter.local_workflows, test_data["workflow"])
        for node_id in _unreachable_flow_nodes(workflow, emitter.side_notes)
    )
    if orphans:
        for step in orphans:
            findings.append(
                finding(
                    step,
                    "UNREACHABLE_BLOCK",
                    "Compiled block is unreachable from the start of the flow",
                    None,
                )
            )
        return {"test_data": None, "step_map": emitter.step_map, "findings": findings}
    return {"test_data": test_data, "step_map": emitter.step_map, "findings": findings}
