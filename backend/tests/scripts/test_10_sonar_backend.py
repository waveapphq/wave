"""Tests for scripts/gate/10-sonar-backend.sh: the SonarQube scan and gate of the backend."""

import pytest

from tests.scripts.gate_support import GateContract
from tests.scripts.sonar_gate_support import SonarGateCases
from tests.scripts.sonar_results_support import BACKEND, Project


@pytest.fixture
def project() -> Project:
    return BACKEND


class TestSonarQubeBackend(SonarGateCases, GateContract):
    NUMBER = 10
    COVERAGE_REPORT = "backend/coverage.xml"
