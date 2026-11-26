"""Tests for scripts/audit-dependencies.py with a stub pip-audit and a stub npm."""

import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest

from tests.scripts.script_support import Call, Repo, Run, Stubs, copy_from_clone, run, stub_env

SCRIPT = "scripts/audit-dependencies.py"
GROUPS = [
    "backend runtime",
    "backend dev",
    "remote host wheels",
    "frontend runtime",
    "frontend full",
    "e2e runtime",
    "e2e full",
]
JINJA = {"id": "GHSA-h5c8-rqwp-cp95", "fix_versions": ["3.1.3"], "aliases": [], "description": ""}
PYTEST = {"id": "PYSEC-2024-1", "fix_versions": [], "aliases": [], "description": ""}
CFFI = {"id": "GHSA-cffi-0000-0001", "fix_versions": ["2.0.1"], "aliases": [], "description": ""}
NO_FINDINGS = "Vulnerability audit: no known vulnerabilities."

# pip-audit: reads the -r file and reports, as JSON, the vulnerabilities the config gives a name.
PIP_AUDIT = """
config = json.load(open(os.environ["STUB_CONFIG"], encoding="utf-8"))
if config.get("pip_error"):
    print("ERROR:pip_audit._cli:Connection refused: osv.dev", file=sys.stderr)
    sys.exit(1)
names = []
for i, arg in enumerate(ARGS):
    path = None
    if arg in ("-r", "--requirement"):
        path = ARGS[i + 1]
    elif arg.startswith("--requirement="):
        path = arg.split("=", 1)[1]
    if path:
        for line in open(path, encoding="utf-8"):
            line = line.split("#")[0].split(";")[0].strip()
            if "==" in line:
                name, version = line.split("==", 1)
                names.append((name.strip().lower(), version.split()[0].strip(" \\\\")))
deps = []
found = False
for name, version in names:
    vulns = config["pip"].get(name, [])
    found = found or bool(vulns)
    deps.append({"name": name, "version": version, "vulns": vulns})
report = json.dumps({"dependencies": deps, "fixes": []})
if "-o" in ARGS or "--output" in ARGS:
    flag = "-o" if "-o" in ARGS else "--output"
    open(ARGS[ARGS.index(flag) + 1], "w", encoding="utf-8").write(report)
else:
    print(report)
sys.exit(1 if found else 0)
"""

# npm audit: prints the config's report for the folder and the --omit=dev choice.
NPM = """
config = json.load(open(os.environ["STUB_CONFIG"], encoding="utf-8"))
if "audit" not in ARGS:
    sys.exit(0)
folder = os.getcwd()
if "--prefix" in ARGS:
    folder = os.path.abspath(ARGS[ARGS.index("--prefix") + 1])
side = "e2e" if folder.rstrip("/").endswith(os.path.join("tests", "e2e")) else "frontend"
group = side + (" runtime" if "--omit=dev" in ARGS else " full")
if config.get("npm_error"):
    print(json.dumps({"error": {"code": "ENOTFOUND", "summary": "request to"
          " https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason:"
          " getaddrinfo ENOTFOUND registry.npmjs.org", "detail": ""}}))
    sys.exit(1)
vulns = config["npm"].get(group, {})
counts = {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}
for item in vulns.values():
    counts[item["severity"]] += 1
counts["total"] = len(vulns)
print(json.dumps({"auditReportVersion": 2, "vulnerabilities": vulns,
                  "metadata": {"vulnerabilities": counts}}))
sys.exit(1 if vulns else 0)
"""


def npm_vuln(
    name: str, severity: str, ghsa: str, fix: str | None, source: int = 1000
) -> dict[str, Any]:
    """One npm audit report entry with one advisory of its own."""
    return {
        "name": name,
        "severity": severity,
        "isDirect": False,
        "via": [
            {
                "source": source,
                "name": name,
                "dependency": name,
                "title": f"A flaw in {name}",
                "url": f"https://github.com/advisories/{ghsa}",
                "severity": severity,
                "range": "<9.9.9",
            }
        ],
        "effects": [],
        "range": "<9.9.9",
        "nodes": [f"node_modules/{name}"],
        "fixAvailable": {"name": name, "version": fix, "isSemVerMajor": False} if fix else False,
    }


MINIMIST = npm_vuln("minimist", "critical", "GHSA-xvch-5gv4-984h", "1.2.6", 1001)
BRACES = npm_vuln("braces", "high", "GHSA-grv7-fg5c-xmjg", None, 1002)
SEMVER = npm_vuln("semver", "moderate", "GHSA-c2qf-rxjj-qqgw", "7.5.2", 1003)
TAR = npm_vuln("tar", "low", "GHSA-f5x3-32g6-xq36", "6.2.1", 1004)


