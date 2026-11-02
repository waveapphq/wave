"""Test routes package."""

from wavecore.api.routes.tests.batch_routes import router as batch_router
from wavecore.api.routes.tests.import_export_routes import router as import_export_router
from wavecore.api.routes.tests.lifecycle_routes import router as lifecycle_router
from wavecore.api.routes.tests.routes import router
from wavecore.api.routes.tests.testdata_routes import router as testdata_router
from wavecore.api.routes.tests.version_routes import router as version_router

__all__ = [
    "batch_router",
    "import_export_router",
    "lifecycle_router",
    "router",
    "testdata_router",
    "version_router",
]
