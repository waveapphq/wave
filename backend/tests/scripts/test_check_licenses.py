"""Tests for scripts/check-licenses.py on a tmp tree with fake lock files, venv and wheels."""

import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

import pytest

from tests.scripts.script_support import CLONE, Repo, Run, Stubs, copy_from_clone, run, stub_env

SCRIPT = "scripts/check-licenses.py"
APPROVED = "scripts/dependency-licenses.json"
WHEEL = "fixwheel-1.0.0-py3-none-any.whl"
PASSED = "License check passed: 5 shipped packages approved."

# `poetry -P backend run python ...` runs this interpreter over the fake site folder.
POETRY_PYTHON = """
site = os.environ["STUB_SITE"]
if "run" not in ARGS:
    sys.exit(0)
rest = ARGS[ARGS.index("run") + 1 :]
if not rest or not os.path.basename(rest[0]).startswith("python"):
    sys.exit(0)
flags = [a for a in rest[1:] if a not in ("-I", "-E", "-s", "-S")]
env = dict(os.environ, PYTHONPATH=site, PYTHONNOUSERSITE="1")
sys.exit(subprocess.run([{python!r}, "-s", *flags], env=env).returncode)
"""


def metadata(name: str, version: str, license_expression: str | None) -> str:
    lines = ["Metadata-Version: 2.4", f"Name: {name}", f"Version: {version}"]
    if license_expression is not None:
        lines.append(f"License-Expression: {license_expression}")
    return "\n".join(lines) + "\n"


