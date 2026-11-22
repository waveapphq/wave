"""Canvas -> recipe readback: invert the compiler, flag inexpressible wiring and settings."""

from collections import defaultdict
from collections.abc import Mapping
from typing import Any

from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.typed_numbers import block_numbers
from wavecore.controls.note import edgeless_notes
from wavecore.core.execution.row_checks import BRANCH_KEYS, LANE_KEYS
from wavecore.core.functions.declarations import DeclarationKind, declaration_numbers
from wavecore.core.layout.engine import (
    START_NODE_ID,
    _is_section_handle,
    _section_sort_key,
)
from wavecore.core.recipes.model import CONDITION_MARKERS, CONTROL_STEP_KEYWORDS, readback_keys
from wavecore.core.recipes.typed_elements import readback_element_types
from wavecore.core.recipes.validator import (
    BlockEntry,
    is_template_value,
    load_block_catalog,
    remote_execution_entry,
    step_outputs,
    value_form,
)
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.sealing import setter_secret_target
from wavecore.core.utf8_text import dump_exact_yaml
from wavecore.core.variables.declared_types import types_of_declarations, types_of_function
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
_LOOP_ELEMENTS = frozenset({"for", "for-each", "while"})
_SUGAR_KEYWORD = {
    "delay": "delay",
    "halt": "halt",
    "break": "break",
    "continue": "continue",
}
# Stored fields a construct's own shape carries; every other field goes through the table.
_SHAPE_FIELDS = frozenset(
    {"branches", "conditions", "assertions", "variables", "target_loop"}
    | {"enable_catch", "enable_finally"}
)
_SETTER_PLACE = "variables"

_Losses = list[dict[str, str]]


def _label(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("label") or node.get("id") or "")


def _identity(data: Mapping[str, Any]) -> dict[str, Any]:
    """A Block's description and disabled mark, when it has them."""
    identity: dict[str, Any] = {}
    if data.get("description"):
        identity["description"] = data["description"]
    if data.get("disabled") is True:
        identity["disabled"] = True
    return identity


def _is_form_shaped(value: Any) -> bool:
    """A map whose only key is `expr`, `template` or `literal`."""
    return isinstance(value, dict) and value_form(value)[0] != "plain"


def _plain_readback(value: Any, *, template_place: bool) -> Any:
    """Plain stored data in the shortest form that compiles back to itself."""
    if template_place and is_template_value(value):
        return {"literal": value}
    if _is_form_shaped(value):
        return {"literal": value}
    if isinstance(value, dict):
        return {key: _plain_readback(item, template_place=False) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain_readback(item, template_place=False) for item in value]
    return value


def _readback_value(value: Any, kind: str, *, template_place: bool) -> Any:
    """One stored value in its recipe form for the mode it holds (REQ-5.2.7.6)."""
    if kind == "expr":
        return {"expr": value}
    if kind == "template":
        return value if is_template_value(value) else {"template": value}
    return _plain_readback(value, template_place=template_place)


def _address(value: Any, path: str) -> bool:
    """Whether a dotted place below a stored value names something the value holds."""
    if isinstance(value, dict):
        if path in value:
            return True
        head, dot, rest = path.partition(".")
        return bool(dot) and head in value and _address(value[head], rest)
    if isinstance(value, list):
        head, dot, rest = path.partition(".")
        if not head.isdigit() or int(head) >= len(value):
            return False
        return not dot or _address(value[int(head)], rest)
    return False


