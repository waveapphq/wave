"""Admin routes package."""

from wavecore.api.routes.admin.bulk_routes import router as bulk_router
from wavecore.api.routes.admin.log_routes import router as log_router
from wavecore.api.routes.admin.masking_routes import router as masking_router
from wavecore.api.routes.admin.routes import router

__all__ = ["bulk_router", "log_router", "masking_router", "router"]