def lock_file(versions: dict[str, tuple[str, bool]]) -> list[str]:
    packages: dict[str, Any] = {"": {"name": "app"}}
    for name, (version, dev) in versions.items():
        row: dict[str, Any] = {"version": version}
        if dev:
            row["dev"] = True
        packages[f"node_modules/{name}"] = row
    return [json.dumps({"name": "app", "lockfileVersion": 3, "packages": packages})]


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    lock: list[str] = []
    for name, version, group in [
        ("jinja2", "3.1.2", "main"),
        ("fastapi", "0.110.0", "main"),
        ("pytest", "8.0.0", "dev"),
    ]:
        lock += [
            "[[package]]",
            f'name = "{name}"',
            f'version = "{version}"',
            'description = ""',
            "optional = false",
            'python-versions = ">=3.9"',
            f'groups = ["{group}"]',
            "files = []",
            "",
        ]
    lock += ["[metadata]", 'lock-version = "2.1"', 'python-versions = "^3.12"']
    tree.write("backend/poetry.lock", lock)
    tree.write(
        "backend/pyproject.toml",
        ["[tool.poetry]", 'name = "wavecore"', 'version = "1.0.0"'],
    )
    wheel = {
        "file": "cffi-2.0.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        "sha256": "0" * 64,
        "package": "cffi",
        "python": ["3.12"],
        "machine": "x86_64",
        "libc": "glibc",
    }
    tree.write("backend/vendor/wheels.lock", [json.dumps({"wheels": [wheel]})])
    versions = {
        "minimist": ("1.2.5", False),
        "braces": ("3.0.2", True),
        "semver": ("7.5.1", False),
        "tar": ("6.1.0", True),
    }
    for folder in ("frontend", "tests/e2e"):
        tree.write(f"{folder}/package.json", ['{"name": "app"}'])
        tree.write(f"{folder}/package-lock.json", lock_file(versions))
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.tool("pip-audit", PIP_AUDIT)
    tools.tool("npm", NPM)
    return tools


def audit(
    repo: Repo,
    stubs: Stubs,
    tmp_path: Path,
    pip: dict[str, list[dict[str, Any]]] | None = None,
    npm: dict[str, dict[str, Any]] | None = None,
    **errors: bool,
) -> Run:
    config = tmp_path / "stub-config.json"
    config.write_text(json.dumps({"pip": pip or {}, "npm": npm or {}, **errors}))
    env = stub_env(
        tmp_path,
        stubs,
        STUB_CONFIG=str(config),
        WAVE_PIP_AUDIT=str(stubs.bin / "pip-audit"),
    )
    return run(repo, [sys.executable, SCRIPT], env, timeout=50)


def group_line(
    group: str, critical: int = 0, high: int = 0, moderate: int = 0, low: int = 0, unknown: int = 0
) -> str:
    return (
        f"{group}: {critical} critical, {high} high, {moderate} moderate, {low} low,"
        f" {unknown} unknown"
    )


def sections(result: Run) -> dict[str, list[str]]:
    """Each group line's advisory lines, by group name."""
    found: dict[str, list[str]] = {}
    current: str | None = None
    for line in result.lines:
        head = re.match(r"^([a-z0-9 ]+): [0-9]+ critical, ", line)
        if head and head.group(1) in GROUPS:
            current = head.group(1)
            found[current] = []
        elif current is not None and line.startswith("  "):
            found[current].append(line)
        else:
            current = None
    return found