class _Flags:
    """A Block's expression and template marks, each consumed once the readback writes it."""

    def __init__(self, data: Mapping[str, Any]) -> None:
        self.marks = {
            "expr": [str(place) for place in data.get("expressionFields") or []],
            "template": [str(place) for place in data.get("templateFields") or []],
        }
        self.placed: set[tuple[str, str]] = set()

    def sources(self) -> set[str]:
        """Every Expression and Template place, read or not."""
        return {place for places in self.marks.values() for place in places}

    def kind(self, place: str, *, template: bool = True) -> str:
        """The mode the Block holds at ``place``; reading it consumes the mark."""
        for kind, places in self.marks.items():
            if place in places and (template or kind == "expr"):
                self.placed.add((kind, place))
                return kind
        return "plain"

    def consume_under(self, head: str) -> None:
        """Marks at and below a place whose value the readback leaves out on purpose."""
        for kind, places in self.marks.items():
            for place in places:
                if place == head or place.startswith(f"{head}."):
                    self.placed.add((kind, place))

    def losses(self, values: Mapping[str, Any], label: str, node_id: str) -> _Losses:
        """Each mark that addresses a stored value the readback could not mark."""
        found: _Losses = []
        for kind, places in self.marks.items():
            mode = "expression" if kind == "expr" else "template"
            for place in places:
                if (kind, place) in self.placed or not _address(values, place):
                    continue
                found.append(
                    {"what": f"the {mode} mode of '{place}' in block '{label}'", "where": node_id}
                )
        return found


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
    entry: BlockEntry | None, values: dict[str, Any], stored: Any, flags: _Flags
) -> list[str] | None:
    """A block's stored Secret outputs, None when absent or equal to its schema's (K8SCON-4)."""
    if entry is None or not isinstance(stored, list):
        return None
    known = step_outputs(entry, values, flags.sources()).outputs
    marked = [name for name in stored if name in known]
    return None if set(marked) == set(entry.secret_outputs) else marked


def _secret_setter_row(place: str, value: Any, flags: _Flags) -> Any:
    """A secret Setter row reads back without its value."""
    kind = flags.kind(place)
    flags.consume_under(place)
    if kind == "plain" or is_secret_envelope(value):
        return None
    return _readback_value(value, kind, template_place=True)


