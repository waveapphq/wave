#!/usr/bin/env bash
# Show detailed SonarQube analysis results for the backend project.
# Provides actionable detail for all issue categories: bugs, vulnerabilities,
# code smells, security hotspots, duplications, and the quality gate with its conditions.
# Requires SONAR_TOKEN. SONAR_URL is optional and defaults to SonarQube Cloud.
# Usage: sonar-results-backend.sh [--fix] [--pr <number>]
#   --fix          also print each finding's flow and, once per rule, why it is an issue and how to fix it
#   --pr <number>  read that pull request's results and gate instead of the current branch's
# Exit 3 (NOT PROVEN): a fix or feature branch's analysis counts 0 lines while HEAD adds or modifies
# Python files under backend/ against its release branch; when HEAD changes none, 0 lines pass.
set -euo pipefail

USAGE="Usage: $0 [--fix] [--pr <number>]"
SHOW_FIX=0
PULL_REQUEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --fix) SHOW_FIX=1 ;;
    --pr) [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || { echo "$USAGE" >&2; exit 2; }; PULL_REQUEST="$2"; shift ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
  shift
done
export SONAR_SHOW_FIX="$SHOW_FIX"
export SONAR_RESULTS_PR="$PULL_REQUEST"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=sonar-env.sh
source "$SCRIPT_DIR/sonar-env.sh"

export PROJECT_KEY="waveapphq_wave-backend"
export SONAR_ORGANIZATION="waveapphq"
export REPO_ROOT
export PROJECT_FOLDER="backend"
export CODE_KIND="Python"
export CODE_SUFFIXES=".py"

python3 << 'PYEOF'
import urllib.request, urllib.parse, json, os, re, subprocess, sys, textwrap
from html.parser import HTMLParser

SQ_URL = os.environ["SONAR_URL"]
PROJECT_KEY = os.environ["PROJECT_KEY"]
BRANCH = os.environ["SONAR_BRANCH"]
TARGET = os.environ["SONAR_BRANCH_TARGET"]
PULL_REQUEST = os.environ["SONAR_RESULTS_PR"]
TOKEN = os.environ["SONAR_TOKEN"]
SHOW_FIX = os.environ["SONAR_SHOW_FIX"] == "1"
REPO_ROOT = os.environ["REPO_ROOT"]
PROJECT_FOLDER = os.environ["PROJECT_FOLDER"]
CODE_KIND = os.environ["CODE_KIND"]
CODE_SUFFIXES = tuple(os.environ["CODE_SUFFIXES"].split())
# SonarQube Cloud looks rules up within an organization; another server has none.
RULE_SCOPE = {"organization": os.environ["SONAR_ORGANIZATION"]} if SQ_URL == "https://sonarcloud.io" else {}
# Every scoped read takes the pull request with --pr, else the current branch.
SCOPE = {"pullRequest": PULL_REQUEST} if PULL_REQUEST else ({"branch": BRANCH} if BRANCH else {})

import base64
AUTH = "Basic " + base64.b64encode(f"{TOKEN}:".encode()).decode()
SEPARATOR = "-" * 90
RULE_SECTIONS = (
    ("root_cause", "Why is this an issue"),
    ("assess_the_problem", "Assess the risk"),
    ("how_to_fix", "How to fix"),
)


def api(path, params, scoped=True):
    if scoped:
        params = {**params, **SCOPE}
    url = f"{SQ_URL}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", AUTH)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def fetch_all_issues(issue_type):
    """Fetch all issues of a given type with pagination."""
    issues = []
    page = 1
    while True:
        d = api("/api/issues/search", {
            "componentKeys": PROJECT_KEY,
            "types": issue_type,
            "statuses": "OPEN,CONFIRMED,REOPENED",
            "ps": 100,
            "p": page,
        })
        issues.extend(d.get("issues", []))
        total = d["paging"]["total"]
        if page * 100 >= total:
            break
        page += 1
    return issues, total


