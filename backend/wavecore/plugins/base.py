"""
Plugin Base Class

Abstract base class for all WAVE plugins implementing these requirements:
- REQ-3.4.2.1: Plugin creation interface
- REQ-3.4.2.2: Plugin parameter definition
- REQ-3.4.2.3: Plugin validation logic
- REQ-3.4.2.4: Plugin versioning
- REQ-3.4.2.5: Plugin documentation
- REQ-3.4.2.10: Plugin proxy declaration
"""

from abc import ABC, abstractmethod
from typing import Any

from wavecore.models.plugins import OutputField, Plugin, PluginMetadata, PluginParameter

PROXY_NOT_APPLICABLE = "not_applicable"
PROXY_SUPPORT_VALUES = ("supported", "unsupported", PROXY_NOT_APPLICABLE)


def declared_proxy_support(metadata: dict[str, Any]) -> str:
    """The proxy_support a plugin's metadata states; not_applicable when it states none."""
    stated: str = metadata.get("proxy_support", PROXY_NOT_APPLICABLE)
    if stated not in PROXY_SUPPORT_VALUES:
        raise ValueError(
            f"Plugin '{metadata['id']}' declares proxy_support '{stated}': "
            "it must be supported, unsupported or not_applicable"
        )
    return stated


class PluginBase(ABC):
    """
    Abstract base class for all WAVE plugins.

    Provides the foundation for plugin creation with standardized interface,
    parameter definition, validation, versioning, and documentation support.

    All concrete plugins must:
    1. Extend this base class
    2. Implement the metadata property
    3. Implement the execute() method
    4. Implement the validate() method
    5. Optionally override initialize() and cleanup() for lifecycle management
    """

    @property
    @abstractmethod
    def metadata(self) -> dict[str, Any]:
        """
        Plugin metadata declaration.

        Returns:
            dict containing:
                - id: Unique plugin identifier (kebab-case)
                - name: Human-readable plugin name
                - version: Semantic version (MAJOR.MINOR.PATCH)
                - category: Plugin category (network, remote, database, system,
                    kubernetes, helm, data, custom)
                - description: Plugin description for documentation
                - parameters: List of parameter definitions (dicts or PluginParameter objects)
                - return_type: Return type specification (string, integer, float, boolean, array,
                    map, table, or None)
                - output_schema: List of output field definitions (dicts or OutputField objects).
                    Required for all plugins. Use [] for plugins with dynamic/no outputs.
                - documentation: Optional dict with overview, behavior, examples
                - proxy_support: Optional. How the plugin relates to the Proxy setting:
                    supported, unsupported or not_applicable (the default when not stated)
        """
        pass  # pragma: no cover

    @property
    def proxy_support(self) -> str:
        """How the plugin relates to the Proxy setting (REQ-3.4.2.10)."""
        return declared_proxy_support(self.metadata)

    @abstractmethod
    async def execute(self, context: dict[str, Any]) -> Any:
        """
        Execute the plugin's main functionality.

        Args:
            context: Execution context containing:
                - parameters: Plugin parameter values
                - variables: Hierarchical variable scope
                - logger: Logger instance
                - credentials: Credentials if needed
                - artifacts_dir, testdata_dirs: the artifacts directory and the test data roots

        Returns:
            Plugin result based on return_type specification

        Raises:
            Exception: On execution failure
        """
        pass  # pragma: no cover

    @abstractmethod
    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate plugin parameters.

        Performs both schema-driven validation (type checking, required params)
        and custom validation logic (cross-parameter relationships, preconditions).

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: On validation failure with descriptive error message
            TypeError: On type mismatch
        """
        pass  # pragma: no cover

    async def initialize(self, context: dict[str, Any]) -> None:  # noqa: B027
        """
        Initialize plugin before execution (optional lifecycle hook).

        Override to perform setup operations like opening connections,
        loading resources, or preparing state.

        Args:
            context: Execution context

        Raises:
            Exception: On initialization failure
        """
        pass

    async def cleanup(self) -> None:  # noqa: B027
        """
        Cleanup plugin after execution (optional lifecycle hook).

        Override to perform teardown operations like closing connections,
        releasing resources, or cleaning up temporary state.

        Guaranteed to be called even if execution fails.

        Raises:
            Exception: On cleanup failure
        """
        pass

    def get_plugin_model(self) -> Plugin:
        """
        Convert metadata to Pydantic Plugin model for validation.

        Returns:
            Plugin: Validated plugin model

        Raises:
            ValueError: If metadata is invalid (e.g., bad version, invalid category)
        """
        meta = self.metadata

        # Enforce output_schema presence
        if "output_schema" not in meta:
            raise ValueError(f"Plugin '{meta['id']}' missing required 'output_schema' in metadata")

        # Convert parameter dicts to PluginParameter objects if needed
        parameters = []
        for param in meta.get("parameters", []):
            if isinstance(param, dict):
                parameters.append(PluginParameter(**param))
            elif isinstance(param, PluginParameter):
                parameters.append(param)
            else:
                raise ValueError(f"Invalid parameter type: {type(param)}")

        # Convert output_schema dicts to OutputField objects if needed
        outputs = []
        for out in meta["output_schema"]:
            if isinstance(out, dict):
                outputs.append(OutputField(**out))
            elif isinstance(out, OutputField):
                outputs.append(out)
            else:
                raise ValueError(f"Invalid output field type: {type(out)}")

        # Create Plugin model (validates semantic version, category, etc.)
        return Plugin(
            id=meta["id"],
            version=meta["version"],
            metadata=PluginMetadata(
                name=meta["name"],
                description=meta["description"],
                author=meta.get("author", "Unknown"),
                category=meta["category"],
                tags=meta.get("tags", []),
            ),
            parameters=parameters,
            outputs=outputs,
            implementation=meta.get("implementation", ""),
            return_type=meta.get("return_type"),
        )
