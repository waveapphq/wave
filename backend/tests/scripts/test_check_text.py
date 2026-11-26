"""Tests for scripts/check-text.sh: process markers in docstrings and block comment lines."""

from pathlib import Path

import pytest

from tests.scripts.script_support import Repo, Run, Stubs, copy_from_clone, run, stub_env

SCRIPT = "scripts/check-text.sh"
# Built at run time, so this file carries no marker of its own.
MARKER = "Road" + "map 10.8"
PRODUCT_WORD = "hand" + "off"
FAILED = "❌ Text checks failed. Fix each line listed above."


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.poetry()
    return tools


def check(repo: Repo, stubs: Stubs, tmp_path: Path) -> Run:
    return run(repo, [str(repo.root / SCRIPT)], stub_env(tmp_path, stubs))


def hit(rel: str, number: int, text: str) -> str:
    """The line the check lists for a marker hit: path, line number and the line."""
    return f"{rel}:{number}:{text}"


class TestTodayHits:
    """The listing format of a marker hit, as the check prints it for a line comment."""

    def test_a_marker_in_a_hash_comment_is_listed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        line = f"# {MARKER} work"
        repo.write("backend/wavecore/a.py", ["x = 1", line])

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("backend/wavecore/a.py", 2, line) in result.lines
        assert FAILED in result.lines

    def test_a_clean_tree_passes(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.write("backend/wavecore/a.py", ['"""Read the file."""', "x = 1"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert FAILED not in result.lines


class TestDocstrings:
    """A marker in a Python docstring fails like one in a comment."""

    def test_a_marker_in_an_inner_docstring_line(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        line = f"    {MARKER} work."
        repo.write(
            "backend/wavecore/a.py",
            ["def f() -> None:", '    """Read the file.', "", line, '    """', "    return None"],
        )

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("backend/wavecore/a.py", 4, line) in result.lines
        assert FAILED in result.lines

    def test_a_marker_in_a_one_line_docstring(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        line = f'    """{MARKER} work."""'
        repo.write("backend/wavecore/a.py", ["def f() -> None:", line, "    return None"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("backend/wavecore/a.py", 2, line) in result.lines

    def test_a_marker_in_the_first_line_of_a_module_docstring(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        line = f'"""{MARKER} module.'
        repo.write("backend/tests/test_a.py", [line, "", "More words.", '"""', "x = 1"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("backend/tests/test_a.py", 1, line) in result.lines

    def test_a_marker_in_a_single_quoted_docstring(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        line = f"    {MARKER} work."
        repo.write(
            "backend/wavecore/a.py",
            ["class A:", "    '''Hold one thing.", line, "    '''", "    x = 1"],
        )

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("backend/wavecore/a.py", 3, line) in result.lines

    def test_a_marker_in_a_plain_string_is_not_a_docstring(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        repo.write("backend/wavecore/a.py", [f'TITLE = "{MARKER}"', "x = 1"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 0, result.lines


class TestBlockComments:
    """Every inner line of a multi-line block comment is read, with or without a leading star."""

    @pytest.mark.parametrize(
        ("opening", "inner"),
        [
            ("/*", f"   {MARKER} work"),
            ("/*", f" * {MARKER} work"),
            ("/**", f"  {MARKER} work"),
            ("/**", f" * {MARKER} work"),
        ],
        ids=["plain", "starred", "doc-plain", "doc-starred"],
    )
    def test_a_marker_on_an_inner_line(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, opening: str, inner: str
    ) -> None:
        repo.write(
            "frontend/src/a.ts",
            ["const a = 1", opening, "   Keep the order.", inner, " */", "export { a }"],
        )

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit("frontend/src/a.ts", 4, inner) in result.lines
        assert FAILED in result.lines

    @pytest.mark.parametrize("suffix", [".ts", ".tsx", ".js", ".mjs"])
    def test_every_script_file_kind(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, suffix: str
    ) -> None:
        inner = f"   {MARKER} work"
        rel = f"frontend/src/a{suffix}"
        repo.write(rel, ["/*", inner, "*/", "const a = 1"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 1, result.lines
        assert hit(rel, 2, inner) in result.lines

    def test_a_line_after_the_block_closes_is_code(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        repo.write(
            "frontend/src/a.ts",
            ["/*", "   Keep the order.", " */", f"const title = '{MARKER}'"],
        )

        result = check(repo, stubs, tmp_path)

        assert result.code == 0, result.lines


class TestProductWord:
    """The product's word for releasing the Workbench session is no process marker."""

    @pytest.mark.parametrize(
        ("rel", "line"),
        [
            ("backend/wavecore/a.py", f"# Release the {PRODUCT_WORD} when the run ends."),
            ("frontend/src/a.ts", f"// Release the {PRODUCT_WORD} when the run ends."),
        ],
    )
    def test_the_word_passes(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, rel: str, line: str
    ) -> None:
        repo.write(rel, [line, "x = 1"])

        result = check(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert FAILED not in result.lines
