"""FastAPI 应用：API 路由 + 静态前端托管 + SPA 回退（spec: web-admin-server）。"""

import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from starlette.staticfiles import StaticFiles

from . import storage
from .api import chat, flows, monitoring, schedules
from .errors import install_error_handlers
from .scheduler.runner import start_scheduler, stop_scheduler
from .settings import FRONTEND_DIST, LOGS_DIR


def setup_logging() -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("webadmin")
    if logger.handlers:
        return
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(
        LOGS_DIR / "webadmin.log", maxBytes=5 * 1024 * 1024,
        backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    logger.addHandler(logging.StreamHandler())


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    storage.init_db()
    start_scheduler()
    logging.getLogger("webadmin").info("webadmin 启动完成")
    yield
    stop_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(title="紫鸟自动化引擎 Web 管理", lifespan=lifespan,
                  docs_url=None, redoc_url=None)
    install_error_handlers(app)

    app.include_router(flows.router)
    app.include_router(monitoring.router)
    app.include_router(schedules.router)
    app.include_router(chat.router)

    # 静态前端 + SPA 回退
    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"),
                  name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse(
                    status_code=404,
                    content={"error": {"code": "not_found",
                                       "message": f"API 不存在: /{full_path}"}})
            candidate = FRONTEND_DIST / full_path
            if full_path and candidate.is_file() \
                    and candidate.resolve().is_relative_to(FRONTEND_DIST.resolve()):
                return FileResponse(candidate)
            return FileResponse(FRONTEND_DIST / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        async def no_frontend():
            return JSONResponse({
                "message": "前端构建产物缺失（webadmin/frontend/dist）。"
                           "API 正常可用，前缀 /api。"})

    return app
