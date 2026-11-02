"""The module walk every vendorability guard shares (REQ-3.4.1.3, REQ-5.1.4).

Code carried to a remote host runs there verbatim under the oldest interpreter the runner
accepts, with nothing installed beside it. A guard walks one package root, lists its modules,
resolves each import to the absolute names it could mean, tells whether an import sits behind
a guard, and judges the whole against an allow-list of names the package may import.
"""

import ast
import importlib.util
import sys
from pathlib import Path
from typing import NamedTuple

from wavecore.core.remote_exec.runner import REMOTE_PYTHON_FLOOR

FLOOR_NAME = f"Python {REMOTE_PYTHON_FLOOR[0]}.{REMOTE_PYTHON_FLOOR[1]}"

# Stdlib the host's floor interpreter has no answer for; each one is real 3.11+ or 3.12.
POST_FLOOR_NAMES = frozenset(
    {
        "asyncio.TaskGroup",
        "asyncio.timeout",
        "datetime.UTC",
        "enum.StrEnum",
        "hashlib.file_digest",
        "itertools.batched",
        "tomllib",
        "typing.Self",
        "typing.override",
    }
)

# The guards an import can sit behind; an unguarded import runs whenever its module loads.
TRY = "try"
TYPE_CHECKING = "type-checking"
VERSION = "version"
FUNCTION = "function"

_IMPORT_ERRORS = frozenset({"ImportError", "ModuleNotFoundError"})


class ImportSite(NamedTuple):
    """One import statement's target: the module it names, the names it could mean, its guards."""

    module: str
    names: frozenset[str]
    guards: frozenset[str]
    line: int

    @property
    def root(self) -> str:
        return self.module.split(".")[0]


def matches(name: str, prefix: str) -> bool:
    """Whether a dotted name is the prefix itself or lives under it."""
    return name == prefix or name.startswith(f"{prefix}.")


def is_stdlib(names: frozenset[str] | set[str]) -> bool:
    return any(name.split(".")[0] in sys.stdlib_module_names for name in names)


def installed_root(package: str) -> Path | None:
    """Where WAVE's own environment holds a third-party package, or None when it is absent."""
    spec = importlib.util.find_spec(package)
    if spec is None or not spec.submodule_search_locations:
        return None
    return Path(next(iter(spec.submodule_search_locations)))


def module_listing(package: str, root: Path) -> list[tuple[str, Path]]:
    """Every module under a package root by its importable name; a file root is one module."""
    if root.is_file():
        return [(package, root)]
    listing: list[tuple[str, Path]] = []
    for path in sorted(root.rglob("*.py")):
        relative = path.relative_to(root)
        parts = list(relative.parts[:-1])
        if relative.stem != "__init__":
            parts.append(relative.stem)
        listing.append((".".join([package, *parts]), path))
    return listing


def resolved_module(node: ast.ImportFrom, dotted: str, path: Path) -> str:
    """An absolute name for the module a `from ... import` names, relative levels included."""
    if not node.level:
        return node.module or ""
    parts = dotted.split(".")
    if path.name != "__init__.py":
        parts = parts[:-1]
    parts = parts[: len(parts) - (node.level - 1)]
    return ".".join([*parts, node.module] if node.module else parts)


def _catches_import_error(node: ast.Try | ast.TryStar) -> bool:
    for handler in node.handlers:
        caught = handler.type
        options = caught.elts if isinstance(caught, ast.Tuple) else [caught]
        for option in options:
            name = option.attr if isinstance(option, ast.Attribute) else getattr(option, "id", "")
            if name in _IMPORT_ERRORS:
                return True
    return False


def _names_type_checking(test: ast.expr) -> bool:
    return (isinstance(test, ast.Name) and test.id == "TYPE_CHECKING") or (
        isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING"
    )


def _reads_version_info(test: ast.expr) -> bool:
    return any(
        (isinstance(node, ast.Attribute) and node.attr == "version_info")
        or (isinstance(node, ast.Name) and node.id == "version_info")
        for node in ast.walk(test)
    )


