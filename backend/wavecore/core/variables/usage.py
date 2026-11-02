"""Who reads and who writes a variable name, one walker for every caller (REQ-3.1.2.7)."""

import ast
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from wavecore.core.expressions.template import extract_template_names, template_expressions
from wavecore.core.variables.computed import extract_expression_names
from wavecore.models.plugins import get_param_attr

_SETTER = "variable-setter"
_CONDITION_LISTS = ("assertions", "conditions")
_VALUES = ("config", "values")
# A CSV / Excel filter condition tests the cell under it, bound as `_cell`; it is not a variable.
_FILTER_CELL = frozenset({"_cell"})


class SiteKind(StrEnum):
    """How a site's text names variables."""

    EXPRESSION = "expression"
    TEMPLATE = "template"
    NAME = "name"
    OUTPUT_BINDING = "output_binding"
    SETTER_TARGET = "setter_target"


_WRITE_KINDS = frozenset({SiteKind.OUTPUT_BINDING, SiteKind.SETTER_TARGET})


@dataclass(frozen=True)
class NameSite:
    """One block setting that names variables: its path from the block's ``data``, kind and text."""

    node_id: str
    path: tuple[str, ...]
    kind: SiteKind
    text: str
    bound: frozenset[str] = frozenset()

    @property
    def setting(self) -> str:
        """The setting's name: a values path (``headers.X``), an output or an input name."""
        return ".".join(self.path[2:] if self.path[0] == "config" else self.path[1:])

    @property
    def writes(self) -> bool:
        return self.kind in _WRITE_KINDS

    def namespace_names(self, namespace: str) -> set[str]:
        """The names the text reads off one namespace: ``system.<name>`` or ``system['<name>']``."""
        if self.kind == SiteKind.EXPRESSION:
            return _attribute_reads(self.text, namespace)
        if self.kind == SiteKind.TEMPLATE:
            pieces = template_expressions(self.text)
            return {name for piece in pieces for name in _attribute_reads(piece, namespace)}
        prefix = f"{namespace}."
        return {self.text.removeprefix(prefix)} if self.text.startswith(prefix) else set()

    @property
    def names(self) -> set[str]:
        """The names the text reads or writes; a name inside a string literal is none."""
        if self.kind == SiteKind.EXPRESSION:
            found = extract_expression_names(self.text)
        elif self.kind == SiteKind.TEMPLATE:
            found = extract_template_names(self.text)
        else:
            found = {self.text} if self.text else set()
        return found - self.bound


def _namespace_attribute(node: ast.AST, namespace: str) -> str | None:
    """The name one AST node reads off ``namespace``, by attribute or by string key."""
    if not isinstance(node, ast.Attribute | ast.Subscript):
        return None
    if not (isinstance(node.value, ast.Name) and node.value.id == namespace):
        return None
    if isinstance(node, ast.Attribute):
        return node.attr
    key = node.slice
    return key.value if isinstance(key, ast.Constant) and isinstance(key.value, str) else None


