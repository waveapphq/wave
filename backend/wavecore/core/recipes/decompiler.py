"""Canvas -> recipe readback: invert the compiler, flag inexpressible wiring.

Reconstructs a recipe from an emitted test_data by walking the graph the same
way the layout engine does (construct handles, then-egress, ingress rejoins),
inverting each ``_emit_*`` shape. Secret values are never surfaced. A near-tree
predicate flags graphs a recipe cannot express (orphans, cycles, cross-branch
edges, unstructured joins) so the amend loop refuses them.
"""

import copy
from collections import defaultdict
from typing import Any

from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.typed_numbers import block_numbers
from wavecore.core.functions.declarations import DeclarationKind, declaration_numbers
from wavecore.core.layout.engine import (
    START_NODE_ID,
    _is_section_handle,
    _section_sort_key,
)
from wavecore.core.recipes.typed_elements import readback_element_types
from wavecore.core.recipes.validator import (
    BlockEntry,
    load_block_catalog,
    remote_execution_entry,
)
from wavecore.core.utf8_text import dump_exact_yaml
from wavecore.core.variables.value_checks import text_as_number

_THEN_EGRESS = {
    "for",
    "for-each",
    "while",
    "try-catch-finally",
    "remote-execution",
    "switch-case",
    "wait-until",
    "parallel",
}
_REJOIN_EGRESS = {"if-else"}
_DECLARED_BRANCH_ELEMENTS = {"if-else", "switch-case", "parallel"}
_LOOP_KEYWORD = {"for": "for", "for-each": "for_each", "while": "while"}
_SUGAR_KEYWORD = {
    "delay": "delay",
    "halt": "halt",
    "break": "break",
    "continue": "continue",
}


def _label(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("label") or node.get("id") or "")


def _rewrap_entry(value: Any, tail: str) -> None:
    """Wraps the entry a dotted expressionFields tail addresses as {expr}, in place."""
    container: Any = value
    key: Any = tail
    if isinstance(value, list):
        index, _, key = tail.partition(".")
        held = index.isdigit() and int(index) < len(value)
        container = value[int(index)] if held else None
        if held and not key:
            # A plain list item is addressed by its index alone.
            container, key = value, int(index)
    if (isinstance(container, dict) and key in container) or isinstance(key, int):
        container[key] = {"expr": container[key]}


def _rewrap_nested(value: Any, tails: list[str]) -> Any:
    if not tails:
        return value
    value = copy.deepcopy(value)
    for tail in tails:
        _rewrap_entry(value, tail)
    return value


_STORED_KIND_KEYS = {"isExpression": "expr", "isTemplate": "template"}


def _readback_declaration(item: dict[str, Any], kind: DeclarationKind) -> dict[str, Any]:
    """A declaration whose digit text in a number place reads back as that number."""
    return declaration_numbers(item, kind=kind, form=text_as_number)


def _parameter_readback(item: dict[str, Any], role: DeclarationKind) -> dict[str, Any]:
    """A local Function parameter as a recipe writes it; a secret one never shows its default."""
    item = _readback_declaration(item, role)
    readback = {
        key: value
        for key, value in item.items()
        if key != "elementTypes" and key not in _STORED_KIND_KEYS
    }
    if item.get("secret"):
        readback.pop("default", None)
        return readback
    default = item.get("default")
    kind = next((key for key in _STORED_KIND_KEYS if item.get(key)), None)
    if kind is not None:
        readback.pop("default", None)
        readback[_STORED_KIND_KEYS[kind]] = default
    elif item.get("type") in ("array", "map") and isinstance(default, list | dict) and default:
        readback["element_types"] = readback_element_types(default, item.get("elementTypes"))
    return readback


def _declared_secret_outputs(data: dict[str, Any]) -> set[str] | None:
    """The outputs a Function Block's Function declares secret; None when its version is gone."""
    if data.get("functionLifecycle") == "local":
        outputs = (data.get("localDefinition") or {}).get("outputs") or []
    else:
        from wavecore.api.services.functions import service as function_service

        contract = function_service.resolve_version_contract(
            str(data.get("functionId") or ""), str(data.get("functionVersion") or "")
        )
        if contract is None:
            return None
        outputs = contract["outputs"]
    return {str(item.get("name") or "") for item in outputs if item.get("secret")}


