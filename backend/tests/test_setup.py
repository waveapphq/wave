"""
Test to verify that the test infrastructure is set up correctly.
"""

import signal
import sys
from pathlib import Path

import pytest

SHIPPED_TEST_TIME_CAP_S = 60


def test_each_test_runs_under_the_shipped_time_cap(pytestconfig: pytest.Config) -> None:
    """A test that hangs fails by name at the cap instead of stalling the run."""
    assert pytestconfig.getini("timeout") == str(SHIPPED_TEST_TIME_CAP_S)
    remaining_s, _interval_s = signal.getitimer(signal.ITIMER_REAL)
    assert 0 < remaining_s <= SHIPPED_TEST_TIME_CAP_S


def test_python_version() -> None:
    """Verify Python version meets requirements (3.12+)."""
    assert sys.version_info >= (3, 12), "Python 3.12 or higher is required"


def test_project_structure() -> None:
    """Verify basic project structure exists."""
    project_root = Path(__file__).parent.parent.parent

    # Check backend structure
    backend_dir = project_root / "backend"
    assert backend_dir.exists(), "backend directory should exist"
    assert (backend_dir / "wavecore").exists(), "wavecore package should exist"
    assert (backend_dir / "pyproject.toml").exists(), "pyproject.toml should exist"
    assert (backend_dir / "tests").exists(), "backend tests directory should exist"

    # Check frontend structure
    frontend_dir = project_root / "frontend"
    assert frontend_dir.exists(), "frontend directory should exist"
    assert (frontend_dir / "src").exists(), "frontend src directory should exist"
    assert (frontend_dir / "tests").exists(), "frontend tests directory should exist"

    # Check e2e tests structure
    tests_dir = project_root / "tests"
    assert tests_dir.exists(), "tests directory should exist"
    assert (tests_dir / "e2e").exists(), "e2e tests directory should exist"


def test_can_import_wavecore_package() -> None:
    """Verify that the wavecore package can be imported and has version."""
    import wavecore

    # Verify the package has a version
    assert hasattr(wavecore, "__version__"), "wavecore package should have __version__"
    assert isinstance(wavecore.__version__, str), "__version__ should be a string"
    # Version should match the VERSION file (single source of truth)
    from pathlib import Path

    expected = next(
        line.split("=", 1)[1].strip()
        for line in Path(__file__)
        .resolve()
        .parent.parent.parent.joinpath("VERSION")
        .read_text()
        .splitlines()
        if line.strip().startswith("ver=")
    )
    assert (
        wavecore.__version__ == expected
    ), f"Expected version {expected}, got {wavecore.__version__}"


@pytest.mark.asyncio
async def test_async_support() -> None:
    """Verify that async tests work with pytest-asyncio."""
    # Simple async test to verify pytest-asyncio is configured correctly
    await asyncio_sleep(0.001)
    # Reaching this line confirms async tests execute successfully


async def asyncio_sleep(seconds: float) -> None:
    """Helper function for async sleep."""
    import asyncio

    await asyncio.sleep(seconds)