def fetch_all_hotspots():
    """Fetch all security hotspots with pagination."""
    hotspots = []
    page = 1
    while True:
        d = api("/api/hotspots/search", {
            "projectKey": PROJECT_KEY,
            "status": "TO_REVIEW",
            "ps": 100,
            "p": page,
        })
        hotspots.extend(d.get("hotspots", []))
        total = d["paging"]["total"]
        if page * 100 >= total:
            break
        page += 1
    return hotspots, total


def fetch_duplicated_files():
    """Fetch files that have duplicated blocks, sorted by count descending."""
    files = []
    page = 1
    while True:
        d = api("/api/measures/component_tree", {
            "component": PROJECT_KEY,
            "metricKeys": "duplicated_blocks,duplicated_lines",
            "qualifiers": "FIL",
            "metricSort": "duplicated_blocks",
            "s": "metric",
            "asc": "false",
            "ps": 100,
            "p": page,
        })
        for comp in d.get("components", []):
            measures = {m["metric"]: int(m["value"]) for m in comp.get("measures", [])}
            blocks = measures.get("duplicated_blocks", 0)
            if blocks > 0:
                files.append({
                    "key": comp["key"],
                    "path": comp["path"],
                    "blocks": blocks,
                    "lines": measures.get("duplicated_lines", 0),
                })
        total = d["paging"]["total"]
        if page * 100 >= total:
            break
        page += 1
    return files


def fetch_duplication_detail(file_key):
    """Fetch duplication details for a specific file."""
    return api("/api/duplications/show", {"key": file_key})


def zero_line_check(ncloc):
    """At 0 lines on a fix or feature branch: HEAD, the code files it adds or modifies here against its release branch, and a Lines of Code note."""
    if ncloc or not TARGET or PULL_REQUEST:
        return "", [], ""

    def git(*args):
        return subprocess.run(["git", "-C", REPO_ROOT, *args], check=True, capture_output=True, text=True).stdout

    try:
        head = git("rev-parse", "HEAD").strip()
        base = git("merge-base", "HEAD", f"origin/{TARGET}").strip()
        names = git("diff", "--name-only", "--no-renames", "--diff-filter=AM", "-z", base, "HEAD", "--", f"{PROJECT_FOLDER}/")
    except (subprocess.CalledProcessError, OSError) as e:
        print(f"  ERROR comparing HEAD with origin/{TARGET}: {getattr(e, 'stderr', '').strip() or e}")
        sys.exit(1)
    unseen = [name for name in names.split("\0") if name.endswith(CODE_SUFFIXES)]
    note = "" if unseen else f" (no code changed: {head[:12]} adds or modifies no {CODE_KIND} file under {PROJECT_FOLDER}/ against {TARGET})"
    return head, unseen, note


def print_gate():
    """The quality gate of the branch or pull request read above, with each condition and its limit."""
    try:
        gate = api("/api/qualitygates/project_status", {"projectKey": PROJECT_KEY})["projectStatus"]
    except Exception as e:
        print(f"  ERROR fetching the quality gate: {e}")
        sys.exit(1)
    print(f"  Quality Gate:        {gate['status']}")
    for c in gate.get("conditions", []):
        limit = {"LT": "fails below", "GT": "fails above"}.get(c.get("comparator"), c.get("comparator", "?"))
        print(f"    {c['status']:<5}  {c['metricKey']}: {c.get('actualValue', '?')}, {limit} {c.get('errorThreshold', '?')}")


class RuleText(HTMLParser):
    """A rule description as plain text lines, with code blocks kept as written."""

    BLOCKS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "li", "tr", "br"}

    def __init__(self):
        super().__init__()
        self.lines = []
        self.buffer = ""
        self.in_code = False

    def flush(self):
        if self.in_code:
            self.lines.extend(("code", line) for line in self.buffer.strip("\n").split("\n"))
        elif self.buffer.strip() not in ("", "-"):
            self.lines.append(("text", self.buffer.strip()))
        self.buffer = ""

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.flush()
            self.in_code = True
        elif tag in self.BLOCKS and not self.in_code:
            self.flush()
            if tag == "li":
                self.buffer = "- "

    def handle_endtag(self, tag):
        if tag == "pre":
            self.flush()
            self.in_code = False
        elif tag in self.BLOCKS and not self.in_code:
            self.flush()

    def handle_data(self, data):
        self.buffer += data if self.in_code else re.sub(r"\s+", " ", data)