def _block_secret_outputs(
    entry: BlockEntry | None, values: dict[str, Any], stored: Any
) -> list[str] | None:
    """A block's stored Secret outputs, None when absent or equal to its schema's (K8SCON-4)."""
    if entry is None or not isinstance(stored, list):
        return None
    known = set(entry.outputs)
    for param in entry.output_name_params:
        declared = values.get(param)
        if isinstance(declared, list):
            known.update(name for name in declared if isinstance(name, str))
    marked = [name for name in stored if name in known]
    return None if set(marked) == set(entry.secret_outputs) else marked


class _LibraryNames:
    """Library Function names by id, read once per readback."""

    def __init__(self) -> None:
        self._names: dict[str, str] | None = None

    def get(self, function_id: str) -> str | None:
        if self._names is None:
            from wavecore.api.services.functions import service as function_service

            rows = function_service.list_functions(per_page=10_000)["data"]
            self._names = {str(row["id"]): str(row["name"]) for row in rows}
        return self._names.get(function_id)


class _Walker:
    """Reconstructs one workflow's recipe flow; local functions bubble up shared."""

    def __init__(
        self,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        catalog: dict[str, BlockEntry],
        remote_entry: BlockEntry,
        functions: dict[str, dict[str, Any]],
        library_names: _LibraryNames,
    ) -> None:
        self.nodes = nodes
        self.edges = edges
        self.by_id = {str(node["id"]): node for node in nodes}
        self.outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for edge in edges:
            self.outgoing[str(edge["source"])].append(edge)
        self.rejoins = {
            str(edge["target"])
            for edge in edges
            if str(edge.get("targetHandle") or "").startswith("ingress_")
        }
        self.catalog = catalog
        self.remote_entry = remote_entry
        self.functions = functions
        self.library_names = library_names
        self.visited: set[str] = set()

    # ------------------------------------------------------------------
    # Graph walk
    # ------------------------------------------------------------------

    def flow(self) -> list[dict[str, Any]]:
        starts = [str(e["target"]) for e in self.edges if str(e["source"]) == START_NODE_ID]
        head = starts[0] if starts else None
        steps, _exit = self._walk(head)
        return steps

    def _declared_branch_handles(self, node_id: str) -> list[str]:
        """If-else and Switch branch ids are author-controlled; they define sections."""
        data = self.by_id[node_id].get("data") or {}
        if str(data.get("elementType") or "") not in _DECLARED_BRANCH_ELEMENTS:
            return []
        branches = ((data.get("config") or {}).get("values") or {}).get("branches") or []
        return [str(b["id"]) for b in branches if isinstance(b, dict) and b.get("id")]

    def _classify(
        self, node_id: str
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any] | None]:
        outs = self.outgoing.get(node_id, [])
        declared = self._declared_branch_handles(node_id)

        def is_section(handle: str) -> bool:
            return handle in declared or _is_section_handle(handle)

        def sort_key(handle: str) -> int:
            return declared.index(handle) if handle in declared else _section_sort_key(handle)

        section = sorted(
            (e for e in outs if is_section(str(e.get("sourceHandle") or ""))),
            key=lambda e: sort_key(str(e["sourceHandle"])),
        )
        then_edge = next((e for e in outs if e.get("sourceHandle") == "then"), None)
        plain = next((e for e in outs if not e.get("sourceHandle")), None)
        return section, then_edge, plain

    @staticmethod
    def _plain_egress(elem: str, plain: dict[str, Any] | None) -> dict[str, Any] | None:
        """A Watch-mode Wait Until continues on the canvas default handle, not `then`."""
        return plain if elem == "wait-until" else None

    def _is_construct(self, elem: str, section: list[dict[str, Any]]) -> bool:
        if elem in _THEN_EGRESS:
            return True
        if elem in _REJOIN_EGRESS or elem == "assert":
            return bool(section)
        return False

    def _walk(self, head: str | None) -> tuple[list[dict[str, Any]], str | None]:
        steps: list[dict[str, Any]] = []
        current = head
        while current is not None and current in self.by_id and current not in self.visited:
            self.visited.add(current)
            node = self.by_id[current]
            elem = str((node.get("data") or {}).get("elementType") or "")
            section, then_edge, plain = self._classify(current)
            if self._is_construct(elem, section):
                egress = then_edge if then_edge is not None else self._plain_egress(elem, plain)
                step, current = self._construct(node, elem, section, egress)
                steps.append(step)
                continue
            steps.append(self._leaf(node, elem))
            if plain is None:
                return steps, None
            target = str(plain["target"])
            if target in self.rejoins:
                return steps, target
            current = target
        return steps, current

    def _construct(
        self,
        node: dict[str, Any],
        elem: str,
        section: list[dict[str, Any]],
        then_edge: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], str | None]:
        if elem in _THEN_EGRESS:
            return self._then_construct(node, elem, section, then_edge)
        return self._rejoin_construct(node, elem, section)

    def _walk_section(self, edge: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
        target = str(edge["target"])
        if target in self.rejoins:
            return [], target
        return self._walk(target)

    def _rejoin_construct(
        self, node: dict[str, Any], elem: str, section: list[dict[str, Any]]
    ) -> tuple[dict[str, Any], str | None]:
        branch_steps: dict[str, list[dict[str, Any]]] = {}
        exit_target: str | None = None
        for edge in section:
            sub, sub_exit = self._walk_section(edge)
            branch_steps[str(edge["sourceHandle"])] = sub
            if sub_exit is not None:
                exit_target = sub_exit
        return self._build_rejoin_step(elem, node, branch_steps), exit_target

    def _then_construct(
        self,
        node: dict[str, Any],
        elem: str,
        section: list[dict[str, Any]],
        then_edge: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], str | None]:
        section_steps: dict[str, list[dict[str, Any]]] = {}
        for edge in section:
            sub, _sub_exit = self._walk_section(edge)
            section_steps[str(edge["sourceHandle"])] = sub
        exit_target = str(then_edge["target"]) if then_edge is not None else None
        return self._build_then_step(elem, node, section_steps), exit_target

    # ------------------------------------------------------------------
    # Leaf steps
    # ------------------------------------------------------------------

    @staticmethod
    def _values(data: dict[str, Any]) -> dict[str, Any]:
        """A Block's values, digit text in each number place read back as that number."""
        values = (data.get("config") or {}).get("values")
        return block_numbers(data, text_as_number) if isinstance(values, dict) else {}

    def _leaf(self, node: dict[str, Any], elem: str) -> dict[str, Any]:
        data = node.get("data") or {}
        config = data.get("config") or {}
        values = self._values(data)
        if elem == "variable-setter":
            step: dict[str, Any] = {"set": self._decompile_set(data, values)}
            # A secret row's element types are sealed with its value and stay out of the recipe.
            element_types = {
                name: types
                for name, types in (data.get("variableElementTypes") or {}).items()
                if isinstance(types, dict | list)
            }
            if element_types:
                step["element_types"] = element_types
            return self._with_label(step, data)
        if elem == "function":
            return self._decompile_function_block(data, config, values)
        if elem == "assert":
            value: dict[str, Any] = {
                "that": self._decompile_conditions(values.get("assertions") or [])
            }
            if "fail_current_scope" in values:
                value["fail_current_scope"] = values["fail_current_scope"]
            return {"assert": self._with_label(value, data)}
        if elem in _SUGAR_KEYWORD:
            sugar = {_SUGAR_KEYWORD[elem]: self._decompile_sugar(elem, data, values)}
            return self._with_label(sugar, data)
        return self._decompile_block(data, config, values, elem)

    def _default_name(self, elem: str) -> str:
        entry = self.remote_entry if elem == self.remote_entry.id else self.catalog.get(elem)
        return entry.name if entry else elem

    def _custom_label(self, data: dict[str, Any]) -> str | None:
        """A Block's own label, when it is not the name its type gives."""
        label = data.get("label")
        if not label or str(label) == self._default_name(str(data.get("elementType") or "")):
            return None
        return str(label)

    def _with_label(self, step: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
        """A step or construct mapping with the Block's own label, when it has one."""
        label = self._custom_label(data)
        return step if label is None else {**step, "label": label}

    def _secret_settings(self, entry: BlockEntry | None) -> set[str]:
        if entry is None:
            return set()
        return {
            name
            for name, param in entry.parameters.items()
            if isinstance(param, dict) and param.get("secret")
        }

    def _decompile_block(
        self,
        data: dict[str, Any],
        config: dict[str, Any],
        values: dict[str, Any],
        elem: str,
    ) -> dict[str, Any]:
        step: dict[str, Any] = {"block": elem}
        label = data.get("label")
        if label and str(label) != self._default_name(elem):
            step["label"] = label
        entry = self.catalog.get(elem)
        settings = self._decompile_settings(
            values, set(data.get("expressionFields") or []), self._secret_settings(entry)
        )
        if settings:
            step["settings"] = settings
        capture = dict(config.get("outputBindings") or {})
        if capture:
            step["capture"] = capture
        marked = _block_secret_outputs(entry, values, config.get("outputSecretFields"))
        if marked is not None:
            step["secret_outputs"] = marked
        return self._with_bindings_and_types(step, data, config)

    def _with_bindings_and_types(
        self, step: dict[str, Any], data: dict[str, Any], config: dict[str, Any]
    ) -> dict[str, Any]:
        """A Block step with the profiles and element types its Block holds."""
        profiles = self._decompile_profiles(config.get("profileBindings") or [])
        if profiles:
            step["profiles"] = profiles
        element_types = data.get("elementTypes") or {}
        if element_types:
            step["element_types"] = dict(element_types)
        return step

    def _decompile_set(self, data: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
        variables = values.get("variables") or {}
        expr_keys = set(data.get("variableExpressionKeys") or [])
        result: dict[str, Any] = {}
        for name, val in variables.items():
            result[name] = {"expr": val} if name in expr_keys else val
        return result

    def _loop_label(self, node_id: str) -> str | None:
        """A loop's authored label, when it carries one (the break/continue target)."""
        node = self.by_id.get(str(node_id))
        return None if node is None else self._custom_label(node.get("data") or {})

    def _decompile_sugar(self, elem: str, data: dict[str, Any], values: dict[str, Any]) -> Any:
        expr_fields = set(data.get("expressionFields") or [])
        if elem == "delay" and set(values.keys()) == {"duration"} and "duration" not in expr_fields:
            return values["duration"]
        if elem in ("break", "continue"):
            label = self._loop_label(str(values.get("target_loop") or ""))
            return {"loop": label} if label else {}
        return self._decompile_settings(values, expr_fields, set())

    def _function_name(self, data: dict[str, Any]) -> str:
        """The name a Function step gives: the Function's own, never the Block's label."""
        label = str(data.get("label") or "")
        if data.get("functionLifecycle") == "local":
            local_def = data.get("localDefinition") or {}
            self._register_local(local_def)
            return str(local_def.get("name") or label)
        return self.library_names.get(str(data.get("functionId") or "")) or label

    def _decompile_function_block(
        self, data: dict[str, Any], config: dict[str, Any], values: dict[str, Any]
    ) -> dict[str, Any]:
        name = self._function_name(data)
        step: dict[str, Any] = {"function": name}
        if data.get("functionLifecycle") != "local" and data.get("functionVersion"):
            step["version"] = data["functionVersion"]
        label = data.get("label")
        if label and str(label) != name:
            step["label"] = label
        secret_inputs = {
            str(field["name"]) for field in block_schema(data).fields if field.get("secret")
        }
        settings = self._decompile_settings(
            values, set(data.get("expressionFields") or []), secret_inputs
        )
        if settings:
            step["settings"] = settings
        capture = dict(config.get("outputBindings") or {})
        if capture:
            step["capture"] = capture
        marked = config.get("outputSecretFields")
        # Left out when it matches what the Function declares secret, which a compile restores.
        if isinstance(marked, list) and set(marked) != _declared_secret_outputs(data):
            step["secret_outputs"] = list(marked)
        return self._with_bindings_and_types(step, data, config)

    def _register_local(self, local_def: dict[str, Any]) -> None:
        name = str(local_def.get("name") or "")
        if not name or name in self.functions:
            return
        self.functions[name] = {}
        inner = local_def.get("workflow") or {}
        inner_walker = _Walker(
            inner.get("nodes") or [],
            inner.get("edges") or [],
            self.catalog,
            self.remote_entry,
            self.functions,
            self.library_names,
        )
        self.functions[name] = {
            "name": name,
            "inputs": [
                _parameter_readback(item, "input") for item in local_def.get("inputs") or []
            ],
            "outputs": [
                _parameter_readback(item, "output") for item in local_def.get("outputs") or []
            ],
        }
        own_variables = _decompile_variables(
            {
                str(item.get("name") or ""): item
                for item in local_def.get("variables") or []
                if isinstance(item, dict)
            }
        )
        if own_variables:
            self.functions[name]["variables"] = own_variables
        self.functions[name]["flow"] = inner_walker.flow()

    # ------------------------------------------------------------------
    # Construct step builders
    # ------------------------------------------------------------------

    def _build_rejoin_step(
        self, elem: str, node: dict[str, Any], branch_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        values = self._values(data)
        if elem == "if-else":
            return {"if": self._with_label(self._build_if(values, branch_steps), data)}
        return {"assert": self._with_label(self._build_assert_split(values, branch_steps), data)}

    def _build_if(
        self, values: dict[str, Any], branch_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for index, branch in enumerate(values.get("branches") or []):
            handle = str(branch.get("id") or f"branch_{index}")
            steps = branch_steps.get(handle, [])
            btype = branch.get("type")
            conditions = branch.get("conditions") or []
            if btype == "else":
                result["else"] = steps
            elif btype == "else_if":
                entry: dict[str, Any] = {}
                if conditions:
                    entry["when"] = self._decompile_condition(conditions[0])
                entry["then"] = steps
                result.setdefault("elif", []).append(entry)
            else:
                if conditions:
                    result["when"] = self._decompile_condition(conditions[0])
                result["then"] = steps
        return result

    def _build_switch(
        self,
        values: dict[str, Any],
        section_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"cases": []}
        for index, branch in enumerate(values.get("branches") or []):
            handle = str(branch.get("id") or f"branch_{index}")
            steps = section_steps.get(handle, [])
            if branch.get("type") == "default":
                result["default"] = steps
                continue
            entry: dict[str, Any] = {}
            conditions = branch.get("conditions") or []
            if conditions:
                entry["when"] = self._decompile_condition(conditions[0])
            entry["steps"] = steps
            # True is the compile default, so only an explicit False round-trips.
            if branch.get("break") is False:
                entry["break"] = False
            result["cases"].append(entry)
        return result

    @staticmethod
    def _build_parallel(
        values: dict[str, Any], section_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        branches: list[dict[str, Any]] = []
        for index, branch in enumerate(values.get("branches") or []):
            handle = str(branch.get("id") or f"branch_{index + 1}")
            entry: dict[str, Any] = {}
            # A blank name and an unset limit are the defaults, so both stay unwritten.
            if branch.get("name"):
                entry["name"] = branch["name"]
            if branch.get("time_limit") is not None:
                entry["time_limit"] = branch["time_limit"]
            entry["steps"] = section_steps.get(handle, [])
            branches.append(entry)
        result: dict[str, Any] = {"branches": branches}
        if values.get("join") and values["join"] != "all":
            result["join"] = values["join"]
        if values.get("time_limit") is not None:
            result["time_limit"] = values["time_limit"]
        return result

    def _build_assert_split(
        self, values: dict[str, Any], branch_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "that": self._decompile_conditions(values.get("assertions") or [])
        }
        if "pass" in branch_steps:
            result["on_pass"] = branch_steps["pass"]
        if "fail" in branch_steps:
            result["on_fail"] = branch_steps["fail"]
        if "fail_current_scope" in values:
            result["fail_current_scope"] = values["fail_current_scope"]
        return result

    def _labeled_step(
        self, keyword: str, value: dict[str, Any], node_id: str, capture: dict[str, Any]
    ) -> dict[str, Any]:
        label = self._loop_label(node_id)
        if label:
            value["label"] = label
        if capture:
            value["capture"] = capture
        return {keyword: value}

    def _build_then_step(
        self, elem: str, node: dict[str, Any], section_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        config = data.get("config") or {}
        values = self._values(data)
        expr_fields = set(data.get("expressionFields") or [])
        capture = dict(config.get("outputBindings") or {})
        body = section_steps.get("body", [])
        if elem == "switch-case":
            return {"switch": self._with_label(self._build_switch(values, section_steps), data)}
        if elem == "parallel":
            built = self._build_parallel(values, section_steps)
            return {"parallel": self._with_label(built, data)}
        if elem == "try-catch-finally":
            built = self._build_try(values, section_steps, capture)
            return {"try": self._with_label(built, data)}
        if elem == "remote-execution":
            built = self._build_remote(values, expr_fields, body, capture)
            return {"remote": self._with_label(built, data)}
        node_id = str(node.get("id") or "")
        if elem == "wait-until":
            value = self._wait_until_value(values, expr_fields, section_steps)
            return self._labeled_step("wait_until", value, node_id, capture)
        value = self._build_loop(elem, values, expr_fields, body)
        return self._labeled_step(_LOOP_KEYWORD[elem], value, node_id, capture)

    @staticmethod
    def _for_loop_value(settings: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if settings.get("mode") == "range":
            result["range"] = {
                key: settings[key] for key in ("start", "end", "step") if key in settings
            }
        elif "count" in settings:
            result["count"] = settings["count"]
        if "timeout" in settings:
            result["timeout"] = settings["timeout"]
        return result

    def _while_value(self, settings: dict[str, Any]) -> dict[str, Any]:
        conditions = self._decompile_conditions(settings.get("conditions") or [])
        result: dict[str, Any] = {
            "conditions": conditions[0] if len(conditions) == 1 else conditions
        }
        for key in ("mode", "max_iterations", "timeout"):
            if key in settings:
                result[key] = settings[key]
        return result

    def _wait_until_value(
        self,
        values: dict[str, Any],
        expr_fields: set[str],
        section_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        settings = self._decompile_settings(values, expr_fields, set())
        result: dict[str, Any] = {
            # `that` is Assert's vocabulary: always a list, at any length.
            "that": self._decompile_conditions(settings.get("conditions") or []),
            "timeout": settings.get("timeout"),
        }
        if "check_interval" in settings:
            result["interval"] = settings["check_interval"]
        for key in ("message", "fail_current_scope"):
            if key in settings:
                result[key] = settings[key]
        if settings.get("mode") != "watch":
            result["retry"] = section_steps.get("retry", [])
        return result

    def _build_loop(
        self, elem: str, values: dict[str, Any], expr_fields: set[str], body: list[dict[str, Any]]
    ) -> dict[str, Any]:
        settings = self._decompile_settings(values, expr_fields, set())
        if elem == "for":
            result = self._for_loop_value(settings)
        elif elem == "for-each":
            result = {"collection": settings.get("collection")}
            if "timeout" in settings:
                result["timeout"] = settings["timeout"]
        else:
            result = self._while_value(settings)
        result["body"] = body
        return result

    def _build_try(
        self,
        values: dict[str, Any],
        section_steps: dict[str, list[dict[str, Any]]],
        capture: dict[str, Any],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"steps": section_steps.get("try", [])}
        if values.get("enable_catch"):
            result["catch"] = section_steps.get("catch", [])
        if values.get("enable_finally"):
            result["finally"] = section_steps.get("finally", [])
        if capture:
            result["capture"] = capture
        return result

    def _build_remote(
        self,
        values: dict[str, Any],
        expr_fields: set[str],
        body: list[dict[str, Any]],
        capture: dict[str, Any],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        settings = self._decompile_settings(
            values, expr_fields, self._secret_settings(self.remote_entry)
        )
        if settings:
            result["settings"] = settings
        if capture:
            result["capture"] = capture
        result["body"] = body
        return result

    # ------------------------------------------------------------------
    # Value inversion
    # ------------------------------------------------------------------

    def _decompile_settings(
        self, values: dict[str, Any], expr_fields: set[str], secret_names: set[str]
    ) -> dict[str, Any]:
        nested: dict[str, list[str]] = defaultdict(list)
        for expr_field in expr_fields:
            head, dot, tail = expr_field.partition(".")
            if dot:
                nested[head].append(tail)
        result: dict[str, Any] = {}
        for name, value in values.items():
            if name in secret_names:
                continue
            if name in expr_fields:
                result[name] = {"expr": value}
            else:
                result[name] = _rewrap_nested(value, nested.get(name, []))
        return result

    def _decompile_profiles(self, bindings: list[Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            entry: dict[str, Any] = {"profile": binding.get("profileName")}
            if binding.get("alias") is not None:
                entry["alias"] = binding["alias"]
            if binding.get("fields") is not None:
                entry["fields"] = list(binding["fields"])
            result.append(entry)
        return result

    def _decompile_condition(self, item: Any) -> Any:
        if not isinstance(item, dict):
            return item
        if item.get("type") == "expression":
            return item.get("expression")
        condition: dict[str, Any] = {
            "variable": item.get("variable"),
            "operator": item.get("operator"),
        }
        # A null compare-to value and a missing value_type compile back the same when left out.
        if item.get("reference_value") is not None:
            condition["value"] = item["reference_value"]
        if item.get("value_type"):
            condition["value_type"] = item["value_type"]
        return condition

    def _decompile_conditions(self, items: list[Any]) -> list[Any]:
        return [
            self._decompile_condition(item)
            for item in items
            if isinstance(item, dict) and item.get("type") != "operator"
        ]


# ---------------------------------------------------------------------------
# Inexpressibility predicate (near-tree)
# ---------------------------------------------------------------------------


def _cycle_from(
    node_id: str,
    by_id: dict[str, Any],
    outgoing: dict[str, list[dict[str, Any]]],
    color: dict[str, int],
) -> str | None:
    color[node_id] = 1
    for edge in outgoing.get(node_id, []):
        target = str(edge["target"])
        if target not in by_id or color[target] == 2:
            continue
        if color[target] == 1:
            return target
        cycle = _cycle_from(target, by_id, outgoing, color)
        if cycle is not None:
            return cycle
    color[node_id] = 2
    return None


def _find_cycle(by_id: dict[str, Any], outgoing: dict[str, list[dict[str, Any]]]) -> str | None:
    color: dict[str, int] = dict.fromkeys(by_id, 0)
    for node_id in by_id:
        if color[node_id] != 0:
            continue
        cycle = _cycle_from(node_id, by_id, outgoing, color)
        if cycle is not None:
            return cycle
    return None


def _reachable_from_start(
    by_id: dict[str, Any],
    edges: list[dict[str, Any]],
    outgoing: dict[str, list[dict[str, Any]]],
) -> set[str]:
    reachable: set[str] = set()
    stack = [str(e["target"]) for e in edges if str(e["source"]) == START_NODE_ID]
    while stack:
        node_id = stack.pop()
        if node_id in reachable or node_id not in by_id:
            continue
        reachable.add(node_id)
        stack.extend(str(e["target"]) for e in outgoing.get(node_id, []))
    return reachable


def _unreachable_node_items(
    nodes: list[dict[str, Any]], reachable: set[str]
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for node in nodes:
        node_id = str(node["id"])
        # Notes are free-floating annotations: unreachable by design.
        if node_id not in reachable and node.get("type") != "noteNode":
            items.append({"what": f"unreachable block '{_label(node)}'", "where": node_id})
    return items


def _fan_items(
    reachable: set[str],
    by_id: dict[str, Any],
    outgoing: dict[str, list[dict[str, Any]]],
    incoming: dict[str, list[dict[str, Any]]],
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for node_id in sorted(reachable):
        plain_out = [e for e in outgoing.get(node_id, []) if not e.get("sourceHandle")]
        if len(plain_out) > 1:
            items.append(
                {"what": f"an unstructured branch at '{_label(by_id[node_id])}'", "where": node_id}
            )
        primary_in = [
            e
            for e in incoming.get(node_id, [])
            if not str(e.get("targetHandle") or "").startswith("ingress_")
        ]
        if len(primary_in) > 1:
            items.append(
                {"what": f"a cross-branch join at '{_label(by_id[node_id])}'", "where": node_id}
            )
    return items


def _dropped_walk_items(
    reachable: set[str], walked: set[str], by_id: dict[str, Any]
) -> list[dict[str, str]]:
    """Reachable blocks the walk never expressed: the verdict must name them."""
    return [
        {
            "what": f"block '{_label(by_id[node_id])}' missing from the recipe flow",
            "where": node_id,
        }
        for node_id in sorted(reachable - walked)
    ]


def _inexpressible_items(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]], walked: set[str]
) -> list[dict[str, str]]:
    by_id = {str(node["id"]): node for node in nodes}
    outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)
    incoming: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        outgoing[str(edge["source"])].append(edge)
        incoming[str(edge["target"])].append(edge)

    reachable = _reachable_from_start(by_id, edges, outgoing)
    items = _unreachable_node_items(nodes, reachable)
    cycle_node = _find_cycle(by_id, outgoing)
    if cycle_node is not None:
        items.append({"what": "a cycle outside a loop construct", "where": cycle_node})
    items.extend(_fan_items(reachable, by_id, outgoing, incoming))
    items.extend(_dropped_walk_items(reachable, walked, by_id))
    return items


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------


def _floating_note_steps(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]], walker: _Walker
) -> list[dict[str, Any]]:
    """Free-floating canvas notes read back as trailing note steps."""
    wired = {str(edge["target"]) for edge in edges}
    steps: list[dict[str, Any]] = []
    for node in nodes:
        if node.get("type") != "noteNode" or str(node["id"]) in wired:
            continue
        data = node.get("data") or {}
        steps.append(walker._with_label({"note": dict(data.get("config") or {})}, data))
    return steps


def _decompile_variables(variables: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, stored in variables.items():
        if not isinstance(stored, dict):
            continue
        declaration = _readback_declaration(stored, "variable")
        var_type = declaration.get("type")
        if declaration.get("secret"):
            # Never surface a secret value; the author re-provides it on amend.
            result[name] = {"type": var_type, "secret": True}
        elif declaration.get("isExpression"):
            result[name] = {"type": var_type, "expr": declaration.get("value")}
        elif declaration.get("isTemplate"):
            result[name] = {"type": var_type, "template": declaration.get("value")}
        elif "value" in declaration:
            result[name] = {"type": var_type, "value": declaration["value"]}
            value = declaration["value"]
            if var_type in ("array", "map") and isinstance(value, list | dict) and value:
                result[name]["element_types"] = readback_element_types(
                    value, declaration.get("elementTypes")
                )
        else:
            # A type alone holds null, so the readback carries no value either.
            result[name] = {"type": var_type}
    return result


def decompile_test_data(test_data: dict[str, Any]) -> dict[str, Any]:
    """Readback a compiled test into a recipe plus an inexpressibility verdict."""
    workflow = test_data.get("workflow") or {}
    nodes = workflow.get("nodes") or []
    edges = workflow.get("edges") or []

    functions: dict[str, dict[str, Any]] = {}
    walker = _Walker(
        nodes, edges, load_block_catalog(), remote_execution_entry(), functions, _LibraryNames()
    )
    flow = walker.flow()
    flow.extend(_floating_note_steps(nodes, edges, walker))
    inexpressible = _inexpressible_items(nodes, edges, walker.visited)

    recipe: dict[str, Any] = {"test": {"name": str(test_data.get("name") or "Untitled Test")}}
    version = test_data.get("version")
    if version:
        # Amendment compares this against the stored test so a readback that has
        # been superseded cannot silently overwrite the newer content.
        recipe["test"]["version"] = str(version)
    description = test_data.get("description")
    if description:
        recipe["test"]["description"] = description
    tags = (test_data.get("metadata") or {}).get("tags") or []
    if tags:
        recipe["test"]["tags"] = list(tags)
    variables = _decompile_variables(test_data.get("variables") or {})
    if variables:
        recipe["variables"] = variables
    if functions:
        recipe["functions"] = list(functions.values())
    recipe["flow"] = flow

    recipe_yaml = dump_exact_yaml(recipe)
    return {
        "recipe": recipe_yaml,
        "expressible": not inexpressible,
        "inexpressible": inexpressible,
    }
