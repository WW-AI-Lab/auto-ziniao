"""统一错误响应（spec: web-admin-server）。

错误结构: {"error": {"code": <string>, "message": <string>}}
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def not_found(message="资源不存在"):
    return ApiError(404, "not_found", message)


def bad_request(message="请求参数错误"):
    return ApiError(400, "bad_request", message)


def conflict(message="资源冲突"):
    return ApiError(409, "conflict", message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', []))}: {e.get('msg', '')}"
            for e in exc.errors()[:5]
        )
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error",
                               "message": f"请求参数校验失败: {details}"}},
        )

    @app.exception_handler(Exception)
    async def _internal_error(request: Request, exc: Exception):
        import logging
        logging.getLogger("webadmin").exception("内部错误: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error",
                               "message": f"内部错误: {exc}"}},
        )
