"""Authenticated HTTP bridge for the GitHub Pages frontend."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
import hmac
import os
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse, RedirectResponse, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ConfigDict

from .provider import BridgeError, PorscheProvider
from .session_auth import SessionAuth, COOKIE, REMEMBER_SECONDS


@dataclass(frozen=True, repr=False)
class Settings:
    access_key: str
    allowed_origin: str
    email: str
    password: str
    vin: str = ""
    login_password: str = ""
    app_origin: str = ""

    @classmethod
    def from_env(cls):
        settings = cls(os.getenv("BRIDGE_ACCESS_KEY", ""), os.getenv("ALLOWED_ORIGIN", ""),
                       os.getenv("PORSCHE_EMAIL", ""), os.getenv("PORSCHE_PASSWORD", ""), os.getenv("PORSCHE_VIN", ""),
                       os.getenv("APP_LOGIN_PASSWORD", ""), os.getenv("APP_ORIGIN", os.getenv("RENDER_EXTERNAL_URL", "")).rstrip("/"))
        origin = urlparse(settings.allowed_origin)
        if len(settings.access_key) < 32 or not settings.email or not settings.password:
            raise RuntimeError("Set BRIDGE_ACCESS_KEY (32+ characters), PORSCHE_EMAIL and PORSCHE_PASSWORD on the server.")
        if origin.scheme != "https" or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username:
            raise RuntimeError("ALLOWED_ORIGIN must be an exact HTTPS origin, without a path or trailing slash.")
        if settings.login_password:
            app_origin=urlparse(settings.app_origin)
            if not 12<=len(settings.login_password)<=256 or app_origin.scheme!='https' or not app_origin.netloc or app_origin.path or app_origin.query or app_origin.fragment or app_origin.username:
                raise RuntimeError('APP_LOGIN_PASSWORD must have 12-256 characters; set APP_ORIGIN to the exact HTTPS application origin.')
        return settings


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


class CaptchaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9 -]+$")


def create_app(settings=None, provider=None):
    settings = settings or Settings.from_env()
    provider = provider or PorscheProvider(settings.email, settings.password, settings.vin)

    auth=SessionAuth(settings.login_password,settings.access_key) if settings.login_password else None
    root=Path(__file__).resolve().parent.parent
    trusted_origin=settings.app_origin if auth else settings.allowed_origin

    @asynccontextmanager
    async def lifespan(app):
        yield
        await provider.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=[trusted_origin],
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"],
                       allow_credentials=False)

    @app.middleware("http")
    async def private_responses(request, call_next):
        # Reject cross-origin callers before any upstream work, including failed requests.
        origin = request.headers.get("origin")
        if auth and origin==settings.allowed_origin and origin!=trusted_origin and request.url.path=='/api/snapshot':
            migration_headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'Authorization, Content-Type'}
            if request.method=='OPTIONS':return Response(status_code=204,headers=migration_headers)
            if request.method=='GET':return JSONResponse({'code':'APP_LOGIN_REQUIRED'},status_code=401,headers=migration_headers)
        if origin and origin != trusted_origin:
            return JSONResponse({"code": "ORIGIN_DENIED"}, status_code=403, headers={"Cache-Control": "no-store"})
        if auth and request.method not in ('GET','HEAD','OPTIONS') and origin!=trusted_origin:
            return JSONResponse({'code':'ORIGIN_DENIED'},status_code=403,headers={'Cache-Control':'no-store'})
        if auth and request.url.path=='/auth/login' and request.headers.get('content-length','0').isdigit() and int(request.headers.get('content-length','0'))>4096:
            return JSONResponse({'code':'INVALID_LOGIN'},status_code=413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if auth:
            response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
            response.headers['X-Frame-Options']='DENY'
            response.headers['Strict-Transport-Security']='max-age=31536000'
        return response

    async def authorize(request: Request):
        if auth:
            if not auth.valid(request.cookies.get(COOKIE)):
                raise HTTPException(401,detail={'code':'APP_LOGIN_REQUIRED'})
            return
        expected = "Bearer " + settings.access_key
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
            raise HTTPException(401, detail={"code": "BRIDGE_AUTH_REQUIRED"})

    @app.exception_handler(BridgeError)
    async def bridge_error(request, exc):
        payload = {"code": exc.code}
        if exc.image:
            payload["captchaImage"] = exc.image
        return JSONResponse(payload, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request,exc):
        # Pydantic's default input echo can include a submitted password.
        return JSONResponse({'code':'INVALID_INPUT'},status_code=422)

    if auth:
        @app.get('/login')
        async def login_page(request: Request):
            if auth.valid(request.cookies.get(COOKIE)):return RedirectResponse('/',status_code=303)
            return FileResponse(root/'login.html')

        @app.post('/auth/login')
        async def login(body: LoginInput):
            token,status=await auth.login(body.password,body.remember)
            if token is None:return JSONResponse({'code':'LOGIN_RATE_LIMIT' if status==429 else 'LOGIN_FAILED'},status_code=status)
            response=JSONResponse({'ok':True})
            response.set_cookie(COOKIE,token,secure=True,httponly=True,samesite='strict',path='/',max_age=REMEMBER_SECONDS if body.remember else None)
            return response

        @app.post('/auth/logout')
        async def logout():
            response=JSONResponse({'ok':True})
            response.delete_cookie(COOKIE,path='/',secure=True,httponly=True,samesite='strict')
            return response

        @app.get('/auth/session',dependencies=[Depends(authorize)])
        async def session():return {'ok':True}

        @app.get('/')
        @app.get('/index.html')
        async def home(request: Request):
            if not auth.valid(request.cookies.get(COOKIE)):return RedirectResponse('/login',status_code=303)
            return HTMLResponse((root/'index.html').read_text().replace('<html lang="ja"','<html lang="ja" data-session-app="true"',1))

        # Public code/icons contain no vehicle data. Private HTML and API are gated above.
    @app.get("/healthz")
    async def health():
        return {"status": "ok"}

    @app.get("/api/snapshot", dependencies=[Depends(authorize)])
    async def snapshot():
        return await provider.snapshot()

    @app.post("/api/auth/captcha", dependencies=[Depends(authorize)])
    async def captcha(body: CaptchaInput):
        return await provider.snapshot(captcha_code=body.code)

    if auth:
        assets={'app.js','api.js','session.js','login.js','styles.css','manifest.webmanifest','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png'}
        @app.get('/{asset:path}')
        async def asset_file(asset: str):
            if asset not in assets:raise HTTPException(404)
            return FileResponse(root/asset)

    return app