class Tree:
    """The shipped dependencies of a tmp clone: lock files, venv packages, wheels, the list."""

    def __init__(self, repo: Repo, site: Path) -> None:
        self.repo = repo
        self.site = site
        self.pypi: dict[str, tuple[str, str | None, list[str]]] = {
            "alpha-lib": ("1.0.0", "MIT", ["main"]),
            "beta-lib": ("2.0.0", "Apache-2.0", ["main"]),
            "devtool": ("3.0.0", "GPL-3.0-only", ["dev"]),
        }
        self.pyproject_deps = {"alpha-lib": '"^1.0"', "beta-lib": '"^2.0"'}
        self.lock_sources: dict[str, dict[str, str]] = {}
        self.npm: dict[str, dict[str, Any]] = {
            "node_modules/front-a": {"version": "1.0.0", "license": "MIT"},
            "node_modules/front-b": {"version": "1.1.0", "license": "ISC"},
            "node_modules/front-dev": {"version": "4.0.0", "license": "GPL-3.0-only", "dev": True},
        }
        self.package_json: dict[str, Any] = {
            "name": "frontend",
            "dependencies": {"front-a": "^1.0.0"},
            "devDependencies": {"front-dev": "^4.0.0"},
        }
        self.wheels: dict[str, tuple[str, str | None]] = {WHEEL: ("fixwheel", "BSD-3-Clause")}
        self.approved: list[dict[str, Any]] = [
            entry("npm", "front-a", "MIT"),
            entry("npm", "front-b", "ISC"),
            entry("pypi", "alpha-lib", "MIT"),
            entry("pypi", "beta-lib", "Apache-2.0"),
            entry("wheel", "fixwheel", "BSD-3-Clause"),
        ]

    def write(self) -> None:
        self._write_backend()
        self._write_frontend()
        self._write_wheels()
        self.repo.write(APPROVED, [json.dumps({"packages": self.approved}, indent=2)])

    def _write_backend(self) -> None:
        deps = [f"{name} = {spec}" for name, spec in self.pyproject_deps.items()]
        self.repo.write(
            "backend/pyproject.toml",
            [
                "[tool.poetry]",
                'name = "wavecore"',
                'version = "1.0.0"',
                "",
                "[tool.poetry.dependencies]",
                'python = "^3.12"',
                *deps,
                "",
                "[tool.poetry.group.dev.dependencies]",
                'devtool = "^3.0"',
            ],
        )
        lock: list[str] = []
        for name, (version, _license, groups) in self.pypi.items():
            lock += [
                "[[package]]",
                f'name = "{name}"',
                f'version = "{version}"',
                'description = ""',
                "optional = false",
                'python-versions = ">=3.9"',
                f"groups = {json.dumps(groups)}",
                "files = []",
            ]
            source = self.lock_sources.get(name)
            if source is not None:
                lock += ["", "[package.source]"]
                lock += [f'{key} = "{value}"' for key, value in source.items()]
            lock.append("")
        lock += ["[metadata]", 'lock-version = "2.1"', 'python-versions = "^3.12"']
        self.repo.write("backend/poetry.lock", lock)
        for name, (version, license_expression, _groups) in self.pypi.items():
            info = self.site / f"{name.replace('-', '_')}-{version}.dist-info"
            info.mkdir(parents=True, exist_ok=True)
            (info / "METADATA").write_text(metadata(name, version, license_expression))

    def _write_frontend(self) -> None:
        self.repo.write("frontend/package.json", [json.dumps(self.package_json, indent=2)])
        packages: dict[str, Any] = {
            "": {
                "name": "frontend",
                "dependencies": self.package_json.get("dependencies", {}),
                "devDependencies": self.package_json.get("devDependencies", {}),
            }
        }
        for path, fields in self.npm.items():
            name = path.rsplit("node_modules/", 1)[1]
            row = {
                "version": fields["version"],
                "resolved": f"https://registry.npmjs.org/{name}/-/{name}-{fields['version']}.tgz",
                "integrity": "sha512-AAAA",
            }
            row.update(fields)
            packages[path] = row
        lock = {"name": "frontend", "lockfileVersion": 3, "requires": True, "packages": packages}
        self.repo.write("frontend/package-lock.json", [json.dumps(lock, indent=2)])

    def _write_wheels(self) -> None:
        folder = self.repo.root / "backend" / "vendor" / "wheels"
        folder.mkdir(parents=True, exist_ok=True)
        rows = []
        for file, (package, license_expression) in self.wheels.items():
            version = file.split("-")[1]
            path = folder / file
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    f"{package}-{version}.dist-info/METADATA",
                    metadata(package, version, license_expression),
                )
            rows.append(
                {
                    "file": file,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "package": package,
                    "python": ["3.12"],
                    "machine": "x86_64",
                    "libc": "glibc",
                }
            )
        lock = self.repo.root / "backend" / "vendor" / "wheels.lock"
        lock.write_text(json.dumps({"wheels": rows}, indent=2) + "\n", encoding="utf-8")


def entry(ecosystem: str, name: str, license_expression: str) -> dict[str, Any]:
    return {
        "ecosystem": ecosystem,
        "name": name,
        "license": license_expression,
        "reason": "LICENSE file read.",
    }


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    return tree


@pytest.fixture
def tree(repo: Repo, tmp_path: Path) -> Tree:
    return Tree(repo, tmp_path / "site")


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.tool("poetry", POETRY_PYTHON.format(python=sys.executable))
    return tools


def check(tree: Tree, stubs: Stubs, tmp_path: Path) -> Run:
    tree.write()
    env = stub_env(tmp_path, stubs, STUB_SITE=str(tree.site))
    return run(tree.repo, [sys.executable, SCRIPT], env)


def assert_failed(result: Run, problems: list[str]) -> None:
    """Exit 1, the problem lines in order, then the count line last."""
    assert result.code == 1, result.lines
    count = len(problems)
    noun = "problem" if count == 1 else "problems"
    assert result.lines[-1] == f"License check failed: {count} {noun}."
    assert [line for line in result.lines if line in problems] == problems
    assert result.lines[-1 - count : -1] == problems


