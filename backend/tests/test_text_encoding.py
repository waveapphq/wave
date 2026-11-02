"""Every text read and write in wavecore names its encoding (REQ-4.6.9)."""

import ast
import os
import tomllib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import wavecore
from tests.core.remote_exec._vendorability import module_listing

_PACKAGE_NAME = wavecore.__name__
_PACKAGE_ROOT = Path(str(wavecore.__file__)).parent
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_PROJECT_FILE = _BACKEND_ROOT / "pyproject.toml"

_MODULES = module_listing(_PACKAGE_NAME, _PACKAGE_ROOT)
_MODULE_NAMES = [dotted for dotted, _path in _MODULES]
_MODULE_PATHS = dict(_MODULES)

_EXPECTED_PARTS = {
    "api",
    "connectivity",
    "controls",
    "core",
    "logging",
    "mcp",
    "models",
    "plugins",
    "storage",
}
_EXPECTED_MODULES = {
    _PACKAGE_NAME,
    f"{_PACKAGE_NAME}.api.services.reports.service",
    f"{_PACKAGE_NAME}.connectivity.helm._cli",
    f"{_PACKAGE_NAME}.connectivity.k8s.verbs.cp",
    f"{_PACKAGE_NAME}.core.blocks.import_export",
    f"{_PACKAGE_NAME}.core.remote_exec.bundle",
    f"{_PACKAGE_NAME}.storage.file_storage.storage",
}
_MINIMUM_MODULE_COUNT = 400

_TEXT_METHODS = frozenset({"read_text", "write_text"})
_MODE_LETTERS = frozenset("rwxabt+")

# A path object takes the mode first; open(), fdopen() and a module's open() take it second.
_SECOND = slice(1, 2)
_FIRST_TWO = slice(0, 2)

# Calls that only look like a text open: a storage helper and a URL opener.
_LOOKALIKES = {
    (f"{_PACKAGE_NAME}.api.services.reports.service", "store.write_text"),
    (f"{_PACKAGE_NAME}.core.remote_exec.bundle", "opener.open"),
}


def _is_binary_mode(node: ast.expr) -> bool:
    if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
        return False
    return "b" in node.value and set(node.value) <= _MODE_LETTERS


def _opens_binary(call: ast.Call, positions: slice) -> bool:
    named = [keyword.value for keyword in call.keywords if keyword.arg == "mode"]
    return any(_is_binary_mode(node) for node in [*call.args[positions], *named])


def _asks_for_text(call: ast.Call) -> bool:
    return any(
        keyword.arg == "text"
        and isinstance(keyword.value, ast.Constant)
        and keyword.value.value is True
        for keyword in call.keywords
    )


