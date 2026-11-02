"""
Unit tests for block execution control.

Tests requirements:
- REQ-3.1.2.6: Optional log level override per block instance
"""


class TestWorkflowBlockLogLevel:
    """Test suite for WorkflowBlock log level override (REQ-3.1.2.6)."""

    def test_workflow_block_without_log_level(self):
        """Test WorkflowBlock can be created without log_level (pass-through behavior)."""
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={"param1": "value1"},
        )

        assert block.block_id == "test-block"
        assert block.block_version == "1.0.0"
        assert block.order == 1
        assert block.parameters == {"param1": "value1"}
        # log_level should be None (pass-through)
        assert block.log_level is None

    def test_workflow_block_with_debug_log_level(self):
        """Test WorkflowBlock can be created with DEBUG log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.DEBUG,
        )

        assert block.log_level == LogLevel.DEBUG

    def test_workflow_block_with_info_log_level(self):
        """Test WorkflowBlock can be created with INFO log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.INFO,
        )

        assert block.log_level == LogLevel.INFO

    def test_workflow_block_with_warn_log_level(self):
        """Test WorkflowBlock can be created with WARN log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.WARN,
        )

        assert block.log_level == LogLevel.WARN

    def test_workflow_block_with_error_log_level(self):
        """Test WorkflowBlock can be created with ERROR log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.ERROR,
        )

        assert block.log_level == LogLevel.ERROR

    def test_workflow_block_with_fatal_log_level(self):
        """Test WorkflowBlock can be created with FATAL log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.FATAL,
        )

        assert block.log_level == LogLevel.FATAL

    def test_workflow_block_with_none_log_level(self):
        """Test WorkflowBlock can be created with NONE log level (suppress all logs)."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
            log_level=LogLevel.NONE,
        )

        assert block.log_level == LogLevel.NONE

    def test_workflow_block_log_level_serialization(self):
        """Test WorkflowBlock with log_level can be serialized to dict."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={"key": "value"},
            log_level=LogLevel.ERROR,
        )

        data = block.model_dump()
        assert data["log_level"] == LogLevel.ERROR.value
        assert data["block_id"] == "test-block"

    def test_workflow_block_log_level_deserialization(self):
        """Test WorkflowBlock with log_level can be created from dict."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.workflow import WorkflowBlock

        data = {
            "block_id": "test-block",
            "block_version": "1.0.0",
            "order": 1,
            "parameters": {},
            "log_level": LogLevel.WARN.value,
        }

        block = WorkflowBlock(**data)
        assert block.log_level == LogLevel.WARN

    def test_workflow_block_log_level_none_serialization(self):
        """Test WorkflowBlock without log_level serializes with None."""
        from wavecore.models.workflow import WorkflowBlock

        block = WorkflowBlock(
            block_id="test-block",
            block_version="1.0.0",
            order=1,
            parameters={},
        )

        data = block.model_dump()
        assert data["log_level"] is None