def rule_text(html):
    parser = RuleText()
    parser.feed(html)
    parser.close()
    parser.flush()
    return parser.lines


def print_flows(issue):
    """Each flow of a finding; a security finding's flow runs from the input to the issue."""
    for n, flow in enumerate(issue.get("flows", []), 1):
        print(f"     Flow {n}:")
        for step in reversed(flow.get("locations", [])):
            step_file = step["component"].split(":")[-1]
            step_line = step.get("textRange", {}).get("startLine", "?")
            print(f"       {step_file}:{step_line}  {step.get('msg', '')}")


def print_rule_help(findings):
    """Once per rule of the open findings: why it is an issue and how to fix it."""
    contexts = {}
    for finding in findings:
        rule = finding.get("rule") or finding.get("ruleKey")
        context = finding.get("ruleDescriptionContextKey")
        contexts.setdefault(rule, set()).update({context} if context else set())
    if not contexts:
        return

    print(f"\n  How to fix ({len(contexts)} rules):")
    print(f"  {SEPARATOR}")
    for rule in sorted(contexts):
        r = api("/api/rules/show", {"key": rule, **RULE_SCOPE}, scoped=False)["rule"]
        print(f"  {rule}: {r.get('name', '')}")
        for key, title in RULE_SECTIONS:
            for section in r.get("descriptionSections", []):
                context = section.get("context", {})
                if section["key"] != key or (contexts[rule] and context and context["key"] not in contexts[rule]):
                    continue
                print(f"\n    {title}" + (f" ({context['displayName']})" if context else ""))
                for kind, text in rule_text(section["content"]):
                    if kind == "code":
                        print(f"       | {text}")
                    else:
                        for wrapped in textwrap.wrap(text, width=82, subsequent_indent="  " if text.startswith("- ") else ""):
                            print(f"     {wrapped}")
        print()


def print_issues(issues, label):
    """Print detailed issue list."""
    if not issues:
        print(f"\n  No open {label.lower()}.")
        return

    print(f"\n  {label} ({len(issues)}):")
    print(f"  {SEPARATOR}")

    for i, issue in enumerate(issues, 1):
        f = issue["component"].split(":")[-1]
        line = issue.get("line", "?")
        severity = issue.get("severity", "?")
        rule = issue.get("rule", "?")
        message = issue.get("message", "")
        effort = issue.get("effort", "")

        print(f"  {i}. [{severity}] {f}:{line}")
        print(f"     Rule: {rule}")
        for msg_line in textwrap.wrap(message, width=80):
            print(f"     {msg_line}")
        if effort:
            print(f"     Effort: {effort}")
        if SHOW_FIX:
            print_flows(issue)
        print()


def print_hotspots(hotspots):
    """Print detailed security hotspot list."""
    if not hotspots:
        print("\n  No open security hotspots.")
        return

    print(f"\n  Security Hotspots - TO_REVIEW ({len(hotspots)}):")
    print(f"  {SEPARATOR}")

    for i, h in enumerate(hotspots, 1):
        f = h["component"].split(":")[-1]
        line = h.get("line", "?")
        message = h.get("message", "")
        category = h.get("securityCategory", "?")
        probability = h.get("vulnerabilityProbability", "?")
        rule = h.get("ruleKey", h.get("key", "?"))

        print(f"  {i}. [{probability}] {f}:{line}")
        print(f"     Category: {category}")
        print(f"     Rule: {rule}")
        for msg_line in textwrap.wrap(message, width=80):
            print(f"     {msg_line}")
        print()