def _opens_text(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id == "open" and not _opens_binary(call, _SECOND)
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in _TEXT_METHODS:
        return True
    if func.attr == "fdopen":
        return not _opens_binary(call, _SECOND)
    if func.attr != "open":
        return False
    # os.open returns a file descriptor, never text.
    if isinstance(func.value, ast.Name) and func.value.id == "os":
        return False
    return not _opens_binary(call, _FIRST_TWO)


def _leaves_the_encoding_out(call: ast.Call) -> bool:
    if any(keyword.arg == "encoding" for keyword in call.keywords):
        return False
    return _asks_for_text(call) or _opens_text(call)


def _held_source(value: object) -> ast.AST | None:
    """A multi-line string that is itself Python source, as the remote worker is."""
    if not isinstance(value, str) or "\n" not in value:
        return None
    try:
        return ast.parse(value)
    except (SyntaxError, ValueError):
        return None


def _hits(tree: ast.AST, first_line: int) -> list[tuple[int, str]]:
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _leaves_the_encoding_out(node):
            line = node.func.end_lineno or node.lineno
            hits.append((first_line + line - 1, ast.unparse(node.func)))
        elif isinstance(node, ast.Constant):
            held = _held_source(node.value)
            if held is not None:
                hits += _hits(held, first_line + node.lineno - 1)
    return hits


def _unnamed_encoding_calls(source: str) -> list[tuple[int, str]]:
    """The text calls one source makes with no encoding argument, as (line, call)."""
    return sorted(_hits(ast.parse(source), 1))


def _source_of(dotted: str) -> str:
    return _MODULE_PATHS[dotted].read_text(encoding="utf-8")


def _lint_settings() -> dict[str, Any]:
    project = tomllib.loads(_PROJECT_FILE.read_text(encoding="utf-8"))
    settings: dict[str, Any] = project["tool"]["ruff"]["lint"]
    return settings


class TestTheWalkCoversTheWholePackage:
    """A walk that finds nothing would pass the rule below without reading a line."""

    def test_the_walk_reads_the_package_beside_the_tests(self) -> None:
        assert _PACKAGE_ROOT.resolve() == _BACKEND_ROOT / _PACKAGE_NAME

    def test_the_walk_finds_modules(self) -> None:
        assert _MODULE_NAMES

    def test_the_walk_reaches_every_part_of_the_package(self) -> None:
        reached = {dotted.split(".")[1] for dotted in _MODULE_NAMES if "." in dotted}

        assert _EXPECTED_PARTS <= reached

    def test_the_walk_finds_modules_known_to_read_or_write_text(self) -> None:
        assert _EXPECTED_MODULES <= set(_MODULE_NAMES)

    def test_the_walk_is_at_least_as_wide_as_the_known_package(self) -> None:
        assert len(_MODULE_NAMES) >= _MINIMUM_MODULE_COUNT

    def test_the_walk_misses_no_python_file_on_disk(self) -> None:
        on_disk = sum(
            name.endswith(".py")
            for _folder, _folders, names in os.walk(_PACKAGE_ROOT)
            for name in names
        )

        assert len(_MODULES) == on_disk


@pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_MODULE_NAMES)
class TestEveryTextCallNamesItsEncoding:
    """Text is UTF-8 whatever the host's locale, so no call may leave the encoding to the host."""

    def test_no_text_call_leaves_the_encoding_to_the_host(self, dotted: str, path: Path) -> None:
        shown = path.relative_to(_BACKEND_ROOT)
        hits = [
            f"{shown}:{line} {call}"
            for line, call in _unnamed_encoding_calls(path.read_text(encoding="utf-8"))
            if (dotted, call) not in _LOOKALIKES
        ]

        assert not hits, f"{dotted} names no encoding at {hits}"


@pytest.mark.parametrize(("dotted", "call"), sorted(_LOOKALIKES))
class TestTheLookalikesAreStillThere:
    """An exemption whose call is gone would hide the next real one of that name."""

    def test_the_exempt_call_is_still_in_its_module(self, dotted: str, call: str) -> None:
        calls = {name for _line, name in _unnamed_encoding_calls(_source_of(dotted))}

        assert call in calls