class TestBlockPluginLogLevel:
    """Test suite for BlockPlugin log level override (REQ-3.4.2.9 alignment)."""

    def test_block_plugin_without_log_level(self):
        """Test BlockPlugin can be created without log_level (pass-through behavior)."""
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={"command": "echo hello"},
            order=1,
        )

        assert plugin.plugin_id == "shell-script"
        assert plugin.plugin_version == "1.0.0"
        assert plugin.order == 1
        assert plugin.parameters == {"command": "echo hello"}
        # log_level should be None (pass-through)
        assert plugin.log_level is None

    def test_block_plugin_with_debug_log_level(self):
        """Test BlockPlugin can be created with DEBUG log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={},
            order=1,
            log_level=LogLevel.DEBUG,
        )

        assert plugin.log_level == LogLevel.DEBUG

    def test_block_plugin_with_warn_log_level(self):
        """Test BlockPlugin can be created with WARN log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={},
            order=1,
            log_level=LogLevel.WARN,
        )

        assert plugin.log_level == LogLevel.WARN

    def test_block_plugin_with_error_log_level(self):
        """Test BlockPlugin can be created with ERROR log level."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={},
            order=1,
            log_level=LogLevel.ERROR,
        )

        assert plugin.log_level == LogLevel.ERROR

    def test_block_plugin_with_none_log_level(self):
        """Test BlockPlugin can be created with NONE log level (suppress all logs)."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={},
            order=1,
            log_level=LogLevel.NONE,
        )

        assert plugin.log_level == LogLevel.NONE

    def test_block_plugin_log_level_serialization(self):
        """Test BlockPlugin with log_level can be serialized to dict."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        plugin = BlockPlugin(
            plugin_id="shell-script",
            plugin_version="1.0.0",
            parameters={"command": "ls"},
            order=1,
            log_level=LogLevel.INFO,
        )

        data = plugin.model_dump()
        assert data["log_level"] == LogLevel.INFO.value
        assert data["plugin_id"] == "shell-script"

    def test_block_plugin_log_level_deserialization(self):
        """Test BlockPlugin with log_level can be created from dict."""
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        data = {
            "plugin_id": "shell-script",
            "plugin_version": "1.0.0",
            "parameters": {},
            "order": 1,
            "log_level": LogLevel.FATAL.value,
        }

        plugin = BlockPlugin(**data)
        assert plugin.log_level == LogLevel.FATAL


class TestBlockDefinitionLogLevel:
    """Test suite for Block definition with internal plugin log levels."""

    def test_block_with_plugin_log_levels(self):
        """Test Block definition can contain plugins with configured log levels."""
        from tests.conftest import create_test_block
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="shell-script-1",
                    plugin_version="1.0.0",
                    parameters={"command": "echo 1"},
                    order=1,
                    log_level=LogLevel.ERROR,  # Quiet this plugin
                ),
                BlockPlugin(
                    plugin_id="shell-script-2",
                    plugin_version="1.0.0",
                    parameters={"command": "echo 2"},
                    order=2,
                    log_level=LogLevel.DEBUG,  # Verbose this plugin
                ),
                BlockPlugin(
                    plugin_id="shell-script-3",
                    plugin_version="1.0.0",
                    parameters={"command": "echo 3"},
                    order=3,
                    # No log_level - pass-through
                ),
            ],
        )

        assert len(block.plugins) == 3
        assert block.plugins[0].log_level == LogLevel.ERROR
        assert block.plugins[1].log_level == LogLevel.DEBUG
        assert block.plugins[2].log_level is None

    def test_block_serialization_with_plugin_log_levels(self):
        """Test Block with plugin log levels can be serialized."""
        from tests.conftest import create_test_block
        from wavecore.models.enums import LogLevel
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="shell-script-1",
                    plugin_version="1.0.0",
                    parameters={},
                    order=1,
                    log_level=LogLevel.WARN,
                )
            ],
        )

        data = block.model_dump()
        assert data["plugins"][0]["log_level"] == LogLevel.WARN.value

    def test_block_deserialization_with_plugin_log_levels(self):
        """Test Block with plugin log levels can be deserialized."""
        from wavecore.models.blocks import Block
        from wavecore.models.enums import LogLevel

        data = {
            "id": "test-block",
            "version": "1.0.0",
            "metadata": {
                "name": "Test Block",
                "description": "Test description",
                "author": "Test Author",
                "tags": [],
            },
            "type": "action",
            "plugin_id": "test-plugin",
            "plugins": [
                {
                    "plugin_id": "shell-script-1",
                    "plugin_version": "1.0.0",
                    "parameters": {},
                    "order": 1,
                    "log_level": LogLevel.INFO.value,
                }
            ],
        }

        block = Block(**data)
        assert block.plugins[0].log_level == LogLevel.INFO


class TestThreeLayerFiltering:
    """Test suite for three-layer filtering: plugin → block → execution."""

    def test_compute_effective_log_level_all_none(self):
        """Test effective level when all layers are None (pass-through to DEBUG)."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # All None means no filtering - use most permissive (DEBUG)
        effective = compute_effective_log_level(
            plugin_level=None,
            block_level=None,
            execution_level=None,
        )

        assert effective == LogLevel.DEBUG

    def test_compute_effective_log_level_plugin_only(self):
        """Test effective level when only plugin level is set."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        effective = compute_effective_log_level(
            plugin_level=LogLevel.WARN,
            block_level=None,
            execution_level=None,
        )

        assert effective == LogLevel.WARN

    def test_compute_effective_log_level_block_only(self):
        """Test effective level when only block level is set."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        effective = compute_effective_log_level(
            plugin_level=None,
            block_level=LogLevel.ERROR,
            execution_level=None,
        )

        assert effective == LogLevel.ERROR

    def test_compute_effective_log_level_execution_only(self):
        """Test effective level when only execution level is set."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        effective = compute_effective_log_level(
            plugin_level=None,
            block_level=None,
            execution_level=LogLevel.INFO,
        )

        assert effective == LogLevel.INFO

    def test_compute_effective_log_level_most_restrictive_wins(self):
        """Test that most restrictive level wins across all three layers."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # Plugin DEBUG (permissive), Block WARN, Execution INFO
        # Most restrictive is WARN
        effective = compute_effective_log_level(
            plugin_level=LogLevel.DEBUG,
            block_level=LogLevel.WARN,
            execution_level=LogLevel.INFO,
        )

        assert effective == LogLevel.WARN

    def test_compute_effective_log_level_execution_most_restrictive(self):
        """Test execution level wins when it's most restrictive."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # Plugin INFO, Block DEBUG, Execution ERROR
        # Most restrictive is ERROR (execution)
        effective = compute_effective_log_level(
            plugin_level=LogLevel.INFO,
            block_level=LogLevel.DEBUG,
            execution_level=LogLevel.ERROR,
        )

        assert effective == LogLevel.ERROR

    def test_compute_effective_log_level_plugin_most_restrictive(self):
        """Test plugin level wins when it's most restrictive."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # Plugin FATAL, Block WARN, Execution INFO
        # Most restrictive is FATAL (plugin)
        effective = compute_effective_log_level(
            plugin_level=LogLevel.FATAL,
            block_level=LogLevel.WARN,
            execution_level=LogLevel.INFO,
        )

        assert effective == LogLevel.FATAL

    def test_compute_effective_log_level_none_always_wins(self):
        """Test that NONE level always wins (suppresses all logs)."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # Block NONE should suppress all
        effective = compute_effective_log_level(
            plugin_level=LogLevel.DEBUG,
            block_level=LogLevel.NONE,
            execution_level=LogLevel.DEBUG,
        )

        assert effective == LogLevel.NONE

        # Plugin NONE should suppress all
        effective = compute_effective_log_level(
            plugin_level=LogLevel.NONE,
            block_level=LogLevel.DEBUG,
            execution_level=LogLevel.DEBUG,
        )

        assert effective == LogLevel.NONE

        # Execution NONE should suppress all
        effective = compute_effective_log_level(
            plugin_level=LogLevel.DEBUG,
            block_level=LogLevel.DEBUG,
            execution_level=LogLevel.NONE,
        )

        assert effective == LogLevel.NONE

    def test_compute_effective_log_level_equal_levels(self):
        """Test when all levels are the same."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        effective = compute_effective_log_level(
            plugin_level=LogLevel.INFO,
            block_level=LogLevel.INFO,
            execution_level=LogLevel.INFO,
        )

        assert effective == LogLevel.INFO

    def test_compute_effective_log_level_two_layers(self):
        """Test with only two layers set."""
        from wavecore.core.blocks.executor import compute_effective_log_level
        from wavecore.models.enums import LogLevel

        # Plugin and execution, no block
        effective = compute_effective_log_level(
            plugin_level=LogLevel.DEBUG,
            block_level=None,
            execution_level=LogLevel.WARN,
        )

        assert effective == LogLevel.WARN

        # Block and execution, no plugin
        effective = compute_effective_log_level(
            plugin_level=None,
            block_level=LogLevel.ERROR,
            execution_level=LogLevel.INFO,
        )

        assert effective == LogLevel.ERROR
