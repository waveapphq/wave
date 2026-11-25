"""A git work tree, a fake SonarQube Cloud and GitHub, and a runner for check-exclusions.py."""

import hashlib
import json
import os
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "check-exclusions.py"

BACKEND_KEY = "waveapphq_wave-backend"
FRONTEND_KEY = "waveapphq_wave-frontend"
ISSUES_PATH = "/api/issues/search"
BRANCHES_PATH = "/api/project_branches/list"
ALERTS_PATH = "/repos/waveapphq/wave/code-scanning/alerts"
ANALYSES_PATH = "/repos/waveapphq/wave/code-scanning/analyses"
CATEGORIES = ("/language:actions", "/language:javascript-typescript", "/language:python")

SONAR_LIST = "tests/exclusions/sonarqube-cloud.md"
CODEQL_LIST = "tests/exclusions/codeql.md"


def sq_id(name: str) -> str:
    """Build a SonarQube entry ID at run time, so no unregistered ID literal sits in the repo."""
    return "SQ-" + name


def cql_id(name: str) -> str:
    """Build a CodeQL entry ID at run time, so no unregistered ID literal sits in the repo."""
    return "CQL-" + name


def line_hash(text: str) -> str:
    """The issue hash SonarQube Cloud gives a line: md5 of the line with all whitespace removed."""
    return hashlib.md5("".join(text.split()).encode()).hexdigest()  # noqa: S324


@dataclass
class Recorded:
    """One request the fake server received."""

    path: str
    query: dict[str, str]
    headers: dict[str, str]


Reply = tuple[int, Any]


@dataclass
class FakeServices:
    """Serves recorded JSON for the SonarQube Cloud and GitHub endpoints the script reads."""

    url: str = ""
    requests: list[Recorded] = field(default_factory=list)
    sonar_marks: dict[tuple[str, str, str], list[dict[str, Any]]] = field(default_factory=dict)
    sonar_branches: dict[str, list[str]] = field(default_factory=dict)
    alerts: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    analyses: Callable[[int], list[dict[str, Any]]] = lambda _call: []
    failures: dict[str, int] = field(default_factory=dict)
    _analyses_calls: int = 0

    def requests_to(self, path: str) -> list[Recorded]:
        """Return the requests made to one path, in order."""
        return [r for r in self.requests if r.path == path]

    def add_marks(self, project: str, kind: str, value: str, *issues: dict[str, Any]) -> None:
        """Hold false positive issues of one project for a branch or a pull request."""
        self.sonar_marks.setdefault((project, kind, value), []).extend(issues)

    def analyses_for(self, ref: str, sha: str, categories: tuple[str, ...] = CATEGORIES) -> None:
        """Answer the analyses list with one CodeQL analysis per category for ref at sha."""
        found = [
            {"ref": ref, "commit_sha": sha, "category": c, "tool": {"name": "CodeQL"}}
            for c in categories
        ]
        self.analyses = lambda _call: found

    def reply(self, path: str, query: dict[str, str]) -> Reply:
        """Build the reply for one request."""
        if path in self.failures:
            return self.failures[path], {"message": "Server Error"}
        if path == ISSUES_PATH:
            kind = "pullRequest" if "pullRequest" in query else "branch"
            issues = self.sonar_marks.get(
                (query.get("componentKeys", ""), kind, query.get(kind, ""))
            )
            page_issues = (issues or []) if query.get("p", "1") == "1" else []
            total = len(issues or [])
            return 200, {
                "total": total,
                "p": int(query.get("p", "1")),
                "ps": int(query.get("ps", "100")),
                "paging": {
                    "pageIndex": int(query.get("p", "1")),
                    "pageSize": int(query.get("ps", "100")),
                    "total": total,
                },
                "issues": page_issues,
                "components": [],
            }
        if path == BRANCHES_PATH:
            names = self.sonar_branches.get(query.get("project", ""), ["master"])
            return 200, {
                "branches": [
                    {
                        "name": n,
                        "isMain": n == "master",
                        "type": "LONG" if n == "master" else "SHORT",
                    }
                    for n in names
                ]
            }
        if path == ALERTS_PATH:
            if query.get("page", "1") != "1":
                return 200, []
            return 200, [
                a
                for a in self.alerts.get(query.get("ref", ""), [])
                if a["state"] == query.get("state")
                and a["tool"]["name"] == query.get("tool_name", a["tool"]["name"])
            ]
        if path == ANALYSES_PATH:
            self._analyses_calls += 1
            return 200, self.analyses(self._analyses_calls)
        return 404, {"message": "Not Found"}


