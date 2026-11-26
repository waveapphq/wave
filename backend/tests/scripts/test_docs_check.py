"""Tests for .github/scripts/docs-check.cjs, run by node with a fake GitHub client."""

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.scripts.script_support import CLONE

MODULE = CLONE / ".github" / "scripts" / "docs-check.cjs"
WORKFLOW = CLONE / ".github" / "workflows" / "docs-check.yml"
BRANCH = "fix/1.0.0-alpha62-docs-check"
DOCS_URL = "https://github.com/waveapphq/wave-docs/pull/"
NO_BOX = "Its description ticks no box and links no docs pull request."
NO_DOCS = "No docs change needed."

# Loads the module, answers pulls.get from the given docs pull requests, prints the result.
RUNNER = """
const check = require(process.argv[2])
const input = JSON.parse(process.argv[3])
const calls = []
const github = {
  rest: {
    pulls: {
      get: async ({ owner, repo, pull_number }) => {
        calls.push({ owner, repo, pull_number })
        const found = input.docs[String(pull_number)]
        if (!found) {
          const error = new Error('Not Found')
          error.status = 404
          throw error
        }
        return { data: found }
      },
    },
  },
}
check({ github, pr: input.pr }).then(
  (result) => console.log(JSON.stringify({ result, calls })),
  (error) => {
    console.error(error)
    process.exit(3)
  },
)
"""


def waiting(number: int) -> str:
    return f"Waiting for waveapphq/wave-docs#{number} to merge. Re-run this check after the merge."


def pull_request(body: str | None, ref: str = BRANCH, owner: str = "waveapphq") -> dict[str, Any]:
    """The pull_request payload of the event, with the fields the check reads."""
    return {
        "number": 95,
        "body": body,
        "head": {"ref": ref, "sha": "a" * 40, "repo": {"full_name": f"{owner}/wave"}},
        "base": {"ref": "release/1.0.0-alpha62", "repo": {"full_name": "waveapphq/wave"}},
    }


def docs_pull(
    ref: str = BRANCH, state: str = "open", merged_at: str | None = None
) -> dict[str, Any]:
    return {"head": {"ref": ref}, "state": state, "merged_at": merged_at}


def template(no_docs: str = " ", link_box: str = " ", link: str = "NUMBER") -> str:
    """The pull request template's Docs part, with each box and the link filled in."""
    return "\n".join(
        [
            "<!-- Link the issue of this change. -->",
            "Closes #12",
            "",
            "## Docs",
            "",
            "Put an x in one of these:",
            "",
            f"- [{no_docs}] No docs change needed",
            f"- [{link_box}] Docs pull request link: {DOCS_URL}{link}",
        ]
    )


