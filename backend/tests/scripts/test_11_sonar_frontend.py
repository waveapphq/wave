"""Tests for scripts/gate/11-sonar-frontend.sh: the SonarQube scan and gate of the frontend."""

import pytest

from tests.scripts.gate_support import GateContract
from tests.scripts.sonar_gate_support import SonarGateCases
from tests.scripts.sonar_results_support import FRONTEND, Project


@pytest.fixture
def project() -> Project:
    return FRONTEND


class TestSonarQubeFrontend(SonarGateCases, GateContract):
    NUMBER = 11
    COVERAGE_REPORT = "frontend/coverage/lcov.info"
