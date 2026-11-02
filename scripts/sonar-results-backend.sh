#!/usr/bin/env bash
# Show detailed SonarQube analysis results for the backend project.
# Provides actionable detail for all issue categories: bugs, vulnerabilities,
# code smells, security hotspots, and duplications.
# Requires SONAR_TOKEN and SONAR_URL environment variables to be set.
set -euo pipefail

if [ -z "${SONAR_TOKEN:-}" ]; then
  echo "ERROR: SONAR_TOKEN environment variable is not set" >&2
  exit 1
fi

if [ -z "${SONAR_URL:-}" ]; then
  echo "ERROR: SONAR_URL environment variable is not set" >&2
  exit 1
fi

SQ_URL="${SONAR_URL}"
PROJECT_KEY="wave-backend"

python3 << 'PYEOF'
import urllib.request, urllib.parse, json, os, sys, textwrap

SQ_URL = os.environ.get("SQ_URL", "http://192.168.100.230:9000")
PROJECT_KEY = os.environ.get("PROJECT_KEY", "wave-backend")
TOKEN = os.environ["SONAR_TOKEN"]

import base64
AUTH = "Basic " + base64.b64encode(f"{TOKEN}:".encode()).decode()
SEPARATOR = "-" * 90


def api(path):
    url = f"{SQ_URL}{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", AUTH)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def fetch_all_issues(issue_type):
    """Fetch all issues of a given type with pagination."""
    issues = []
    page = 1
    while True:
        params = urllib.parse.urlencode({
            "componentKeys": PROJECT_KEY,
            "types": issue_type,
            "statuses": "OPEN,CONFIRMED,REOPENED",
            "ps": 100,
            "p": page,
        })
        d = api(f"/api/issues/search?{params}")
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
        params = urllib.parse.urlencode({
            "projectKey": PROJECT_KEY,
            "status": "TO_REVIEW",
            "ps": 100,
            "p": page,
        })
        d = api(f"/api/hotspots/search?{params}")
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
        params = urllib.parse.urlencode({
            "component": PROJECT_KEY,
            "metricKeys": "duplicated_blocks,duplicated_lines",
            "qualifiers": "FIL",
            "metricSort": "duplicated_blocks",
            "s": "metric",
            "asc": "false",
            "ps": 100,
            "p": page,
        })
        d = api(f"/api/measures/component_tree?{params}")
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
    params = urllib.parse.urlencode({"key": file_key})
    return api(f"/api/duplications/show?{params}")


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
    d = api(f"/api/measures/component?component={PROJECT_KEY}&metricKeys={metrics}")
    m = {x["metric"]: x["value"] for x in d["component"]["measures"]}
    ratings = {"1.0": "A", "2.0": "B", "3.0": "C", "4.0": "D", "5.0": "E"}

    print()
    print(f"  Lines of Code:       {int(float(m.get('ncloc', 0))):,}")
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

# Duplications
dup_files = fetch_duplicated_files()
print_duplications(dup_files)

print(f"  Dashboard: {SQ_URL}/dashboard?id={PROJECT_KEY}")
print()
PYEOF
