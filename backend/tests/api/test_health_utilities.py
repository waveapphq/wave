"""Unit tests for health module utility functions.

This module tests internal utility functions in the health module to ensure
100% code coverage, including cache invalidation hooks and resource checking.
"""

from unittest.mock import MagicMock, patch

import pytest

from wavecore.api.routes import health


class TestHealthUtilities:
    """Test suite for health utility functions."""

    def test_invalidate_health_cache_clears_timestamps(self) -> None:
        """Test that invalidate_health_cache resets cache timestamps."""
        # Set some non-zero values
        health._cache_timestamp = 12345.0
        health._detailed_cache_timestamp = 67890.0

        # Invalidate cache
        health.invalidate_health_cache()

        # Both timestamps should be reset to 0
        assert health._cache_timestamp == 0.0
        assert health._detailed_cache_timestamp == 0.0

    def test_on_health_state_change_invalidates_cache(self) -> None:
        """Test that on_health_state_change calls invalidate_health_cache."""
        # Set cache timestamps
        health._cache_timestamp = 12345.0
        health._detailed_cache_timestamp = 67890.0

        # Call state change hook
        health.on_health_state_change()

        # Cache should be invalidated
        assert health._cache_timestamp == 0.0
        assert health._detailed_cache_timestamp == 0.0

    def test_on_config_change_invalidates_cache(self) -> None:
        """Test that on_config_change calls invalidate_health_cache."""
        # Set cache timestamps
        health._cache_timestamp = 12345.0
        health._detailed_cache_timestamp = 67890.0

        # Call config change hook
        health.on_config_change()

        # Cache should be invalidated
        assert health._cache_timestamp == 0.0
        assert health._detailed_cache_timestamp == 0.0

    @pytest.mark.asyncio
    async def test_check_resource_health_degraded_disk(self) -> None:
        """Test check_resource_health returns degraded when disk >85%."""
        with patch("psutil.disk_usage") as mock_disk:
            with patch("psutil.virtual_memory") as mock_mem:
                # Mock high disk usage (86%)
                mock_disk.return_value = MagicMock(percent=86.0)
                mock_mem.return_value = MagicMock(percent=50.0)

                result = health.check_resource_health()

                assert result == "degraded"

    @pytest.mark.asyncio
    async def test_check_resource_health_degraded_memory(self) -> None:
        """Test check_resource_health returns degraded when memory >85%."""
        with patch("psutil.disk_usage") as mock_disk:
            with patch("psutil.virtual_memory") as mock_mem:
                # Mock high memory usage (90%)
                mock_disk.return_value = MagicMock(percent=50.0)
                mock_mem.return_value = MagicMock(percent=90.0)

                result = health.check_resource_health()

                assert result == "degraded"

    @pytest.mark.asyncio
    async def test_check_resource_health_unhealthy_disk(self) -> None:
        """Test check_resource_health returns unhealthy when disk >95%."""
        with patch("psutil.disk_usage") as mock_disk:
            with patch("psutil.virtual_memory") as mock_mem:
                # Mock very high disk usage (96%)
                mock_disk.return_value = MagicMock(percent=96.0)
                mock_mem.return_value = MagicMock(percent=50.0)

                result = health.check_resource_health()

                assert result == "unhealthy"

    @pytest.mark.asyncio
    async def test_check_resource_health_unhealthy_memory(self) -> None:
        """Test check_resource_health returns unhealthy when memory >95%."""
        with patch("psutil.disk_usage") as mock_disk:
            with patch("psutil.virtual_memory") as mock_mem:
                # Mock very high memory usage (97%)
                mock_disk.return_value = MagicMock(percent=50.0)
                mock_mem.return_value = MagicMock(percent=97.0)

                result = health.check_resource_health()

                assert result == "unhealthy"

    def test_aggregate_health_status_unhealthy_when_not_initialized(self) -> None:
        """Test aggregate_health_status returns unhealthy when not initialized."""
        with patch("wavecore.api.routes.health.is_initialized", return_value=False):
            with patch("wavecore.api.routes.health.has_critical_errors", return_value=False):
                with patch("wavecore.api.routes.health.is_shutting_down", return_value=False):
                    components = {
                        "storage": "healthy",
                        "database": "healthy",
                        "execution_engine": "healthy",
                    }
                    result = health.aggregate_health_status(components)

                    assert result == "unhealthy"

    def test_aggregate_health_status_unhealthy_when_shutting_down(self) -> None:
        """Test aggregate_health_status returns unhealthy when shutting down."""
        with patch("wavecore.api.routes.health.is_initialized", return_value=True):
            with patch("wavecore.api.routes.health.has_critical_errors", return_value=False):
                with patch("wavecore.api.routes.health.is_shutting_down", return_value=True):
                    components = {
                        "storage": "healthy",
                        "database": "healthy",
                        "execution_engine": "healthy",
                    }
                    result = health.aggregate_health_status(components)

                    assert result == "unhealthy"
