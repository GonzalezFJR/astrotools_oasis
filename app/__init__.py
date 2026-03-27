"""Oasis AstroTools - FastAPI application factory."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from .config import settings

_APP_DIR = Path(__file__).parent


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description="Herramientas de planificación de observaciones astronómicas",
    )

    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

    app.mount(
        "/static",
        StaticFiles(directory=_APP_DIR / "static"),
        name="static",
    )

    from .routes import fov, home, snr

    app.include_router(home.router)
    app.include_router(snr.router)
    app.include_router(fov.router)

    return app
