"""Block routes package."""

from wavecore.api.routes.blocks.import_export_routes import router as import_export_router
from wavecore.api.routes.blocks.routes import router
from wavecore.api.routes.blocks.version_routes import router as version_router

__all__ = ["import_export_router", "router", "version_router"]
