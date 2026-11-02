"""Promoted MCP finding helpers (REQ-5.2.7.9).

`_finding` and `_service_finding` live in wavecore/mcp/tools/_findings.py and are
consumed by organize.py and testdata.py.
"""

import inspect
from typing import Any

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException


def findings() -> Any:
    from wavecore.mcp.tools import _findings

    return _findings


def organize() -> Any:
    from wavecore.mcp.tools import organize as organize_tools

    return organize_tools


class TestFindingEnvelope:
    """_finding builds the exact envelope every tool result carries."""

    def test_all_five_keys_are_present(self) -> None:
        assert findings()._finding("BAD_INPUT", "Something is wrong", "Do this instead") == {
            "step": "input",
            "code": "BAD_INPUT",
            "severity": "error",
            "problem": "Something is wrong",
            "fix": "Do this instead",
        }

    def test_the_fix_is_optional(self) -> None:
        assert findings()._finding("BAD_INPUT", "Something is wrong") == {
            "step": "input",
            "code": "BAD_INPUT",
            "severity": "error",
            "problem": "Something is wrong",
            "fix": None,
        }


class TestServiceFinding:
    """_service_finding turns a refused service call into one input finding."""

    def test_a_conflict_keeps_the_service_message_verbatim(self) -> None:
        exc = ConflictException("File already exists: customers.csv")

        assert findings()._service_finding(exc) == {
            "step": "input",
            "code": "VALIDATION",
            "severity": "error",
            "problem": "File already exists: customers.csv",
            "fix": None,
        }

    def test_a_not_found_keeps_the_service_message_verbatim(self) -> None:
        exc = NotFoundException("Test data entry not found: ghost.csv")

        assert findings()._service_finding(exc)["problem"] == "Test data entry not found: ghost.csv"

    def test_a_validation_exception_keeps_the_service_message_verbatim(self) -> None:
        exc = ValidationException("Invalid test data path: /etc/passwd")

        assert findings()._service_finding(exc)["problem"] == "Invalid test data path: /etc/passwd"

    def test_a_plain_exception_falls_back_to_its_string(self) -> None:
        assert findings()._service_finding(ValueError("boom"))["problem"] == "boom"


class TestOrganizeConsumesThePromotion:
    """organize.py imports the helpers; its private copies are gone."""

    def test_organize_reuses_the_promoted_finding(self) -> None:
        assert organize()._finding is findings()._finding

    def test_organize_reuses_the_promoted_service_finding(self) -> None:
        assert organize()._service_finding is findings()._service_finding

    def test_the_private_definitions_are_no_longer_in_organize(self) -> None:
        source = inspect.getsource(organize())

        assert "def _finding(" not in source
        assert "def _service_finding(" not in source