def start_services() -> tuple[FakeServices, ThreadingHTTPServer]:
    """Start the fake server on a free local port."""
    services = FakeServices()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the http.server hook name
            parts = urlsplit(self.path)
            query = {k: v[-1] for k, v in parse_qs(parts.query).items()}
            services.requests.append(
                Recorded(parts.path, query, {k.lower(): v for k, v in self.headers.items()})
            )
            status, body = services.reply(parts.path, query)
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    services.url = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return services, server


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


def sonar_list(entries: list[tuple[str, str | None]], extra: list[str] | None = None) -> list[str]:
    """The SonarQube list file: one entry per (ID, rule); a None rule leaves the Rule line out."""
    lines = ["# SonarQube Cloud False Positives", "", "## Hashes", ""]
    for entry_id, rule in entries:
        lines += [f"### {entry_id}: A Test Entry", "", "- **Kind**: False positive"]
        if rule is not None:
            lines.append(f"- **Rule**: `{rule}`, A rule title")
        lines += ["", "The reason, in words.", ""]
    return lines + (extra or [])


def codeql_list(entries: list[tuple[str, str | None]], extra: list[str] | None = None) -> list[str]:
    """The CodeQL list file: one entry per (ID, alerts text); None leaves the alerts line out."""
    lines = ["# CodeQL Dismissals", "", "## Logging", ""]
    for entry_id, alerts in entries:
        lines += [
            f"### {entry_id}: A Test Entry",
            "",
            "- **Kind**: False positive",
            "- **Rule**: `py/clear-text-logging-sensitive-data`, A rule title",
        ]
        if alerts is not None:
            lines.append(f"- **CodeQL alerts**: {alerts}")
        lines += ["", "The reason, in words.", ""]
    return lines + (extra or [])


def sonar_mark(
    repo: Repo,
    rel: str,
    line: int,
    rule: str,
    comments: list[str],
    *,
    text: str | None = None,
    project: str | None = None,
    reported_line: int | None = None,
) -> dict[str, Any]:
    """A false positive issue on a repo file's line, hashed from the file unless text is given."""
    top, _, inner = rel.partition("/")
    key = project or (BACKEND_KEY if top == "backend" else FRONTEND_KEY)
    return {
        "key": f"issue-{rel}-{line}-{rule}",
        "rule": rule,
        "component": f"{key}:{inner}",
        "project": key,
        "line": reported_line or line,
        "hash": line_hash(text if text is not None else repo.line(rel, line)),
        "issueStatus": "FALSE_POSITIVE",
        "status": "RESOLVED",
        "resolution": "FALSE-POSITIVE",
        "comments": [
            {
                "key": f"comment-{n}",
                "login": "maintainer",
                "htmlText": body,
                "markdown": body,
                "updatable": False,
                "createdAt": f"2026-01-{n + 1:02d}T10:00:00+0000",
            }
            for n, body in enumerate(comments)
        ],
    }


def codeql_alert(
    number: int, state: str, rule: str, path: str, line: int, tool: str = "CodeQL"
) -> dict[str, Any]:
    """A code scanning alert as the GitHub alerts list returns it."""
    return {
        "number": number,
        "state": state,
        "rule": {"id": rule, "name": rule, "severity": "error"},
        "tool": {"name": tool, "guid": None, "version": "2.20.0"},
        "dismissed_reason": "false positive" if state == "dismissed" else None,
        "most_recent_instance": {
            "ref": "",
            "state": state,
            "location": {"path": path, "start_line": line, "end_line": line},
        },
    }


@dataclass
class Result:
    """What one script run printed and returned."""

    code: int
    stdout: list[str]
    stderr: list[str]

    @property
    def all_lines(self) -> list[str]:
        """Every line of both streams."""
        return self.stdout + self.stderr


def run_script(repo: Repo, env: dict[str, str], *flags: str) -> Result:
    """Run the script from the clone with the work tree as its current directory."""
    done = subprocess.run(
        [sys.executable, str(SCRIPT), *flags],
        cwd=repo.root,
        env=env,
        capture_output=True,
        text=True,
        timeout=40,
        check=False,
    )
    return Result(done.returncode, done.stdout.splitlines(), done.stderr.splitlines())


def script_env(home: Path, services: FakeServices, **extra: str) -> dict[str, str]:
    """A clean environment: no GitHub Actions variables, no token, the fake services' URLs."""
    home.mkdir(parents=True, exist_ok=True)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "GIT_CONFIG_NOSYSTEM": "1",
        "WAVE_EXCLUSIONS_SONAR_URL": services.url,
        "WAVE_EXCLUSIONS_GITHUB_URL": services.url,
        "WAVE_EXCLUSIONS_POLL_SECONDS": "0",
        "WAVE_EXCLUSIONS_WAIT_SECONDS": "60",
    }
    env.update(extra)
    return env