class TestPasses:
    """Every shipped package approved with a matching license."""

    def test_an_approved_tree_passes(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert result.lines[-1] == PASSED

    def test_the_venv_is_read_through_poetry(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        check(tree, stubs, tmp_path)

        calls = stubs.calls("poetry")
        assert calls, "poetry was not called"
        assert all(c.args[:2] == ["-P", "backend"] for c in calls), [c.args for c in calls]

    def test_dev_only_packages_are_not_checked(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        # devtool (pypi dev group) and front-dev (npm dev) carry GPL and are on no list.
        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert not any("devtool" in line or "front-dev" in line for line in result.lines)

    def test_unknown_metadata_passes_on_its_entry(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.pypi["alpha-lib"] = ("1.0.0", None, ["main"])
        tree.npm["node_modules/front-b"] = {"version": "1.1.0"}

        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert result.lines[-1] == PASSED

    def test_a_version_bump_needs_no_list_change(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.pypi["alpha-lib"] = ("1.9.0", "MIT", ["main"])

        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_an_approved_gpl_package_on_its_entry_passes(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.npm["node_modules/front-b"] = {"version": "1.1.0", "license": "GPL-2.0-only"}
        tree.approved[1] = entry("npm", "front-b", "GPL-2.0-only")

        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_patches_of_an_e2e_test_image_are_allowed(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.repo.write("tests/e2e/services/sshd/patches/fix.patch", ["--- a", "+++ b"])

        result = check(tree, stubs, tmp_path)

        assert result.code == 0, result.lines


class TestPackageProblems:
    """Not approved, changed and denied licenses, each with its exact line."""

    @pytest.mark.parametrize(
        ("change", "line"),
        [
            ("pypi", "Not approved: pypi beta-lib 2.0.0 (Apache-2.0)."),
            ("npm", "Not approved: npm front-b 1.1.0 (ISC)."),
            ("wheel", "Not approved: wheel fixwheel 1.0.0 (BSD-3-Clause)."),
        ],
    )
    def test_a_package_missing_from_the_list(
        self, tree: Tree, stubs: Stubs, tmp_path: Path, change: str, line: str
    ) -> None:
        name = line.split()[3]
        tree.approved = [e for e in tree.approved if (e["ecosystem"], e["name"]) != (change, name)]

        result = check(tree, stubs, tmp_path)

        assert_failed(result, [line])

    def test_a_new_package_with_no_license_is_unknown(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.pypi["gamma-lib"] = ("0.1.0", None, ["main"])

        result = check(tree, stubs, tmp_path)

        assert_failed(result, ["Not approved: pypi gamma-lib 0.1.0 (UNKNOWN)."])

    def test_a_transitive_npm_package_is_shipped(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.npm["node_modules/front-a/node_modules/front-c"] = {
            "version": "0.2.0",
            "license": "MIT",
        }

        result = check(tree, stubs, tmp_path)

        assert_failed(result, ["Not approved: npm front-c 0.2.0 (MIT)."])

    @pytest.mark.parametrize(
        ("ecosystem", "license_expression", "line"),
        [
            ("pypi", "BSD-3-Clause", "License changed: pypi alpha-lib 1.0.0 is BSD-3-Clause,"),
            ("npm", "Apache-2.0", "License changed: npm front-a 1.0.0 is Apache-2.0,"),
            ("wheel", "MIT", "License changed: wheel fixwheel 1.0.0 is MIT,"),
        ],
    )
    def test_a_changed_license(
        self,
        tree: Tree,
        stubs: Stubs,
        tmp_path: Path,
        ecosystem: str,
        license_expression: str,
        line: str,
    ) -> None:
        approved = {"pypi": "MIT", "npm": "MIT", "wheel": "BSD-3-Clause"}[ecosystem]
        if ecosystem == "pypi":
            tree.pypi["alpha-lib"] = ("1.0.0", license_expression, ["main"])
        elif ecosystem == "npm":
            tree.npm["node_modules/front-a"] = {"version": "1.0.0", "license": license_expression}
        else:
            tree.wheels[WHEEL] = ("fixwheel", license_expression)

        result = check(tree, stubs, tmp_path)

        assert_failed(result, [f"{line} approved as {approved}."])

    @pytest.mark.parametrize(
        "license_expression", ["GPL-3.0-only", "GPL-2.0-or-later", "AGPL-3.0-only"]
    )
    def test_a_deny_list_license_not_on_the_list(
        self, tree: Tree, stubs: Stubs, tmp_path: Path, license_expression: str
    ) -> None:
        tree.npm["node_modules/front-g"] = {"version": "5.0.0", "license": license_expression}

        result = check(tree, stubs, tmp_path)

        assert_failed(result, [f"Denied license: npm front-g 5.0.0 ({license_expression})."])

    def test_a_package_that_turned_gpl_is_denied(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.pypi["alpha-lib"] = ("1.0.0", "GPL-3.0-or-later", ["main"])

        result = check(tree, stubs, tmp_path)

        assert_failed(result, ["Denied license: pypi alpha-lib 1.0.0 (GPL-3.0-or-later)."])

    def test_lgpl_is_not_on_the_deny_list(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.npm["node_modules/front-l"] = {"version": "5.0.0", "license": "LGPL-2.1-only"}

        result = check(tree, stubs, tmp_path)

        assert_failed(result, ["Not approved: npm front-l 5.0.0 (LGPL-2.1-only)."])


class TestModifications:
    """A dependency from outside the registries, a patch or a changed wheel."""

    def test_a_git_source_in_pyproject(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.pyproject_deps["alpha-lib"] = '{git = "https://github.com/someone/alpha-lib.git"}'

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result, ["Modified dependency: alpha-lib comes from git in backend/pyproject.toml."]
        )

    def test_a_path_source_in_pyproject(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.pyproject_deps["alpha-lib"] = '{path = "../alpha-lib"}'

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result, ["Modified dependency: alpha-lib comes from a path in backend/pyproject.toml."]
        )

    def test_a_url_source_in_pyproject(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.pyproject_deps["alpha-lib"] = '{url = "https://example.com/alpha-lib-1.0.0.tar.gz"}'

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result, ["Modified dependency: alpha-lib comes from a URL in backend/pyproject.toml."]
        )

    @pytest.mark.parametrize(
        ("source", "kind"),
        [
            ({"type": "git", "url": "https://github.com/someone/beta-lib.git"}, "git"),
            ({"type": "directory", "url": "../beta-lib"}, "a path"),
            ({"type": "url", "url": "https://example.com/beta-lib.tar.gz"}, "a URL"),
            ({"type": "file", "url": "../beta-lib-2.0.0.tar.gz"}, "a file"),
        ],
        ids=["git", "path", "url", "file"],
    )
    def test_a_source_in_poetry_lock(
        self, tree: Tree, stubs: Stubs, tmp_path: Path, source: dict[str, str], kind: str
    ) -> None:
        tree.lock_sources["beta-lib"] = source

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result, [f"Modified dependency: beta-lib comes from {kind} in backend/poetry.lock."]
        )

    @pytest.mark.parametrize(
        ("spec", "kind"),
        [
            ("git+https://github.com/someone/front-a.git", "git"),
            ("file:../front-a", "a file"),
            ("https://example.com/front-a-1.0.0.tgz", "a URL"),
        ],
        ids=["git", "file", "url"],
    )
    def test_a_source_in_package_json(
        self, tree: Tree, stubs: Stubs, tmp_path: Path, spec: str, kind: str
    ) -> None:
        tree.package_json["dependencies"] = {"front-a": spec}

        result = check(tree, stubs, tmp_path)

        assert f"Modified dependency: front-a comes from {kind} in frontend/package.json." in (
            result.lines
        )
        assert result.code == 1, result.lines

    @pytest.mark.parametrize(
        ("resolved", "kind"),
        [
            ("git+ssh://git@github.com/someone/front-b.git#0123abc", "git"),
            ("https://example.com/front-b-1.1.0.tgz", "a URL"),
            ("file:../front-b-1.1.0.tgz", "a file"),
        ],
        ids=["git", "url", "file"],
    )
    def test_a_resolved_outside_the_registry_in_package_lock(
        self, tree: Tree, stubs: Stubs, tmp_path: Path, resolved: str, kind: str
    ) -> None:
        tree.npm["node_modules/front-b"] = {
            "version": "1.1.0",
            "license": "ISC",
            "resolved": resolved,
        }

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result,
            [f"Modified dependency: front-b comes from {kind} in frontend/package-lock.json."],
        )

    @pytest.mark.parametrize("folder", ["patches", "frontend/patches", "backend/patches"])
    def test_a_patches_folder(self, tree: Tree, stubs: Stubs, tmp_path: Path, folder: str) -> None:
        tree.repo.write(f"{folder}/front-a+1.0.0.patch", ["--- a", "+++ b"])

        result = check(tree, stubs, tmp_path)

        assert_failed(result, [f"Modified dependency: patches folder {folder}."])

    def test_a_patch_package_dependency(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.package_json["devDependencies"]["patch-package"] = "^8.0.0"

        result = check(tree, stubs, tmp_path)

        assert "Modified dependency: patch-package in frontend/package.json." in result.lines
        assert result.code == 1, result.lines

    def test_a_patched_dependencies_key(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.package_json["patchedDependencies"] = {"front-a@1.0.0": "patches/front-a.patch"}

        result = check(tree, stubs, tmp_path)

        assert "Modified dependency: patchedDependencies in frontend/package.json." in result.lines
        assert result.code == 1, result.lines

    def test_a_wheel_not_in_the_lock(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.write()
        extra = tree.repo.root / "backend" / "vendor" / "wheels" / "extra-1.0-py3-none-any.whl"
        with zipfile.ZipFile(extra, "w") as archive:
            archive.writestr("extra-1.0.dist-info/METADATA", metadata("extra", "1.0", "MIT"))
        env = stub_env(tmp_path, stubs, STUB_SITE=str(tree.site))

        result = run(tree.repo, [sys.executable, SCRIPT], env)

        assert_failed(
            result, ["Modified dependency: extra-1.0-py3-none-any.whl is not in wheels.lock."]
        )

    def test_a_wheel_whose_sha256_differs(self, tree: Tree, stubs: Stubs, tmp_path: Path) -> None:
        tree.write()
        lock_path = tree.repo.root / "backend" / "vendor" / "wheels.lock"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["wheels"][0]["sha256"] = "0" * 64
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        env = stub_env(tmp_path, stubs, STUB_SITE=str(tree.site))

        result = run(tree.repo, [sys.executable, SCRIPT], env)

        assert_failed(
            result, [f"Modified dependency: {WHEEL} does not match its sha256 in wheels.lock."]
        )


class TestOrderAndCount:
    """Modifications first, then packages sorted by ecosystem and name; then the count."""

    def test_several_problems_in_order_with_the_plural(
        self, tree: Tree, stubs: Stubs, tmp_path: Path
    ) -> None:
        tree.repo.write("frontend/patches/front-a+1.0.0.patch", ["--- a", "+++ b"])
        tree.wheels[WHEEL] = ("fixwheel", "MIT")
        tree.pypi["zeta-lib"] = ("0.3.0", "MPL-2.0", ["main"])
        tree.pypi["alpha-lib"] = ("1.0.0", "AGPL-3.0-only", ["main"])
        tree.npm["node_modules/front-z"] = {"version": "9.0.0", "license": "0BSD"}

        result = check(tree, stubs, tmp_path)

        assert_failed(
            result,
            [
                "Modified dependency: patches folder frontend/patches.",
                "Not approved: npm front-z 9.0.0 (0BSD).",
                "Denied license: pypi alpha-lib 1.0.0 (AGPL-3.0-only).",
                "Not approved: pypi zeta-lib 0.3.0 (MPL-2.0).",
                "License changed: wheel fixwheel 1.0.0 is MIT, approved as BSD-3-Clause.",
            ],
        )


class TestApprovedList:
    """The clone's approved list: its shape, its order and the cases it must carry."""

    @pytest.fixture
    def packages(self) -> list[dict[str, Any]]:
        path = CLONE / APPROVED
        if not path.is_file():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        assert set(data) == {"packages"}
        return list(data["packages"])

    def test_every_entry_has_its_fields(self, packages: list[dict[str, Any]]) -> None:
        assert packages, f"{APPROVED} is missing or empty."
        for item in packages:
            assert set(item) <= {"ecosystem", "name", "license", "reason", "bundled"}, item
            assert item["ecosystem"] in ("pypi", "npm", "wheel"), item
            assert item["name"], item
            assert item["license"], item
            assert item["reason"].strip(), item
            assert "\n" not in item["reason"], item
            bundled = item.get("bundled", [])
            assert isinstance(bundled, list), item
            assert all(isinstance(b, str) for b in bundled), item

    def test_entries_are_sorted_by_ecosystem_then_name(
        self, packages: list[dict[str, Any]]
    ) -> None:
        keys = [(p["ecosystem"], p["name"]) for p in packages]
        assert keys, f"{APPROVED} is missing or empty."
        assert keys == sorted(keys)
        assert len(keys) == len(set(keys))

    def test_no_entry_holds_a_version(self, packages: list[dict[str, Any]]) -> None:
        assert packages, f"{APPROVED} is missing or empty."
        assert all("version" not in p for p in packages)

    @pytest.mark.parametrize(
        ("ecosystem", "name", "license_expression"),
        [
            ("pypi", "asyncssh", "EPL-2.0"),
            ("pypi", "certifi", "MPL-2.0"),
        ],
    )
    def test_known_licenses(
        self,
        packages: list[dict[str, Any]],
        ecosystem: str,
        name: str,
        license_expression: str,
    ) -> None:
        found = [p for p in packages if (p["ecosystem"], p["name"]) == (ecosystem, name)]
        assert [p["license"] for p in found] == [license_expression]

    def test_tlslite_ng_is_lgpl(self, packages: list[dict[str, Any]]) -> None:
        found = [p for p in packages if p["name"] == "tlslite-ng"]
        assert found
        assert all("LGPL" in p["license"] for p in found)

    @pytest.mark.parametrize(
        ("ecosystem", "name", "bundled"),
        [
            ("pypi", "python-tds", "pytds/lcid.py LGPL-3.0-or-later"),
            ("wheel", "cryptography", "libgcc_s GPL-3.0-or-later WITH GCC-exception-3.1"),
        ],
    )
    def test_bundled_files_under_another_license(
        self, packages: list[dict[str, Any]], ecosystem: str, name: str, bundled: str
    ) -> None:
        (found,) = [p for p in packages if (p["ecosystem"], p["name"]) == (ecosystem, name)]
        assert bundled in found.get("bundled", [])

    def test_apsw_wheels_name_libcrypt(self, packages: list[dict[str, Any]]) -> None:
        (found,) = [p for p in packages if (p["ecosystem"], p["name"]) == ("wheel", "apsw")]
        assert any(b.startswith("libcrypt ") for b in found.get("bundled", []))

    @pytest.mark.parametrize("name", ["apsw", "asyncssh", "ecdsa", "lxml", "psutil", "python-tds"])
    def test_packages_whose_metadata_names_no_license_are_listed(
        self, packages: list[dict[str, Any]], name: str
    ) -> None:
        assert [p for p in packages if p["name"] == name]
