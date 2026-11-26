"""A git work tree in tmp_path, stub tools on PATH and a runner for the scripts under test."""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

CLONE = Path(__file__).resolve().parents[3]

# Built at run time, so this file holds no literal system temp path.
SHARED_TEMP = "/" + "tmp"
SHARED_TEMP_PATTERN = re.compile(r"(?<![\w.})\-])" + re.escape(SHARED_TEMP) + r"\b")

# Environment variables every stub records with its call.
RECORDED_ENV = re.compile(r"^(WAVE_|SHARD_|TARGET_|SONAR_)")


class Repo:
    """A git work tree in tmp_path that the script runs in."""

    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True)
        self.git("init", "-q", "-b", "master")
        self.git("config", "user.email", "tests@example.com")
        self.git("config", "user.name", "Tests")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args: str) -> str:
        """Run git in the work tree and return its output."""
        done = subprocess.run(
            ["git", *args], cwd=self.root, capture_output=True, text=True, check=True
        )
        return done.stdout.strip()

    def write(self, rel: str, lines: list[str]) -> None:
        """Write a file, one string per line."""
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def line(self, rel: str, number: int) -> str:
        """Return one 1-based line of a file."""
        return (self.root / rel).read_text(encoding="utf-8").splitlines()[number - 1]

    def line_of(self, rel: str, text: str) -> int:
        """Return the 1-based number of the first line that equals text."""
        lines = (self.root / rel).read_text(encoding="utf-8").splitlines()
        return lines.index(text) + 1

    def commit(self) -> str:
        """Track every file and commit; return the commit sha."""
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "tree", "--allow-empty")
        return self.git("rev-parse", "HEAD")

    def checkout(self, branch: str) -> None:
        """Create and check out a branch at HEAD."""
        self.git("checkout", "-q", "-b", branch)

    def detach(self) -> None:
        """Detach HEAD at the current commit."""
        self.git("checkout", "-q", "--detach")


def copy_from_clone(repo: Repo, rel: str) -> Path:
    """Copy one file of the clone into the work tree at the same path, keeping its mode."""
    source = CLONE / rel
    target = repo.root / rel
    if source.is_file():
        # A missing file stays missing, so running it fails inside the test.
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return target


def refuse_shared_temp(repo: Repo, *rels: str) -> None:
    """Fail before running a script copy that still writes to the host's shared temp folder."""
    for rel in rels:
        path = repo.root / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if SHARED_TEMP_PATTERN.search(text):
            pytest.fail(f"{rel} still names {SHARED_TEMP}; the test does not run it.")


@dataclass
class Call:
    """One recorded call of a stub."""

    tool: str
    args: list[str]
    cwd: str
    env: dict[str, str] = field(default_factory=dict)

    @property
    def line(self) -> str:
        return " ".join(self.args)


STUB_HEAD = """#!{python}
import json
import os
import re
import subprocess
import sys
import time

RECORDED = re.compile({env!r})
TOOL = {tool!r}
ARGS = sys.argv[1:]
with open(os.environ["STUB_LOG"], "a", encoding="utf-8") as _log:
    _log.write(
        json.dumps(
            {{
                "tool": TOOL,
                "args": ARGS,
                "cwd": os.getcwd(),
                "env": {{k: v for k, v in os.environ.items() if RECORDED.match(k)}},
            }}
        )
        + "\\n"
    )
FAIL = set(filter(None, os.environ.get("STUB_FAIL", "").split(",")))
"""

# poetry: `poetry run <tool> ...` fails when the tool's name is in STUB_FAIL.
POETRY_BODY = """
if "run" in ARGS:
    tool = ARGS[ARGS.index("run") + 1]
    if tool == "typos":
        sys.stdin.read()
    sys.exit(1 if tool in FAIL else 0)
sys.exit(0)
"""

# npm and npx: the check a call stands for, by its words and its folder; build makes build/.
NODE_BODY = """
folder = os.getcwd()
if "--prefix" in ARGS:
    folder = os.path.abspath(ARGS[ARGS.index("--prefix") + 1])
e2e = folder.rstrip("/").endswith(os.path.join("tests", "e2e"))
words = " ".join(ARGS)
key = None
if "lint" in ARGS or "eslint" in words:
    key = "eslint"
elif "type-check" in ARGS or "tsc" in ARGS:
    key = "e2e-typescript" if e2e else "typescript"
elif "build" in ARGS:
    key = "build"
    os.makedirs(os.path.join(folder, "build"), exist_ok=True)
elif "test:coverage" in ARGS or "vitest" in words:
    key = "vitest"
sys.exit(1 if key in FAIL else 0)
"""

# A check script of the repo: fails when its key is in STUB_FAIL.
CHECK_BODY = """
sys.exit(1 if {key!r} in FAIL else 0)
"""

