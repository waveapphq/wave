#!/usr/bin/env python3
"""Check every shipped dependency against scripts/dependency-licenses.json, and look for changes."""

import hashlib
import json
import re
import subprocess
import sys
import tomllib
import zipfile
from dataclasses import dataclass
from email.parser import HeaderParser
from pathlib import Path

ROOT = Path.cwd()
APPROVED = "scripts/dependency-licenses.json"
PYPROJECT = "backend/pyproject.toml"
POETRY_LOCK = "backend/poetry.lock"
PACKAGE_JSON = "frontend/package.json"
PACKAGE_LOCK = "frontend/package-lock.json"
WHEELS_LOCK = "backend/vendor/wheels.lock"
WHEELS_DIR = "backend/vendor/wheels"
NPM_REGISTRY = "https://registry.npmjs.org/"
UNKNOWN = "UNKNOWN"
# The patch files of E2E test images are part of those images, not of a shipped dependency.
ALLOWED_PATCHES = "tests/e2e/services/"
DENIED = re.compile(r"(?<![A-Za-z])A?GPL")
NPM_DEPENDENCY_KEYS = (
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
)

# Trove classifiers that name one SPDX license; any other names none.
CLASSIFIER_SPDX = {
    "MIT License": "MIT",
    "MIT No Attribution License (MIT-0)": "MIT-0",
    "Apache Software License": "Apache-2.0",
    "ISC License (ISCL)": "ISC",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "The Unlicense (Unlicense)": "Unlicense",
    "Python Software Foundation License": "PSF-2.0",
}

# Reads License-Expression, then the License classifiers, of every installed distribution.
VENV_READER = """
import importlib.metadata, json
found = {}
for dist in importlib.metadata.distributions():
    meta = dist.metadata
    name = meta["Name"]
    if name:
        found[name] = {
            "expression": meta.get("License-Expression"),
            "classifiers": [
                c for c in meta.get_all("Classifier") or [] if c.startswith("License ::")
            ],
        }
print(json.dumps(found))
"""


@dataclass(frozen=True)
class Package:
    ecosystem: str
    name: str
    version: str
    license: str


def normalize(name: str) -> str:
    """The PEP 503 form of a Python distribution name."""
    return re.sub(r"[-_.]+", "-", name).lower()


def resolve(expression: str | None, classifiers: list[str]) -> str:
    """The license of a distribution from its metadata, or UNKNOWN."""
    if expression and expression.strip():
        return expression.strip()
    names = [c.split(" :: ")[-1] for c in classifiers if c.count(" :: ") >= 2]
    if len(names) == 1:
        if names[0] in CLASSIFIER_SPDX:
            return CLASSIFIER_SPDX[names[0]]
        # A GPL classifier with no SPDX form still names a deny-list license.
        if "General Public License" in names[0] and "Lesser" not in names[0]:
            return names[0]
    return UNKNOWN


