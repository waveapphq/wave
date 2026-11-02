"""Suite routes package."""

from wavecore.api.routes.suites.batch_routes import router as batch_router
from wavecore.api.routes.suites.composition_routes import router as composition_router
from wavecore.api.routes.suites.import_export_routes import router as import_export_router
from wavecore.api.routes.suites.routes import router
from wavecore.api.routes.suites.version_routes import router as version_router

__all__ = ["batch_router", "composition_router", "import_export_router", "router", "version_router"]