# podman: `run` runs the container's command on the host with mounts mapped to host paths.
PODMAN_BODY = """
VALUE_FLAGS = {
    "-v", "--volume", "-e", "--env", "-w", "--workdir", "--name", "--network", "--memory",
    "--memory-swap", "--sysctl", "--cpuset-cpus", "--user", "-u", "--entrypoint", "--mount",
    "--tmpfs", "--add-host", "--cpus", "--shm-size", "--env-file", "--label", "-l",
    "--pids-limit", "--security-opt", "--cap-add", "--hostname", "--ulimit", "--userns",
    "--ipc", "--pid", "--device",
}
if not ARGS or ARGS[0] != "run":
    sys.exit(0)
index = 1
volumes = []
env = {}
workdir = None
while index < len(ARGS) and ARGS[index].startswith("-"):
    flag = ARGS[index]
    if flag.startswith("--") and "=" in flag:
        name, value = flag.split("=", 1)
        index += 1
    elif flag in VALUE_FLAGS:
        name, value = flag, ARGS[index + 1]
        index += 2
    else:
        index += 1
        continue
    if name in ("-v", "--volume"):
        host, inside = value.split(":")[:2]
        volumes.append((inside, host))
    elif name in ("-e", "--env"):
        if "=" in value:
            key, val = value.split("=", 1)
        else:
            key, val = value, os.environ.get(value, "")
        env[key] = val
    elif name in ("-w", "--workdir"):
        workdir = value
command = ARGS[index + 1:]
volumes.sort(key=lambda pair: -len(pair[0]))


def on_host(text):
    for inside, host in volumes:
        text = text.replace(inside, host)
    return text


if not command:
    sys.exit(0)
child = {k: v for k, v in os.environ.items() if not k.startswith("WAVE_")}
child.update(env)
cwd = on_host(workdir) if workdir else os.getcwd()
sys.exit(subprocess.run([on_host(a) for a in command], cwd=cwd, env=child).returncode)
"""


class Stubs:
    """Stub tools on PATH and stub helper scripts in the work tree, all recording their calls."""

    def __init__(self, root: Path) -> None:
        self.bin = root / "bin"
        self.bin.mkdir(parents=True)
        self.log = root / "calls.jsonl"
        self.log.write_text("", encoding="utf-8")

    def _write(self, path: Path, tool: str, body: str) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        head = STUB_HEAD.format(python=sys.executable, tool=tool, env=RECORDED_ENV.pattern)
        path.write_text(head + body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return path

    def tool(self, name: str, body: str = "sys.exit(0)\n") -> Path:
        """A stub tool on PATH."""
        return self._write(self.bin / name, name, body)

    def script(self, repo: Repo, rel: str, body: str | None = None, key: str = "") -> Path:
        """A stub helper script in the work tree; with a key it fails when STUB_FAIL names it."""
        text = body if body is not None else CHECK_BODY.format(key=key or rel)
        return self._write(repo.root / rel, rel, text)

    def sourced(self, repo: Repo, rel: str) -> Path:
        """A stub shell file that a script sources; it records that it was read."""
        path = repo.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        record = json.dumps({"tool": rel, "args": [], "cwd": "", "env": {}})
        path.write_text(f"echo '{record}' >> \"$STUB_LOG\"\n", encoding="utf-8")
        return path

    def podman(self) -> Path:
        return self.tool("podman", PODMAN_BODY)

    def poetry(self) -> Path:
        return self.tool("poetry", POETRY_BODY)

    def node_tools(self) -> None:
        self.tool("npm", NODE_BODY)
        self.tool("npx", NODE_BODY)

    def calls(self, tool: str | None = None) -> list[Call]:
        """Every recorded call, in order, or those of one tool."""
        rows = [
            json.loads(line)
            for line in self.log.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        found = [Call(r["tool"], r["args"], r["cwd"], r.get("env", {})) for r in rows]
        return [c for c in found if tool is None or c.tool == tool]


def stub_env(tmp_path: Path, stubs: Stubs, **extra: str) -> dict[str, str]:
    """A clean environment: the stubs first on PATH, then only the system folders and node."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    temp = tmp_path / "temp"
    temp.mkdir(exist_ok=True)
    folders = [str(stubs.bin)]
    node = shutil.which("node")
    if node is not None:
        folders.append(str(Path(node).parent))
    folders += ["/usr/local/bin", "/usr/bin", "/bin"]
    env = {
        "PATH": os.pathsep.join(folders),
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "TERM": "dumb",
        "TMPDIR": str(temp),
        "GIT_CONFIG_NOSYSTEM": "1",
        "STUB_LOG": str(stubs.log),
    }
    env.update(extra)
    return env


@dataclass
class Run:
    """What one script run printed, both streams merged, and its exit code."""

    code: int
    lines: list[str]

    def has(self, pattern: str) -> bool:
        """Whether a whole line matches the anchored pattern."""
        return any(re.fullmatch(pattern, line) for line in self.lines)


def run(repo: Repo, command: list[str], env: dict[str, str], timeout: float = 45) -> Run:
    """Run a command in the work tree, stderr merged into stdout."""
    done = subprocess.run(
        command,
        cwd=repo.root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
        check=False,
    )
    return Run(done.returncode, done.stdout.splitlines())


def log_lines(run_result: Run, log: Path) -> list[str]:
    """The lines that name the log file, as `Log: <absolute path>`."""
    return [line for line in run_result.lines if line == f"Log: {log}"]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