def _fill_if_branch(
    target: dict[str, Any],
    label_key: str,
    label: Any,
    when: Any,
    steps_key: str,
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """An If branch's label when it has one, its condition when it has one, then its steps."""
    if label:
        target[label_key] = label
    if when is not None:
        target["when"] = when
    target[steps_key] = steps
    return target


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
        *,
        declared_types: Mapping[str, str],
        losses: _Losses,
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
        self.declared_types = declared_types
        self.losses = losses
        self.visited: set[str] = set()
        # Each enclosing loop's node id and its label, else its block name.
        self.loop_stack: list[tuple[str, str]] = []

    # Graph walk

    def flow(self) -> list[dict[str, Any]]:
        starts = [str(e["target"]) for e in self.edges if str(e["source"]) == START_NODE_ID]
        head = starts[0] if starts else None
        steps, _exit = self._walk(head)
        return steps

    def side_notes(self) -> list[dict[str, Any]]:
        """The note steps of the Notes beside the flow, the ones with no connection at all."""
        return [self._leaf(node, "note") for node in edgeless_notes(self.nodes, self.edges)]

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
        loop = elem in _LOOP_ELEMENTS
        if loop:
            data = node.get("data") or {}
            name = self._custom_label(data) or self._default_name(elem)
            self.loop_stack.append((str(node.get("id") or ""), name))
        section_steps: dict[str, list[dict[str, Any]]] = {}
        for edge in section:
            sub, _sub_exit = self._walk_section(edge)
            section_steps[str(edge["sourceHandle"])] = sub
        if loop:
            self.loop_stack.pop()
        exit_target = str(then_edge["target"]) if then_edge is not None else None
        return self._build_then_step(elem, node, section_steps), exit_target

    # Field-loss report

    def _lose(self, node: dict[str, Any], what: str) -> None:
        self.losses.append({"what": what, "where": str(node.get("id") or "")})

    def _settle(self, node: dict[str, Any], flags: _Flags, values: Mapping[str, Any]) -> None:
        """Report each mark of the Block the readback could not write."""
        self.losses.extend(flags.losses(values, _label(node), str(node.get("id") or "")))

    def _control_settings(
        self, node: dict[str, Any], elem: str, values: dict[str, Any], flags: _Flags
    ) -> dict[str, Any]:
        """A control's own settings in their recipe form (REQ-5.2.7.6)."""
        entry = self.catalog.get(elem)
        declared = set(entry.parameters) if entry is not None else set(values)
        settings: dict[str, Any] = {}
        for name, value in values.items():
            if name not in declared:
                self._lose(node, f"setting '{name}' of block '{_label(node)}'")
                flags.consume_under(name)
            elif name not in _SHAPE_FIELDS:
                settings[name] = _readback_value(value, flags.kind(name), template_place=True)
        return settings

    def _construct_fields(
        self, node: dict[str, Any], elem: str, values: dict[str, Any], flags: _Flags
    ) -> dict[str, Any]:
        """A construct's settings as recipe keys, read back through the control field table."""
        settings = self._control_settings(node, elem, values, flags)
        return dict(readback_keys(CONTROL_STEP_KEYWORDS[elem], settings))

    # Leaf steps

    def _values(self, data: dict[str, Any]) -> dict[str, Any]:
        """A Block's values, digit text in each number place read back as that number."""
        values = (data.get("config") or {}).get("values")
        if not isinstance(values, dict):
            return {}
        return block_numbers(data, text_as_number, self.declared_types)

    def _leaf(self, node: dict[str, Any], elem: str) -> dict[str, Any]:
        data = node.get("data") or {}
        config = data.get("config") or {}
        values = self._values(data)
        flags = _Flags(data)
        if elem == "variable-setter":
            step = self._decompile_setter(node, values, flags)
        elif elem == "function":
            step = self._decompile_function_block(node, config, values, flags)
        elif elem == "assert":
            assertion = self._assert_value(node, values, flags, {})
            step = {"assert": self._with_identity(assertion, data, config)}
        elif elem == "note":
            step = self._decompile_note(node, values, flags)
        elif elem in _SUGAR_KEYWORD:
            sugar = {_SUGAR_KEYWORD[elem]: self._decompile_sugar(node, elem, values, flags)}
            step = self._with_identity(sugar, data)
        else:
            step = self._decompile_block(data, config, values, elem, flags)
        self._settle(node, flags, values)
        return step

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
        """A step with the Block's own label, when it has one."""
        label = self._custom_label(data)
        return step if label is None else {**step, "label": label}

    def _with_identity(
        self,
        step: dict[str, Any],
        data: dict[str, Any],
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """A step or construct mapping with the Block's own label."""
        result = dict(step)
        label = self._custom_label(data)
        if label is not None:
            result["label"] = label
        result.update(_identity(data))
        capture = dict((config or {}).get("outputBindings") or {})
        if capture:
            result["capture"] = capture
        return result

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
        flags: _Flags,
    ) -> dict[str, Any]:
        step: dict[str, Any] = self._with_identity({"block": elem}, data)
        entry = self.catalog.get(elem)
        settings = self._decompile_settings(values, flags, self._secret_settings(entry))
        if settings:
            step["settings"] = settings
        capture = dict(config.get("outputBindings") or {})
        if capture:
            step["capture"] = capture
        marked = _block_secret_outputs(entry, values, config.get("outputSecretFields"), flags)
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

    def _setter_row(self, row: str, value: Any, flags: _Flags) -> Any:
        """One Setter row in the value forms it compiles from (REQ-3.4.1.14)."""
        place = f"{_SETTER_PLACE}.{row}"
        kind = flags.kind(place)
        if kind != "plain" or not isinstance(value, dict | list):
            return _readback_value(value, kind, template_place=True)
        entries = list(value.items()) if isinstance(value, dict) else list(enumerate(value))
        kinds = {key: flags.kind(f"{place}.{key}") for key, _item in entries}
        if isinstance(value, dict) and _is_form_shaped(value) and set(kinds.values()) == {"plain"}:
            return {"literal": value}
        read = [
            (key, _readback_value(item, kinds[key], template_place=True)) for key, item in entries
        ]
        return dict(read) if isinstance(value, dict) else [item for _key, item in read]

    def _decompile_setter(
        self, node: dict[str, Any], values: dict[str, Any], flags: _Flags
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        target = setter_secret_target(node)
        secret_rows = target[1] if target is not None else []
        rows = values.get(_SETTER_PLACE)
        rows = rows if isinstance(rows, dict) else {}
        stored_types = data.get("elementTypes") or {}
        result: dict[str, Any] = {}
        element_types: dict[str, Any] = {}
        for row, value in rows.items():
            place = f"{_SETTER_PLACE}.{row}"
            if row in secret_rows:
                result[row] = _secret_setter_row(place, value, flags)
                continue
            result[row] = self._setter_row(row, value, flags)
            types = stored_types.get(place)
            if isinstance(types, dict | list) and isinstance(value, dict | list):
                element_types[row] = types
        step: dict[str, Any] = {"set": result}
        marked = [row for row in secret_rows if row in rows]
        if marked:
            step["secret_rows"] = marked
        if element_types:
            step["element_types"] = element_types
        return self._with_identity(step, data)

    def _jump_target(self, node: dict[str, Any], elem: str, values: dict[str, Any]) -> Any:
        """A Break / Continue target (REQ-3.5.1.2, REQ-3.5.1.3)."""
        target = str(values.get("target_loop") or "")
        ids = [node_id for node_id, _name in self.loop_stack]
        if target not in ids:
            self._lose(
                node,
                f"a {elem} aimed at a loop that does not enclose it, in block '{_label(node)}'",
            )
            return {}
        index = ids.index(target)
        if index == len(ids) - 1:
            return {}
        name = self.loop_stack[index][1]
        if any(nearer == name for _id, nearer in self.loop_stack[index + 1 :]):
            self._lose(
                node, f"a {elem} aimed past a loop of the same name, in block '{_label(node)}'"
            )
        return {"loop": name}

    def _decompile_sugar(
        self, node: dict[str, Any], elem: str, values: dict[str, Any], flags: _Flags
    ) -> Any:
        if elem in ("break", "continue"):
            self._control_settings(node, elem, values, flags)
            return self._jump_target(node, elem, values)
        settings = self._control_settings(node, elem, values, flags)
        fields = dict(readback_keys(CONTROL_STEP_KEYWORDS[elem], settings))
        duration = fields.get("duration")
        if elem == "delay" and set(fields) == {"duration"} and not isinstance(duration, dict):
            return duration
        return fields

    def _decompile_note(
        self, node: dict[str, Any], values: dict[str, Any], flags: _Flags
    ) -> dict[str, Any]:
        """A Note's text and color as stored; the settle reports a mode mark on it."""
        declared = self.catalog["note"].parameters
        for name in values:
            if name not in declared:
                self._lose(node, f"setting '{name}' of block '{_label(node)}'")
                flags.consume_under(name)
        data = node.get("data") or {}
        # A note step has no form for these; the canvas never sets them on a Note.
        identity = _identity(data)
        if "description" in identity:
            self._lose(node, f"the description of block '{_label(node)}'")
        if "disabled" in identity:
            self._lose(node, f"the disabled mark of block '{_label(node)}'")
        note = readback_keys(CONTROL_STEP_KEYWORDS["note"], values)
        return self._with_label({"note": note}, data)

    def _function_name(self, data: dict[str, Any]) -> str:
        """The name a Function step gives: the Function's own, never the Block's label."""
        label = str(data.get("label") or "")
        if data.get("functionLifecycle") == "local":
            local_def = data.get("localDefinition") or {}
            self._register_local(local_def)
            return str(local_def.get("name") or label)
        return self.library_names.get(str(data.get("functionId") or "")) or label

    def _decompile_function_block(
        self,
        node: dict[str, Any],
        config: dict[str, Any],
        values: dict[str, Any],
        flags: _Flags,
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        name = self._function_name(data)
        if data.get("editMode") and data.get("draft") is not None:
            self._lose(node, f"an unpublished edit of Function '{name}' in block '{_label(node)}'")
        step: dict[str, Any] = {"function": name}
        if data.get("functionLifecycle") != "local" and data.get("functionVersion"):
            step["version"] = data["functionVersion"]
        label = data.get("label")
        if label and str(label) != name:
            step["label"] = label
        step.update(_identity(data))
        secret_inputs = {
            str(field["name"]) for field in block_schema(data).fields if field.get("secret")
        }
        settings = self._decompile_settings(values, flags, secret_inputs)
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
            declared_types=types_of_function(local_def, every_input=True),
            losses=self.losses,
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
        notes = inner_walker.side_notes()
        if notes:
            self.functions[name]["notes"] = notes
        self.losses.extend(
            _inexpressible_items(inner_walker.nodes, inner_walker.edges, inner_walker.visited)
        )

    # Construct step builders

    def _build_rejoin_step(
        self, elem: str, node: dict[str, Any], branch_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        config = data.get("config") or {}
        values = self._values(data)
        flags = _Flags(data)
        if elem == "if-else":
            self._control_settings(node, elem, values, flags)
            step = {"if": self._with_identity(self._build_if(node, values, branch_steps), data)}
        else:
            built = self._assert_value(node, values, flags, branch_steps)
            step = {"assert": self._with_identity(built, data, config)}
        self._settle(node, flags, values)
        return step

    def _branch_losses(self, node: dict[str, Any], record: Any, allowed: frozenset[str]) -> None:
        if isinstance(record, dict):
            for key in record:
                if key not in allowed:
                    self._lose(node, f"key '{key}' of a branch in block '{_label(node)}'")

    def _branch_when(self, node: dict[str, Any], branch: dict[str, Any], index: int) -> Any:
        """A branch's conditions as one condition, or a list when it holds more."""
        place = f"branches.{index}.conditions"
        conditions = self._decompile_conditions(node, branch.get("conditions") or [], place)
        return conditions[0] if len(conditions) == 1 else conditions

    def _build_if(
        self,
        node: dict[str, Any],
        values: dict[str, Any],
        branch_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for index, branch in enumerate(values.get("branches") or []):
            self._branch_losses(node, branch, BRANCH_KEYS)
            handle = str(branch.get("id") or f"branch_{index}")
            steps = branch_steps.get(handle, [])
            btype = branch.get("type")
            label = branch.get("label")
            if btype == "else":
                _fill_if_branch(result, "else_label", label, None, "else", steps)
                continue
            when = self._branch_when(node, branch, index) if branch.get("conditions") else None
            if btype == "else_if":
                entry = _fill_if_branch({}, "label", label, when, "then", steps)
                result.setdefault("elif", []).append(entry)
            else:
                _fill_if_branch(result, "if_label", label, when, "then", steps)
        return result

    def _build_switch(
        self,
        node: dict[str, Any],
        values: dict[str, Any],
        section_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"cases": []}
        for index, branch in enumerate(values.get("branches") or []):
            self._branch_losses(node, branch, BRANCH_KEYS)
            handle = str(branch.get("id") or f"branch_{index}")
            steps = section_steps.get(handle, [])
            label = branch.get("label")
            if branch.get("type") == "default":
                if label:
                    result["default_label"] = label
                result["default"] = steps
                continue
            entry: dict[str, Any] = {"label": label} if label else {}
            if branch.get("conditions"):
                entry["when"] = self._branch_when(node, branch, index)
            entry["steps"] = steps
            # True is the compile default, so only an explicit False round-trips.
            if branch.get("break") is False:
                entry["break"] = False
            result["cases"].append(entry)
        return result

    def _build_parallel(
        self,
        node: dict[str, Any],
        values: dict[str, Any],
        flags: _Flags,
        section_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        branches: list[dict[str, Any]] = []
        for index, branch in enumerate(values.get("branches") or []):
            self._branch_losses(node, branch, LANE_KEYS)
            handle = str(branch.get("id") or f"branch_{index + 1}")
            entry: dict[str, Any] = {}
            # A blank name and an unset limit are the defaults, so both stay unwritten.
            if branch.get("name"):
                entry["name"] = branch["name"]
            if branch.get("time_limit") is not None:
                kind = flags.kind(f"branches.{index}.time_limit", template=False)
                entry["time_limit"] = _readback_value(
                    branch["time_limit"], kind, template_place=False
                )
            entry["steps"] = section_steps.get(handle, [])
            branches.append(entry)
        return {"branches": branches, **self._construct_fields(node, "parallel", values, flags)}

    def _assert_value(
        self,
        node: dict[str, Any],
        values: dict[str, Any],
        flags: _Flags,
        branch_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        """An Assert in both modes; `mode` is written only when the sections do not imply it."""
        result: dict[str, Any] = {
            "that": self._decompile_conditions(node, values.get("assertions") or [], "assertions")
        }
        fields = self._construct_fields(node, "assert", values, flags)
        mode = fields.pop("mode", None)
        if "pass" in branch_steps:
            result["on_pass"] = branch_steps["pass"]
        if "fail" in branch_steps:
            result["on_fail"] = branch_steps["fail"]
        if mode == "split" and not branch_steps:
            result["mode"] = mode
        return {**result, **fields}

    def _build_then_step(
        self, elem: str, node: dict[str, Any], section_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        data = node.get("data") or {}
        config = data.get("config") or {}
        values = self._values(data)
        flags = _Flags(data)
        body = section_steps.get("body", [])
        step: dict[str, Any]
        if elem == "switch-case":
            self._control_settings(node, elem, values, flags)
            built = self._build_switch(node, values, section_steps)
            step = {"switch": self._with_identity(built, data)}
        elif elem == "parallel":
            built = self._build_parallel(node, values, flags, section_steps)
            step = {"parallel": self._with_identity(built, data)}
        elif elem == "try-catch-finally":
            self._control_settings(node, elem, values, flags)
            built = self._build_try(values, section_steps)
            step = {"try": self._with_identity(built, data, config)}
        elif elem == "remote-execution":
            built = self._build_remote(values, flags, body, config)
            step = {"remote": self._with_identity(built, data, config)}
        elif elem == "wait-until":
            built = self._wait_until_value(node, values, flags, section_steps)
            step = {"wait_until": self._with_identity(built, data, config)}
        else:
            built = self._build_loop(node, elem, values, flags, body)
            step = {CONTROL_STEP_KEYWORDS[elem]: self._with_identity(built, data, config)}
        self._settle(node, flags, values)
        return step

    def _wait_until_value(
        self,
        node: dict[str, Any],
        values: dict[str, Any],
        flags: _Flags,
        section_steps: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            # `that` is Assert's vocabulary: always a list, at any length.
            "that": self._decompile_conditions(node, values.get("conditions") or [], "conditions"),
            **self._construct_fields(node, "wait-until", values, flags),
        }
        if values.get("mode") != "watch":
            result["retry"] = section_steps.get("retry", [])
        return result

    def _build_loop(
        self,
        node: dict[str, Any],
        elem: str,
        values: dict[str, Any],
        flags: _Flags,
        body: list[dict[str, Any]],
    ) -> dict[str, Any]:
        result = self._construct_fields(node, elem, values, flags)
        if elem == "while":
            conditions = self._decompile_conditions(
                node, values.get("conditions") or [], "conditions"
            )
            result = {
                "conditions": conditions[0] if len(conditions) == 1 else conditions,
                **result,
            }
        result["body"] = body
        return result

    @staticmethod
    def _build_try(
        values: dict[str, Any], section_steps: dict[str, list[dict[str, Any]]]
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"steps": section_steps.get("try", [])}
        if values.get("enable_catch"):
            result["catch"] = section_steps.get("catch", [])
        if values.get("enable_finally"):
            result["finally"] = section_steps.get("finally", [])
        return result

    def _build_remote(
        self,
        values: dict[str, Any],
        flags: _Flags,
        body: list[dict[str, Any]],
        config: dict[str, Any],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        settings = self._decompile_settings(values, flags, self._secret_settings(self.remote_entry))
        if settings:
            result["settings"] = settings
        profiles = self._decompile_profiles(config.get("profileBindings") or [])
        if profiles:
            result["profiles"] = profiles
        result["body"] = body
        return result

    # Value inversion

    def _setting_entries(self, name: str, value: Any, flags: _Flags) -> Any:
        """A plain setting whose first-level entries and row fields may each hold an expression."""
        if not isinstance(value, dict | list):
            return _plain_readback(value, template_place=True)
        if isinstance(value, dict):
            kinds = {key: flags.kind(f"{name}.{key}", template=False) for key in value}
            if _is_form_shaped(value) and set(kinds.values()) == {"plain"}:
                return {"literal": value}
            return {
                key: _readback_value(item, kinds[key], template_place=False)
                for key, item in value.items()
            }
        items: list[Any] = []
        for index, item in enumerate(value):
            kind = flags.kind(f"{name}.{index}", template=False)
            if kind == "plain" and isinstance(item, dict) and not _is_form_shaped(item):
                fields = {key: flags.kind(f"{name}.{index}.{key}", template=False) for key in item}
                items.append(
                    {
                        key: _readback_value(field, fields[key], template_place=False)
                        for key, field in item.items()
                    }
                )
            else:
                items.append(_readback_value(item, kind, template_place=False))
        return items

    def _decompile_settings(
        self, values: dict[str, Any], flags: _Flags, secret_names: set[str]
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for name, value in values.items():
            kind = flags.kind(name)
            # A secret written as an expression names a variable, so only a literal one stays out.
            if kind == "plain" and name in secret_names:
                flags.consume_under(name)
            elif kind != "plain":
                result[name] = _readback_value(value, kind, template_place=True)
            else:
                result[name] = self._setting_entries(name, value, flags)
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

    def _decompile_comparison(self, item: dict[str, Any]) -> dict[str, Any]:
        condition: dict[str, Any] = {
            "variable": item.get("variable"),
            "operator": item.get("operator"),
        }
        value = item.get("reference_value")
        # A null value is left out; the read values hold none for an operator that takes none.
        if value is not None:
            kind = "plain"
            if item.get("reference_is_expression"):
                kind = "expr"
            elif item.get("reference_is_template"):
                kind = "template"
            condition["value"] = _readback_value(value, kind, template_place=True)
        if item.get("value_type"):
            condition["value_type"] = item["value_type"]
        return condition

    def _decompile_condition(self, node: dict[str, Any], item: Any, place: str, index: int) -> Any:
        """One condition item of the list at ``place``."""
        item_type = item.get("type") if isinstance(item, dict) else None
        if item_type == "expression":
            text = item.get("expression")
            if text in CONDITION_MARKERS:
                self._lose_item(node, "expression", place)
            return text
        if item_type == "literal":
            return self._decompile_comparison(item)
        if item_type == "group":
            items = item.get("items") or []
            return {"group": self._decompile_conditions(node, items, f"{place}.{index}.items")}
        self._lose_item(node, str(item_type), place)
        return item

    def _lose_item(self, node: dict[str, Any], item_type: str, place: str) -> None:
        self._lose(
            node,
            f"a condition item of type '{item_type}' in '{place}' of block '{_label(node)}'",
        )

    def _decompile_conditions(
        self, node: dict[str, Any], items: list[Any], place: str
    ) -> list[Any]:
        """A stored condition list in its recipe form."""
        written: list[Any] = []
        joined = True
        for index, item in enumerate(items):
            if isinstance(item, dict) and item.get("type") == "operator":
                marker = item.get("value")
                if joined or marker not in CONDITION_MARKERS or index == len(items) - 1:
                    self._lose_joins(node, place)
                elif marker == "or":
                    written.append("or")
                joined = True
                continue
            if not joined:
                self._lose_joins(node, place)
            written.append(self._decompile_condition(node, item, place, index))
            joined = False
        return written

    def _lose_joins(self, node: dict[str, Any], place: str) -> None:
        what = (
            f"a condition list in '{place}' of block '{_label(node)}' whose items are not "
            "joined by and / or"
        )
        where = str(node.get("id") or "")
        if {"what": what, "where": where} not in self.losses:
            self._lose(node, what)


# Inexpressibility predicate (near-tree)


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
    nodes: list[dict[str, Any]], reachable: set[str], beside: set[str]
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for node in nodes:
        node_id = str(node["id"])
        if node_id not in reachable and node_id not in beside:
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
    beside = {str(node["id"]) for node in edgeless_notes(nodes, edges)}
    items = _unreachable_node_items(nodes, reachable, beside)
    cycle_node = _find_cycle(by_id, outgoing)
    if cycle_node is not None:
        items.append({"what": "a cycle outside a loop construct", "where": cycle_node})
    items.extend(_fan_items(reachable, by_id, outgoing, incoming))
    items.extend(_dropped_walk_items(reachable, walked, by_id))
    return items


# Public entry


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
    losses: _Losses = []
    walker = _Walker(
        nodes,
        edges,
        load_block_catalog(),
        remote_execution_entry(),
        functions,
        _LibraryNames(),
        declared_types=types_of_declarations(test_data.get("variables") or {}),
        losses=losses,
    )
    flow = walker.flow()
    notes = walker.side_notes()
    inexpressible = [*_inexpressible_items(nodes, edges, walker.visited), *losses]

    recipe: dict[str, Any] = {"test": {"name": str(test_data.get("name") or "Untitled Test")}}
    version = test_data.get("version")
    if version:
        # Amend compares this with the stored test so a stale readback cannot overwrite it.
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
    if notes:
        recipe["notes"] = notes

    recipe_yaml = dump_exact_yaml(recipe)
    return {
        "recipe": recipe_yaml,
        "expressible": not inexpressible,
        "inexpressible": inexpressible,
    }