class TestNothingFound:
    def test_exit_0_with_every_group_at_zero(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = audit(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert result.lines[-1] == NO_FINDINGS
        for group in GROUPS:
            assert group_line(group) in result.lines
        assert list(sections(result)) == GROUPS


class TestFindings:
    """Group lines, advisory lines and the summary, exit 1."""

    def test_every_group_with_its_advisories(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = audit(
            repo,
            stubs,
            tmp_path,
            pip={"jinja2": [JINJA], "pytest": [PYTEST], "cffi": [CFFI]},
            npm={
                "frontend runtime": {"minimist": MINIMIST, "semver": SEMVER},
                "frontend full": {
                    "minimist": MINIMIST,
                    "semver": SEMVER,
                    "braces": BRACES,
                    "tar": TAR,
                },
                "e2e full": {"tar": TAR},
            },
        )

        assert result.code == 1, result.lines
        assert group_line("backend runtime", unknown=1) in result.lines
        assert group_line("backend dev", unknown=1) in result.lines
        assert group_line("remote host wheels", unknown=1) in result.lines
        assert group_line("frontend runtime", critical=1, moderate=1) in result.lines
        assert group_line("frontend full", critical=1, high=1, moderate=1, low=1) in result.lines
        assert group_line("e2e runtime") in result.lines
        assert group_line("e2e full", low=1) in result.lines
        found = {group: sorted(lines) for group, lines in sections(result).items()}
        assert list(sections(result)) == GROUPS
        minimist = "  minimist 1.2.5 GHSA-xvch-5gv4-984h critical fix 1.2.6"
        semver = "  semver 7.5.1 GHSA-c2qf-rxjj-qqgw moderate fix 7.5.2"
        braces = "  braces 3.0.2 GHSA-grv7-fg5c-xmjg high fix none"
        tar = "  tar 6.1.0 GHSA-f5x3-32g6-xq36 low fix 6.2.1"
        assert found == {
            "backend runtime": ["  jinja2 3.1.2 GHSA-h5c8-rqwp-cp95 unknown fix 3.1.3"],
            "backend dev": ["  pytest 8.0.0 PYSEC-2024-1 unknown fix none"],
            "remote host wheels": ["  cffi 2.0.0 GHSA-cffi-0000-0001 unknown fix 2.0.1"],
            "frontend runtime": sorted([minimist, semver]),
            "frontend full": sorted([minimist, semver, braces, tar]),
            "e2e runtime": [],
            "e2e full": [tar],
        }
        assert result.lines[-1] == "Vulnerability audit: 7 known vulnerabilities in 7 packages."

    def test_one_advisory_uses_the_singular(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = audit(repo, stubs, tmp_path, pip={"jinja2": [JINJA]})

        assert result.code == 1, result.lines
        assert result.lines[-1] == "Vulnerability audit: 1 known vulnerability in 1 package."

    def test_an_advisory_in_two_groups_counts_once(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = audit(
            repo,
            stubs,
            tmp_path,
            npm={"frontend runtime": {"minimist": MINIMIST}, "e2e full": {"minimist": MINIMIST}},
        )

        assert result.code == 1, result.lines
        assert result.lines[-1] == "Vulnerability audit: 1 known vulnerability in 1 package."

    def test_two_advisories_of_one_package(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        second = {**JINJA, "id": "GHSA-q2x7-8rv6-6q7h", "fix_versions": ["3.1.4"]}

        result = audit(repo, stubs, tmp_path, pip={"jinja2": [JINJA, second]})

        assert result.code == 1, result.lines
        assert group_line("backend runtime", unknown=2) in result.lines
        assert "  jinja2 3.1.2 GHSA-q2x7-8rv6-6q7h unknown fix 3.1.4" in result.lines
        assert result.lines[-1] == "Vulnerability audit: 2 known vulnerabilities in 1 package."


class TestSources:
    """How pip-audit and npm audit are called."""

    def test_pip_audit_uses_osv_over_each_python_group(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        audit(repo, stubs, tmp_path)

        calls = stubs.calls("pip-audit")
        assert len(calls) == 3, [c.args for c in calls]
        for call in calls:
            assert osv(call), call.args

    def test_npm_audit_runs_four_groups_and_never_fixes(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        audit(repo, stubs, tmp_path)

        calls = [c for c in stubs.calls("npm") if "audit" in c.args]
        assert all("fix" not in c.args and "--json" in c.args for c in calls), calls
        seen = sorted((npm_folder(c, repo), "--omit=dev" in c.args) for c in calls)
        assert seen == [("e2e", False), ("e2e", True), ("frontend", False), ("frontend", True)]


def osv(call: Call) -> bool:
    args = call.args
    if "--vulnerability-service=osv" in args:
        return True
    return any(
        a in ("--vulnerability-service", "-s") and args[i + 1] == "osv"
        for i, a in enumerate(args[:-1])
    )


def npm_folder(call: Call, repo: Repo) -> str:
    folder = Path(call.cwd)
    if "--prefix" in call.args:
        folder = (Path(call.cwd) / call.args[call.args.index("--prefix") + 1]).resolve()
    return "e2e" if folder == repo.root / "tests" / "e2e" else "frontend"


class TestUnreachable:
    """A source that cannot be reached stops the audit with exit 2."""

    def test_pip_audit_unreachable(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = audit(repo, stubs, tmp_path, pip_error=True)

        assert result.code == 2, result.lines
        assert result.has(r"Vulnerability audit stopped: pip-audit could not be reached \(.+\)\.")

    def test_npm_audit_unreachable(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = audit(repo, stubs, tmp_path, npm_error=True)

        assert result.code == 2, result.lines
        assert result.has(r"Vulnerability audit stopped: npm audit could not be reached \(.+\)\.")
