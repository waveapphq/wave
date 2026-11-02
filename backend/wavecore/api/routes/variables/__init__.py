"""Variable routes package."""

from wavecore.api.routes.variables.expression_routes import router as expression_router
from wavecore.api.routes.variables.routes import router

__all__ = ["expression_router", "router"]
