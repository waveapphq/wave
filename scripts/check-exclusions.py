#!/usr/bin/env python3
"""Compare SonarQube Cloud marks and dismissed CodeQL alerts with tests/exclusions and the code."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

USAGE = "Usage: scripts/check-exclusions.py --sonarqube or --codeql"

SONAR_LIST = "tests/exclusions/sonarqube-cloud.md"
CODEQL_LIST = "tests/exclusions/codeql.md"
PROJECTS = {"backend": "waveapphq_wave-backend", "frontend": "waveapphq_wave-frontend"}
REPO_API = "/repos/waveapphq/wave/code-scanning"
COMMITS_API = "/repos/waveapphq/wave/commits"
CATEGORIES = (
    "/language:actions",
    "/language:javascript-typescript",
    "/language:python",
)
TOKEN_FILE = Path(".config") / "gh" / "waveapphq-read.token"

CODE_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".mjs")
SKIPPED_DIR = "backend/tests/scripts/"
COMMENT = re.compile(
    r"^\s*(?:#|//) (?:SonarQube|CodeQL) exclusion: ((?:SQ|CQL)-[A-Z]+-[0-9]{3})\s*$"
)
HEADING = re.compile(r"^### ((?:SQ|CQL)-[A-Z]+-[0-9]{3}): .+$")
SECTION_END = re.compile(r"^###? ")
RULE_LINE = "- **Rule**: "
ALERTS_LINE = "- **CodeQL alerts**: "
BACKTICKED = re.compile(r"`([^`]+)`")
ALERT_ITEM = re.compile(r"^([0-9]+)(?: to ([0-9]+))?$")
LOCAL_RELEASE = re.compile(r"^release/[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+[0-9]+)?$")
LOCAL_WORK = re.compile(r"^(fix|feature)/([0-9]+\.[0-9]+\.[0-9]+(-[a-z]+[0-9]+)?)-")
PULL_MERGE_REF = re.compile(r"^refs/pull/([0-9]+)/merge$")


class Stop(Exception):
    """An error that ends the run with exit 2 and its text."""


class Failed(Exception):
    """A finding that ends the run with exit 1 and its text, before any comparison."""


@dataclass
class Place:
    """What a part reads: the SonarQube branches and pull request, and the CodeQL ref."""

    branch: str
    ref: str
    pull_request: str | None = None
    work_branch: str | None = None
    sha: str | None = None


@dataclass
class Entry:
    """One list entry; value is the rule (SQ) or the alert numbers (CQL), None when unreadable."""

    entry_id: str
    line: int
    rule: str | None = None
    alerts: list[int] = field(default_factory=list)
    valid: bool = True


@dataclass
class IdComment:
    """An ID comment and the line it covers."""

    file: str
    line: int
    entry_id: str
    covered_line: int
    covered_hash: str


def plural(count: int, word: str, words: str) -> str:
    return f"{count} {word if count == 1 else words}"


def env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


# Git work tree


def git(root: Path | None, *args: str) -> str:
    done = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=False
    )
    if done.returncode != 0:
        raise Stop(done.stderr.strip() or f"git {' '.join(args)} failed")
    return done.stdout


def work_tree() -> Path:
    return Path(git(None, "rev-parse", "--show-toplevel").strip())


def read_lines(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [line.removesuffix("\r") for line in lines]


def line_hash(text: str) -> str:
    return hashlib.md5(
        "".join(text.split()).encode(), usedforsecurity=False
    ).hexdigest()


def id_comments(root: Path, prefix: str) -> list[IdComment]:
    """The ID comments of one tool in tracked code files under backend/ and frontend/."""
    found: list[IdComment] = []
    tracked = git(root, "ls-files", "-z", "--", "backend", "frontend").split("\0")
    for rel in sorted(t for t in tracked if t):
        if not rel.endswith(CODE_SUFFIXES) or rel.startswith(SKIPPED_DIR):
            continue
        path = root / rel
        if not path.is_file():
            continue
        lines = read_lines(path)
        for index, text in enumerate(lines):
            match = COMMENT.match(text)
            if match is None or not match.group(1).startswith(prefix + "-"):
                continue
            covered = lines[index + 1] if index + 1 < len(lines) else ""
            found.append(
                IdComment(rel, index + 1, match.group(1), index + 2, line_hash(covered))
            )
    return found


# Exclusion lists


def parse_alerts(text: str) -> list[int] | None:
    numbers: list[int] = []
    for item in text.strip().split(", "):
        match = ALERT_ITEM.match(item)
        if match is None:
            return None
        first = int(match.group(1))
        last = int(match.group(2) or first)
        if last < first:
            return None
        numbers.extend(range(first, last + 1))
    return numbers


def read_entries(root: Path, rel: str, prefix: str, failures: list[str]) -> list[Entry]:
    """Parse one list file; each entry it cannot read adds its failure line."""
    lines = read_lines(root / rel)
    entries: list[Entry] = []
    index = 0
    while index < len(lines):
        match = HEADING.match(lines[index])
        if match is None or not match.group(1).startswith(prefix + "-"):
            index += 1
            continue
        entry = Entry(match.group(1), index + 1)
        body: list[str] = []
        index += 1
        while index < len(lines) and not SECTION_END.match(lines[index]):
            body.append(lines[index])
            index += 1
        problem = (
            read_rule(entry, body) if prefix == "SQ" else read_alert_list(entry, body)
        )
        if problem is not None:
            entry.valid = False
            failures.append(
                f"{rel}:{entry.line}: {entry.entry_id} is not a valid entry: {problem}."
            )
        entries.append(entry)
    return entries


def read_rule(entry: Entry, body: list[str]) -> str | None:
    rules = [
        m.group(1)
        for b in body
        if b.startswith(RULE_LINE)
        if (m := BACKTICKED.search(b))
    ]
    if not rules:
        return "no Rule line"
    if len(rules) > 1:
        return "more than one Rule line"
    entry.rule = rules[0]
    return None


def read_alert_list(entry: Entry, body: list[str]) -> str | None:
    found = [b[len(ALERTS_LINE) :] for b in body if b.startswith(ALERTS_LINE)]
    if not found:
        return "no CodeQL alerts line"
    if len(found) > 1:
        return "more than one CodeQL alerts line"
    numbers = parse_alerts(found[0])
    if numbers is None:
        return "cannot read the alert list"
    entry.alerts = numbers
    return None


def carried_and_known(
    entries: list[Entry], comments: list[IdComment], rel: str, failures: list[str]
) -> None:
    """Every entry has an ID comment and every ID comment names an entry."""
    known = {e.entry_id for e in entries}
    carried = {c.entry_id for c in comments}
    for entry in entries:
        if entry.entry_id not in carried:
            failures.append(
                f"{entry.entry_id}: no code carries this ID. Add the comment above the flagged"
                f" line, or remove the entry from {rel}."
            )
    for comment in comments:
        if comment.entry_id not in known:
            failures.append(
                f"{comment.file}:{comment.line}: {comment.entry_id} has no entry in {rel}."
                " Add the entry, or remove the comment."
            )


# Where the script runs


def find_place(root: Path, part: str) -> Place:
    if os.environ.get("GITHUB_ACTIONS") == "true":
        event = os.environ.get("GITHUB_EVENT_NAME", "")
        if event == "pull_request":
            return pull_request_place(part)
        if event == "push":
            branch = os.environ.get("GITHUB_REF_NAME", "")
            return Place(
                branch, f"refs/heads/{branch}", sha=os.environ.get("GITHUB_SHA", "")
            )
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch == "master" or LOCAL_RELEASE.match(branch):
        return Place(branch, f"refs/heads/{branch}")
    work = LOCAL_WORK.match(branch)
    if work is not None:
        release = f"release/{work.group(2)}"
        return Place(release, f"refs/heads/{release}", work_branch=branch)
    raise Stop(
        f"{part} exclusions: cannot tell what to check on {branch}."
        " Check out master, a release branch, or a fix or feature branch."
    )


def pull_request_place(part: str) -> Place:
    github_ref = os.environ.get("GITHUB_REF", "")
    match = PULL_MERGE_REF.match(github_ref)
    if match is None:
        raise Stop(
            f"{part} exclusions: cannot tell what to check on {github_ref}."
            " Check out master, a release branch, or a fix or feature branch."
        )
    event_path = os.environ.get("GITHUB_EVENT_PATH", "")
    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
        sha = str(event["pull_request"]["head"]["sha"])
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise Stop(
            f"{part} exclusions: could not read {event_path}: {error}."
        ) from error
    number = match.group(1)
    return Place(
        os.environ.get("GITHUB_BASE_REF", ""),
        f"refs/pull/{number}/head",
        pull_request=number,
        sha=sha,
    )


# HTTP


def get_json(
    part: str, base: str, path: str, query: dict[str, str], token: str | None
) -> Any:
    url = base.rstrip("/") + path
    headers = {"Accept": "application/json", "User-Agent": "wave-check-exclusions"}
    if token is not None:
        headers["Accept"] = "application/vnd.github+json"
        headers["Authorization"] = f"Bearer {token}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(query)}", headers=headers, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise Stop(
            f"{part} exclusions: could not read {url}: HTTP {error.code} {error.reason}."
        ) from error
    except urllib.error.URLError as error:
        raise Stop(
            f"{part} exclusions: could not read {url}: {error.reason}."
        ) from error
    except (OSError, ValueError) as error:
        raise Stop(f"{part} exclusions: could not read {url}: {error}.") from error


# SonarQube part


@dataclass
class Mark:
    """A false positive issue of one project, its file in the work tree and its oldest comment."""

    file: str
    line: int
    rule: str
    hash: str
    first_comment: str | None


def sonar_marks(base: str, project: str, kind: str, value: str) -> list[Mark]:
    top = next(t for t, key in PROJECTS.items() if key == project)
    marks: list[Mark] = []
    page = 1
    while True:
        query = {
            "componentKeys": project,
            kind: value,
            "issueStatuses": "FALSE_POSITIVE",
            "additionalFields": "comments",
            "ps": "500",
            "p": str(page),
        }
        data = get_json("SonarQube", base, "/api/issues/search", query, None)
        for issue in data.get("issues", []):
            component = str(issue.get("component", ""))
            comments = sorted(
                issue.get("comments", []), key=lambda c: str(c.get("createdAt", ""))
            )
            marks.append(
                Mark(
                    f"{top}/{component.partition(':')[2]}",
                    int(issue.get("line", 0)),
                    str(issue.get("rule", "")),
                    str(issue.get("hash", "")),
                    str(comments[0].get("markdown", "")) if comments else None,
                )
            )
        total = int(data.get("paging", {}).get("total", 0))
        if page * 500 >= total:
            return marks
        page += 1


def sonar_lists_branch(base: str, project: str, branch: str) -> bool:
    data = get_json(
        "SonarQube", base, "/api/project_branches/list", {"project": project}, None
    )
    return any(b.get("name") == branch for b in data.get("branches", []))


def starts_with_id(text: str | None, entry_id: str) -> bool:
    return (
        text is not None
        and re.match(re.escape(entry_id) + r"(?![A-Za-z0-9-])", text) is not None
    )


def check_sonarqube(root: Path) -> tuple[list[str], str, str]:
    place = find_place(root, "SonarQube")
    base = os.environ.get("WAVE_EXCLUSIONS_SONAR_URL", "https://sonarcloud.io")
    failures: list[str] = []
    entries = read_entries(root, SONAR_LIST, "SQ", failures)
    comments = id_comments(root, "SQ")

    marks: list[Mark] = []
    work_listed = False
    for project in PROJECTS.values():
        marks += sonar_marks(base, project, "branch", place.branch)
        if place.pull_request is not None:
            marks += sonar_marks(base, project, "pullRequest", place.pull_request)
        if place.work_branch is not None and sonar_lists_branch(
            base, project, place.work_branch
        ):
            work_listed = True
            marks += sonar_marks(base, project, "branch", place.work_branch)
    if place.pull_request is not None:
        target = f"pull request {place.pull_request} and {place.branch}"
    elif work_listed:
        target = f"{place.work_branch} and {place.branch}"
    else:
        target = place.branch

    carried_and_known(entries, comments, SONAR_LIST, failures)
    rules = {e.entry_id: e.rule for e in entries if e.valid}
    marked: set[int] = set()
    for comment in comments:
        rule = rules.get(comment.entry_id)
        if rule is None:
            continue
        matching = [
            i
            for i, m in enumerate(marks)
            if m.file == comment.file
            and m.rule == rule
            and m.hash == comment.covered_hash
        ]
        if not matching:
            failures.append(
                f"{comment.file}:{comment.covered_line}: {rule} is not marked false positive on"
                f" {target}. Mark it in SonarQube Cloud with a comment that starts with"
                f" {comment.entry_id}."
            )
            continue
        for index in matching:
            if index in marked:
                continue
            marked.add(index)
            if not starts_with_id(marks[index].first_comment, comment.entry_id):
                failures.append(
                    f"{comment.file}:{comment.covered_line}: the false positive mark on {target}"
                    f" does not start with {comment.entry_id}. Edit the mark's comment."
                )
    for index, mark in enumerate(marks):
        if index not in marked:
            failures.append(
                f"{mark.file}:{mark.line}: {mark.rule} is marked false positive on {target} but"
                " has no matching SonarQube exclusion comment. Add the comment and the entry,"
                " or reopen the issue."
            )

    counts = (
        f"{plural(len(entries), 'entry', 'entries')},"
        f" {plural(len(comments), 'ID comment', 'ID comments')} and"
        f" {plural(len(marks), 'mark', 'marks')}"
    )
    return failures, f"SonarQube exclusions: {counts} match on {target}.", target


# CodeQL part


def github_token() -> str:
    token = os.environ.get("GH_TOKEN", "").strip()
    if token:
        return token
    path = Path.home() / TOKEN_FILE
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    raise Stop(
        "CodeQL exclusions: no token. Set GH_TOKEN or write a read token to"
        " ~/.config/gh/waveapphq-read.token."
    )


def wait_for_analyses(base: str, token: str, ref: str, sha: str) -> None:
    """Wait until GitHub has a CodeQL analysis of sha on ref in each category."""
    poll = env_int("WAVE_EXCLUSIONS_POLL_SECONDS", 30)
    wait = env_int("WAVE_EXCLUSIONS_WAIT_SECONDS", 1800)
    start = time.monotonic()
    deadline = start + wait
    query = {"ref": ref, "tool_name": "CodeQL", "per_page": "100"}
    while True:
        analyses = get_json("CodeQL", base, f"{REPO_API}/analyses", query, token)
        done = {a.get("category") for a in analyses if a.get("commit_sha") == sha}
        found = sum(1 for c in CATEGORIES if c in done)
        minutes = int(time.monotonic() - start) // 60
        print(
            f"Waiting for CodeQL analyses of {sha}: {found}/{len(CATEGORIES)} found,"
            f" {minutes} of {wait // 60} minutes",
            file=sys.stderr,
            flush=True,
        )
        if found == len(CATEGORIES):
            return
        if codeql_run_failed(base, token, sha):
            raise Failed(f"The CodeQL run for {sha} failed; no analysis to compare.")
        if time.monotonic() >= deadline:
            raise Stop(
                f"CodeQL exclusions: no CodeQL analysis for {sha} on {ref} after"
                f" {wait // 60} minutes. Re-run this job when code scanning has finished."
            )
        time.sleep(poll)


def codeql_run_failed(base: str, token: str, sha: str) -> bool:
    """Whether a CodeQL check run of sha ended in failure, so no analysis will come."""
    names = {f"Analyze ({c.split(':', 1)[1]})" for c in CATEGORIES}
    page = 1
    while True:
        query = {"per_page": "100", "page": str(page)}
        reply = get_json("CodeQL", base, f"{COMMITS_API}/{sha}/check-runs", query, token)
        runs = reply.get("check_runs", [])
        if any(r.get("name") in names and r.get("conclusion") == "failure" for r in runs):
            return True
        if len(runs) < 100:
            return False
        page += 1


def codeql_alerts(base: str, token: str, ref: str, state: str) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    page = 1
    while True:
        query = {
            "tool_name": "CodeQL",
            "ref": ref,
            "state": state,
            "per_page": "100",
            "page": str(page),
        }
        batch = get_json("CodeQL", base, f"{REPO_API}/alerts", query, token)
        alerts += [a for a in batch if a.get("tool", {}).get("name") == "CodeQL"]
        if len(batch) < 100:
            return alerts
        page += 1


def alert_rule(alert: dict[str, Any]) -> str:
    return str(alert.get("rule", {}).get("id", ""))


def check_codeql(root: Path) -> tuple[list[str], str, str]:
    place = find_place(root, "CodeQL")
    token = github_token()
    base = os.environ.get("WAVE_EXCLUSIONS_GITHUB_URL", "https://api.github.com")
    if place.sha is not None:
        wait_for_analyses(base, token, place.ref, place.sha)
    alerts = {
        state: {
            int(a["number"]): a for a in codeql_alerts(base, token, place.ref, state)
        }
        for state in ("open", "dismissed", "fixed")
    }
    failures: list[str] = []
    entries = read_entries(root, CODEQL_LIST, "CQL", failures)
    comments = id_comments(root, "CQL")

    listing: dict[int, list[str]] = {}
    for entry in entries:
        for number in entry.alerts:
            listing.setdefault(number, []).append(entry.entry_id)
            if number in alerts["open"]:
                failures.append(
                    f"{entry.entry_id}: alert {number} ({alert_rule(alerts['open'][number])}) is"
                    f" open on {place.ref}. Fix the code, or dismiss the alert."
                )

    matched = 0
    for number, alert in sorted(alerts["dismissed"].items()):
        owners = listing.get(number, [])
        if not owners:
            failures.append(
                f"Alert {number} ({alert_rule(alert)}) is dismissed but no entry lists it."
                f" Add it to an entry in {CODEQL_LIST}, or reopen the alert."
            )
            continue
        if len(owners) > 1:
            names = ", ".join(owners[:-1]) + " and " + owners[-1]
            failures.append(
                f"Alert {number} is listed by {names}. Keep it in one entry."
            )
        matched += 1

    carried_and_known(entries, comments, CODEQL_LIST, failures)
    counts = (
        f"{plural(len(entries), 'entry', 'entries')},"
        f" {plural(matched, 'alert', 'alerts')} and"
        f" {plural(len(comments), 'ID comment', 'ID comments')}"
    )
    return failures, f"CodeQL exclusions: {counts} match on {place.ref}.", place.ref


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in ("--sonarqube", "--codeql"):
        print(USAGE, file=sys.stderr)
        return 2
    part = "SonarQube" if argv[0] == "--sonarqube" else "CodeQL"
    try:
        root = work_tree()
        check = check_sonarqube if part == "SonarQube" else check_codeql
        failures, summary, target = check(root)
    except Stop as error:
        print(error, file=sys.stderr)
        return 2
    except Failed as error:
        print(error)
        return 1
    for failure in failures:
        print(failure)
    if failures:
        print(
            f"{part} exclusions: {plural(len(failures), 'mismatch', 'mismatches')} on {target}."
        )
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