def read_json(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def read_toml(rel: str) -> dict:
    return tomllib.loads((ROOT / rel).read_text(encoding="utf-8"))


# Shipped packages


def pypi_packages() -> list[Package]:
    lock = read_toml(POETRY_LOCK)
    shipped = [p for p in lock.get("package", []) if "main" in p.get("groups", [])]
    reply = subprocess.run(
        ["poetry", "-P", "backend", "run", "python", "-c", VENV_READER],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if reply.returncode != 0:
        sys.exit(f"Could not read the backend venv through poetry: {reply.stderr.strip()}")
    installed = {
        normalize(name): meta for name, meta in json.loads(reply.stdout.splitlines()[-1]).items()
    }
    found = []
    for row in shipped:
        meta = installed.get(normalize(row["name"]), {})
        license_text = resolve(meta.get("expression"), meta.get("classifiers", []))
        found.append(Package("pypi", normalize(row["name"]), row["version"], license_text))
    return found


def npm_packages() -> list[Package]:
    found = []
    for path, row in read_json(PACKAGE_LOCK).get("packages", {}).items():
        if not path or row.get("dev") or row.get("devOptional") or row.get("link"):
            continue
        name = path.rsplit("node_modules/", 1)[-1]
        license_text = row.get("license")
        if not isinstance(license_text, str) or not license_text.strip():
            license_text = UNKNOWN
        found.append(Package("npm", name, row.get("version", ""), license_text.strip()))
    return found


def wheel_license(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            metas = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
            if not metas:
                return UNKNOWN
            text = archive.read(metas[0]).decode("utf-8", errors="replace")
    except (OSError, zipfile.BadZipFile):
        return UNKNOWN
    meta = HeaderParser().parsestr(text)
    classifiers = [c for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return resolve(meta.get("License-Expression"), classifiers)


def wheel_packages() -> list[Package]:
    found = []
    for row in read_json(WHEELS_LOCK).get("wheels", []):
        version = row["file"].split("-")[1]
        license_text = wheel_license(ROOT / WHEELS_DIR / row["file"])
        found.append(Package("wheel", normalize(row["package"]), version, license_text))
    return found


# Modifications


def source_kind(spec: str) -> str | None:
    """What a dependency spec or a resolved address points at outside a registry, if anything."""
    if spec.startswith(("git+", "git:", "git@", "github:", "gitlab:", "bitbucket:")):
        return "git"
    if spec.startswith("file:"):
        return "a file"
    if spec.startswith("link:"):
        return "a path"
    if spec.startswith(("http://", "https://")):
        return "a URL"
    return None


def pyproject_modifications() -> list[str]:
    data = read_toml(PYPROJECT)
    poetry = data.get("tool", {}).get("poetry", {})
    tables = [poetry.get("dependencies", {})]
    tables += [g.get("dependencies", {}) for g in poetry.get("group", {}).values()]
    found = []
    for table in tables:
        for name, spec in table.items():
            specs = spec if isinstance(spec, list) else [spec]
            for item in specs:
                if not isinstance(item, dict):
                    continue
                for key, kind in (("git", "git"), ("path", "a path"), ("url", "a URL")):
                    if key in item:
                        found.append(
                            f"Modified dependency: {name} comes from {kind} in {PYPROJECT}."
                        )
    project = data.get("project", {})
    lines = list(project.get("dependencies", []))
    for group in project.get("optional-dependencies", {}).values():
        lines += group
    for line in lines:
        if " @ " not in line:
            continue
        name, target = (part.strip() for part in line.split(" @ ", 1))
        kind = source_kind(target) or "a URL"
        found.append(f"Modified dependency: {name} comes from {kind} in {PYPROJECT}.")
    return found


def poetry_lock_modifications() -> list[str]:
    kinds = {"git": "git", "directory": "a path", "url": "a URL", "file": "a file"}
    found = []
    for row in read_toml(POETRY_LOCK).get("package", []):
        kind = kinds.get(row.get("source", {}).get("type", ""))
        if kind is not None:
            found.append(f"Modified dependency: {row['name']} comes from {kind} in {POETRY_LOCK}.")
    return found


def package_json_modifications() -> list[str]:
    data = read_json(PACKAGE_JSON)
    found = []
    names = set()
    for key in NPM_DEPENDENCY_KEYS:
        for name, spec in data.get(key, {}).items():
            names.add(name)
            kind = source_kind(spec)
            if kind is None and re.fullmatch(r"[\w.-]+/[\w.-]+(#.*)?", spec):
                kind = "git"
            if kind is not None:
                found.append(f"Modified dependency: {name} comes from {kind} in {PACKAGE_JSON}.")
    if "patch-package" in names:
        found.append(f"Modified dependency: patch-package in {PACKAGE_JSON}.")
    if "patchedDependencies" in data or "patchedDependencies" in data.get("pnpm", {}):
        found.append(f"Modified dependency: patchedDependencies in {PACKAGE_JSON}.")
    return found


def package_lock_modifications() -> list[str]:
    found = []
    for path, row in read_json(PACKAGE_LOCK).get("packages", {}).items():
        resolved = row.get("resolved")
        if not path or not isinstance(resolved, str) or resolved.startswith(NPM_REGISTRY):
            continue
        name = path.rsplit("node_modules/", 1)[-1]
        kind = source_kind(resolved) or "a path"
        found.append(f"Modified dependency: {name} comes from {kind} in {PACKAGE_LOCK}.")
    return found


def patches_folders() -> list[str]:
    listed = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    folders = set()
    for rel in filter(None, listed.split("\0")):
        parts = rel.split("/")[:-1]
        if "patches" in parts and not rel.startswith(ALLOWED_PATCHES):
            folders.add("/".join(parts[: parts.index("patches") + 1]))
    return [f"Modified dependency: patches folder {folder}." for folder in sorted(folders)]


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def wheel_modifications() -> list[str]:
    folder = ROOT / WHEELS_DIR
    if not folder.is_dir():
        return []
    pinned = {row["file"]: row["sha256"] for row in read_json(WHEELS_LOCK).get("wheels", [])}
    found = []
    for path in sorted(p for p in folder.iterdir() if p.is_file()):
        if path.name not in pinned:
            found.append(f"Modified dependency: {path.name} is not in wheels.lock.")
        elif digest(path) != pinned[path.name]:
            found.append(
                f"Modified dependency: {path.name} does not match its sha256 in wheels.lock."
            )
    return found


# The check


def package_problem(package: Package, approved: dict[tuple[str, str], str]) -> str | None:
    label = f"{package.ecosystem} {package.name} {package.version}"
    entry = approved.get((package.ecosystem, package.name))
    if entry is not None and (package.license == entry or package.license == UNKNOWN):
        return None
    if DENIED.search(package.license):
        return f"Denied license: {label} ({package.license})."
    if entry is not None:
        return f"License changed: {label} is {package.license}, approved as {entry}."
    return f"Not approved: {label} ({package.license})."


def main() -> int:
    approved = {
        (row["ecosystem"], row["name"]): row["license"] for row in read_json(APPROVED)["packages"]
    }
    problems = (
        pyproject_modifications()
        + poetry_lock_modifications()
        + package_json_modifications()
        + package_lock_modifications()
        + patches_folders()
        + wheel_modifications()
    )
    packages = sorted(
        set(pypi_packages() + npm_packages() + wheel_packages()),
        key=lambda p: (p.ecosystem, p.name, p.version),
    )
    for package in packages:
        problem = package_problem(package, approved)
        if problem is not None:
            problems.append(problem)

    for problem in problems:
        print(problem)
    if problems:
        noun = "problem" if len(problems) == 1 else "problems"
        print(f"License check failed: {len(problems)} {noun}.")
        return 1
    print(f"License check passed: {len(packages)} shipped packages approved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