def check(
    tmp_path: Path, pr: dict[str, Any], docs: dict[str, dict[str, Any]] | None = None
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Run the module's check and return its result and the pulls.get calls."""
    if not MODULE.is_file():
        pytest.fail(".github/scripts/docs-check.cjs does not exist in the clone.")
    node = shutil.which("node")
    assert node is not None, "node is not on PATH"
    runner = tmp_path / "runner.cjs"
    runner.write_text(RUNNER, encoding="utf-8")
    done = subprocess.run(
        [node, str(runner), str(MODULE), json.dumps({"pr": pr, "docs": docs or {}})],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    out = json.loads(done.stdout.strip().splitlines()[-1])
    return out["result"], out["calls"]


class TestNoDocsBox:
    """A ticked "No docs change needed" line of the template passes."""

    def test_the_ticked_line_passes(self, tmp_path: Path) -> None:
        result, calls = check(tmp_path, pull_request(template(no_docs="x")))

        assert result == {"state": "success", "text": NO_DOCS}
        assert calls == []

    def test_the_unticked_template_fails(self, tmp_path: Path) -> None:
        result, calls = check(tmp_path, pull_request(template()))

        assert result == {"state": "failure", "text": NO_BOX}
        assert calls == []

    def test_an_empty_description_fails(self, tmp_path: Path) -> None:
        result, _calls = check(tmp_path, pull_request(None))

        assert result == {"state": "failure", "text": NO_BOX}

    def test_the_words_without_the_ticked_box_count_for_nothing(self, tmp_path: Path) -> None:
        body = "No docs change needed, the change is in the CI scripts.\n" + template()

        result, _calls = check(tmp_path, pull_request(body))

        assert result == {"state": "failure", "text": NO_BOX}

    def test_a_ticked_line_inside_an_html_comment_counts_for_nothing(self, tmp_path: Path) -> None:
        body = "<!--\n- [x] No docs change needed\n-->\n" + template()

        result, _calls = check(tmp_path, pull_request(body))

        assert result == {"state": "failure", "text": NO_BOX}

    def test_a_ticked_line_inside_a_comment_rebuilt_by_a_removal_counts_for_nothing(
        self, tmp_path: Path
    ) -> None:
        # Removing the inner comment once leaves "<!-- hidden ... -->" around the ticked line.
        body = "<!<!-- x -->-- hidden\n- [x] No docs change needed\n-->\n" + template()

        result, _calls = check(tmp_path, pull_request(body))

        assert result == {"state": "failure", "text": NO_BOX}


class TestDocsLinkBox:
    """A ticked "Docs pull request link:" line is followed; a link anywhere else is not."""

    def test_a_ticked_link_to_a_merged_pull_request_passes(self, tmp_path: Path) -> None:
        docs = {"41": docs_pull(state="closed", merged_at="2026-11-20T10:00:00Z")}

        result, calls = check(tmp_path, pull_request(template(link_box="x", link="41")), docs)

        assert result == {"state": "success", "text": "waveapphq/wave-docs#41 is merged."}
        assert calls == [{"owner": "waveapphq", "repo": "wave-docs", "pull_number": 41}]

    def test_a_ticked_link_to_an_open_pull_request_waits(self, tmp_path: Path) -> None:
        docs = {"41": docs_pull()}

        result, _calls = check(tmp_path, pull_request(template(link_box="x", link="41")), docs)

        assert result == {
            "state": "pending",
            "text": waiting(41),
        }

    def test_a_ticked_link_on_another_branch_fails(self, tmp_path: Path) -> None:
        docs = {"41": docs_pull(ref="fix/1.0.0-alpha62-other")}

        result, _calls = check(tmp_path, pull_request(template(link_box="x", link="41")), docs)

        assert result == {
            "state": "failure",
            "text": f"Docs pull request 41 is on the branch fix/1.0.0-alpha62-other, not {BRANCH}.",
        }

    def test_a_ticked_link_to_a_closed_pull_request_fails(self, tmp_path: Path) -> None:
        docs = {"41": docs_pull(state="closed")}

        result, _calls = check(tmp_path, pull_request(template(link_box="x", link="41")), docs)

        assert result == {
            "state": "failure",
            "text": "Docs pull request 41 was closed without a merge.",
        }

    def test_a_ticked_link_to_a_missing_pull_request_fails(self, tmp_path: Path) -> None:
        result, _calls = check(tmp_path, pull_request(template(link_box="x", link="41")), {})

        assert result == {"state": "failure", "text": "Docs pull request 41 was not found."}

    def test_a_link_on_the_unticked_line_counts_for_nothing(self, tmp_path: Path) -> None:
        docs = {"41": docs_pull(state="closed", merged_at="2026-11-20T10:00:00Z")}

        result, calls = check(tmp_path, pull_request(template(link="41")), docs)

        assert result == {"state": "failure", "text": NO_BOX}
        assert calls == []

    @pytest.mark.parametrize(
        "extra",
        [
            f"The docs change is in {DOCS_URL}41.",
            f"- {DOCS_URL}41",
            f"- [x] See {DOCS_URL}41",
        ],
        ids=["sentence", "list-item", "other-ticked-line"],
    )
    def test_a_link_anywhere_else_counts_for_nothing(self, tmp_path: Path, extra: str) -> None:
        docs = {"41": docs_pull(state="closed", merged_at="2026-11-20T10:00:00Z")}
        body = template() + "\n\n" + extra

        result, calls = check(tmp_path, pull_request(body), docs)

        assert result == {"state": "failure", "text": NO_BOX}
        assert calls == []

    def test_only_the_ticked_line_is_followed_when_the_body_links_others(
        self, tmp_path: Path
    ) -> None:
        docs = {
            "41": docs_pull(state="closed", merged_at="2026-11-20T10:00:00Z"),
            "52": docs_pull(),
        }
        body = f"See {DOCS_URL}41 for context.\n" + template(link_box="x", link="52")

        result, calls = check(tmp_path, pull_request(body), docs)

        assert result == {
            "state": "pending",
            "text": waiting(52),
        }
        assert calls == [{"owner": "waveapphq", "repo": "wave-docs", "pull_number": 52}]


class TestReleaseBranch:
    """A release branch of this repo needs no docs pull request."""

    def test_a_release_branch_of_this_repo_passes(self, tmp_path: Path) -> None:
        pr = pull_request(template(), ref="release/1.0.0-alpha62")

        result, _calls = check(tmp_path, pr)

        assert result == {
            "state": "success",
            "text": "A release branch needs no docs pull request.",
        }

    def test_a_release_branch_of_a_fork_is_checked(self, tmp_path: Path) -> None:
        pr = pull_request(template(), ref="release/1.0.0-alpha62", owner="someone")

        result, _calls = check(tmp_path, pr)

        assert result == {"state": "failure", "text": NO_BOX}


class TestWorkflow:
    """The workflow loads the check from the file."""

    def test_the_workflow_holds_no_inline_check(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")

        assert "const check = async" not in text
        assert ".github/scripts/docs-check.cjs" in text

    def test_the_job_checks_out_the_scripts_folder_with_read_access(self) -> None:
        workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
        job = workflow["jobs"]["docs-check"]

        assert job["permissions"].get("contents") == "read"
        checkouts = [
            step
            for step in job["steps"]
            if str(step.get("uses", "")).startswith("actions/checkout@")
        ]
        assert len(checkouts) == 1
        assert ".github/scripts" in str(checkouts[0].get("with", {}).get("sparse-checkout", ""))