class TestTheEncodingGuardSeesAViolation:
    """A guard that cannot fail proves nothing, so it is run against sources that break it."""

    @pytest.mark.parametrize(
        "source, call",
        [
            ("handle = open(path)\n", "open"),
            ('handle = open(path, "w")\n', "open"),
            ('handle = open(path, mode="a")\n', "open"),
            ("handle = open(path, **options)\n", "open"),
            ("text = path.read_text()\n", "path.read_text"),
            ("path.write_text(body)\n", "path.write_text"),
            ("text = (folder / name).read_text()\n", "(folder / name).read_text"),
            ("handle = path.open()\n", "path.open"),
            ('handle = path.open("a")\n', "path.open"),
            ('handle = io.open("table.txt")\n', "io.open"),
            ("handle = aiofiles.open(path)\n", "aiofiles.open"),
            ('handle = aiofiles.open(path, "w")\n', "aiofiles.open"),
            ('handle = aiofiles.open(path, mode="a")\n', "aiofiles.open"),
            ('handle = os.fdopen(descriptor, "w")\n', "os.fdopen"),
            ('archive = tarfile.open(fileobj=stream, mode="r|")\n', "tarfile.open"),
            ('archive = tarfile.open(path, "w:bz2")\n', "tarfile.open"),
            ("done = subprocess.run(argv, capture_output=True, text=True)\n", "subprocess.run"),
            ("process = launch(argv, stdout=PIPE, text=True)\n", "launch"),
        ],
    )
    def test_a_text_call_with_no_encoding_is_named(self, source: str, call: str) -> None:
        assert _unnamed_encoding_calls(source) == [(1, call)]

    @pytest.mark.parametrize(
        "source",
        [
            'handle = open(path, encoding="utf-8")\n',
            'handle = open(path, "w", encoding="utf-8", newline="")\n',
            'handle = open(path, "rb")\n',
            'handle = open(path, mode="wb")\n',
            'text = path.read_text(encoding="utf-8", errors="replace")\n',
            'path.write_text(body, encoding="utf-8")\n',
            'handle = path.open("rb")\n',
            'handle = path.open("a", encoding="utf-8")\n',
            'handle = gzip.open(path, "wb")\n',
            'handle = os.fdopen(descriptor, "wb")\n',
            'handle = os.fdopen(descriptor, "w", encoding="utf-8")\n',
            "descriptor = os.open(path, os.O_RDONLY)\n",
            'handle = aiofiles.open(path, "w", encoding="utf-8")\n',
            'handle = aiofiles.open(path, "rb")\n',
            'handle = aiofiles.open(path, mode="wb")\n',
            'archive = tarfile.open(fileobj=stream, mode="r|", encoding="utf-8")\n',
            'done = subprocess.run(argv, text=True, encoding="utf-8", errors="replace")\n',
            "done = subprocess.run(argv, capture_output=True)\n",
            "done = subprocess.run(argv, text=False)\n",
            "handle = reopen(path)\n",
            "text = path.read_bytes()\n",
        ],
    )
    def test_source_the_rule_accepts_names_no_call(self, source: str) -> None:
        assert _unnamed_encoding_calls(source) == []

    def test_a_call_over_several_lines_is_named_on_the_line_of_its_name(self) -> None:
        source = 'text = (\n    folder\n    .joinpath("VERSION")\n    .read_text()\n)\n'

        assert [line for line, _call in _unnamed_encoding_calls(source)] == [4]

    def test_every_violation_of_one_source_is_named_in_line_order(self) -> None:
        source = "path.write_text(body)\n\nhandle = open(path)\n"

        assert _unnamed_encoding_calls(source) == [(1, "path.write_text"), (3, "open")]

    def test_source_held_as_a_string_is_read_too(self) -> None:
        source = 'WORKER = """\nimport sys\n\nhandle = open(sys.argv[1])\n"""\n'

        assert _unnamed_encoding_calls(source) == [(4, "open")]

    def test_source_held_as_a_string_passes_when_it_names_the_encoding(self) -> None:
        source = 'WORKER = """\nimport sys\n\nhandle = open(sys.argv[1], encoding="utf-8")\n"""\n'

        assert _unnamed_encoding_calls(source) == []

    def test_a_string_that_is_not_source_names_no_call(self) -> None:
        source = 'NOTE = """\nHow to open(path) and read a file.\n"""\n'

        assert _unnamed_encoding_calls(source) == []


class TestTheLintRuleIsOn:
    """The rule is a preview rule, so it runs only when preview is on and it is named."""

    def test_the_select_list_names_the_rule(self) -> None:
        assert "PLW1514" in _lint_settings()["select"]

    def test_preview_is_on(self) -> None:
        assert _lint_settings().get("preview") is True

    def test_no_other_preview_rule_runs(self) -> None:
        assert _lint_settings().get("explicit-preview-rules") is True


_HOST_ENCODINGS = (None, "locale")
_LOG_FILE_HANDLERS = frozenset(
    {"FileHandler", "RotatingFileHandler", "TimedRotatingFileHandler", "WatchedFileHandler"}
)

Rule = Callable[[ast.Call], bool]


def _asks_for_the_host_encoding(call: ast.Call) -> bool:
    return any(
        keyword.arg == "encoding"
        and isinstance(keyword.value, ast.Constant)
        and keyword.value.value in _HOST_ENCODINGS
        for keyword in call.keywords
    )


def _reads_text_as_the_host_does(call: ast.Call) -> bool:
    return _asks_for_the_host_encoding(call) and (_asks_for_text(call) or _opens_text(call))


def _logs_to_a_file_as_the_host_does(call: ast.Call) -> bool:
    func = call.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
    named = any(keyword.arg == "encoding" for keyword in call.keywords)
    return name in _LOG_FILE_HANDLERS and (not named or _asks_for_the_host_encoding(call))


