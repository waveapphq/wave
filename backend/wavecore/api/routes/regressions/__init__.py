"""Regression routes package."""

from wavecore.api.routes.regressions.batch_routes import router as batch_router
from wavecore.api.routes.regressions.composition_routes import router as composition_router
from wavecore.api.routes.regressions.import_export_routes import router as import_export_router
from wavecore.api.routes.regressions.routes import router
from wavecore.api.routes.regressions.version_routes import router as version_router

__all__ = ["batch_router", "composition_router", "import_export_router", "router", "version_router"]