def _guard(parent: ast.AST, child: ast.AST) -> str | None:
    """The guard `parent` puts around `child`, if any."""
    if isinstance(parent, ast.FunctionDef | ast.AsyncFunctionDef) and child in parent.body:
        return FUNCTION
    if isinstance(parent, ast.Try | ast.TryStar) and _catches_import_error(parent):
        if child in parent.body or isinstance(child, ast.ExceptHandler):
            return TRY
    if isinstance(parent, ast.If):
        if _names_type_checking(parent.test) and child in parent.body:
            return TYPE_CHECKING
        if _reads_version_info(parent.test):
            return VERSION
    return None


def _import_nodes(tree: ast.AST) -> list[tuple[ast.Import | ast.ImportFrom, frozenset[str]]]:
    """Every import statement with the guards its enclosing statements put around it."""
    found: list[tuple[ast.Import | ast.ImportFrom, frozenset[str]]] = []
    stack: list[tuple[ast.AST, frozenset[str]]] = [(tree, frozenset())]
    while stack:
        node, guards = stack.pop()
        if isinstance(node, ast.Import | ast.ImportFrom):
            found.append((node, guards))
        for child in ast.iter_child_nodes(node):
            guard = _guard(node, child)
            stack.append((child, guards | {guard} if guard else guards))
    return sorted(found, key=lambda item: (item[0].lineno, item[0].col_offset))


def import_sites(dotted: str, path: Path) -> list[ImportSite]:
    """Every import in one module: `import a, b` is two sites, `from a import b, c` is one."""
    sites: list[ImportSite] = []
    for node, guards in _import_nodes(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            sites += [
                ImportSite(alias.name, frozenset({alias.name}), guards, node.lineno)
                for alias in node.names
            ]
            continue
        base = resolved_module(node, dotted, path)
        names = frozenset({base, *[f"{base}.{alias.name}" for alias in node.names]})
        sites.append(ImportSite(base, names, guards, node.lineno))
    return sites


def import_candidates(dotted: str, path: Path) -> list[set[str]]:
    """Each imported name as the dotted names it could mean; a `from` import's aliases apart."""
    candidates: list[set[str]] = []
    for site in import_sites(dotted, path):
        aliases = sorted(site.names - {site.module})
        candidates += [{site.module, alias} for alias in aliases] or [set(site.names)]
    return candidates


def imported_names(dotted: str, path: Path) -> set[str]:
    return {name for names in import_candidates(dotted, path) for name in names}


def parses_at_the_floor(source: str) -> bool:
    """Whether the floor interpreter's own parser would accept this source."""
    try:
        ast.parse(source, feature_version=REMOTE_PYTHON_FLOOR)
    except SyntaxError:
        return False
    return True


def post_floor_names(source: str) -> set[str]:
    """The past-the-floor stdlib names one source reads, by import or by dotted attribute."""
    read: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            read |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            read |= {f"{node.module}.{alias.name}" for alias in node.names}
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            read.add(f"{node.value.id}.{node.attr}")
    return read & POST_FLOOR_NAMES


class PackageWalk:
    """One package root and the names it may import beside the stdlib and itself."""

    def __init__(self, package: str, root: Path, allowed: tuple[str, ...] = ()) -> None:
        self.package = package
        self.root = root
        self.allowed = (package, *allowed)
        self.modules = module_listing(package, root)
        self.names = [dotted for dotted, _path in self.modules]

    def vendorable(self, names: set[str] | frozenset[str]) -> bool:
        """Stdlib, the package itself, or a name the allow-list covers."""
        if is_stdlib(names):
            return True
        return any(matches(name, prefix) for name in names for prefix in self.allowed)

    def outsiders(self, dotted: str, path: Path) -> list[list[str]]:
        """The imports of one module that are none of what the walk allows."""
        return [
            sorted(names) for names in import_candidates(dotted, path) if not self.vendorable(names)
        ]