def _calls_that_break(rule: Rule, tree: ast.AST, first_line: int = 1) -> list[tuple[int, str]]:
    """The calls of one source that break a rule, as (line, call); held source is read too."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and rule(node):
            line = node.func.end_lineno or node.lineno
            found.append((first_line + line - 1, ast.unparse(node.func)))
        elif isinstance(node, ast.Constant) and (held := _held_source(node.value)) is not None:
            found += _calls_that_break(rule, held, first_line + node.lineno - 1)
    return sorted(found)


class TestTheHostEncodingIsNeverAskedForByName:
    """encoding=None and encoding="locale" read with the host's encoding, like no encoding."""

    @pytest.mark.parametrize(
        "source, hit",
        [
            ("handle = open(path, encoding=None)\n", (1, "open")),
            ('handle = open(path, "w", encoding="locale")\n', (1, "open")),
            ("text = path.read_text(encoding=None)\n", (1, "path.read_text")),
            ('done = subprocess.run(argv, text=True, encoding="locale")\n', (1, "subprocess.run")),
            (
                'WORKER = """\nimport sys\n\nhandle = open(sys.argv[1], encoding=None)\n"""\n',
                (4, "open"),
            ),
        ],
    )
    def test_a_text_call_that_asks_for_it_is_named(self, source: str, hit: tuple[int, str]) -> None:
        assert _calls_that_break(_reads_text_as_the_host_does, ast.parse(source)) == [hit]

    @pytest.mark.parametrize(
        "source",
        [
            'handle = open(path, encoding="utf-8")\n',
            "handle = open(path, encoding=chosen)\n",
            'handle = open(path, "rb", encoding=None)\n',
            "process = connection.create_process(command, encoding=None)\n",
            "done = subprocess.run(argv, encoding=None)\n",
        ],
    )
    def test_source_the_rule_accepts_names_no_call(self, source: str) -> None:
        assert _calls_that_break(_reads_text_as_the_host_does, ast.parse(source)) == []


class TestALogFileNamesItsEncoding:
    """A logging file handler writes text, so it names its encoding like any other text call."""

    @pytest.mark.parametrize(
        "source, call",
        [
            ('handler = logging.FileHandler("wave.log")\n', "logging.FileHandler"),
            ("handler = RotatingFileHandler(path, maxBytes=1)\n", "RotatingFileHandler"),
            (
                'handler = handlers.TimedRotatingFileHandler(path, when="D", encoding=None)\n',
                "handlers.TimedRotatingFileHandler",
            ),
            (
                'handler = logging.handlers.WatchedFileHandler(path, encoding="locale")\n',
                "logging.handlers.WatchedFileHandler",
            ),
        ],
    )
    def test_a_log_file_handler_with_no_encoding_is_named(self, source: str, call: str) -> None:
        assert _calls_that_break(_logs_to_a_file_as_the_host_does, ast.parse(source)) == [(1, call)]

    @pytest.mark.parametrize(
        "source",
        [
            'handler = logging.FileHandler("wave.log", encoding="utf-8")\n',
            'handler = RotatingFileHandler(path, maxBytes=1, encoding="utf-8")\n',
            "handler = logging.StreamHandler(sys.stderr)\n",
        ],
    )
    def test_source_the_rule_accepts_names_no_call(self, source: str) -> None:
        assert _calls_that_break(_logs_to_a_file_as_the_host_does, ast.parse(source)) == []


@pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_MODULE_NAMES)
class TestNoModuleLeavesTextToTheHostByName:
    """Both rules above hold for every module of the package."""

    @pytest.mark.parametrize(
        "rule",
        [_reads_text_as_the_host_does, _logs_to_a_file_as_the_host_does],
        ids=["text call", "log file handler"],
    )
    def test_no_call_breaks_the_rule(self, rule: Rule, dotted: str, path: Path) -> None:
        shown = path.relative_to(_BACKEND_ROOT)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        hits = [f"{shown}:{line} {call}" for line, call in _calls_that_break(rule, tree)]

        assert not hits, f"{dotted} leaves the encoding to the host at {hits}"
