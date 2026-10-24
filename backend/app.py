"""Authenticated HTTP bridge for the GitHub Pages frontend."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hmac
import os
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ConfigDict

from .provider import BridgeError, PorscheProvider


@dataclass(frozen=True, repr=False)
class Settings:
    access_key: str
    allowed_origin: str
    email: str
    password: str
    vin: str = ""

    @classmethod
    def from_env(cls):
        settings = cls(os.getenv("BRIDGE_ACCESS_KEY", ""), os.getenv("ALLOWED_ORIGIN", ""),
                       os.getenv("PORSCHE_EMAIL", ""), os.getenv("PORSCHE_PASSWORD", ""), os.getenv("PORSCHE_VIN", ""))
        origin = urlparse(settings.allowed_origin)
        if len(settings.access_key) < 32 or not settings.email or not settings.password:
            raise RuntimeError("Set BRIDGE_ACCESS_KEY (32+ characters), PORSCHE_EMAIL and PORSCHE_PASSWORD on the server.")
        if origin.scheme != "https" or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username:
            raise RuntimeError("ALLOWED_ORIGIN must be an exact HTTPS origin, without a path or trailing slash.")
        return settings


class CaptchaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9 -]+$")


def create_app(settings=None, provider=None):
    settings = settings or Settings.from_env()
    provider = provider or PorscheProvider(settings.email, settings.password, settings.vin)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await provider.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=[settings.allowed_origin],
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"],
                       allow_credentials=False)

    @app.middleware("http")
    async def private_responses(request, call_next):
        # Reject cross-origin callers before any upstream work, including failed requests.
        origin = request.headers.get("origin")
        if origin and origin != settings.allowed_origin:
            return JSONResponse({"code": "ORIGIN_DENIED"}, status_code=403, headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    async def authorize(request: Request):
        expected = "Bearer " + settings.access_key
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
            raise HTTPException(401, detail={"code": "BRIDGE_AUTH_REQUIRED"})

    @app.exception_handler(BridgeError)
    async def bridge_error(request, exc):
        payload = {"code": exc.code}
        if exc.image:
            payload["captchaImage"] = exc.image
        return JSONResponse(payload, status_code=exc.status)

    @app.get("/healthz")
    async def health():
        return {"status": "ok"}

    @app.get("/api/snapshot", dependencies=[Depends(authorize)])
    async def snapshot():
        return await provider.snapshot()

    @app.post("/api/auth/captcha", dependencies=[Depends(authorize)])
    async def captcha(body: CaptchaInput):
        return await provider.snapshot(captcha_code=body.code)

    return app