def _attribute_reads(expression: str, namespace: str) -> set[str]:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return set()
    found = (_namespace_attribute(node, namespace) for node in ast.walk(tree))
    return {name for name in found if name}


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _data(node: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(node.get("data"))


def _config(node: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(_data(node).get("config"))


def _expression_names(text: Any) -> set[str]:
    return extract_expression_names(text) if isinstance(text, str) else set()


def _template_names(text: Any) -> set[str]:
    return extract_template_names(text) if isinstance(text, str) else set()


def node_output_bindings(node: Mapping[str, Any]) -> dict[str, str]:
    """A block's output bindings: each output to the variable it writes."""
    bindings = _mapping(_config(node).get("outputBindings"))
    return {
        str(output): target
        for output, target in bindings.items()
        if isinstance(target, str) and target
    }


def _field_lookup(values: Any, field_name: str) -> tuple[tuple[str, ...], str] | None:
    """The path and text of a dotted setting name, when it holds text."""
    parts = tuple(str(field_name).split("."))
    current = values
    for part in parts:
        if isinstance(current, Mapping) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return (parts, current) if isinstance(current, str) else None


def field_text(values: Any, field_name: str) -> str | None:
    """The author-written text at a dotted setting name (``map.key``, ``list.0.field``)."""
    found = _field_lookup(values, field_name)
    return found[1] if found else None


def _parameter_schema(data: Mapping[str, Any]) -> list[Any]:
    """The catalog parameters of a block's control or plugin; none when it is unknown."""
    from wavecore.models.enums import ControlId

    element_type = str(data.get("elementType") or "")
    version = str(data.get("version") or "1.0.0")
    try:
        control_id = ControlId(element_type)
    except ValueError:
        control_id = None
    if control_id is not None:
        from wavecore.controls.registry import get_control_implementation

        control = get_control_implementation(control_id, version)
        return list(control().metadata.get("parameter_schema") or []) if control else []
    if data.get("nodeType") == "control":
        return []
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(element_type, version)
    return list(plugin.metadata.get("parameters") or []) if plugin else []


def reference_settings(data: Mapping[str, Any]) -> set[str]:
    """The settings whose text names a variable (``variable_ref``), read like expressions."""
    return {
        str(get_param_attr(param, "name"))
        for param in _parameter_schema(data)
        if get_param_attr(param, "variable_ref", False) and get_param_attr(param, "name")
    }


class _SiteWalk:
    """The name sites of one block, in a fixed order: condition rows, settings, bindings."""

    def __init__(self, node: Mapping[str, Any]) -> None:
        self.node = node
        self.node_id = str(node.get("id", ""))
        self.data = _data(node)
        self.config = _config(node)
        self.values = _mapping(self.config.get("values"))

    def site(
        self, path: tuple[str, ...], kind: SiteKind, text: Any, bound: frozenset[str] = frozenset()
    ) -> Iterator[NameSite]:
        if isinstance(text, str) and text and not (kind == SiteKind.NAME and text in bound):
            yield NameSite(self.node_id, path, kind, text, bound)

    def conditions(
        self, items: Any, path: tuple[str, ...], bound: frozenset[str] = frozenset()
    ) -> Iterator[NameSite]:
        """Condition rows and nested groups; a compare-to value reads only as an expression."""
        for index, item in enumerate(items if isinstance(items, list) else []):
            row = _mapping(item)
            at = (*path, str(index))
            kind = row.get("type")
            if kind == "group":
                yield from self.conditions(row.get("items"), (*at, "items"), bound)
            elif kind == "expression":
                yield from self.site(
                    (*at, "expression"), SiteKind.EXPRESSION, row.get("expression"), bound
                )
            elif kind == "literal":
                yield from self.site((*at, "variable"), SiteKind.NAME, row.get("variable"), bound)
                if row.get("reference_is_expression"):
                    yield from self.site(
                        (*at, "reference_value"),
                        SiteKind.EXPRESSION,
                        row.get("reference_value"),
                        bound,
                    )

    def checks(self) -> Iterator[NameSite]:
        """Condition rows of Assert, If/Else, Switch, While, Wait Until and table filters."""
        for key in _CONDITION_LISTS:
            yield from self.conditions(self.values.get(key), (*_VALUES, key))
        branches = self.values.get("branches")
        for index, branch in enumerate(branches if isinstance(branches, list) else []):
            path = (*_VALUES, "branches", str(index), "conditions")
            yield from self.conditions(_mapping(branch).get("conditions"), path)
        filters = self.values.get("filters")
        for index, row in enumerate(filters if isinstance(filters, list) else []):
            path = (*_VALUES, "filters", str(index), "conditions")
            yield from self.conditions(_mapping(row).get("conditions"), path, _FILTER_CELL)

    def fields(self, names: Any, kind: SiteKind) -> Iterator[NameSite]:
        for name in names or []:
            found = _field_lookup(self.values, name)
            if found is not None:
                yield from self.site((*_VALUES, *found[0]), kind, found[1])

    def settings(self) -> Iterator[NameSite]:
        """Expression, reference and template settings, and Variable Setter value rows."""
        declared = list(self.data.get("expressionFields") or [])
        references = sorted(reference_settings(self.data) - set(declared))
        yield from self.fields([*declared, *references], SiteKind.EXPRESSION)
        yield from self.fields(self.data.get("templateFields"), SiteKind.TEMPLATE)
        rows = _mapping(self.values.get("variables"))
        for keys, kind in (
            (self.data.get("variableExpressionKeys"), SiteKind.EXPRESSION),
            (self.data.get("variableTemplateKeys"), SiteKind.TEMPLATE),
        ):
            for key in keys or []:
                yield from self.site((*_VALUES, "variables", str(key)), kind, rows.get(key))

    def bindings(self) -> Iterator[NameSite]:
        """Output binding and Variable Setter targets write."""
        for output, target in node_output_bindings(self.node).items():
            binding = ("config", "outputBindings", output)
            yield NameSite(self.node_id, binding, SiteKind.OUTPUT_BINDING, target)
        if self.data.get("elementType") == _SETTER:
            for name in _mapping(self.values.get("variables")):
                row = (*_VALUES, "variables", str(name))
                yield NameSite(self.node_id, row, SiteKind.SETTER_TARGET, str(name))

    def all(self) -> Iterator[NameSite]:
        yield from self.checks()
        if self.values:
            yield from self.settings()
        yield from self.bindings()


def block_sites(node: Mapping[str, Any]) -> Iterator[NameSite]:
    """Every setting of one block that reads or writes variable names (REQ-3.1.2.7)."""
    yield from _SiteWalk(node).all()


def block_write_sites(node: Mapping[str, Any]) -> Iterator[NameSite]:
    """One block's output binding targets and Variable Setter targets."""
    return (site for site in _SiteWalk(node).bindings() if site.writes)


def block_reads(node: Mapping[str, Any]) -> set[str]:
    """The names one block reads; a name inside a string literal is not a read."""
    return {name for site in block_sites(node) if not site.writes for name in site.names}


def block_namespace_reads(node: Mapping[str, Any], namespace: str) -> set[str]:
    """The names one block reads off a namespace, such as the System variables it uses."""
    return {
        name
        for site in block_sites(node)
        if not site.writes
        for name in site.namespace_names(namespace)
    }


def block_writes(node: Mapping[str, Any]) -> set[str]:
    """The names one block writes: its output binding targets and Variable Setter targets."""
    return {site.text for site in block_write_sites(node)}


def scope_blocks(
    workflow: Mapping[str, Any], *, include_muted: bool = False
) -> Iterator[Mapping[str, Any]]:
    """Every block of one scope, containers included, never a nested Function's body."""
    nodes = _mapping(workflow).get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        if isinstance(node, Mapping) and (include_muted or not _data(node).get("disabled")):
            yield node


def _declarations(function_def: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    items = function_def.get(key)
    return [item for item in items if isinstance(item, Mapping)] if isinstance(items, list) else []


def _declared_names(function_def: Mapping[str, Any], key: str) -> list[str]:
    return [
        name
        for item in _declarations(function_def, key)
        if isinstance(name := item.get("name"), str) and name
    ]


def _computed_reads(declaration: Mapping[str, Any], source_key: str) -> set[str] | None:
    """The names an Expression / Template declaration's source reads; None for a plain one."""
    source = declaration.get(source_key)
    if declaration.get("isExpression"):
        return _expression_names(source)
    if declaration.get("isTemplate"):
        return _template_names(source)
    return None


def computed_declarations(function_def: Mapping[str, Any]) -> dict[str, set[str]]:
    """Each Expression / Template output, then local variable, with the names it reads."""
    computed: dict[str, set[str]] = {}
    for key, source_key in (("outputs", "default"), ("variables", "value")):
        for declaration in _declarations(function_def, key):
            name = declaration.get("name")
            reads = _computed_reads(declaration, source_key)
            if isinstance(name, str) and name and reads is not None:
                computed[name] = reads
    return computed


def sources_graph(
    expressions: Mapping[str, Any], templates: Mapping[str, Any]
) -> dict[str, set[str]]:
    """Each Expression, then Template, source with the names it reads."""
    graph = {name: _expression_names(source) for name, source in expressions.items()}
    graph.update({name: _template_names(source) for name, source in templates.items()})
    return graph


def _loop_back(graph: Mapping[str, set[str]], start: str) -> list[str] | None:
    """The names from ``start`` along a path that reads ``start`` again, or None."""
    pending = [[start]]
    seen = {start}
    while pending:
        path = pending.pop()
        for read in sorted(graph.get(path[-1], ())):
            if read == start:
                return path
            if read in graph and read not in seen:
                seen.add(read)
                pending.append([*path, read])
    return None


def closed_loop(loop: Sequence[str]) -> list[str]:
    """The names of one loop from its smallest name round to it again."""
    first = loop.index(min(loop))
    ordered = [*loop[first:], *loop[:first]]
    return [*ordered, ordered[0]]


def cycle_path(graph: Mapping[str, set[str]]) -> list[str] | None:
    """The first loop among computed names, from its smallest name round to it again."""
    for name in graph:
        loop = _loop_back(graph, name)
        if loop is not None:
            return closed_loop(loop)
    return None


def cycle_message(path: Sequence[str]) -> str:
    """The one message of a loop among computed variables."""
    return f"Circular reference detected for variable '{path[0]}': {' -> '.join(path)}"


def function_reads(function_def: Mapping[str, Any]) -> set[str]:
    """Names read by the Function's unmuted blocks and its computed locals and outputs."""
    names: set[str] = set()
    for node in scope_blocks(_mapping(function_def.get("workflow"))):
        names.update(block_reads(node))
    for reads in computed_declarations(function_def).values():
        names.update(reads)
    return names


def function_writes(function_def: Mapping[str, Any]) -> set[str]:
    """Names written by the Function's unmuted blocks, plus every computed output."""
    names: set[str] = set()
    for node in scope_blocks(_mapping(function_def.get("workflow"))):
        names.update(block_writes(node))
    for output in _declarations(function_def, "outputs"):
        name = output.get("name")
        if isinstance(name, str) and name and _computed_reads(output, "default") is not None:
            names.add(name)
    return names


def unused_inputs(function_def: Mapping[str, Any]) -> list[str]:
    """Declared inputs no block reads, in declaration order."""
    read = function_reads(function_def)
    return [name for name in _declared_names(function_def, "inputs") if name not in read]


def unwritten_outputs(function_def: Mapping[str, Any]) -> list[str]:
    """Declared outputs no block writes, in declaration order; a default is not a write."""
    written = function_writes(function_def)
    return [name for name in _declared_names(function_def, "outputs") if name not in written]
