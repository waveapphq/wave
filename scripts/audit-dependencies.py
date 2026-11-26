#!/usr/bin/env python3
"""Audit the backend, remote host wheel, frontend and E2E dependencies for known vulnerabilities."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path

PIP_AUDIT_VERSION = "2.10.1"
ROOT = Path.cwd()
SEVERITIES = ("critical", "high", "moderate", "low", "unknown")
NPM_FOLDERS = (("frontend", "frontend"), ("e2e", "tests/e2e"))


@dataclass(frozen=True)
class Advisory:
    ecosystem: str
    package: str
    version: str
    id: str
    severity: str
    fix: str


class Unreachable(Exception):
    """A source that could not be reached, with its last error."""

    def __init__(self, source: str, error: str) -> None:
        super().__init__(error)
        self.source = source
        self.error = error


def last_line(text: str, fallback: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else fallback


# Python groups


def python_requirements() -> dict[str, list[str]]:
    lock = tomllib.loads((ROOT / "backend/poetry.lock").read_text(encoding="utf-8"))
    groups: dict[str, list[str]] = {"backend runtime": [], "backend dev": []}
    for row in lock.get("package", []):
        pin = f"{row['name']}=={row['version']}"
        if "main" in row.get("groups", []):
            groups["backend runtime"].append(pin)
        if "dev" in row.get("groups", []):
            groups["backend dev"].append(pin)
    wheels = json.loads((ROOT / "backend/vendor/wheels.lock").read_text(encoding="utf-8"))
    pins = {f"{row['package']}=={row['file'].split('-')[1]}" for row in wheels.get("wheels", [])}
    groups["remote host wheels"] = sorted(pins)
    return groups


def pip_audit_command(work: Path) -> str:
    given = os.environ.get("WAVE_PIP_AUDIT")
    if given:
        return given
    venv = work / "venv"
    # The backend venv's pip fills the throwaway venv, so the host Python needs no ensurepip.
    steps = [
        [sys.executable, "-m", "venv", "--without-pip", str(venv)],
        [
            "poetry",
            "-P",
            "backend",
            "run",
            "python",
            "-m",
            "pip",
            "--python",
            str(venv / "bin" / "python"),
            "install",
            "--quiet",
            f"pip-audit=={PIP_AUDIT_VERSION}",
        ],
    ]
    for step in steps:
        done = subprocess.run(step, cwd=ROOT, capture_output=True, text=True, check=False)
        if done.returncode != 0:
            raise Unreachable("pip-audit", last_line(done.stderr, "install failed"))
    return str(venv / "bin" / "pip-audit")


def pip_audit(command: str, work: Path, group: str, pins: list[str]) -> list[Advisory]:
    slug = group.replace(" ", "-")
    requirements = work / f"{slug}.txt"
    report = work / f"{slug}.json"
    requirements.write_text("".join(f"{pin}\n" for pin in pins), encoding="utf-8")
    done = subprocess.run(
        [
            command,
            "--requirement",
            str(requirements),
            "--no-deps",
            "--disable-pip",
            "--vulnerability-service",
            "osv",
            "--format",
            "json",
            "--output",
            str(report),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise Unreachable("pip-audit", last_line(done.stderr or done.stdout, "no report")) from None
    found = []
    for dependency in data.get("dependencies", []):
        version = dependency.get("version", "")
        for vuln in dependency.get("vulns", []):
            found.append(
                Advisory(
                    "pypi",
                    dependency["name"],
                    version,
                    vuln["id"],
                    "unknown",
                    first_fix(version, vuln.get("fix_versions") or []),
                )
            )
    return found


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version))


def first_fix(version: str, fixes: list[str]) -> str:
    """The lowest fix version above the installed one; a list can hold fixes of older lines."""
    above = [fix for fix in fixes if version_key(fix) > version_key(version)]
    return min(above, key=version_key) if above else "none"


# npm groups


def npm_audit(folder: str, runtime: bool) -> list[Advisory]:
    path = ROOT / folder
    command = [shutil.which("npm") or "npm", "audit", "--json"]
    if runtime:
        command.append("--omit=dev")
    done = subprocess.run(command, cwd=path, capture_output=True, text=True, check=False)
    try:
        data = json.loads(done.stdout)
    except ValueError:
        raise Unreachable("npm audit", last_line(done.stderr or done.stdout, "no report")) from None
    if "error" in data:
        error = data["error"]
        raise Unreachable("npm audit", str(error.get("summary") or error.get("code") or error))
    lock = json.loads((path / "package-lock.json").read_text(encoding="utf-8")).get("packages", {})
    found = []
    for name, item in data.get("vulnerabilities", {}).items():
        nodes = item.get("nodes") or [f"node_modules/{name}"]
        version = lock.get(nodes[0], {}).get("version", "")
        fix_available = item.get("fixAvailable")
        fix = "none"
        if isinstance(fix_available, dict) and fix_available.get("name") == name:
            fix = str(fix_available.get("version") or "none")
        for via in item.get("via", []):
            if not isinstance(via, dict):
                continue
            url = str(via.get("url", ""))
            advisory_id = url.rstrip("/").rsplit("/", 1)[-1] if url else str(via.get("source"))
            severity = via.get("severity", "")
            found.append(
                Advisory(
                    "npm",
                    name,
                    version,
                    advisory_id,
                    severity if severity in SEVERITIES else "unknown",
                    fix,
                )
            )
    return found


# The audit


def print_group(group: str, advisories: list[Advisory]) -> None:
    unique = sorted(set(advisories), key=lambda a: (a.package, a.id))
    counts = ", ".join(f"{sum(1 for a in unique if a.severity == s)} {s}" for s in SEVERITIES)
    print(f"{group}: {counts}")
    for a in unique:
        print(f"  {a.package} {a.version} {a.id} {a.severity} fix {a.fix}")


def plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def main() -> int:
    everything: list[Advisory] = []
    work = Path(tempfile.mkdtemp())
    try:
        command = pip_audit_command(work)
        for group, pins in python_requirements().items():
            advisories = pip_audit(command, work, group, pins)
            print_group(group, advisories)
            everything += advisories
        for label, folder in NPM_FOLDERS:
            for runtime in (True, False):
                advisories = npm_audit(folder, runtime)
                print_group(f"{label} {'runtime' if runtime else 'full'}", advisories)
                everything += advisories
    except Unreachable as stop:
        print(f"Vulnerability audit stopped: {stop.source} could not be reached ({stop.error}).")
        return 2
    finally:
        shutil.rmtree(work, ignore_errors=True)

    ids = {a.id for a in everything}
    packages = {(a.ecosystem, a.package) for a in everything}
    if not ids:
        print("Vulnerability audit: no known vulnerabilities.")
        return 0
    print(
        f"Vulnerability audit: {plural(len(ids), 'known vulnerability', 'known vulnerabilities')}"
        f" in {plural(len(packages), 'package', 'packages')}."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