def print_duplications(dup_files):
    """Print detailed duplication information."""
    if not dup_files:
        print("\n  No duplicated code blocks.")
        return

    total_blocks = sum(f["blocks"] for f in dup_files)
    total_lines = sum(f["lines"] for f in dup_files)
    print(f"\n  Duplicated Files ({len(dup_files)} files, {total_blocks} blocks, {total_lines} lines):")
    print(f"  {SEPARATOR}")

    for df in dup_files:
        print(f"\n  {df['path']}  ({df['blocks']} blocks, {df['lines']} dup lines)")
        try:
            detail = fetch_duplication_detail(df["key"])
            files_data = detail.get("files", {})
            file_map = {}
            for ref, f in files_data.items():
                file_map[ref] = f.get("name", f.get("key", "?"))

            for dup in detail.get("duplications", []):
                blocks = dup.get("blocks", [])
                if len(blocks) < 2:
                    continue
                parts = []
                for b in blocks:
                    ref = str(b.get("_ref", b.get("ref", "")))
                    fname = file_map.get(ref, "?")
                    start = b.get("from", "?")
                    size = b.get("size", "?")
                    end = int(start) + int(size) - 1 if start != "?" and size != "?" else "?"
                    parts.append(f"{fname}:{start}-{end}")
                print(f"    {' <-> '.join(parts)}  ({blocks[0].get('size', '?')} lines)")
        except Exception as e:
            print(f"    (Could not fetch details: {e})")

    print()


# --- Main ---
print("=" * 90)
print("  WAVE Backend - SonarQube Detailed Results")
print("=" * 90)

# Summary metrics
try:
    metrics = "ncloc,coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells"
    metrics += ",security_hotspots,security_hotspots_reviewed"
    metrics += ",sqale_rating,reliability_rating,security_rating"
    d = api("/api/measures/component", {"component": PROJECT_KEY, "metricKeys": metrics})
    m = {x["metric"]: x["value"] for x in d["component"]["measures"]}
    ratings = {"1.0": "A", "2.0": "B", "3.0": "C", "4.0": "D", "5.0": "E"}
    ncloc = int(float(m.get("ncloc", 0)))
    head, unseen, lines_note = zero_line_check(ncloc)

    print()
    print(f"  Lines of Code:       {ncloc:,}{lines_note}")
    print(f"  Coverage:            {m.get('coverage', '?')}%")
    print(f"  Duplications:        {m.get('duplicated_lines_density', '?')}%")
    print()
    print(f"  Bugs:                {m.get('bugs', '0')}  (Reliability: {ratings.get(m.get('reliability_rating'), '?')})")
    print(f"  Vulnerabilities:     {m.get('vulnerabilities', '0')}  (Security: {ratings.get(m.get('security_rating'), '?')})")
    print(f"  Code Smells:         {m.get('code_smells', '0')}  (Maintainability: {ratings.get(m.get('sqale_rating'), '?')})")
    hs = m.get("security_hotspots", "0")
    hr = m.get("security_hotspots_reviewed", "")
    hs_str = f"{hs} ({hr}% reviewed)" if hr else hs
    print(f"  Security Hotspots:   {hs_str}")
except Exception as e:
    print(f"  ERROR fetching metrics: {e}")
    sys.exit(1)

print()
print_gate()

if unseen:
    print()
    print(f"NOT PROVEN: the scan analyzed 0 lines while {head[:12]} changed {len(unseen)} {CODE_KIND} file{'' if len(unseen) == 1 else 's'}")
    for path in unseen[:10]:
        print(f"  {path}")
    sys.exit(3)

# Bugs
bugs, _ = fetch_all_issues("BUG")
print_issues(bugs, "Bugs")

# Vulnerabilities
vulns, _ = fetch_all_issues("VULNERABILITY")
print_issues(vulns, "Vulnerabilities")

# Code Smells
smells, _ = fetch_all_issues("CODE_SMELL")
print_issues(smells, "Code Smells")

# Security Hotspots
hotspots, _ = fetch_all_hotspots()
print_hotspots(hotspots)

if SHOW_FIX:
    print_rule_help(bugs + vulns + smells + hotspots)

# Duplications
dup_files = fetch_duplicated_files()
print_duplications(dup_files)

dashboard = {"id": PROJECT_KEY, **SCOPE}
print(f"  Dashboard: {SQ_URL}/dashboard?{urllib.parse.urlencode(dashboard)}")
print()
PYEOF
